---
title: Ingestion Log Reference
description: Cross-reference to the canonical ingestion-log page (operate/ingestion-log.md) — schema, canonical messages, and the failure-mode playbook live there.
weight: 5
mode: how-to
persona: deployer
owner: "docs-stewards"
last_reviewed: 2026-09-19
---

The ingestion log is the **operator-facing diagnostic channel** for the
document ingestion pipeline — the per-chunk progress feed dataprep writes to
the backend `ingestion_log` collection while it parses, chunks, labels, and
embeds a file.

The canonical reference (schema, endpoints, canonical message strings, the
AQL read pattern, the trace-correlation recipe, the failure-mode playbook,
and the verify-it-worked checks) has moved to
[Operate → Ingestion Log]({{< relref "/docs/operate/ingestion-log" >}}).

For label-quality diagnostics and per-chunk label debugging, see
[RAG → Data labelling strategy]({{< relref "/docs/rag-pipeline/data-labeling" >}}).