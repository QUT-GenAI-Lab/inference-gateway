"""
Download `meta-llama/Llama-3.2-3B-Instruct` into `model/` for SageMaker
uncompressed hosting.

The upstream repository is gated. Before running this script, the user must:

1. Accept the Llama 3.2 Community License at
   https://huggingface.co/meta-llama/Llama-3.2-3B-Instruct.
2. Export `HF_TOKEN` with a user access token that has read access to the
   `meta-llama/*` gated repositories.

Only root Transformers-format files are pulled via
`huggingface_hub.snapshot_download`; the directory `model/code/` shipped in
this repository is left untouched. The duplicate Meta release PyTorch
checkpoints under `original/*.pth` are explicitly excluded so the artifact
stays a single Transformers-format tree (config, tokenizer, safetensor index,
and the two safetensor shards).
"""

import os

from huggingface_hub import snapshot_download

MODEL_ID = "meta-llama/Llama-3.2-3B-Instruct"
cwd = os.environ.get("INIT_CWD", os.getcwd())
target_dir = os.path.join(cwd, "model")

# Hugging Face `meta-llama/Llama-3.2-3B-Instruct` ships at the repository root:
#   - *.json configs (config.json, generation_config.json,
#     model.safetensors.index.json, tokenizer_config.json,
#     special_tokens_map.json)
#   - two safetensor shards (model-00001-of-00002.safetensors,
#     model-00002-of-00002.safetensors)
#   - tokenizer files (tokenizer.json, tokenizer.model) and chat_template.jinja
#   - duplicate Meta release PyTorch checkpoints under original/ (the *.pth and
#     *.bin artefacts) that we want to exclude
allow_patterns = [
    "*.json",
    "*.safetensors",
    "tokenizer.json",
    "tokenizer.model",
    "chat_template.jinja",
]

ignore_patterns = [
    "original/*",
    "*.pth",
    "*.bin",
]

print(f"Downloading {MODEL_ID} model artefacts into {target_dir}")
print(f"Allow patterns: {allow_patterns}")
print(f"Ignore patterns: {ignore_patterns}")

snapshot_download(
    repo_id=MODEL_ID,
    local_dir=target_dir,
    allow_patterns=allow_patterns,
    ignore_patterns=ignore_patterns,
)

print(f"Saved {MODEL_ID} artefacts to {target_dir}")
