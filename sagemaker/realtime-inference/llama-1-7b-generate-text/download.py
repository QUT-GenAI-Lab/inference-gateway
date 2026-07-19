import os

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer

MODEL_ID = "huggyllama/llama-7b"
cwd = os.environ.get("INIT_CWD", os.getcwd())

tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)
tokenizer.pad_token = tokenizer.eos_token
tokenizer.padding_side = "left"

try:
    model = AutoModelForCausalLM.from_pretrained(
        MODEL_ID,
        torch_dtype=torch.bfloat16,
        trust_remote_code=True,
        low_cpu_mem_usage=True,
    )
except ImportError as exc:
    if "accelerate" not in str(exc).lower():
        raise
    model = AutoModelForCausalLM.from_pretrained(
        MODEL_ID,
        torch_dtype=torch.bfloat16,
        trust_remote_code=True,
    )

model_path = os.path.join(cwd, "model")
print(f"Saving {MODEL_ID} model and tokenizer to {model_path}")

model.save_pretrained(save_directory=model_path, safe_serialization=True)
tokenizer.save_pretrained(save_directory=model_path)

