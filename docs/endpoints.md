# API Endpoints

This document describes the API endpoints exposed by the GenAI Arcade Inference Gateway. 

## `POST /generate`

Text generation endpoint for chat-based models. Accepts a list of messages and generation parameters, and returns the generated content along with token usage.

**Request Body:**

```json
{
  "messages": [
    {"role": "system", "content": "You are a helpful assistant."},
    {"role": "user", "content": "What is the capital of France?"}
  ],
  "model": "google/gemma-4-E2B-it",
  "max_tokens": 512,
  "temperature": 0.7,
  "top_p": 0.9
}
```

| Name | Type | Default | Description |
|---|---|---|---|
| `messages` (required) | `list[dict[str, str]]` | N/A | Chat messages with `role` and `content` keys |
| `model` | `str` | `google/gemma-4-E2B-it` | Model ID to use for generation |
| `max_tokens` | `int` | `512` | Maximum tokens to generate |
| `temperature` | `float` | `0.7` | Sampling temperature (0.0-2.0) |
| `top_p` | `float` | `0.9` | Nucleus sampling threshold (0.0-1.0) |

**Response:**

200 OK

```json
{
    "content": "The capital of France is Paris.",
}
```

400 Bad Request

```json
{
    "error": "Invalid request body: 'messages' field is required."
}
```

404 Not Found

```json
{
    "error": "Model 'google/gemma-4-E2B-it' not found."
}
```

500 Internal Server Error

```json
{
    "error": "An unexpected error occurred while processing the request."
}
```