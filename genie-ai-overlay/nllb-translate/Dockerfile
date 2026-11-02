# NLLB-200 GPU translation sidecar (DEC-25, F6).
# Base must carry CUDA 12.8 + sm_120-capable torch for the RTX 6000 Blackwell —
# same watch item as the TEI 120-1.9 pin. Rules out prebuilt nllb-serve images
# (their torch predates Blackwell). Bump the base only alongside a box probe.
FROM pytorch/pytorch:2.7.1-cuda12.8-cudnn9-runtime

WORKDIR /app
COPY requirements.txt .
# torch/torchvision come from the base image — never reinstall here.
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .

EXPOSE 9201
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "9201"]
