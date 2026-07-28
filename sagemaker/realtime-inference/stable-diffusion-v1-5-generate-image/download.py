import shutil
from pathlib import Path

from huggingface_hub import snapshot_download

MODEL_ID = "stable-diffusion-v1-5/stable-diffusion-v1-5"
MODEL_DIRECTORY = Path(__file__).resolve().parent / "model"

# Download only the pipeline configuration/tokenizer and the FP16 safetensors
# used by the runtime. The safety checker is intentionally disabled, so its
# weights and feature extractor are not part of the artifact.

# We use FP16 (half-precision) to reduce the model size and speed up inference.
ALLOW_PATTERNS = [
    "model_index.json",
    "scheduler/scheduler_config.json",
    "text_encoder/config.json",
    "text_encoder/model.fp16.safetensors",
    "tokenizer/*",
    "unet/config.json",
    "unet/diffusion_pytorch_model.fp16.safetensors",
    "vae/config.json",
    "vae/diffusion_pytorch_model.fp16.safetensors",
]
IGNORE_PATTERNS = [
    "*.bin",
    "*.ckpt",
    "*.msgpack",
    "*.onnx",
    "*.pickle",
    "*.pt",
    "*.pth",
    "*.index.json",
    ".cache/*",
    "**/.cache/*",
]


def main() -> None:
    MODEL_DIRECTORY.mkdir(parents=True, exist_ok=True)
    print(f"Downloading {MODEL_ID} FP16 artifacts to {MODEL_DIRECTORY}")
    snapshot_download(
        repo_id=MODEL_ID,
        local_dir=MODEL_DIRECTORY,
        allow_patterns=ALLOW_PATTERNS,
        ignore_patterns=IGNORE_PATTERNS,
    )
    shutil.rmtree(MODEL_DIRECTORY / ".cache", ignore_errors=True)
    print("Download complete. Existing model/code files were preserved.")


if __name__ == "__main__":
    main()
