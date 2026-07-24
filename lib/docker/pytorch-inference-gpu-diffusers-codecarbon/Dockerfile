FROM 763104351884.dkr.ecr.ap-southeast-2.amazonaws.com/huggingface-pytorch-inference:2.6.0-transformers5.5.3-gpu-py312-cu124-ubuntu22.04

COPY requirements.txt /tmp/requirements.txt

RUN pip install \
    --no-cache-dir \
    --requirement /tmp/requirements.txt