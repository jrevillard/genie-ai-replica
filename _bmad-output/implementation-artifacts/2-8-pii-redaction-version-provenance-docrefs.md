---
baseline_commit: pending
---
# Story 2.8: PII redaction at ingest + version/provenance + document references

Status: ready-for-dev
Story key: `2-8-pii-redaction-version-provenance-docrefs` | GitLab: #884 (`prd::okf-server`, `okf-server::epic-2`)
Epic: 2 (OKF Server — Repository Ingestion & Management) | Branch: `feat/okf-server`
FRs: **FR-3** (version tracking, doc-repo-consolidated), **FR-5** (PII redaction, blocking), **FR-28** (stable document references) | ADRs: okf-004 (revised by this story), okf-030 (D22 publish gate), okf-021 (write-path step 4d) | Gap: **G28** | NFRs: P1/P2

> **ADR-004 revision (this story):** ADR-okf-004 mandates Presidio library-mode "in the OKF Server governance/ module" — but Presidio is Python-only and the okf-server is Node (ADR-okf-001), and zero Presidio code exists anywhere in the repo (verified by grep). This story implements a **pluggable `PiiScanner` interface with a rule-based Node implementation (v1)** — zero new deps, sovereign, deterministic — and amends ADR-004 with the Node reality + the Presidio-backed upgrade path (Epic 6 hardening). The ADR's intent (blocking, at ingest, in-process, no new infra) is preserved.

## Story

As a **data-protection officer**,
I want **PII redacted/flagged at ingest with publish blocked on PII policy failure, each ingest versioned with curator provenance, and every concept carrying a stable view-source reference**,
so that **no PII reaches `published`, provenance is auditable, and users can view the original source document in the browser.**

## Acceptance Criteria

1. **Pluggable PII scanner (rule-based v1).** `services/pii/pii-scanner.js` — a PURE `scan(text, options)` returning `{ hits: [{type, start, end, preview_masked}], redacted_text, counts_by_type }`. v1 recognizers (zero deps, deterministic): email, phone (E.164 + common formats), credit-card (Luhn-validated), IBAN, IPv4, and configurable national-ID regex patterns (`OKF_PII_EXTRA_PATTERNS` JSON env). Masking replaces each hit with `[PII:{type}]`. Frontmatter values scanned as text (ADR-okf-019 scans frontmatter, not just bodies). **NFR-P2**: raw PII is NEVER persisted — only type + count + masked preview.
2. **`pii-service` + `pii_state` writer (G28).** `services/pii-service.js`: `scanConcept(repo_id, concept_id, frontmatter, body)` → scans, **UPSERTs** `okf_concepts_meta` `{pii_state: 'clean'|'hit'|'error', pii_hits_summary: {type: count}, pii_scanned_at}` (UPSERT creates a minimal doc `repo_id/concept_id` if absent — the seed of Story 2.9.2's full writer; 'unknown' default from conformance-service is superseded on scan); on 'hit' the **redacted_text** is returned for the caller to persist (2.9.1 stores it; 2.8 does not persist bodies). MELT (`okf.pii.scan` span + `okf_pii_operations_total` counter + shared logger). Scanner failure → `pii_state='error'` (never silently clean).
3. **Scan endpoint.** `POST /api/okf/repos/:repo_id/pii-scan` (tools-admin): body = `{concepts: [{concept_id, frontmatter, body}]}` (explicit v1 input — the orchestrator (2.9.1) and producer (7.2) call the service directly at write-path step 4d; a repo-file auto-discovery mode (query `files` by `repo_id` — 2.5 stamps it — + doc-repo view endpoint) is included for plain-`.md` uploads: `{file_ids: [...]}` or `{discover: true}`). Response: per-concept report + repo-level summary.
4. **Publish gate helper (D22/ADR-okf-030).** `assertPiiClean(repo_id)` service method: returns `{blocked: bool, reasons}` — blocked if ANY concept has `pii_state ∈ {'hit','error'}` OR no scan record exists (`pii_state` still 'unknown'/absent → publish refuses with "PII scan required"). FR-5/NFR-P1 blocking semantics. Exported for the lifecycle transition (Story 4.3/10.6 enforce it at the transition; 2.8 ships + tests the helper).
5. **Version record (FR-3, doc-repo-consolidated — NOT bundle_version).** `recordIngestVersion(repo_id, {file_id, curator})`: writes `last_ingest: {file_id, uploaded_at (read from the files doc), curator: {sub, name}, version_id}` onto `okf_repositories`, where `version_id = 'sha256:' + files.file_hash.slice(0,16)` (stable, derived from the already-recorded content hash — zero new collections; the immutable `okf_versions` manifest remains Story 2.9.7's `bundle_version`). Called by the pii-scan endpoint on success and available to 2.9.1.
6. **Document references (FR-28).** `getDocumentReference(concept)` helper → `{file_id, view_url: '/api/files/{file_id}/view', download_url: '/api/files/{file_id}/download'}`; the concept read API (repository-service getById) includes `document_reference` in its response when `source_file_id` is present on the meta doc. Reuses the doc-repo's EXISTING endpoints — no new doc-repo surface.
7. **ADR-004 revision.** Append a revision section to `docs/adr/okf-004-pii-redaction-strategy.md`: Node reality (Presidio Python-only), v1 = rule-based pluggable scanner (same blocking/sovereign/no-new-infra intent), upgrade path = Presidio-backed implementation behind the same interface (Epic 6).
8. **Standards.** Ruff n/a (Node only); ESLint/Prettier clean; ITU copyright headers; Jest tests (scanner purity + recognizers + Luhn negative cases + masking + frontmatter; service UPSERT states incl. 'error'; gate blocking matrix {hit, error, unknown, clean}; endpoint auth + report shape; version record; doc-ref shape). Red-green verified. Direct AQL (no ORM).

## Tasks / Subtasks

- [ ] **T1 — `pii-scanner.js`** (AC: 1) — pure recognizers + masking + `OKF_PII_EXTRA_PATTERNS`; no DB imports in the scan path.
- [ ] **T2 — `pii-service.js`** (AC: 2, 5) — `scanConcept` + `upsertPiiState` (AQL UPSERT on `(repo_id, concept_id)`; creates minimal doc if absent) + `recordIngestVersion` + MELT.
- [ ] **T3 — `assertPiiClean`** (AC: 4) — AQL aggregate over okf_concepts_meta by repo_id; blocking matrix.
- [ ] **T4 — Route + controller** (AC: 3, 6) — `routes/repos-routes.js` `POST /:repo_id/pii-scan` (tools-admin); `getDocumentReference` wired into repository-service getById.
- [ ] **T5 — Discovery mode** (AC: 3) — direct AQL `FOR f IN files FILTER f.repo_id == @repo_id` (same ArangoDB, ADR-okf-018; single-database verified in CLAUDE.md schema) + doc-repo view fetch + plain-`.md` scan; zips rejected with a clear "unzip lands with 2.9.5" error.
- [ ] **T6 — ADR-004 revision** (AC: 7).
- [ ] **T7 — Tests** (AC: 8) — per AC; mirror the conformance-service test patterns (arango-mock, createApp, keycloak-auth mock).
- [ ] **T8 — Lint/format/verify** — `cd components/okf-server && npx eslint . && npx prettier --check . && npm test`.

## Dev Notes

### Integration points (verified this session)
- `conformance-service.js:132-135` writes `pii_state:'unknown'` — 2.8 supersedes on scan; `persistConformanceIssues` (filter-and-UPDATE, :126-139) is the AQL pattern to mirror (UPSERT variant).
- `okf_concepts_meta` has NO creator today (G9 — nothing writes it) → 2.8's upsertPiiState is the **seed**; 2.9.2 formalizes first-class fields.
- 2.5 stamps `okf_repo_id` + `graph_name` on the files doc (extractMetadata) — discovery (T5) filters on it. Single ArangoDB database (ADR-okf-018; files/users/conversations coexist).
- Doc-repo view/download endpoints exist (`fileRoutes.js` `GET /:fileId/view`, `/:fileId/download`) — FR-28 reuses, does not rebuild.
- Service-module pattern: `repository-service.js` (withSpan + audit + `okf_repo_operations_total`) — mirror for `okf_pii_operations_total`.
- **No Presidio anywhere** (grep-verified); node-side ML PII libs are heavy/uncertain-license — rule-based v1 is the sovereign, permissive, deterministic choice.

### 2.8 vs 2.9.7 boundary (versions)
FR-3's "stable version identifier" = the derived `sha256:…` ingest record on `okf_repositories.last_ingest` (per-upload provenance). `okf_versions`/`bundle_version` (2.9.7) = the immutable publish manifest. No duplication: different lifecycle moments (upload vs publish).

### Out of scope
- Presidio-backed scanner (Epic 6, behind the same interface) · body persistence/redacted-text storage (2.9.1) · zip unzip (2.9.5) · lifecycle transition ENDPOINTS enforcing the gate (4.3/10.6 — 2.8 ships the helper) · right-to-erasure cascade (2.9.9) · okf_versions manifest (2.9.7).

### References
- Code: conformance-service.js:126-139,132-135 · repository-service.js:28 (LIFECYCLE_STATES),111-167 (pattern) · fileRoutes.js view/download · metadataService.js extractMetadata (okf_repo_id stamp).
- Docs: ADR-okf-004 (to be revised) · ADR-okf-030 (D22) · ADR-okf-021 §write-path-4d · ADR-okf-031 (2.9.7 boundary) · ADR-okf-018 (single DB) · PRD FR-3/5/28, NFR-P1/P2 · course-correction G28 · epics.md Story 2.8.

## Dev Agent Record

### Agent Model Used
_(filled during dev-story)_

### Debug Log References

### Completion Notes List

### File List
