FROM python:3.11-slim

WORKDIR /app

# System deps for python-arango and requests
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source
COPY *.py ./

# Copy crop data and BAMIS reference data
COPY data/ ./data/

ENV PYTHONUNBUFFERED=1 \
    LOG_LEVEL=INFO

CMD ["python", "-m", "main"]
