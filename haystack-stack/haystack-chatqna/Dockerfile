FROM python:3.10-slim
 
WORKDIR /app
 
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        ffmpeg \
        curl \
        fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*
 
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
# Pre-download spaCy English model so runtime doesn't need network
RUN python -m spacy download en_core_web_sm
 
COPY src/ ./src/
COPY data/ ./data/
 
EXPOSE 8000
 
CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "4", "--limit-concurrency", "200"]
 