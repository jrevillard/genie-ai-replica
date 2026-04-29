import os
import shutil
from pathlib import Path

import uvicorn
from fastapi import FastAPI, BackgroundTasks, HTTPException, UploadFile, File, Form
from typing import List
from src.config import settings
from src.ingestion.run_ingestion import run_ingestion_pipeline
from src.ingestion.arcadedb_schema import create_schema
from src.ingestion.run_graph_enrichment import run_graph_pipeline

app = FastAPI(title="Genie AI - Dataprep Worker")

DOCS_DIR = Path("./data/docs")

# Health check is vital for Docker
@app.get("/health")
def health_check():
    return {"status": "ok", "service": "haystack-dataprep"}


# Auto-create ArcadeDB schema on startup 
@app.on_event("startup")
async def startup_event():
    """Ensure ArcadeDB schema exists every time the service starts."""
    try:
        create_schema()
        print("✅ ArcadeDB schema initialized")
    except Exception as e:
        print(f"⚠️ Schema init warning (may already exist): {e}")
# ── END NEW ──

@app.post("/api/v1/schema")
async def trigger_schema_creation():
    """
    Triggers the creation of the ArcadeDB schema
    """
    try:
        # 1. Actually call the function
        create_schema()
        
        # 2. Return a response after completion
        return {
            "status": "accepted", 
            "message": "Schema created successfully."
        }
        
    except Exception as e:
        print(f"Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    
    
@app.post("/api/v1/ingest")
async def trigger_ingestion(background_tasks: BackgroundTasks):
    """
    Triggers the Haystack pipeline to process documents in the /data folder.
    Runs in the background to prevent HTTP timeouts on large PDFs.
    """
    try:
        background_tasks.add_task(run_ingestion_pipeline)
        return {
            "status": "accepted", 
            "message": "Ingestion job has been successfully queued and is running in the background."
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to start ingestion: {str(e)}")
    
if __name__ == "__main__":
    uvicorn.run("src.main:app", host=settings.API_HOST, port=settings.API_PORT, reload=True)


@app.post("/api/v1/upload")
async def upload_documents(
    background_tasks: BackgroundTasks,
    files: List[UploadFile] = File(...),
    auto_ingest: bool = Form(default=True),
):
    """Upload PDF/TXT documents and optionally trigger ingestion.

    Files are saved to /data/docs/ and (by default) the ingestion
    pipeline runs automatically in the background.
    """
    DOCS_DIR.mkdir(parents=True, exist_ok=True)
    saved = []
    for f in files:
        if not f.filename:
            continue
        # Only allow PDF and TXT
        ext = Path(f.filename).suffix.lower()
        if ext not in (".pdf", ".txt"):
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported file type '{ext}'. Only .pdf and .txt are allowed.",
            )
        dest = DOCS_DIR / f.filename
        with open(dest, "wb") as out:
            shutil.copyfileobj(f.file, out)
        saved.append(f.filename)

    if not saved:
        raise HTTPException(status_code=400, detail="No valid files uploaded.")

    if auto_ingest:
        background_tasks.add_task(run_ingestion_pipeline)

    return {
        "status": "accepted",
        "files_saved": saved,
        "auto_ingest": auto_ingest,
        "message": f"{len(saved)} file(s) saved. "
        + ("Ingestion queued in background." if auto_ingest else "Upload only — call /api/v1/ingest to process."),
    }


@app.get("/api/v1/documents")
async def list_documents():
    """List all documents currently in the data directory."""
    DOCS_DIR.mkdir(parents=True, exist_ok=True)
    files = []
    for p in sorted(DOCS_DIR.iterdir()):
        if p.is_file():
            files.append({
                "name": p.name,
                "size_kb": round(p.stat().st_size / 1024, 1),
                "type": p.suffix.lower(),
            })
    return {"documents": files, "total": len(files)}


@app.post("/api/v1/enrich-graph")
async def trigger_graph_enrichment(background_tasks: BackgroundTasks, batch_size: int = 20):
    """
    Heavy Graph Enrichment.
    Queries ArcadeDB for chunks where graph_enriched=False, and runs Gemini to extract nodes.
    """
    try:
        background_tasks.add_task(run_graph_pipeline, batch_size=batch_size)
        return {
            "status": "accepted", 
            "message": f"🧠 Graph enrichment job for {batch_size} chunks queued in the background."
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to start graph enrichment: {str(e)}")