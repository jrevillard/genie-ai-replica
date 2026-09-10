# ADR okf-021: Write-side orchestration — the OKF ingest sequence, bundle format, and transaction strategy

- **Status**: Proposed
- **Date**: 2026-08-13
- **Decision owners**: Genie.ai Dev (architect)

## Context

Gap G1 (P0): the OKF Server has a repository CRUD service, a parser, and a conformance service, but **no component sequences the full ingest path** — parse → validate → PII → index → edges → meta → lifecycle. Each leaf story assumed some other component owned the linchpin sequence, so the pieces never compose. Related gaps compound it: G9 (`okf_concepts_meta` never written — `persistConformanceIssues` UPDATEs zero rows), G10 (the "async" contract in Story 2.5 is unsatisfiable — no ingestion worker exists, only the crawl worker), and G11 (bundle format undefined; re-ingest duplicates chunks).

The load-bearing constraints: ADR-okf-001 makes the OKF Server **Node/Express**; ADR-okf-008 keeps the **document-repository** as the blob store + ClamAV + dataprep caller; NFR-R2 mandates ingest resilience via Redis Streams + DLQ (the SST pattern, already used by the crawler); the HTTP ingest call must **never block** on dataprep (the user's explicit store→pending→worker→graph model); and re-ingest must be **idempotent** (NFR-S4). The substrate already exists: the document-repository has an async ingest lifecycle (`Pending → Ingesting → Ingested`), the crawl worker drains Redis Streams, and dataprep already accepts per-request `graph_name`.

Basis: [okf-course-correction-2026-08-13 §2.3, §3 D1/D2/D6](../../_bmad-output/planning-artifacts/okf-course-correction-2026-08-13.md) and the [Sprint Change Proposal 2026-08-13](../../_bmad-output/planning-artifacts/sprint-change-proposal-2026-08-13.md).

## Decision

**Add a write-side orchestrator (`ingestService`) inside the Node OKF Server that owns the ingest sequence, with an async Redis-Streams worker, a zip bundle format, and compensation-via-sweeper instead of a distributed transaction.** (D1 = (a); D2 = (a); D6 = (a).)

1. **Orchestrator home: okf-server, not doc-repo** (D1). The document-repository stays a dumb blob store (storage + ClamAV + dataprep handoff — ADR-okf-008). All OKF business logic — repo→graph_name/ACL-label derivation, per-concept fan-out, meta UPSERT, edge writing, lifecycle transition — lives in the OKF Server's new `services/ingest-service.js`. The orchestrator is the **only** component that knows repo→tenant/domain, so it is the only component that injects ACL labels (G4 root cause).

2. **Bundle format = a zip of `.md` concept files** (D2). Atomic upload; the server unzips and iterates concepts. This is the contract Story 2.5 enforces and Story 2.9.5 implements (server unzip + per-concept fan-out).

3. **Async pattern = Redis Streams + worker** (D5, NFR-R2). `POST /api/okf/repos/:repo_id/ingest` returns **202 Accepted** after storing + ClamAV-scanning + creating the `files` doc at `dataprep.status='Pending'`. The new `ingestionWorker` (Story 2.9.4) drains `Pending` jobs (concurrency 1 by default — dataprep serializes embedding anyway; configurable), with a per-purpose DLQ. This mirrors the existing document-repository async lifecycle and the crawl-worker pattern — **no new resilience infrastructure**.

4. **Transaction strategy = no distributed transaction; compensation via sweeper** (D6). Cross-service ingest (okf-server → doc-repo → dataprep) cannot be atomic. Instead: every concept's `okf_concepts_meta.index_status` (`parsed|indexed|failed`) is the source of truth, and an orchestrator **sweeper** (scheduled) reconciles orphans — chunks whose `concept_id` has no `okf_concepts_meta` are retracted. This fits the async model and avoids saga complexity.

5. **Idempotent re-ingest** (NFR-S4). Content-hash dedup: if a concept's hash is unchanged AND `index_status='indexed'`, skip. This closes the G11 re-ingest-duplicates-chunks defect.

6. **HTTP ingest never blocks on dataprep** (the user's explicit model). The 202 returns once jobs are enqueued; indexing completes asynchronously; the worker transitions `index_status` and the repo `lifecycle_state`.

## Alternatives considered

| Alternative | Status |
|---|---|
| Orchestrator in doc-repo (D1-b) | Rejected — pushes OKF business logic into the blob store and couples ingest to a service that should stay thin; contradicts ADR-okf-008's "document-repository remains the single document store, not the control plane." |
| Bundle = tar, or per-concept calls (D2-b/c) | Rejected — tar adds a second archive format for no gain; per-concept calls lose atomicity and multiply round-trips. Zip is universally tooled. |
| Saga / distributed transaction (D6-b) | Rejected — disproportionate complexity for an async, retry-friendly pipeline; the sweeper + `index_status` model is simpler and fits NFR-R2. |
| Sync-per-concept with timeout + 429 | Rejected — violates the "never block on dataprep" model and risks request timeouts on large repos. |

## Consequences

- **Positive**: ingest becomes end-to-end functional (G1); `okf_concepts_meta` gets a writer (G9); the async worker exists (G10); re-ingest is idempotent (G11); ACL labels are injected by the single component that owns repo→tenant/domain (G4).
- **Negative**: a new Node module + worker; eventual consistency (a repo is queryable only after the worker drains it — SM-1 freshness target applies); the sweeper must be operated/monitored.
- **Mitigations**: per-concept `index_status` makes partial progress observable; the DLQ + sweeper bound failure; the repo read API surfaces ingest health (FR-21/FR-13).

## References

PRD §4.2 (FR-5/6/8), FR-34 (async ingestion pipeline), NFR-R2, NFR-S4; [Sprint Change Proposal 2026-08-13](../../_bmad-output/planning-artifacts/sprint-change-proposal-2026-08-13.md); [okf-course-correction-2026-08-13 §2.3](../../_bmad-output/planning-artifacts/okf-course-correction-2026-08-13.md); [ADR-okf-001](okf-001-okf-server-component-and-stack.md); [ADR-okf-008](okf-008-bundle-content-store.md); [ADR-okf-022](okf-022-node-python-dataprep-handoff.md); [ADR-okf-030](okf-030-lifecycle-state-machine.md).
