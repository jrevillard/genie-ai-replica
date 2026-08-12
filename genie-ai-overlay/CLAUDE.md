# CLAUDE.md — genie-ai-overlay

## Python Environment

Always use a **virtual environment** for any pip/Python operations:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[test]"
```

Never use `--break-system-packages`.

## Testing

```bash
source .venv/bin/activate
python -m pytest tests/ -v
```

## Linting & Formatting

```bash
source .venv/bin/activate
ruff check tests/
ruff format --check tests/
```

## Architecture

OPEA microservices for the RAG pipeline (Python/FastAPI):

| Service | Purpose | Entry Point |
|---------|---------|-------------|
| `chatqna/` | Chat orchestrator — coordinates retrieval, reranking, LLM generation | `genieai_chatqna.py` |
| `retriever/` | Hybrid vector-graph retrieval from ArangoDB | `genieai_retriever_arango.py` |
| `dataprep/` | Document ingestion, chunking, labeling | `genieai_dataprep_arangodb.py` |
| `reranker/` | Result reranking via TEI | `genieai_reranker.py` |
| `core/` | Shared types, protocols, constants | `bootstrap.py` |

## Testing

Framework: pytest (configured in `pytest.ini`). Tests run from `genie-ai-overlay/` directory.

```bash
pytest                        # All tests
pytest tests/test_chatqna.py  # Specific service
pytest tests/test_tracing_with_span.py  # OTel span validation
```

**Shared fixtures**: `tests/conftest.py` — mocks for `comps` library (vendored at build time; the `docarray` collision is handled by the `docarray_alias_shim`), ArangoDB, model endpoints.

**Tracing**: OTel SDK initialized in `tracing.py`. Use `@tracing.trace_span(name)` decorator. See `.claude/rules/OBSERVABILITY.md`.

## See Also

- Root `CLAUDE.md` — GENIE.AI architecture, deployment, full tech stack
- `.claude/rules/TESTING.md` — Test commands and patterns for all components
- `.claude/rules/OBSERVABILITY.md` — OTel tracing architecture and configuration
