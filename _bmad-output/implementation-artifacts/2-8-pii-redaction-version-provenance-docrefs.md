---
baseline_commit: pending
---
# Story 2.8: PII redaction at ingest + version/provenance + document references

Status: ready-for-dev
Story key: `2-8-pii-redaction-version-provenance-docrefs` | GitLab: #884 (`prd::okf-server`, `okf-server::epic-2`)
Epic: 2 (OKF Server — Repository Ingestion & Management) | Branch: `feat/okf-server`
FRs: **FR-3** (version tracking, doc-repo-consolidated), **FR-5** (PII redaction, blocking), **FR-28** (stable document references) | ADRs: okf-004 (**revised 2026-08-14: Presidio sidecar**), okf-030 (D22 publish gate), okf-021 (write-path step 4d) | Gap: **G28** | NFRs: P1/P2

> **PII architecture (ADR-004 revision, user-confirmed 2026-08-14):** a **first-party Python sidecar `components/pii-service/`** (FastAPI + Presidio analyzer/anonymizer + spaCy NER model baked into the image; MIT) provides authoritative detection. The Node okf-server calls it over HTTP (`fail-CLOSED` — sidecar down → `pii_state='error'` → publish blocked). A rule-based regex detector exists ONLY as the editor's advisory pre-check (FR-25), never at the gate. GDPR rationale: personal data in free prose (names/addresses/DoB/health facts) is undetectable by regex and requires NER.

## Story

As a **data-protection officer**,
I want **PII detected by an NER-based Presidio service and redacted/flagged at ingest with publish blocked on failure, each ingest versioned with curator provenance, and every concept carrying a stable view-source reference**,
so that **no personal data reaches `published` (GDPR), provenance is auditable, and users can view the original source document in the browser.**

## Acceptance Criteria

### A. The pii-service sidecar (NEW component)

1. **`components/pii-service/`** — Python/FastAPI service: `presidio-analyzer` + `presidio-anonymizer` (MIT) + spaCy NER model **baked into the Docker image** (air-gap sovereign; no runtime egress — NFR-S1); CPU-only (NFR-S6); internal Kong service (like dataprep — not publicly routed); `GET /health` + `GET /ready` (model loaded); structured logging; ITU copyright headers; pytest suite.
2. **`POST /v1/pii/scan`** — `{texts: [{id, text, language?}], entities?: [], threshold?: number}` → `{results: [{id, hits: [{type, start, end, score}], counts_by_type, redacted_text}]}`. Redaction strategy = **replace-with-typed-placeholder** (`[PII:PERSON]`, `[PII:EMAIL]`, …) preserving readability. Default entity set: PERSON, LOCATION, EMAIL_ADDRESS, PHONE_NUMBER, CREDIT_CARD, IBAN_CODE, IP_ADDRESS, DATE_TIME, NRP. Batch input (ingest is async; one call per concept-batch).
3. **Per-jurisdiction recognizer registry** — national-ID patterns (Lesotho, Bangladesh, Gambia initial set) are **configuration** (a recognizers config file/env-loaded registry), not code. Adding a jurisdiction = a config entry.
4. **Deployment + CI**: `docker-compose.yaml` service (`genieai_network`, `genieai=true`, CPU, non-root, fluentd); `.gitlab-ci.yml` build/scan/promote lane mirroring the existing Python components (Trivy scan advisory for the new lane initially — model image size will surface AS warnings; document accepted findings); Kong config entry (internal). **Bump-UNgated** — imports nothing from OPEA `comps`.
5. **Model choice** (documented in the service README): v1 = spaCy `en_core_web_md` (NER-capable, ~50MB — reasonable image) with the recognizer registry; `lg` upgrade is a config swap. Non-English deployments swap models per language roadmap (i18n is core; v1 ships English).

### B. The Node okf-server side

6. **`services/pii/pii-client.js`** — HTTP client to the sidecar: timeout, bounded retry with backoff, circuit-breaker; maps responses to the internal hits shape. **Fail-closed**: any transport failure → the scan result is `{state: 'error'}` — NEVER silently clean (FR-5/NFR-P1). No raw PII logged (mask in logs — NFR-P2).
7. **`services/pii/pii-precheck.js`** (advisory only) — the rule-based regex detector (email/phone/credit-card+Luhn/IBAN) used ONLY by the editor pre-check surface (FR-25/Story 4.2) for instant feedback. Explicitly documented as non-authoritative.
8. **`services/pii-service.js`** (the orchestrator-facing API — write-path step 4d): `scanConcept(repo_id, concept_id, frontmatter, body)` → calls the client (frontmatter values scanned as text — ADR-okf-019), **UPSERTs** `okf_concepts_meta` `{pii_state: 'clean'|'hit'|'error', pii_hits_summary: {type: count}, pii_scanned_at}` (UPSERT creates a minimal doc if absent — the seed of Story 2.9.2's writer; supersedes conformance's 'unknown'); on 'hit' the `redacted_text` is returned for the caller to persist (2.9.1 stores bodies). MELT (`okf.pii.scan` span + `okf_pii_operations_total` + shared logger).
9. **Scan endpoint.** `POST /api/okf/repos/:repo_id/pii-scan` (tools-admin): `{concepts: [{concept_id, frontmatter, body}]}` (explicit v1 input — 2.9.1/7.2 call the service directly) OR `{file_ids: [...]}`/`{discover: true}` for plain-`.md` uploads (query `files` by `repo_id` — 2.5 stamps it — fetch via the doc-repo view endpoint, scan each doc; zips rejected with "unzip lands with 2.9.5"). Response: per-concept report + repo summary. On success with file input → `recordIngestVersion`.
10. **Publish gate helper (D22/ADR-okf-030).** `assertPiiClean(repo_id)` → `{blocked, reasons}` — blocked if ANY concept `pii_state ∈ {'hit','error'}` OR no scan record ('unknown'/absent → "PII scan required"). Ships + tests the helper; the lifecycle transitions (4.3/10.6) enforce it.
11. **Version record (FR-3).** `recordIngestVersion(repo_id, {file_id, curator})` → `okf_repositories.last_ingest = {file_id, uploaded_at (from the files doc), curator: {sub, name}, version_id: 'sha256:'+file_hash.slice(0,16)}` — stable, derived from the recorded content hash; **NOT** `bundle_version` (2.9.7's publish-time immutable manifest — different lifecycle moment: upload vs publish).
12. **Document references (FR-28).** `getDocumentReference(concept)` → `{file_id, view_url: '/api/files/{file_id}/view', download_url: '...'}`; repository-service `getById` includes `document_reference` when `source_file_id` is on the meta doc. Reuses the doc-repo's EXISTING endpoints.
13. **Standards.** Node: ESLint/Prettier clean, Jest (client fail-closed matrix, service UPSERT states, gate blocking matrix, endpoint auth/report, version record, doc-ref); Python: ruff + pytest (analyzer config, registry, redaction, endpoints, health). Direct AQL. Red-green verified. No Co-Authored-By.

## Tasks / Subtasks

- [ ] **T1 — Sidecar skeleton** (AC: 1,4): `components/pii-service/` (app.py, Dockerfile with model-bake, requirements.txt + lock, docker-compose entry, Kong internal route, CI lane, /health + /ready).
- [ ] **T2 — `/v1/pii/scan`** (AC: 2,3): presidio AnalyzerEngine + AnonymizerEngine; placeholder strategy; registry config (LS/BD/GM national IDs); batch shape; pytest.
- [ ] **T3 — Node `pii-client.js`** (AC: 6): axios + timeout/retry/circuit; fail-closed mapping; log masking. Jest with a mocked HTTP layer.
- [ ] **T4 — `pii-precheck.js`** (AC: 7): the regex detector (advisory; reused later by 4.2's editor).
- [ ] **T5 — `pii-service.js`** (AC: 8,11): scanConcept + upsertPiiState (AQL UPSERT seed) + recordIngestVersion + MELT.
- [ ] **T6 — `assertPiiClean`** (AC: 10) + gate blocking-matrix tests.
- [ ] **T7 — Route + discovery** (AC: 9,12): `POST /:repo_id/pii-scan` (tools-admin); files-by-repo_id AQL + doc-repo view fetch; `document_reference` in getById.
- [ ] **T8 — Tests + verify** (AC: 13): Node Jest suite; `cd components/pii-service && ruff check . && ruff format --check . && pytest`; `cd components/okf-server && npx eslint . && npx prettier --check . && npm test`.

## Dev Notes

### Why a sidecar (not in-process) — the compliance argument
GDPR personal data includes free-prose names, addresses, DoB, and health/financial facts — undetectable by regex, requiring NER. Presidio (MIT) is the reference open-source stack (spaCy NER + ~30 recognizers + pluggable registry). It is Python-only; the okf-server is Node (ADR-okf-001). A first-party sidecar keeps the authoritative gate NER-based while the Node service stays thin. We already operate four Python FastAPI containers — this is a fifth, with the same lifecycle; NOT a new vendor/infra kind (ADR-004's "no new infra" intent = no external SaaS — preserved). **Fail-closed** transport errors block publish — no silent degradation of the compliance gate. Original unredacted text = the retained doc-repo copy (FR-27) — steward review needs no encrypted side-store.

### Integration points (verified)
- `conformance-service.js:132-135` writes `pii_state:'unknown'` — superseded on scan; `persistConformanceIssues` (:126-139) = the AQL filter-and-UPDATE pattern to mirror (UPSERT variant).
- `okf_concepts_meta` has NO creator today (G9) → `upsertPiiState` is the 2.9.2 seed.
- 2.5 stamps `okf_repo_id` on the files doc — discovery filters on it (single ArangoDB, ADR-okf-018).
- Doc-repo view/download endpoints exist (`fileRoutes.js`) — FR-28 reuses.
- Service-module pattern: `repository-service.js` (withSpan + audit + counter) — mirror for `okf_pii_operations_total`.
- CI precedent for a Python component lane: dataprep/retriever (build → smoke import → scan → promote). **Bump-UNgated** (no `comps` import).

### 2.8 vs 2.9.7 boundary
`last_ingest.version_id` (sha256-derived, per-upload provenance) ≠ `bundle_version` (2.9.7 publish-time immutable manifest). Upload vs publish — no duplication.

### Licensing (verified)
presidio-analyzer/anonymizer MIT · spaCy MIT · fastapi MIT · uvicorn BSD · axios MIT (already in okf-server). All permissive — passes prd.md §9 + the blocking scan gate.

### Out of scope
- Editor pre-check UI wiring (4.2) · body/redacted-text persistence (2.9.1) · zip unzip (2.9.5) · lifecycle transition endpoints enforcing the gate (4.3/10.6) · right-to-erasure cascade (2.9.9) · okf_versions (2.9.7) · non-English models (language roadmap).

### References
- ADR-okf-004 (revised 2026-08-14 — this story implements the revision) · ADR-okf-030 (D22) · ADR-okf-021 §write-path-4d · ADR-okf-018 (single DB) · PRD FR-3/5/25/28, NFR-P1/P2, NFR-S1/S6 · course-correction G28 · epics.md Story 2.8.
- Code: conformance-service.js:126-139 · repository-service.js:28,111-167 · fileRoutes.js view/download · metadataService.js (okf_repo_id stamp).

## Dev Agent Record

### Agent Model Used
_(filled during dev-story)_

### Debug Log References

### Completion Notes List

### File List
