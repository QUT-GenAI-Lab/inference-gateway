from io import BytesIO
from os import environ
from threading import Lock
from typing import cast

import torch
from optimum.onnxruntime import ORTStableDiffusionPipeline
from PIL import Image

MODEL_PATH = environ.get("MODEL_PATH", "./model")

HYPER_SD_NUM_INFERENCE_STEPS = 2
HYPER_SD_GUIDANCE_SCALE = 0

SUPPORTED_MEDIA_TYPES = ("image/jpeg", "image/png")

_pipeline: ORTStableDiffusionPipeline | None = None
_generation_lock = Lock()


def load_pipeline() -> ORTStableDiffusionPipeline:
    global _pipeline
    _pipeline = ORTStableDiffusionPipeline.from_pretrained(
        MODEL_PATH,
        provider="CPUExecutionProvider",
    )
    return _pipeline


def get_pipeline() -> ORTStableDiffusionPipeline:
    assert _pipeline is not None
    return _pipeline


class HyperSdConfigError(ValueError):
    pass

def generate_image(
    prompt: str,
    width: int,
    height: int,
    seed: int,
    guidance_scale: float = HYPER_SD_GUIDANCE_SCALE,
    media_type: str = "image/jpeg",
) -> bytes:
    pipeline = get_pipeline()

    with _generation_lock:
        images, _ = pipeline(
            prompt,
            num_inference_steps=HYPER_SD_NUM_INFERENCE_STEPS,
            guidance_scale=float(guidance_scale),
            width=width,
            height=height,
            generator=torch.Generator(device="cpu").manual_seed(seed),
            output_type="pil",
            return_dict=False,
        )

    image = cast(list[Image.Image], images)[0]

    output = BytesIO()
    pil_format = "PNG" if media_type == "image/png" else "JPEG"
    image.save(output, format=pil_format)

    return output.getvalue()
