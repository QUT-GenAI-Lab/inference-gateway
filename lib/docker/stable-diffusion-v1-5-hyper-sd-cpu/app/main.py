from contextlib import asynccontextmanager
from random import randint
from typing import Annotated

from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

from .inference import (
    HYPER_SD_GUIDANCE_SCALE,
    HYPER_SD_NUM_INFERENCE_STEPS,
    SUPPORTED_MEDIA_TYPES,
    HyperSdConfigError,
    generate_image,
    load_pipeline,
)

MAX_PROMPT_LENGTH = 2000
MAX_SEED = 2**32 - 1


@asynccontextmanager
async def lifespan(app: FastAPI):
    load_pipeline()

    yield


app = FastAPI(lifespan=lifespan)


class GenerateDimensions(BaseModel):
    width: int = Field(ge=64, le=1024, multiple_of=8, default=512)
    height: int = Field(ge=64, le=1024, multiple_of=8, default=512)


class GenerateConfig(BaseModel):
    num_inference_steps: int = HYPER_SD_NUM_INFERENCE_STEPS
    guidance_scale: float = HYPER_SD_GUIDANCE_SCALE


class GenerateRequest(BaseModel):
    prompt: str = Field(max_length=MAX_PROMPT_LENGTH)
    dimensions: GenerateDimensions = GenerateDimensions()
    seed: int = Field(ge=0, le=MAX_SEED, default_factory=lambda: randint(0, MAX_SEED))
    config: GenerateConfig = GenerateConfig()


def negotiate_media_type(accept: str | None) -> str:
    if not accept or not accept.strip():
        return "image/jpeg"

    # The gateway forwards an already-negotiated concrete media type.
    normalized = accept.split(";", 1)[0].strip().lower()
    if normalized in SUPPORTED_MEDIA_TYPES:
        return normalized

    raise HTTPException(
        status_code=406,
        detail="Accept must allow image/jpeg or image/png.",
    )


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post(
    "/generate",
    responses={200: {"content": {"image/png": {}, "image/jpeg": {}}}},
    response_class=Response,
)
def generate(
    request: GenerateRequest,
    accept: Annotated[str | None, Header()] = "image/jpeg",
):
    media_type = negotiate_media_type(accept)

    try:
        image = generate_image(
            prompt=request.prompt,
            width=request.dimensions.width,
            height=request.dimensions.height,
            seed=request.seed,
            guidance_scale=request.config.guidance_scale,
            media_type=media_type,
        )
    except HyperSdConfigError as error:
        raise HTTPException(status_code=400, detail=str(error))

    return Response(content=image, media_type=media_type)
