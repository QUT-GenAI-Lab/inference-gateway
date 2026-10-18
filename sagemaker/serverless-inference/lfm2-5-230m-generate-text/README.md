# LFM2.5-230M SageMaker Serverless Chat

SageMaker serverless chat for the gateway's `liquidai.lfm2.5-230m` model.

The endpoint serves the public Hugging Face checkpoint `LiquidAI/LFM2.5-230M` under its LFM Open License. Downloads do not require a Hugging Face token.

## Download and package

Run these commands from this model directory:

```bash
npm --prefix ../../../ run model:download
npm --prefix ../../../ run model:package
```

Upload the packaged `model.tar.gz`:

```bash
npm --prefix ../../../ run model:upload
```

The upload destination is:

```text
s3://genai-arcade-sagemaker-models/serverless-inference/lfm2-5-230m-generate-text/model.tar.gz
```

The endpoint loads this artifact from S3 and uses 6,144 MB of serverless memory, on-demand capacity, and a maximum concurrency of 20.

## Local runner

After downloading the model, run `python local.py`. Enter `/exit` to quit. The handler accepts this chat request:

```json
{
  "messages": [{ "role": "user", "content": "Who are you?" }],
  "includeEcoMetrics": true
}
```

Set `includeEcoMetrics` to `true` to enable CPU CodeCarbon tracking; it defaults to `false`. The handler returns `eco_metrics`, which the gateway normalizes to `ecoMetrics`. Health checks accept `{ "healthCheck": true }` without messages and are never tracked.

The handler accepts up to 32 messages. It truncates each message to 4,000 characters and the system prompt to 2,000 characters, and rejects prompts above 4,096 rendered tokens. It generates at most 512 new tokens using the model card's sampling defaults. CodeCarbon estimates CPU energy and emissions; accuracy depends on the available hardware counters.

## Gateway deployment

The endpoint name is `lfm2-5-230m-generate-text`; its public model ID is `liquidai.lfm2.5-230m`. After uploading the artifact, run `npm run deploy` from the gateway root.
