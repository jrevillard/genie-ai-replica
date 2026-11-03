# Roadmap Decisions Pending — week of 2026-08-22

**Purpose:** the significant items surfaced by work on `feat/okf-server` (and its assessments) that need a product/roadmap decision. Each item: what, why it's on the table now, options, and where the evidence lives. Nothing here is scheduled until decided.

---

## D1 — Presidio PII redaction on the LEGACY single-document ingestion path

- **What:** the existing document-upload → dataprep pipeline (the free-form corpus, explicitly unchanged per PRD line 420) has **zero PII detection**; Presidio (Story 2.8) covers the OKF write path only. Stated intent was Presidio on **both** paths — the artifacts say OKF-only.
- **Options:** (a) extend FR-5 + a story wiring `pii-service` into doc-repo→dataprep before chunking (sidecar is bump-ungated and already callable — bounded increment); (b) accept + document the exclusion as a known limitation.
- **Evidence:** `pii-gdpr-gap-assessment-2026-08-14.md` §1/B1/F1 (verified: embeddings computed on raw text, raw chunk stored twice).
- **Impact if deferred:** every PDF/DOCX upload remains a PII ingress into vectors/graph/logs — the largest single compliance exposure found.

## D2 — Erasure ownership outside OKF (right-to-erasure gaps with NO owner)

- **What (all verified in code):** file hard-delete never retracts vector data (`fileService.deleteFile` — retract is a separate manual endpoint); user-account deletion nullifies only the `users` doc — conversations, messages, `queries` (full chat text), analytics, uploaded PII files all survive, still attributable; no purge path for analytics/events; chat content in logs/backups outside every erasure flow.
- **Options:** (a) a small backend hardening epic (retract-on-delete cascade; /api/me/delete cascade; log/backup retention policy); (b) explicit risk acceptance documented for the DPO.
- **Evidence:** gap assessment §3 A1–A7.
- **Note:** chunk-level `file_id` lineage exists — file-scoped erasure is a wiring problem, not a schema problem.

## D3 — Retained-original model (unredacted copies kept by design)

- **What:** OKF keeps the unredacted doc-repo original by design (FR-27/ADR-004 rev) — the corpus is pseudonymized-at-best system-wide; originals are served via view/download endpoints and the dataprep container keeps a never-deleted temp copy of every ingested file.
- **Options:** accept with controls (access control on view/download + originals included in the 2.9.9 erasure/retention sweep + temp-copy cleanup) vs. encrypted side-store.
- **Evidence:** gap assessment §3 E2, A6.

## D4 — Encryption / transport posture (deployment-level)

- **What:** no encryption at rest for any store (ArangoDB, Redis AOF, uploads, telemetry volumes); all east-west traffic plaintext HTTP incl. forwarded bearer tokens; ArangoDB published on host :8529 plaintext; cloud deploy disables TLS verification; backups plaintext with a hardcoded test password in `dump.sh`.
- **Options:** host-level LUKS vs ArangoDB RocksDB encryption; overlay-network encryption; remove host publication; re-enable TLS verification; backup encryption+scheduling. Mostly deployment decisions, not code.
- **Evidence:** gap assessment §3 D7–D12.

## D5 — Label semantics: scope vs forced-attach (deferred by David 2026-08-15)

- **What:** upload `labels` act as a **scope** over LLM chunk-label suggestions (selected-but-never-suggested labels — e.g. a category — do NOT attach); ACL tokens are the only forced-attach. If the product expectation is "selected labels ride on every chunk", that's a deliberate dataprep change.
- **Evidence:** `genieai_dataprep_arangodb.py` `_finalize_chunk_labels` (verified live 2026-08-15: 12 selected → 11 attached; category label scoped out).

## D6 — Admin Logs / Security-scanning migration to VictoriaLogs

- **What:** admin dashboard Logs + Security-scan facilities are 100% Winston-file-based (regex parsers, single-service visibility, already drifted — `/api/admin/logs` likely returns empty); no app code queries VictoriaLogs; **cloud runs with observability OFF**. Includes the producer-side mandate: the shared logger needs a first-class VictoriaLogs transport (one transport covers backend + doc-repo + okf-server).
- **Status:** assessment **COMPLETE** (`admin-logs-victorialogs-migration-assessment-2026-08-15.md`) — a preliminary planning artifact (not branch work). It ships the target architecture (§6), a phased migration plan **P0–P4** with measurable exit criteria (§7, est. ~5–6 stories), and **6 sub-decisions with recommendations** (§8) that this roadmap decision should ratify or amend:
  - **D6.1 VictoriaLogs as hard dependency** — recommendation: split VictoriaLogs + Collector out of the `observability` profile into the core stack (logs browsing + security scanning are core admin features; metrics/traces/Grafana stay optional).
  - **D6.2 cutover** — env fallback (`ADMIN_LOGS_SOURCE`) for one release, then removed.
  - **D6.3 admin visibility scope** — all services (not backend-only).
  - **D6.4 sequencing** — producer-first (logger transport P1a before consumer rewires P2/P3).
  - **D6.6 producer egress** — via the OTel Collector (default), direct-to-VL as env override.
- **Impact if deferred:** admin users (non-technical operators) keep a broken/near-empty Logs facility; the producer mandate (logger → VL as first-class destination) stays unmet.

## D7 — PII detection accuracy harness (supporting D1)

- **What:** no recall/precision evaluation exists for Presidio detection (Epic 8 harnesses cover retrieval quality only); national-ID recognizers are conservative placeholders pending per-deployment validation.
- **Options:** fold a PII eval fixture into Epic 8's fixture trinity vs. defer to deployment runbooks.
- **Evidence:** gap assessment §3 B3–B5.

---

**Suggested reading order for the decision meeting:** D1 → D2 (compliance exposure), D6 (in-flight assessment), D3/D4 (posture), D5/D7 (quality/semantics).