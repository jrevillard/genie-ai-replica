FROM python:3.11-slim AS base

RUN apt-get update && apt-get install -y \
    build-essential libgeos-dev libproj-dev curl \
    && rm -rf /var/lib/apt/lists/*

# Node.js 20 required for Mapbox MCP Server (npx @mapbox/mcp-server)
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs
RUN npm install -g @mapbox/mcp-server@latest --network-timeout=600000

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=5 \
    CMD python -c "import requests; exit(0) if requests.get('http://localhost:8000/health', timeout=5).status_code == 200 else exit(1)"

EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
