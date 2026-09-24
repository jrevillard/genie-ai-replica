# Eval Reports

Historical reports on the RAG eval pipeline (`tests/rag-benchmarks/`).

| Date | Report | Stack | Notes |
|---|---|---|---|
| 2026-09-23 | [el-salvador-reranker-evaluation.md](2026-09-23-el-salvador-reranker-evaluation.md) | genieai-el-salvador | 3-config reranker comparison (adaptive 0.0006 / adaptive 0.0010 / slice+top5). All equivalent on RAGAS end-to-end. Faithfulness=0.55 with reliable judge — main issue is retrieval+answer quality, not reranker tuning. |

See `tests/rag-benchmarks/README.md` for the full eval methodology.
