# Debugging with Tracing & Logs (stub)

Full recipes: `docs/observability/tracing-debugging-recipes.md` —
fetching a trace from VictoriaTraces, per-phase breakdown script, the
dataprep span taxonomy, `ingestion_log` AQL queries (field is
`file_id`), where data lives, the base64 remote-script pattern, and the
gotchas (host clock skew vs UTC stamps, table-heavy chunks, vLLM
probes).

Read it before debugging the dataprep/RAG pipeline with traces or
logs. Hard rules: spans use `startTime` (µs), NOT `timestamp`, and
`duration` is in µs; a trace may be empty right after an ingest —
retry before concluding.
