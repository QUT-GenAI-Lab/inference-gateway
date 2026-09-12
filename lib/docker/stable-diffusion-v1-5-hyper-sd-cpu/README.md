# Stable Diffusion v1.5 Hyper SD CPU

This image uses the following for image generation:

```python
MODEL_ID = "stable-diffusion-v1-5/stable-diffusion-v1-5"
BASE_MODEL_REVISION = "451f4fe16113bff5a5d2269ed5ad43b0592e9a14"
HYPER_SD_REPO = "ByteDance/Hyper-SD"
HYPER_SD_REVISION = "bc08d970a87c74c71209491d64e352584569886345"
HYPER_SD_WEIGHT = "Hyper-SD15-2steps-lora.safetensors"
```

Besides using `stable-diffusion-v1-5` as the base model, this image also uses the Hyper-SD LoRA weights to reduce the number of inference steps required to generate images of sufficient quality from approximately 15-20 steps to 2 steps with the `Hyper-SD15-2steps-lora.safetensors` weights. This is particularly useful for CPU inference, as it significantly reduces the time required to generate images.

## Running the model locally

Install the required dependencies:

```bash
pip install -r requirements.txt
```

Use `app/main.py` to run the model locally. The following command will start a FastAPI server on port 8000:

```bash
fastapi run app/main.py --port 8000
```

## Building the Docker Image

First, use the existing `scripts/download_model.py` script to download the model weights, convert them to ONNX format and save them to the `model` directory:

```bash
python scripts/download_model.py
```

A `docker-compose.dev.yaml` file is provided for development purposes to build the image and run the container:

```bash
docker compose -f docker-compose.dev.yaml up --build --detach
```

> [!NOTE]
>
> Alternatively, you can build the image directly using the `docker build` command:
> 
> ```bash
> docker build -t stable-diffusion-v1-5-hyper-sd-cpu:latest .
> ```
> 
> And then run the container using the `docker run` command:
> 
> ```bash
> docker run -p 8000:8000 stable-diffusion-v1-5-hyper-sd-cpu:latest
> ```

## Testing the model

A `local-test.py` script is provided to test the FastAPI server locally. You will need to install the development dependencies first:

```bash
pip install -r requirements-dev.txt
```

Then, run the `local-test.py` script to send custom prompts to the FastAPI server and generate images:

```bash
python local-test.py
```

The output images will be saved to the `output` directory.