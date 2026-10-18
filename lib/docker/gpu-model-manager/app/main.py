"""FastAPI wrapper around the GPU model manager."""

import asyncio
from contextlib import asynccontextmanager
import os
from collections.abc import AsyncIterator

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import Response

from app.manager import (
    GpuBusyError,
    InstanceShuttingDownError,
    ModelManager,
    ProviderNotReadyError,
    UnknownModelError,
)
from app.shutdown import request_instance_stop

COMPOSE_FILE = os.environ.get("GPU_COMPOSE_FILE", "/workspace/compose.yaml")
COMPOSE_PROJECT = os.environ.get("GPU_COMPOSE_PROJECT", "gpu")
MODEL_PORT = int(os.environ.get("GPU_MODEL_PORT", "8000"))
SERVICES = [
    service.strip()
    for service in os.environ.get("GPU_MODEL_SERVICES", "").split(",")
    if service.strip()
]
IDLE_TIMEOUT_MINUTES = int(os.environ.get("GPU_IDLE_TIMEOUT_MINUTES", "15"))


async def compose(*args: str, timeout: float = 660) -> str:
    command = [
        "docker",
        "compose",
        "--file",
        COMPOSE_FILE,
        "--project-name",
        COMPOSE_PROJECT,
        *args,
    ]
    print("$", " ".join(command), flush=True)

    process = await asyncio.create_subprocess_exec(
        *command,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )

    try:
        stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=timeout)
    except TimeoutError:
        process.kill()
        await process.wait()
        raise RuntimeError(f"Docker Compose timed out after {timeout}s") from None

    stdout_text = stdout.decode().strip()
    stderr_text = stderr.decode().strip()

    if process.returncode != 0:
        raise RuntimeError(stderr_text or stdout_text or "Docker Compose failed")

    return stdout_text


async def health(service: str) -> bool:
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            response = await client.get(f"http://{service}:{MODEL_PORT}/health")
            return response.status_code == 200
    except httpx.HTTPError:
        return False


manager = ModelManager(
    SERVICES,
    compose,
    health,
    MODEL_PORT,
    IDLE_TIMEOUT_MINUTES,
)


async def idle_shutdown_loop() -> None:
    while True:
        await asyncio.sleep(30)
        await manager.check_idle_shutdown(request_instance_stop)


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    if manager.idle_timeout_minutes == 0:
        yield
        return
    task = asyncio.create_task(idle_shutdown_loop())
    try:
        yield
    finally:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

app = FastAPI(title="GPU Model Manager", version="1.0.0", lifespan=lifespan)


@app.get("/health")
async def healthcheck() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/models")
async def models() -> dict[str, object]:
    return {
        "available": sorted(manager.services),
        "running": await manager.running_services(),
        "loading": sorted(
            service for service in manager.services if manager.is_loading(service)
        ),
    }


@app.get("/models/{model}/status")
async def model_status(model: str) -> dict[str, object]:
    try:
        manager.validate(model)
    except UnknownModelError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    return {
        "model": model,
        "running": await manager.is_ready(model),
        "loading": manager.is_loading(model),
    }


@app.post("/models/{model}/wake")
async def wake_model(model: str) -> dict[str, str]:
    try:
        status = await manager.ensure_awake(model)
    except UnknownModelError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except GpuBusyError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except InstanceShuttingDownError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    return {"model": model, "status": status}


@app.post("/models/{model}/invoke")
async def invoke_model(model: str, request: Request) -> Response:
    body = await request.body()
    content_type = request.headers.get("content-type", "application/json")
    accept = request.headers.get("accept", "application/json")

    async def forward(service: str) -> Response:
        url = f"http://{service}:{MODEL_PORT}/invoke"
        try:
            async with httpx.AsyncClient(timeout=None) as client:
                upstream = await client.post(
                    url,
                    content=body,
                    headers={
                        "content-type": content_type,
                        "accept": accept,
                    },
                )
        except httpx.HTTPError as exc:
            raise HTTPException(
                status_code=502, detail=f"Model request failed: {exc}"
            ) from exc

        return Response(
            content=upstream.content,
            status_code=upstream.status_code,
            media_type=upstream.headers.get("content-type"),
        )

    try:
        return await manager.invoke(model, forward)
    except UnknownModelError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except (ProviderNotReadyError, InstanceShuttingDownError) as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
