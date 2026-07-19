import json
import math
from typing import Any

import torch
import torch.nn.functional as F
from transformers import GPT2LMHeadModel, GPT2Tokenizer

CONTENT_TYPE_JSON = "application/json"
DEFAULT_TOP_K = 10
MIN_TOP_K = 1
MAX_TOP_K = 50
MAX_TEXT_LENGTH = 2000


def _clamp_top_k(value: Any) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = DEFAULT_TOP_K

    return min(MAX_TOP_K, max(MIN_TOP_K, parsed))


def _display_token(token: str) -> str:
    stripped = token.strip()
    if stripped:
        return stripped

    if "\n" in token:
        return "\\n"

    if "\t" in token:
        return "\\t"

    if " " in token:
        return "space"

    return repr(token)


def model_fn(model_dir: str) -> dict[str, Any]:
    tokenizer = GPT2Tokenizer.from_pretrained(model_dir)
    model = GPT2LMHeadModel.from_pretrained(model_dir)
    tokenizer.pad_token = tokenizer.eos_token

    device = torch.device("cpu")

    # Set model to evaluation mode
    model.eval()

    return {
        "model": model,
        "tokenizer": tokenizer,
        "device": device,
    }


def input_fn(request_body: str | bytes, content_type: str) -> dict[str, Any]:
    if CONTENT_TYPE_JSON not in content_type:
        raise ValueError(f"Unsupported content type: {content_type}")

    body = (
        request_body.decode("utf-8")
        if isinstance(request_body, bytes)
        else request_body
    )
    payload = json.loads(body or "{}")
    if payload.get("healthCheck"):
        return {"healthCheck": True}
    text = str(payload.get("text", ""))[:MAX_TEXT_LENGTH]

    return {
        "text": text,
        "top_k": _clamp_top_k(payload.get("top_k", DEFAULT_TOP_K)),
    }


def predict_fn(data: dict[str, Any], model_context: dict[str, Any]) -> dict[str, Any]:
    if data.get("healthCheck"):
        return {"status": "ok"}

    text = str(data["text"])
    if not text.strip():
        return {"tokens": []}

    model = model_context["model"]
    tokenizer = model_context["tokenizer"]
    top_k = _clamp_top_k(data.get("top_k", DEFAULT_TOP_K))

    input_ids = tokenizer.encode(text, return_tensors="pt")
    if input_ids.numel() == 0:
        return {"tokens": []}

    with torch.no_grad():
        outputs = model(input_ids)
        logits = outputs.logits[0, -1, :]
        log_probs = F.log_softmax(logits, dim=-1)
        top_log_probs, top_indices = torch.topk(log_probs, top_k)

    tokens = []
    for rank, (logprob_tensor, token_id_tensor) in enumerate(
        zip(top_log_probs, top_indices), start=1
    ):
        token_id = int(token_id_tensor.item())
        token = tokenizer.decode([token_id])
        logprob = float(logprob_tensor.item())
        probability = float(math.exp(logprob))

        tokens.append(
            {
                "rank": rank,
                "token_id": token_id,
                "token": token,
                "display": _display_token(token),
                "probability": probability,
                "percentage": probability * 100,
                "logprob": logprob,
            }
        )

    return {"tokens": tokens}


def output_fn(prediction: dict[str, Any], accept: str) -> tuple[str, str]:
    return json.dumps(prediction), CONTENT_TYPE_JSON
