FROM python:3.11-slim

WORKDIR /app

# System deps for python-arango and requests
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application package
COPY app/ ./app/

# Copy crop data and BAMIS reference data
COPY data/ ./data/

# Copy developer/test scripts
COPY scripts/ ./scripts/

ENV PYTHONUNBUFFERED=1 \
    LOG_LEVEL=INFO \
    BAMIS_PDF_DIR=/data/raw_pdfs \
    BAMIS_DATA_DIR=/app/data

# Mount point for raw BAMIS PDFs supplied by the crawl step
VOLUME ["/data/raw_pdfs"]

CMD ["python", "-m", "app.main"]
