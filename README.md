# GenAI Arcade Inference Gateway

The `Inference Gateway API` is a unified API to provide LLM inference capabilities to GenAI Arcade widgets, such as text generation, next-token probabilities, image generation and more. It abstracts the complexity of managing multiple models and providers, allowing widgets to be provider-agnostic.

```
┌───────────────────────────────────────────────────────────────────┐
│                      FRONTEND (Static, SvelteKit)                 │
│                                                                   │
│  linkedin  │  politeness  │  milkless  │  RAG  │  calculator ...  │
│  (15+ widget pages, each calling their own widget API)            │
└───────────────────────────────┬───────────────────────────────────┘
                                │  @gradio/client
                                ▼
┌──────────────────────────────────────────────────────────────────┐
│                     WIDGET API MICROSERVICES                     │
│                                                                  │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐  │
│  │ linkedin   │  │ politeness │  │ milkless   │  │  ...more   │  │
│  │ app.py     │  │ app.py     │  │ app.py     │  │            │  │
│  └─────┬──────┘  └─────┬──────┘  └─────┬──────┘  └──────┬─────┘  │
│        │               │               │                │        │
│        │           HTTP REST / JSON (stateless)         │        │
└────────┼───────────────┼───────────────┼────────────────┼────────┘
         │               │               │                │
         ▼               ▼               ▼                ▼
┌───────────────────────────────────────────────────────────────────┐
│                          INFERENCE GATEWAY                        │
|                                                                   |
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  POST /generate          Text generation (chat)             │  │
│  │  POST /predict/tokens    Next-token probabilities           │  │
│  │  POST /generate/image    Text-to-image                      │  │
│  │  POST /translate         Machine translation                │  │
│  │  GET  /models            List available models              │  │
│  │  ... and more                                               │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                              │                                    │
│                         ProviderAdapter                           │
│                              │                                    │
└──────────────────────────────┼────────────────────────────────────┘
                               │
                ┌──────────────┼──────────────┐
                │                             │
                ▼                             ▼
┌─────────────────────────┐  ┌─────────────────────────┐
│   External Providers    │  │  HF Space (ZeroGPU)     │
│   ─────────────────     │  │  ───────────            │
│   AWS Bedrock           │  │  pipeline +             │
│   SageMaker Endpoint    │  │  AutoModel              │
│   TGI / vLLM hosted     │  │  from_pretrained()      │
└─────────────────────────┘  └─────────────────────────┘
```

## Stack Overview

The Arcade Inference Gateway is a monolithic **AWS Lambda** function running a **Hono** web server with TypeScript. Bootstrapped with [Hono's AWS Lambda guide](https://hono.dev/docs/getting-started/aws-lambda).

The following provider is supported:

- **AWS Bedrock**: AWS's managed service for hosting and serving foundation models from multiple providers. It provides an OpenAPI-compatible interface for inference.

## Usage

The Inference Gateway is designed to be used by GenAI Arcade widgets through a simple REST API. Widgets can send requests to the gateway to perform various inference tasks without needing to manage model-specific logic.

**Example: Text Generation Request**

```python
import requests
GENERATE_URL = "https://your-gateway-url.com/generate"

messages = [
    {"role": "system", "content": "You are a helpful assistant."},
    {"role": "user", "content": "Explain quantum computing in one sentence."},
]

response = requests.post(GENERATE_URL, json={
    "messages": messages,
    "model": "google/gemma-4-E2B-it",
})

if response.status_code == 200:
    result = response.json()
    print(result["content"])
else:
    print(f"Error: {response.status_code} - {response.text}")
```