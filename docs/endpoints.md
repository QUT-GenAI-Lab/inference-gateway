# API Endpoints

This document describes the endpoints exposed by the GenAI Arcade Inference Gateway. Routes require the `x-api-key` header; each OpenAPI route should include `security: [{ apiKey: [] }]`.

## `GET /health`

Checks whether the gateway Lambda is reachable.

**Response:**

```json
{
  "status": "ok"
}
```

## `POST /generate/chat`

Generate chat responses through AWS Bedrock, SageMaker, or the EC2 development backend.

**Request Body:**

```json
{
  "messages": [
    { "role": "user", "content": "What is the capital of France?" }
  ],
  "system": "You are a helpful assistant that provides concise answers.",
  "model": "amazon.nova-micro-v1:0",
  "includeEcoMetrics": false
}
```

| Name | Type | Default | Description |
| --- | --- | --- | --- |
| `messages` | array | required | Chat messages with `role` and `content` fields. |
| `system` | string | none | Optional system instructions. |
| `includeEcoMetrics` | boolean | `false` | Include energy, water, and emissions metrics when supported by the provider. |
| `model` | string | `amazon.nova-micro-v1:0` | Routed Bedrock, SageMaker, or EC2 model ID. |

Use `liquidai.lfm2.5-230m` for LFM2.5-230M chat. Set `includeEcoMetrics` to `true` for CodeCarbon estimates:

```json
{
  "messages": [{ "role": "user", "content": "Who are you?" }],
  "model": "liquidai.lfm2.5-230m",
  "includeEcoMetrics": true
}
```

**Response:**

```json
{
  "content": "The capital of France is Paris."
}
```

## `POST /predict/next-token`

Predicts likely GPT-2 next tokens for a text input. The Lambda route is backed by `NextTokenProvider`; the current implementation is `SageMakerGpt2Provider`, which invokes a SageMaker Serverless endpoint.

**Request Body:**

```json
{
  "text": "The weather today is",
  "top_k": 10
}
```

| Name | Type | Default | Description |
| --- | --- | --- | --- |
| `text` | string | required | Input text used as context for prediction. Maximum length is 2,000 characters. |
| `top_k` | integer | `10` | Number of predictions to return. Values are clamped to `1..50`. |

Whitespace-only `text` returns an empty token list.

**Response:**

```json
{
  "tokens": [
    {
      "rank": 1,
      "token_id": 2576,
      "token": " sunny",
      "display": "sunny",
      "probability": 0.0912,
      "percentage": 9.12,
      "logprob": -2.395
    }
  ]
}
```

Use `display` for UI labels and raw `token` when appending a selected prediction to the input text.

**Error Response:**

```json
{
  "error": {
    "code": "PREDICTION_FAILED",
    "message": "Prediction failed"
  }
}
```

Common error codes:

| Code | Meaning |
| --- | --- |
| `INVALID_REQUEST` | Request body or parameters are invalid. |
| `UNSUPPORTED_CONTENT_TYPE` | Request content type is not supported. |
| `PREDICTION_FAILED` | SageMaker inference failed. |
| `MODEL_UNAVAILABLE` | SageMaker endpoint is unavailable or timed out. |
| `INTERNAL_ERROR` | Unexpected gateway error. |
