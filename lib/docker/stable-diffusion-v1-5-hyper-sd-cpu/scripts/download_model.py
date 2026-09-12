"""Export Stable Diffusion 1.5 fused with the Hyper-SD 2-step LoRA to ONNX.

Follows the official Hyper-SD model card: https://huggingface.co/ByteDance/Hyper-SD#sd15-related-models
"""

import shutil
from pathlib import Path

import torch
from diffusers.pipelines.stable_diffusion.pipeline_stable_diffusion import (
    StableDiffusionPipeline,
)
from diffusers.schedulers.scheduling_ddim import DDIMScheduler
from optimum.exporters.onnx import onnx_export_from_model

MODEL_ID = "stable-diffusion-v1-5/stable-diffusion-v1-5"
BASE_MODEL_REVISION = "451f4fe16113bff5a5d2269ed5ad43b0592e9a14"
HYPER_SD_REPO = "ByteDance/Hyper-SD"
HYPER_SD_REVISION = "bc08d970a87c74c71209491d64e352584569886345"
HYPER_SD_WEIGHT = "Hyper-SD15-2steps-lora.safetensors"

OUTPUT = Path("model")

def apply_hyper_sd_lora(pipe: StableDiffusionPipeline) -> None:
    pipe.load_lora_weights(
        HYPER_SD_REPO,
        weight_name=HYPER_SD_WEIGHT,
        revision=HYPER_SD_REVISION,
    )
    pipe.fuse_lora()
    pipe.unload_lora_weights()
    pipe.scheduler = DDIMScheduler.from_config(
        pipe.scheduler.config,
        timestep_spacing="trailing",
    )


def main() -> None:
    if OUTPUT.exists():
        shutil.rmtree(OUTPUT)
    OUTPUT.mkdir(parents=True)

    pipe = StableDiffusionPipeline.from_pretrained(
        MODEL_ID,
        revision=BASE_MODEL_REVISION,
        torch_dtype=torch.float32,
    )

    apply_hyper_sd_lora(pipe)

    onnx_export_from_model(
        model=pipe,
        output=OUTPUT,
        task="text-to-image",
        device="cpu",
    )

    print(f"Model exported to {OUTPUT}")


if __name__ == "__main__":
    main()
