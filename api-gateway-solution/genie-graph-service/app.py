from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import httpx
import os

app = FastAPI(title="GENIE Graph Service")

# Use the container name "arcadedb" on the docker network (NOT localhost)
ARCADEDB_HOST = os.getenv("ARCADEDB_HOST", "arcadedb")
ARCADEDB_PORT = int(os.getenv("ARCADEDB_PORT", "2480"))
ARCADEDB_DB = os.getenv("ARCADEDB_DB", "genie")
ARCADEDB_USER = os.getenv("ARCADEDB_USER", "root")
ARCADEDB_PASSWORD = os.getenv("ARCADEDB_PASSWORD", "genieRoot123")

ARCADEDB_COMMAND_URL = f"http://{ARCADEDB_HOST}:{ARCADEDB_PORT}/api/v1/command/{ARCADEDB_DB}"

class QueryRequest(BaseModel):
    query: str
    language: str = "sql"  # sql is common; change to "cypher" if you're using cypher

@app.post("/graph/query")
async def run_query(request: QueryRequest):
    payload = {
        "language": request.language,
        "command": request.query,
    }

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            r = await client.post(
                ARCADEDB_COMMAND_URL,
                json=payload,
                auth=(ARCADEDB_USER, ARCADEDB_PASSWORD),
            )
    except httpx.RequestError as e:
        raise HTTPException(status_code=503, detail=f"ArcadeDB not reachable: {e}") from e

    if r.status_code >= 400:
        # return the db error details to debug quickly
        raise HTTPException(status_code=r.status_code, detail=r.text)

    return {
        "status": "ok",
        "db": ARCADEDB_DB,
        "result": r.json(),
    }

@app.get("/")
def root():
    return {"status": "genie-graph-service running"}

@app.get("/health")
async def health():
    # quick ping to ArcadeDB server endpoint
    url = f"http://{ARCADEDB_HOST}:{ARCADEDB_PORT}/api/v1/server"
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(url, auth=(ARCADEDB_USER, ARCADEDB_PASSWORD))
        if r.status_code >= 400:
            return {"status": "degraded", "arcadedb": "error", "code": r.status_code}
        return {"status": "ok", "arcadedb": "ok"}
    except httpx.RequestError:
        return {"status": "degraded", "arcadedb": "unreachable"}
