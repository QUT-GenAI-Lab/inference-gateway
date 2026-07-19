# Llama-1 7B SageMaker Generate Chat Model

This directory contains the SageMaker inference handler and packaging script for a realtime Llama-1 7B implementation of the gateway `GenerateChatProvider` contract.

The extracted model is:

```text
huggyllama/llama-7b
```

## Runtime Layout

The `model/` directory is the source layout for the SageMaker `model.tar.gz` artifact. The committed file is:

```text
model/
`- code/
   `- inference.py
```

`download.py` downloads the Hugging Face model and tokenizer into `model/`. After download and packaging, the artifact contains the Llama model files at the archive root plus `code/inference.py`.

`model/code/inference.py` implements the SageMaker entrypoints:

- `model_fn(model_dir)`
- `input_fn(request_body, content_type)`
- `predict_fn(data, model_context)`
- `output_fn(prediction, accept)`

> [!IMPORTANT]
> To run the model locally, you can use the `local.py` script in this directory. It provides a simple command-line interface for testing the model without deploying to SageMaker.
>
> ```bash
> python local.py
> ```

## Gateway Contract

The handler accepts the same JSON body as `GenerateChatSchema.input` in `lambda/lib/provider.ts`:

```json
{
  "messages": [
    { "role": "user", "content": "What is the capital of France?" }
  ],
  "system": "You are a helpful assistant that provides concise answers.",
  "model": "huggyllama/llama-7b"
}
```

`model` is accepted for provider compatibility but the SageMaker endpoint always serves the packaged `huggyllama/llama-7b` artifact.

The response shape matches `GenerateChatSchema.output`:

```json
{
  "content": "The capital of France is Paris."
}
```

Internally, Llama-1 is prompted as a simple instruction/conversation transcript because it is not a chat-tuned model:

```text
Instructions: <system>

Question: <user message>

Response: <assistant history>

Response:
```

The handler keeps cleanup heuristics for repeated lines and chat-style stop markers.

## Packaging

Run the model scripts from this directory through the `inference-gateway` package scripts:

```bash
npm run model:download
npm run model:package
npm run model:upload
```

The upload destination derived from this directory is:

```text
s3://genai-arcade-sagemaker-models/realtime-inference/llama-1-7b-generate-text/model.tar.gz
```

`huggyllama/llama-7b` is large. Run the download step in an environment with enough disk and memory for the model conversion and save step. The runtime handler expects a GPU-backed realtime SageMaker endpoint.
