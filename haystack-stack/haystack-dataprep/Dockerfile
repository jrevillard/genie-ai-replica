FROM python:3.10-slim
 
WORKDIR /app
 
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        curl \
    && rm -rf /var/lib/apt/lists/*
 
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
 
COPY src/ ./src/
COPY data/ ./data/

# BUG-025 fix: drop root. Takes effect on next rebuild.
RUN groupadd --system amina \
 && useradd  --system --gid amina --home-dir /app --shell /sbin/nologin amina \
 && mkdir -p /app/logs /app/tmp \
 && chown -R amina:amina /app
USER amina

EXPOSE 8000

CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]
