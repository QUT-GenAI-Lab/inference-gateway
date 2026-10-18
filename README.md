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

Key libraries used:

- `hono`: Lightweight web framework for building the REST API.
- `zod` & `@hono/zod-validator`: For request validation and schema definition.
- `@hono/zod-openapi`: To generate OpenAPI specifications from Zod schemas.

## Usage

The Inference Gateway is designed to be used by GenAI Arcade widgets through a simple REST API. Widgets can send requests to the gateway to perform various inference tasks without needing to manage model-specific logic.

**Example: Text Generation Request**

```python
import requests
GENERATE_URL = "https://your-gateway-url.com/generate/text"

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

Use `liquidai.lfm2.5-230m` for LFM2.5-230M serverless chat. Set
`includeEcoMetrics` to `true` for CodeCarbon estimates:

```json
{
  "messages": [{ "role": "user", "content": "Who are you?" }],
  "model": "liquidai.lfm2.5-230m",
  "includeEcoMetrics": true
}
```

## EC2 GPU Development Backend

These development models run on a single `g4dn.xlarge` EC2 instance:

- `dev.meta.llama-3.2-3b-instruct`
- `dev.stable-diffusion-v1-5/stable-diffusion-v1-5`

Use the chat model with `/generate/chat` and the image model with
`/generate/image`. The manager serves one model at a time on the T4 GPU.
Requests start a stopped host or load a cold model in the background. Retry
HTTP `503` responses until the model is ready.

### Deploy and inspect startup

Run these commands from the `inference-gateway` root. Download the weights
first; each model's README covers any gated-model access requirements:

```bash
(cd sagemaker/realtime-inference/llama-3-2-3b-instruct-generate-text && npm run model:download)
(cd sagemaker/realtime-inference/stable-diffusion-v1-5-generate-image && npm run model:download)
npm run deploy
```

Each model directory has a `Dockerfile` and `server.py`. CDK builds the
`linux/amd64` manager and model images, with weights baked into the model images,
and pushes them to ECR. The selected VPC must have private subnets with egress.
The `GpuManagerUrl` and `GpuInstanceId` CloudFormation outputs identify the
manager and host.

Deployment does not wait for bootstrap. The host pulls and starts the manager,
checks `/health`, then pulls model images in a background service. Model
containers start only when requested. Background pulls run again after a host
restart and can be interrupted by idle shutdown.

Connect through Session Manager to inspect progress, replacing `<GpuInstanceId>`
with the output value:

```bash
aws ssm start-session --profile qut-genai-lab --region ap-southeast-2 --target "<GpuInstanceId>"
sudo tail -F /var/log/gpu-bootstrap.log /var/log/gpu-model-manager.log /var/log/gpu-model-pull.log
sudo systemctl status model-manager.service gpu-model-pull.service
```

The bootstrap log covers host setup; the manager log covers its image pull,
startup, and health check; the model pull log shows download progress. Retry a
failed model pull with `sudo systemctl restart --no-block gpu-model-pull.service`.
Read manager container output with
`sudo docker compose --file /opt/ml/compose.yaml --project-name gpu logs model-manager`.

### Idle shutdown

The host stops after 15 minutes without model work. Health and status polling
do not reset the timer. Set `gpuIdleTimeoutMinutes` on `InferenceGatewayStack`
to another nonnegative number of minutes, or `0` to disable automatic shutdown.
EBS preserves the Docker image cache across stops and starts. Idle shutdown skips
graceful OS shutdown and shutdown scripts, which risks data integrity.

To stop or start the host manually, use the `GpuInstanceId` output:

```bash
INSTANCE_ID="<GpuInstanceId>"
aws ec2 stop-instances --region ap-southeast-2 --instance-ids "$INSTANCE_ID"
aws ec2 start-instances --region ap-southeast-2 --instance-ids "$INSTANCE_ID"
```
