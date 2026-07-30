import io
import json
import secrets
from dataclasses import dataclass
from typing import Any

import torch
from diffusers.pipelines.stable_diffusion.pipeline_stable_diffusion import (
    StableDiffusionPipeline,
)
from diffusers.schedulers.scheduling_unipc_multistep import UniPCMultistepScheduler
from PIL import Image

CONTENT_TYPE_JSON = "application/json"
CONTENT_TYPE_JPEG = "image/jpeg"
CONTENT_TYPE_PNG = "image/png"
SUPPORTED_IMAGE_TYPES = {CONTENT_TYPE_JPEG, CONTENT_TYPE_PNG}
MODEL_ID = "stable-diffusion-v1-5/stable-diffusion-v1-5"


@dataclass
class Defaults:
    max_prompt_length: int = 2000
    min_dimension: int = 64
    max_dimension: int = 1024
    max_seed: int = 4_294_967_295
    default_inference_steps: int = 25
    default_guidance_scale: float = 7.5


def _media_type(value: str) -> str:
    return value.split(";", 1)[0].strip().lower()


def _require_integer(value: Any, field_name: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise TypeError(f"{field_name} must be an integer")
    return value


def _validate_dimension(value: Any, field_name: str) -> int:
    dimension = _require_integer(value, field_name)
    if not Defaults.min_dimension <= dimension <= Defaults.max_dimension:
        raise ValueError(
            f"{field_name} must be between {Defaults.min_dimension} and {Defaults.max_dimension}"
        )
    if dimension % 8 != 0:
        raise ValueError(f"{field_name} must be divisible by 8")
    return dimension


def model_fn(model_dir: str) -> dict[str, Any]:
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    dtype = torch.float16 if device.type == "cuda" else torch.float32
    print(f"Loading Stable Diffusion on {device} with dtype {dtype}")

    pipeline = StableDiffusionPipeline.from_pretrained(
        model_dir,
        torch_dtype=dtype,
        use_safetensors=True,
        # This endpoint is protected and only accessible by widgets with controlled prompts,
        # so we can disable the safety checker
        safety_checker=None,
        variant="fp16",
        local_files_only=True,
        feature_extractor=None,
        requires_safety_checker=False,
    ).to(device)
    pipeline.scheduler = UniPCMultistepScheduler.from_config(pipeline.scheduler.config)

    return {"pipeline": pipeline, "device": device}


def input_fn(request_body: str | bytes, content_type: str) -> dict[str, Any]:
    if _media_type(content_type) != CONTENT_TYPE_JSON:
        raise ValueError(f"Unsupported content type: {content_type}")

    body = (
        request_body.decode("utf-8")
        if isinstance(request_body, bytes)
        else request_body
    )
    payload = json.loads(body or "{}")
    if not isinstance(payload, dict):
        raise TypeError("request body must be a JSON object")
    if payload.get("healthCheck") is True:
        return {"healthCheck": True}

    prompt = payload.get("prompt")
    if not isinstance(prompt, str) or len(prompt) > Defaults.max_prompt_length:
        raise ValueError(
            f"prompt must be a string containing 0-{Defaults.max_prompt_length} characters"
        )

    dimensions = payload.get("dimensions")
    if not isinstance(dimensions, dict):
        raise TypeError("dimensions must be an object")
    width = _validate_dimension(dimensions.get("width"), "dimensions.width")
    height = _validate_dimension(dimensions.get("height"), "dimensions.height")

    model = payload.get("model")
    if model != MODEL_ID:
        raise ValueError(f"model must be {MODEL_ID}")

    seed_value = payload.get("seed")
    seed = (
        secrets.randbits(32)
        if seed_value is None
        else _require_integer(seed_value, "seed")
    )
    if not 0 <= seed <= Defaults.max_seed:
        raise ValueError(f"seed must be between 0 and {Defaults.max_seed}")

    config = payload.get("config", {})
    if not isinstance(config, dict):
        raise TypeError("config must be an object")
    steps = _require_integer(
        config.get("num_inference_steps", Defaults.default_inference_steps),
        "config.num_inference_steps",
    )
    if not 1 <= steps <= 50:
        raise ValueError("config.num_inference_steps must be between 1 and 50")
    guidance_scale = config.get("guidance_scale", Defaults.default_guidance_scale)
    if isinstance(guidance_scale, bool) or not isinstance(guidance_scale, (int, float)):
        raise TypeError("config.guidance_scale must be a number")
    guidance_scale = float(guidance_scale)
    if not 0 <= guidance_scale <= 20:
        raise ValueError("config.guidance_scale must be between 0 and 20")

    return {
        "prompt": prompt,
        "dimensions": {"width": width, "height": height},
        "model": model,
        "seed": seed,
        "config": {
            "num_inference_steps": steps,
            "guidance_scale": guidance_scale,
        },
    }


def predict_fn(data: dict[str, Any], model_context: dict[str, Any]) -> Any:
    if data.get("healthCheck"):
        return {"status": "ok"}

    generator = None
    if data["seed"] is not None:
        generator = torch.manual_seed(data["seed"])
    result = model_context["pipeline"](
        prompt=data["prompt"],
        height=data["dimensions"]["height"],
        width=data["dimensions"]["width"],
        num_inference_steps=data["config"]["num_inference_steps"],
        guidance_scale=data["config"]["guidance_scale"],
        generator=generator,
    )
    if not result.images:
        raise ValueError("Stable Diffusion returned no images")
    if not isinstance(result.images[0], Image.Image):
        raise TypeError("Stable Diffusion returned a non-Pillow image")
    return result.images[0]


def output_fn(prediction: Any, accept: str) -> str | bytes:
    if isinstance(prediction, dict):
        return json.dumps(prediction)

    content_type = _media_type(accept)
    if content_type not in SUPPORTED_IMAGE_TYPES:
        raise ValueError(f"Unsupported accept type: {accept}")
    if not isinstance(prediction, Image.Image):
        raise TypeError("prediction must be a Pillow image")

    image = (
        prediction.convert("RGB") if content_type == CONTENT_TYPE_JPEG else prediction
    )
    image_format = "JPEG" if content_type == CONTENT_TYPE_JPEG else "PNG"
    # Save the image to buffer instead of disk for immediate return
    buffer = io.BytesIO()
    image.save(buffer, format=image_format)
    image_bytes = buffer.getvalue()
    print(
        {
            "prediction_type": type(prediction).__name__,
            "output_type": type(image_bytes).__name__,
            "output_size": len(image_bytes),
            "accept": accept,
        }
    )
    return image_bytes
