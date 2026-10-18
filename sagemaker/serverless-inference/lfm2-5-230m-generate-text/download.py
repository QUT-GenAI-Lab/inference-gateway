"""Download LiquidAI/LFM2.5-230M into model/ for SageMaker packaging."""

import os

from huggingface_hub import snapshot_download

MODEL_ID = "LiquidAI/LFM2.5-230M"
cwd = os.environ.get("INIT_CWD", os.getcwd())
target_dir = os.path.join(cwd, "model")

snapshot_download(
    repo_id=MODEL_ID,
    local_dir=target_dir,
    allow_patterns=[
        "*.json",
        "*.safetensors",
        "tokenizer.json",
        "tokenizer.model",
        "chat_template.jinja",
    ],
)

print(f"Saved {MODEL_ID} artifacts to {target_dir}")
