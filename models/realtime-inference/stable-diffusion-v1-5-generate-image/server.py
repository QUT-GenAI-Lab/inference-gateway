"""Load the model at startup, then serve its SageMaker inference hooks over HTTP."""

import importlib
import os
import sys
from contextlib import asynccontextmanager
from typing import Any, Callable

from fastapi import FastAPI, Request, Response
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse

MODEL_PATH = os.environ.get("MODEL_PATH", "/models")
MODEL_CODE_PATH = os.environ.get("MODEL_CODE_PATH", os.path.join(MODEL_PATH, "code"))

JSON_CONTENT_TYPE = "application/json"

_model_context: dict[str, Any] | None = None
_hooks: dict[str, Callable[..., Any]] = {}


def _load_hooks() -> dict[str, Callable[..., Any]]:
    if MODEL_CODE_PATH not in sys.path:
        sys.path.insert(0, MODEL_CODE_PATH)

    module = importlib.import_module("inference")

    hooks: dict[str, Callable[..., Any]] = {}
    for name in ("model_fn", "input_fn", "predict_fn", "output_fn"):
        fn = getattr(module, name, None)
        if not callable(fn):
            raise RuntimeError(f"inference.{name} is not defined")
        hooks[name] = fn
    return hooks


def _load_model() -> dict[str, Any]:
    print(f"Loading model from {MODEL_PATH} using hooks in {MODEL_CODE_PATH}")
    context = _hooks["model_fn"](MODEL_PATH)
    print("Model loaded and ready for inference")
    return context


@asynccontextmanager
async def lifespan(_: FastAPI):
    global _model_context
    _hooks.update(_load_hooks())
    _model_context = await run_in_threadpool(_load_model)
    yield
    _model_context = None


app = FastAPI(title="GPU Model Server", version="1.0.0", lifespan=lifespan)


@app.get("/health")
async def health() -> Response:
    if _model_context is None:
        return JSONResponse({"status": "loading"}, status_code=503)
    return JSONResponse({"status": "ready"})


@app.post("/invoke")
async def invoke(request: Request) -> Response:
    if _model_context is None:
        return JSONResponse({"error": "Model is not ready"}, status_code=503)

    body = await request.body()
    content_type = request.headers.get("content-type", JSON_CONTENT_TYPE)
    accept = request.headers.get("accept", JSON_CONTENT_TYPE)

    try:
        data = await run_in_threadpool(_hooks["input_fn"], body, content_type)
        if isinstance(data, dict) and data.get("healthCheck"):
            return JSONResponse({"status": "ok"})

        prediction = await run_in_threadpool(
            _hooks["predict_fn"], data, _model_context
        )
        output = await run_in_threadpool(_hooks["output_fn"], prediction, accept)
    except (ValueError, TypeError) as exc:
        return JSONResponse({"error": str(exc)}, status_code=400)
    except Exception as exc:  # noqa: BLE001
        print(f"Inference failed: {exc!r}")
        return JSONResponse({"error": "Inference failed"}, status_code=500)

    if isinstance(output, tuple) and len(output) == 2:
        return Response(content=output[0], media_type=output[1])
    if isinstance(output, (bytes, bytearray)):
        return Response(content=bytes(output), media_type=accept)
    return Response(content=output, media_type=JSON_CONTENT_TYPE)
