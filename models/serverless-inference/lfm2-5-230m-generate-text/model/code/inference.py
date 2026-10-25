import json
from typing import Any

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer

from emissions_tracker import track_emissions

CONTENT_TYPE_JSON = "application/json"
MAX_MESSAGES = 32
MAX_TEXT_LENGTH = 4000
MAX_SYSTEM_LENGTH = 2000
MAX_INPUT_TOKENS = 4096
MAX_NEW_TOKENS = 512
VALID_MESSAGE_ROLES = {"user", "assistant"}


def _normalise_messages(value: Any) -> list[dict[str, str]]:
    if not isinstance(value, list) or not value:
        raise ValueError("messages must be a non-empty array")
    if len(value) > MAX_MESSAGES:
        raise ValueError(f"messages must contain at most {MAX_MESSAGES} messages")

    messages = []
    for message in value:
        if not isinstance(message, dict):
            raise TypeError("each message must be an object")

        role = message.get("role")
        if role not in VALID_MESSAGE_ROLES:
            raise ValueError("message role must be 'user' or 'assistant'")

        content = message.get("content")
        if not isinstance(content, str):
            raise TypeError("message content must be a string")
        if not content.strip():
            raise ValueError("message content must not be empty")

        messages.append({"role": role, "content": content[:MAX_TEXT_LENGTH]})
    return messages


def model_fn(model_dir: str) -> dict[str, Any]:
    tokenizer = AutoTokenizer.from_pretrained(model_dir)
    model = AutoModelForCausalLM.from_pretrained(
        model_dir,
        torch_dtype=torch.float32,
    )
    model.eval()
    return {"model": model, "tokenizer": tokenizer}


def input_fn(request_body: str | bytes, content_type: str) -> dict[str, Any]:
    if content_type != CONTENT_TYPE_JSON:
        raise ValueError(f"Unsupported content type: {content_type}")

    if isinstance(request_body, bytes):
        request_body = request_body.decode("utf-8")
    try:
        payload = json.loads(request_body or "{}")
    except json.JSONDecodeError as exc:
        raise ValueError(f"Request body is not valid JSON: {exc}") from exc
    if not isinstance(payload, dict):
        raise TypeError("request body must be a JSON object")

    health_check = payload.get("healthCheck", False)
    if not isinstance(health_check, bool):
        raise TypeError("healthCheck must be a boolean")
    if health_check:
        return {"healthCheck": True}

    if "messages" not in payload:
        raise ValueError("messages is required")

    system = payload.get("system")
    if system is not None and not isinstance(system, str):
        raise TypeError("system must be a string when provided")
    system = system[:MAX_SYSTEM_LENGTH] if system else None

    include_eco_metrics = payload.get("includeEcoMetrics", False)
    if not isinstance(include_eco_metrics, bool):
        raise TypeError("includeEcoMetrics must be a boolean")

    return {
        "messages": _normalise_messages(payload["messages"]),
        "system": system,
        "include_eco_metrics": include_eco_metrics,
    }


@track_emissions
def predict_fn(data: dict[str, Any], model_context: dict[str, Any]) -> dict[str, Any]:
    if data.get("healthCheck"):
        return {"status": "ok"}

    conversation = []
    if data.get("system"):
        conversation.append({"role": "system", "content": data["system"]})
    conversation.extend(data["messages"])

    tokenizer = model_context["tokenizer"]
    model = model_context["model"]
    inputs = tokenizer.apply_chat_template(
        conversation,
        tokenize=True,
        add_generation_prompt=True,
        return_tensors="pt",
        return_dict=True,
    )
    input_length = inputs["input_ids"].shape[-1]
    if input_length > MAX_INPUT_TOKENS:
        raise ValueError(
            f"Prompt exceeds the {MAX_INPUT_TOKENS} rendered token limit: "
            f"measured {input_length} tokens"
        )

    with torch.inference_mode():
        output_sequences = model.generate(
            **inputs,
            do_sample=True,
            temperature=0.1,
            top_k=50,
            repetition_penalty=1.05,
            max_new_tokens=MAX_NEW_TOKENS,
        )

    content = tokenizer.decode(
        output_sequences[0, input_length:],
        skip_special_tokens=True,
    )
    if not isinstance(content, str):
        raise TypeError("Generated content must be a string")
    return {"content": content}


def output_fn(prediction: dict[str, Any], accept: str) -> tuple[str, str]:
    if accept != CONTENT_TYPE_JSON:
        raise ValueError(f"Unsupported accept header: {accept}")
    return json.dumps(prediction), CONTENT_TYPE_JSON
