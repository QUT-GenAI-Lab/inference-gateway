# GPT-2 SageMaker Next-Token Model

This directory contains the SageMaker inference handler and packaging scripts for the GPT-2 next-token predictor.

The public flow is:

```text
Widget UI -> Widget API -> Inference Gateway Lambda -> SageMaker Serverless Endpoint -> GPT-2 model
```

## Runtime Layout

The `model/` directory is a source layout for the SageMaker `model.tar.gz` artifact. The committed files are:

```text
model/
|- config.json
|- generation_config.json
|- tokenizer.json
|- tokenizer_config.json
`- code/
   `- inference.py
```

The downloaded weights (`model.safetensors` or `pytorch_model.bin`) and tokenizer support files (`vocab.json`, `merges.txt`, `special_tokens_map.json`) are produced by the download step and are gitignored. After packaging, the artifact contains:

```text
model.tar.gz
|- config.json
|- generation_config.json
|- model.safetensors or pytorch_model.bin
|- tokenizer.json
|- tokenizer_config.json
|- vocab.json
|- merges.txt
|- special_tokens_map.json
`- code/
   `- inference.py
```

`model/code/inference.py` implements the SageMaker entrypoints:

- `model_fn(model_dir)`
- `input_fn(request_body, content_type)`
- `predict_fn(data, model_context)`
- `output_fn(prediction, accept)`

The handler loads GPT-2 and its tokenizer from the packaged model directory, runs CPU inference, applies `log_softmax` to the final-token logits, and returns the top-k decoded token predictions.

`download.py` is a helper that uses `transformers` to download the official `gpt2` model and tokenizer from Hugging Face into `model/`.

## Packaging Scripts

The `inference-gateway` `package.json` defines three scripts that drive the `download` -> `package` -> `upload` flow. Run them from this directory (the scripts use `INIT_CWD` to resolve the working directory):

```bash
npm run model:download
```

Runs `download.py` to fetch GPT-2 weights and tokenizer files into `model/`. Requires `transformers` available in the active Python environment.

```bash
npm run model:package
```

Creates `model.tar.gz` from the contents of `model/` (`tar -czf model.tar.gz -C model .`). The Hugging Face PyTorch inference image expects the artifact to be gzipped with the model files at the root of the archive.

```bash
npm run model:upload
```

Uploads `model.tar.gz` to the SageMaker model artifact bucket using `aws s3 cp`. The S3 key is derived from the invocation directory: anything under `sagemaker/` becomes the key prefix, with `model.tar.gz` appended. From this directory the destination is:

```text
s3://genai-arcade-sagemaker-models/serverless-inference/gpt-2-next-token/model.tar.gz
```

It is possible to override the bucket (default: `genai-arcade-sagemaker-models`) with the `SAGEMAKER_MODELS_BUCKET` environment variable. The script must be invoked from a directory under `sagemaker/` (it walks up the path looking for the `sagemaker` segment).

## Updating the Model

To update the deployed GPT-2 artifact:

1. From this directory, run the packaging scripts in order:

   ```bash
   npm run model:download
   npm run model:package
   npm run model:upload
   ```

2. Deploy the CDK stack:

   ```bash
   cd inference-gateway
   npm run deploy
   ```

The SageMaker execution role is scoped to `s3://genai-arcade-sagemaker-models/serverless-inference/gpt-2-next-token/model.tar.gz`.

To upload to a different bucket (for example a staging or development account), set `SAGEMAKER_MODELS_BUCKET` before running `model:upload`.

## Deployment Notes

The CDK stack creates:

- an S3 bucket named `genai-arcade-sagemaker-models` for SageMaker model artifacts (or imports the existing one),
- a SageMaker execution role,
- a SageMaker model using the packaged GPT-2 artifact,
- a Serverless Inference endpoint configuration,
- a SageMaker endpoint named `gpt-2-next-token`,
- Lambda permission for `sagemaker:InvokeEndpoint` on that endpoint.

The endpoint is configured by the `SageMakerEndpoints` construct in `lib/sagemaker-endpoints.ts`, which uses the `SageMakerServerlessEndpoint` construct. Default serverless settings are `6144 MB` memory and max concurrency `20`.

The Hugging Face PyTorch inference image is selected from the `HF_INFERENCE_IMAGE_URIS` mapping in `lib/sagemaker-endpoints.ts`. Add the target AWS region to that mapping before deploying the stack to a region that is not already listed.

## Remaining Configuration Values

- `GATEWAY_URL`: use `https://inference.genai-arcade.net` for the deployed gateway, or use the stack outputs `ApiGatewayDefaultUrl` / `CustomDomainName` for non-default environments.
- `SAGEMAKER_MODELS_BUCKET`: optional override for the `model:upload` script. Defaults to `genai-arcade-sagemaker-models`.
- AWS credentials, account, and region: use the normal AWS CLI/CDK profile and environment for the target development, staging, or production account.
