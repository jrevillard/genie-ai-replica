# Developer onboarding — agricultural metadata pipeline

## What to read first

1. `docs/agri-taxonomy/ARCHITECTURE.md` — insertion point and risks  
2. `genie-ai-overlay/dataprep/agri_metadata/` — Python package layout  
3. `genieai_dataprep_arangodb.py` — `ingest_file_with_guardrail` and `reextract_taxonomy_only`  

## Local Python checks

The dataprep image installs all dependencies. For host-side unit tests:

```bash
export PYTHONPATH=genie-ai-overlay/dataprep
pip install pydantic openai  # minimal for tests
python3 -m unittest discover -s genie-ai-overlay/dataprep/tests -p 'test_*.py' -v
```

## Docker build

The dataprep Dockerfile copies `agri_metadata/` into `/app/comps/dataprep/src/agri_metadata`.

Rebuild the dataprep image after changing the taxonomy package.

## Document-repository

- New fields on `files`: `taxonomyMetadata`, `metadataExtractionVersion`, `metadataExtractionTimestamp`, `metadataConfidenceScore`, `taxonomyVersion`, `isRelevant`, `taxonomyExtractionTelemetry`
- Service account (`dataprep-service`) must be allowed on `PATCH .../ingestion-metadata` (same as status updates)

## Retriever

Update ChatQnA / clients to send `context.taxonomy_filters` when you need metadata-scoped RAG.

## Operations

- Disable taxonomy LLM: `AGRI_TAXONOMY_ENABLED=false` (chunking continues; optional manual defaults only if you add them).  
- Refresh file metadata without re-chunking: Admin `POST /api/files/:id/reextract-taxonomy`.
