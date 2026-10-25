"""Switch models and stop an idle single-GPU host."""

import asyncio
from collections.abc import Awaitable, Callable
import logging
import time

ComposeRunner = Callable[..., Awaitable[str]]
HealthProbe = Callable[[str], Awaitable[bool]]
InstanceStopper = Callable[[], Awaitable[None]]

logger = logging.getLogger(__name__)


class UnknownModelError(KeyError):
    pass


class GpuBusyError(RuntimeError):
    pass


class ProviderNotReadyError(RuntimeError):
    pass


class InstanceShuttingDownError(RuntimeError):
    pass


class ModelManager:
    def __init__(
        self,
        services: list[str],
        compose: ComposeRunner,
        health: HealthProbe,
        model_port: int = 8000,
        idle_timeout_minutes: int = 15,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        if (
            isinstance(idle_timeout_minutes, bool)
            or not isinstance(idle_timeout_minutes, int)
            or idle_timeout_minutes < 0
        ):
            raise ValueError("idle_timeout_minutes must be a nonnegative integer")
        self.services = set(services)
        self.model_port = model_port
        self.idle_timeout_minutes = idle_timeout_minutes
        self._compose = compose
        self._health = health
        self._clock = clock
        self._last_activity = clock()
        self._active_operations = 0
        self._shutting_down = False
        # One T4 means switching and inference are serialized behind one lock.
        self._gpu_lock = asyncio.Lock()
        self._loading: set[str] = set()
        self._tasks: dict[str, asyncio.Task[None]] = {}

    def validate(self, model: str) -> None:
        if model not in self.services:
            raise UnknownModelError(f"Unknown model: {model}")

    def is_loading(self, model: str) -> bool:
        return model in self._loading

    def _begin_activity(self) -> None:
        if self._shutting_down:
            raise InstanceShuttingDownError(
                "GPU development instance is shutting down."
            )
        self._active_operations += 1
        self._last_activity = self._clock()

    def _end_activity(self) -> None:
        self._active_operations -= 1
        self._last_activity = self._clock()

    async def check_idle_shutdown(self, stop_instance: InstanceStopper) -> bool:
        """Stop the instance after inactivity if its GPU is idle."""
        if (
            self.idle_timeout_minutes == 0
            or self._shutting_down
            or self._active_operations
            or self._loading
            or self._gpu_lock.locked()
            or self._clock() - self._last_activity < self.idle_timeout_minutes * 60
        ):
            return False

        async with self._gpu_lock:
            if (
                self._shutting_down
                or self._active_operations
                or self._loading
                or self._clock() - self._last_activity
                < self.idle_timeout_minutes * 60
            ):
                return False
            self._shutting_down = True

        logger.info("GPU development instance idle; requesting EC2 shutdown")
        try:
            await stop_instance()
        except Exception:
            logger.exception("Failed to stop idle GPU development instance")
            self._shutting_down = False
            return False
        return True

    async def running_services(self) -> list[str]:
        output = await self._compose(
            "ps", "--services", "--status", "running"
        )
        return [
            line.strip() for line in output.splitlines() if line.strip() in self.services
        ]

    async def is_ready(self, model: str) -> bool:
        if model not in await self.running_services():
            return False
        return await self._health(model)

    async def _stop_others(self, model: str) -> None:
        for current in await self.running_services():
            if current != model:
                await self._compose("stop", current)

    async def _load(self, model: str) -> None:
        try:
            async with self._gpu_lock:
                await self._stop_others(model)
                await self._compose("pull", model)
                await self._compose(
                    "up",
                    "--detach",
                    "--wait",
                    "--wait-timeout",
                    "600",
                    model,
                )
        finally:
            self._loading.discard(model)
            self._last_activity = self._clock()

    async def ensure_awake(self, model: str) -> str:
        """Start cold models in the background and return "ready" or "loading".
        Reject model switches while the GPU is busy.
        """
        self.validate(model)
        self._begin_activity()

        try:
            if await self.is_ready(model):
                await self._stop_others(model)
                return "ready"

            if model in self._loading:
                return "loading"

            if self._gpu_lock.locked():
                raise GpuBusyError(
                    "GPU is busy with another model; retry once it is idle."
                )

            self._loading.add(model)
            task = asyncio.create_task(self._load(model))
            self._tasks[model] = task
            task.add_done_callback(lambda _: self._tasks.pop(model, None))
            return "loading"
        finally:
            self._end_activity()

    async def wait(self, model: str) -> None:
        task = self._tasks.get(model)
        if task is not None:
            await task

    async def invoke(
        self,
        model: str,
        forward: Callable[[str], Awaitable[object]],
    ) -> object:
        """Run ``forward`` while holding the GPU lock so nothing can switch."""
        self.validate(model)
        self._begin_activity()

        try:
            if not await self.is_ready(model):
                raise ProviderNotReadyError(
                    "Model is not ready. Wake it and retry later."
                )

            if self._gpu_lock.locked():
                raise ProviderNotReadyError(
                    "Another inference is using the GPU. Please try again later."
                )

            async with self._gpu_lock:
                if not await self.is_ready(model):
                    raise ProviderNotReadyError(
                        "Model stopped before inference started. Please try again later."
                    )
                return await forward(model)
        finally:
            self._end_activity()
