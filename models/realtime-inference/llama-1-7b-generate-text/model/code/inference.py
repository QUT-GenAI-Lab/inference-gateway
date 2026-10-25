import json
from typing import Any

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer
from emissions_tracker import track_emissions

CONTENT_TYPE_JSON = "application/json"
MAX_INPUT_TOKENS = 512
MAX_NEW_TOKENS = 512
MAX_TEXT_LENGTH = 4000
VALID_MESSAGE_ROLES = {"user", "assistant"}
STOP_MARKERS = [
    "\n\nHuman:",
    "\n\nUser:",
    "\n\nQuestion:",
    "\n\nQ:",
    "\n\nA:",
    "\nHuman:",
    "\nUser:",
    "Human:",
    "User:",
    "Question:",
    "###",
    "Answer:",
]


def _normalise_messages(value: Any) -> list[dict[str, str]]:
    print(f"Normalising messages: {value}")

    if not isinstance(value, list):
        raise ValueError("messages must be an array")

    messages = []
    for message in value:
        if not isinstance(message, dict):
            raise ValueError("each message must be an object")

        role = message.get("role")
        if role not in VALID_MESSAGE_ROLES:
            raise ValueError("message role must be 'user' or 'assistant'")

        messages.append(
            {
                "role": role,
                "content": str(message.get("content") or "")[:MAX_TEXT_LENGTH],
            }
        )

    return messages


def _format_chat_prompt(system: str | None, messages: list[dict[str, str]]) -> str:
    """Formats the chat prompt for LLaMA-1 based on the system message and user/assistant messages."""
    full_prompt = ""
    if system:
        full_prompt += f"Instructions: {system[:MAX_TEXT_LENGTH]}\n\n"

    for message in messages:
        label = "Question" if message["role"] == "user" else "Response"
        full_prompt += f"{label}: {message['content']}\n\n"

    full_prompt += "Response: "
    return full_prompt


def _clean_response(response_text: str, original_prompt: str) -> str:
    """Clean up Llama-1 response to prevent loops and cut at natural stopping points"""
    if original_prompt in response_text:
        response_text = response_text.replace(original_prompt, "").strip()

    # Split by common conversation markers and take first part
    for marker in STOP_MARKERS:
        if marker in response_text:
            response_text = response_text.split(marker)[0].strip()
            break

    # Remove repetitive patterns (simple heuristic)
    # by splitting the response into lines and removing duplicates while preserving order
    lines = response_text.split("\n")
    cleaned_lines = []
    seen_lines = set()

    for line in lines:
        line = line.strip()
        if line and line not in seen_lines:
            cleaned_lines.append(line)
            seen_lines.add(line)
        # If we encounter a line we've seen before, the model might be looping
        elif line in seen_lines:
            break

    response_text = "\n".join(cleaned_lines)

    # Truncate if too long (another safety measure)
    if len(response_text) > 1000:
        response_text = response_text[:1000] + "..."

    return response_text.strip()


def model_fn(model_dir: str) -> dict[str, Any]:
    tokenizer = AutoTokenizer.from_pretrained(model_dir)
    # Llama-1 doesn't have a pad token by default
    tokenizer.pad_token = tokenizer.eos_token
    tokenizer.padding_side = "left"  # Important for generation

    # Set device and dtype based on availability of CUDA
    # If CUDA is available, we use bfloat16 for better performance; otherwise, we fall back to float32.
    # Source: https://huggingface.co/docs/transformers/main_classes/model#transformers.PreTrainedModel.from_pretrained
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Using device: {device}, torch version: {torch.__version__}")

    model_kwargs: dict[str, Any] = {
        "torch_dtype": torch.bfloat16,
        "trust_remote_code": True,
        "low_cpu_mem_usage": True,
        "use_cache": True,
    }
    if device.type == "cuda":
        model_kwargs["device_map"] = {"": 0}  # Force to GPU 0

    model = AutoModelForCausalLM.from_pretrained(model_dir, **model_kwargs)

    return {
        "model": model,
        "tokenizer": tokenizer,
        "device": device,
    }


def input_fn(request_body: str | bytes, content_type: str) -> dict[str, Any]:
    if CONTENT_TYPE_JSON not in content_type:
        raise ValueError(f"Unsupported content type: {content_type}")

    print(f"Received request body: {request_body}")

    body = (
        request_body.decode("utf-8")
        if isinstance(request_body, bytes)
        else request_body
    )
    payload = json.loads(body or "{}")
    print(f"Parsed payload: {payload}")
    if payload.get("healthCheck"):
        return {"healthCheck": True}

    system = payload.get("system")
    print(f"System message: {system}")
    include_eco_metrics = payload.get("includeEcoMetrics", False)
    return {
        "messages": _normalise_messages(payload.get("messages")),
        "system": str(system)[:MAX_TEXT_LENGTH] if system is not None else None,
        "include_eco_metrics": include_eco_metrics,
    }


@track_emissions
def predict_fn(data: dict[str, Any], model_context: dict[str, Any]) -> dict[str, Any]:
    if data.get("healthCheck"):
        return {"status": "ok"}

    messages = data.get("messages", [])
    system = data.get("system", "")

    print(f"Messages: {messages}")
    print(f"System: {system}")
    print(f"Include Eco Metrics: {data.get('include_eco_metrics')}")

    # Skip generation if no messages have content
    if not any(message["content"].strip() for message in messages):
        return {"content": ""}

    formatted_prompt = _format_chat_prompt(system, messages)
    model = model_context["model"]
    tokenizer = model_context["tokenizer"]
    device = model_context["device"]
    print("Formatted prompt:")
    print("-" * 40)
    print(formatted_prompt)
    print("-" * 40)

    inputs = tokenizer(
        formatted_prompt,
        return_tensors="pt",
        max_length=MAX_INPUT_TOKENS,
        truncation=True,
        padding=False,
    ).to(device)

    # Pass the stop strings to allow appropriate early stopping during generation and prevent the model from looping.
    # When generating with stop strings, you must pass the model's tokenizer to the `tokenizer` argument of `generate`
    early_stop_kwargs = {
        "stop_strings": STOP_MARKERS,
        "tokenizer": tokenizer,
        "eos_token_id": tokenizer.eos_token_id,
        "pad_token_id": tokenizer.pad_token_id,
        "use_cache": True,
    }

    with torch.no_grad():
        outputs = model.generate(
            **inputs, max_new_tokens=MAX_NEW_TOKENS, **early_stop_kwargs
        )

    response_tokens = outputs[0][inputs["input_ids"].shape[1] :]
    content = tokenizer.decode(response_tokens, skip_special_tokens=True)
    print(f"Generated content: {content}")
    content = _clean_response(content, formatted_prompt)

    return {"content": content}


def output_fn(prediction: dict[str, Any], accept: str) -> tuple[str, str]:
    print(f"Returning response: {prediction}")
    return json.dumps(prediction), CONTENT_TYPE_JSON
