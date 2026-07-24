# Llama 3.2 3B Instruct SageMaker Generate Chat Model

This directory contains the SageMaker inference handler and download script for a realtime Llama 3.2 3B Instruct implementation of the gateway `GenerateChatProvider` contract.

The packaged model is:

```text
meta-llama/Llama-3.2-3B-Instruct
```

## Prerequisites

`meta-llama/Llama-3.2-3B-Instruct` is a gated Hugging Face repository. Before running `download.py`, the user must:

1. Accept the **Llama 3.2 Community License** at https://huggingface.co/meta-llama/Llama-3.2-3B-Instruct.
2. Export `HF_TOKEN` with a user access token that has read access to the `meta-llama/*` gated repositories:

   ```bash
   # bash/zsh
   export HF_TOKEN=<your-token>
   ```

   ```powershell
   # Windows PowerShell
   $env:HF_TOKEN = "<your-token>"
   ```

## Runtime Layout

The committed layout contains only the inference code and the download/local runners. Model weights are downloaded into `model/` separately and are **not** committed (the repository `.gitignore` excludes `*.safetensors`, `*.model`, `*.jinja`, and `sagemaker/**/model/*.json`).

```text
llama-3.2-3b-instruct-generate-text/
|- download.py
|- local.py
|- README.md
|- model/
|  `- code/
|     |- emissions_tracker.py
|     |- inference.py
|     `- requirements.txt
`- tests/
   `- test_inference.py
```

## Downloading the Model

> [!IMPORTANT]
> Run `download.py` yourself before uploading the artifact. It is **not** run automatically anywhere in this repository and the model weights are intentionally **never** committed to git. Do not let opencode (or any agent) run it for you either unless you explicitly authorise it.

From this directory run:

```bash
npm run model:download
```

`download.py` uses `huggingface_hub.snapshot_download` to pull only the root Transformers-format files into `model/`, leaving `model/code/` untouched and excluding the duplicate Meta `original/*.pth` PyTorch checkpoints.

After downloading, `model/` should contain exactly these files plus the existing `code/` directory:

```text
model/
|- chat_template.jinja              (~4 KB, gitignored)
|- config.json                      (~860 B, gitignored)
|- generation_config.json           (~140 B, gitignored)
|- model-00001-of-00002.safetensors ~5.0 GB (gitignored)
|- model-00002-of-00002.safetensors ~1.0 GB (gitignored)
|- model.safetensors.index.json      (~20 KB, gitignored)
|- special_tokens_map.json          (~660 B, gitignored)
|- tokenizer.json                   (~9 MB, gitignored)
|- tokenizer.model                  (~1.7 MB, gitignored)
|- tokenizer_config.json            (~7.5 KB, gitignored)
`- code/
   |- emissions_tracker.py
   |- inference.py
   `- requirements.txt
```

Verify the two safetensor shards and `model.safetensors.index.json` are present, and that there are no `original/*.pth` files. Do not commit the downloaded weights, tokenizer, or json configs — they are intentionally gitignored.

## Local Testing

Run the handler locally without SageMaker:

```bash
python local.py
```

`local.py` calls `model_fn`, `input_fn`, `predict_fn`, and `output_fn` against the on-disk `model/` directory through a small REPL. Use `/help` to list the available commands (`/system` to set the system message, `/eco` to toggle `includeEcoMetrics` for the next response, `/clear` to clear the screen, and `/exit` to quit).

The Python unit tests can be run from the endpoint directory:

```bash
python -m unittest discover -s tests
```

## Gateway Contract

The handler accepts the same JSON body as `GenerateChatSchema.input` in `lambda/lib/provider.ts`:

```json
{
  "messages": [
    { "role": "user", "content": "What is the capital of France?" }
  ],
  "system": "You are a helpful assistant that provides concise answers.",
  "includeEcoMetrics": false
}
```

`model` is accepted by the gateway schema for provider compatibility, but the SageMaker endpoint always serves the packaged `meta-llama/Llama-3.2-3B-Instruct` artifact.

The response shape matches `GenerateChatSchema.output`:

```json
{
  "content": "The capital of France is Paris."
}
```

Readiness requests are independent of `messages`:

```json
{ "healthCheck": true }
```

Return:

```json
{ "status": "ok" }
```

When `includeEcoMetrics` is `true`, the Python handler additionally emits `eco_metrics` in snake_case at the SageMaker runtime boundary. The gateway normalises that to the API-facing `ecoMetrics` field; do not emit `ecoMetrics` from Python. Health-check requests are never tracked.

Internally the handler renders the conversation through `tokenizer.apply_chat_template(transcript, add_generation_prompt=True)` with the optional `system` message prepended as a `system`-role entry. Only tokens generated after the rendered prompt are decoded, and generation reuses the model's saved sampling/stop-token configuration (`generation_config.json`) up to a maximum of 512 new tokens. Prompts exceeding 4,096 rendered tokens are rejected.

## Packaging and Deployment

The realtime CDK construct reads an **uncompressed** S3 prefix rather than `model.tar.gz`. Upload the unpacked `model/` directory (model weights plus `code/`) from this directory:

```bash
npm run model:upload
```

The upload destination is:

```text
s3://genai-arcade-sagemaker-models/realtime-inference/llama-3.2-3b-instruct-generate-text/uncompressed/
```

Then deploy the gateway CDK stack from `inference-gateway/`:

```bash
npm run deploy
```

Do **not** upload S3 artifacts or run `npm run deploy` as part of routine implementation. The local artifact directory plus CDK synth (`npm run cdk -- synth`) are sufficient to validate the wiring.

## Hardware Profile

`Llama3_2_3bInstructGenerateTextEndpoint` selects `ml.g4dn.xlarge`:

- 1 NVIDIA T4 GPU (Turing, compute capability 7.5)
- 4 vCPUs
- 16 GiB instance memory

The handler loads the 3B-parameter model in FP16 on the T4 (CPU falls back to float32). The FP16 weights (~6 GB) plus activation/KV-cache and CodeCarbon sampling fit inside the 16 GiB GPU memory budget and the configured inference-component memory reservation of 6–8 GiB. The construct reserves one T4, two vCPUs, and 6–8 GiB of memory per inference component copy, scales from one initial copy back down to zero after idle, and caps the autoscaling target at one concurrent request per copy.