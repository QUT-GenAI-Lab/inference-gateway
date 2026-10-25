# syntax=docker/dockerfile:1.7
ARG BASE_IMAGE=763104351884.dkr.ecr.ap-southeast-2.amazonaws.com/huggingface-pytorch-inference:2.6.0-transformers5.5.3-gpu-py312-cu124-ubuntu22.04
FROM ${BASE_IMAGE}

RUN pip install --no-cache-dir fastapi "uvicorn[standard]" codecarbon

ENV MODEL_PATH=/models \
    MODEL_CODE_PATH=/models/code \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /opt/gpu-server

COPY server.py /opt/gpu-server/server.py
COPY model /models

EXPOSE 8000

CMD ["python", "-m", "uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
