import json
from typing import Any

import torch
from transformers import (
    AutoModelForCausalLM,
    AutoTokenizer,
    pipeline,
    BitsAndBytesConfig,
)
from emissions_tracker import track_emissions

CONTENT_TYPE_JSON = "application/json"
ACCEPT_HEADER_JSON = CONTENT_TYPE_JSON
ENABLE_QUANTIZATION = False  # For devices that cannot fit the full-sized model.

MAX_INPUT_TOKENS = 4096
MAX_NEW_TOKENS = 512

MAX_MESSAGES = 32
MAX_TEXT_LENGTH = 4000
MAX_SYSTEM_LENGTH = 2000

VALID_MESSAGE_ROLES = {"user", "assistant"}


def _normalise_messages(value: Any) -> list[dict[str, str]]:
    if not isinstance(value, list):
        raise TypeError("messages must be an array")
    if len(value) == 0:
        raise ValueError("messages must contain at least one message")
    if len(value) > MAX_MESSAGES:
        raise ValueError(f"messages must contain at most {MAX_MESSAGES} messages")

    messages: list[dict[str, str]] = []
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

        messages.append(
            {
                "role": role,
                "content": content[:MAX_TEXT_LENGTH],
            }
        )

    return messages


def _normalise_system(value: Any) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise TypeError("system must be a string when provided")
    truncated = value[:MAX_SYSTEM_LENGTH]
    return truncated or None


def _build_transcript(
    system: str | None, messages: list[dict[str, str]]
) -> list[dict[str, str]]:
    transcript: list[dict[str, str]] = []
    if system:
        transcript.append({"role": "system", "content": system})
    transcript.extend(
        {"role": message["role"], "content": message["content"]} for message in messages
    )
    return transcript


def model_fn(model_dir: str) -> dict[str, Any]:
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    # The endpoint runs on an ml.g4dn.xlarge with a single NVIDIA T4. Use FP16
    # on CUDA instead of bfloat16, which the T4 does not
    # support natively, and fall back to float32 for local CPU runners.
    # reference: https://huggingface.co/mistralai/Voxtral-4B-TTS-2603/discussions/30
    dtype = torch.float16 if device.type == "cuda" else torch.float32

    model_kwargs: dict[str, Any] = {
        "torch_dtype": dtype,
        "low_cpu_mem_usage": True,
        "use_cache": True,
    }
    if device.type == "cuda":
        model_kwargs["device_map"] = {"": 0}  # Force the model onto GPU 0.

    if ENABLE_QUANTIZATION:
        model_kwargs["load_in_4bit"] = True
        model_kwargs["quantization_config"] = BitsAndBytesConfig(load_in_4bit=True)

    print(f"Using device: {device}, torch version: {torch.__version__}, dtype: {dtype}")
    llama_model = AutoModelForCausalLM.from_pretrained(
        model_dir,
        **model_kwargs,
    )
    llama_model.eval()

    llama_tokenizer = AutoTokenizer.from_pretrained(model_dir)

    llama32_3b_pipe = pipeline(
        "text-generation",
        model=llama_model,
        tokenizer=llama_tokenizer,
    )

    return {
        "model": llama_model,
        "tokenizer": llama_tokenizer,
        "pipeline": llama32_3b_pipe,
        "device": device,
    }


def input_fn(request_body: str | bytes, content_type: str) -> dict[str, Any]:
    if content_type != CONTENT_TYPE_JSON:
        raise ValueError(f"Unsupported content type: {content_type}")

    body = (
        request_body.decode("utf-8")
        if isinstance(request_body, bytes)
        else request_body
    )
    try:
        payload = json.loads(body or "{}")
    except json.JSONDecodeError as exc:
        raise ValueError(f"Request body is not valid JSON: {exc}") from exc

    print(f"Parsed payload: {payload}")

    if payload.get("healthCheck"):
        return {"healthCheck": True}

    if "messages" not in payload:
        raise ValueError("messages is required")

    system = _normalise_system(payload.get("system"))
    messages = _normalise_messages(payload.get("messages"))
    include_eco_metrics = bool(payload.get("includeEcoMetrics", False))

    return {
        "messages": messages,
        "system": system,
        "include_eco_metrics": include_eco_metrics,
    }


@track_emissions
def predict_fn(data: dict[str, Any], model_context: dict[str, Any]) -> dict[str, Any]:
    if data.get("healthCheck"):
        return {"status": "ok"}

    messages = data["messages"]
    system = data.get("system")

    tokenizer = model_context["tokenizer"]
    llama32_3b_pipe = model_context["pipeline"]

    print(f"Messages: {messages}")
    print(f"System: {system}")
    print(f"Include Eco Metrics: {data.get('include_eco_metrics')}")

    input_history = _build_transcript(system, messages)

    # Llama 3.2 supports a 128k context window, but this endpoint intentionally
    # caps rendered prompts
    prompt_ids = tokenizer.apply_chat_template(
        input_history,
        add_generation_prompt=True,
        return_tensors="pt",
    )
    input_length = len(prompt_ids)
    if input_length > MAX_INPUT_TOKENS:
        raise ValueError(
            f"Prompt exceeds the {MAX_INPUT_TOKENS} rendered token limit: "
            f"measured {input_length} tokens"
        )

    print(
        "Rendering prompt and generating up to "
        f"{MAX_NEW_TOKENS} new tokens "
        f"from {input_length} prompt tokens."
    )

    with torch.inference_mode():
        outputs = llama32_3b_pipe(
            input_history,
            max_new_tokens=MAX_NEW_TOKENS,
        )

    try:
        content = outputs[-1]["generated_text"][-1]["content"]
    except (IndexError, KeyError, TypeError) as exc:
        raise ValueError("Text-generation pipeline returned malformed output") from exc
    if not isinstance(content, str):
        raise TypeError("Text-generation pipeline content must be a string")

    print(f"Generated content: {content}")

    return {"content": content}


def output_fn(prediction: dict[str, Any], accept: str) -> tuple[str, str]:
    if accept != ACCEPT_HEADER_JSON:
        raise ValueError(f"Unsupported accept header: {accept}")

    print(f"Returning response: {prediction}")
    return json.dumps(prediction), CONTENT_TYPE_JSON
