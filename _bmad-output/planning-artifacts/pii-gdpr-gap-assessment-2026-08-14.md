# PII / Data-Protection Gap Assessment — RAG Pipeline & OKF (`feat/okf-server`)

**Date:** 2026-08-14 · **Branch:** `feat/okf-server` (HEAD `2af129149` + **uncommitted Story 2.8 work** — `components/pii-service/`, `okf-server/services/pii/`, `pii-service.js`, pii-scan route)
**Method:** full-codebase review (dataprep, document-repository, okf-server, pii-service, retriever, chatqna, gov-chat-backend, docker-compose/ansible/OTel config) cross-checked against the OKF PRD, ADRs okf-001..034, sprint status, and GitLab issues #873–#960. Every finding below is grounded in code (file:line as of this working tree). **Verification:** after drafting, all 51 findings were adversarially re-checked by 7 independent verifier agents instructed to refute each claim against the actual files — 49 CONFIRMED, 2 AMBIGUOUS (both corrected below: D15, F2/ADR-021), 0 REFUTED. Corrections from that pass are baked into the rows and citations.
**Scope note:** mobile and frontend clients are outside the RAG data path and not reviewed.

---

## 1. Executive summary

Presidio is being positioned **correctly for the OKF write path** — NER sidecar, fail-closed client, blocking publish gate, irreversible placeholder redaction, and scan-before-index ordering in the designed ADR-021 sequence. However:

1. **The existing single-document ingestion path has no PII detection at all and no planned story.** The PRD explicitly keeps it unchanged ([prd.md:420](prds/prd-okf-server-2026-07-15/prd.md)) and does not list PII redaction among the shared enhancements. This contradicts the stated intent of using Presidio "also in the existing single document based ingestion process" → decision needed (§5.1).
2. **Most OKF compliance machinery is still backlog**: write-side orchestrator (2.9.1), scan-before-index ordering (2.9.1), repo-graph retract fix (2.9.6), retention/erasure sweep (2.9.9), per-tenant authz (6.1/6.1b), audit (6.2). Epic 1 is gated on the OPEA 1.5 bump.
3. **Chat/user-data obligations are outside the OKF PRD and unplanned anywhere**: user-account deletion cascades nowhere, chat content is readable cross-user (IDOR), analytics is globally readable, and chat text is logged at INFO into 30-day VictoriaLogs.
4. **Infrastructure posture**: no encryption at rest for any store, plaintext east-west traffic (including forwarded bearer tokens), ArangoDB published on the host in plaintext.

### Verdict by dimension

| GDPR dimension | State in code today | Planned coverage | Verdict |
|---|---|---|---|
| Right to erasure | File hard-delete leaves vectors; user delete cascades nowhere; OKF retract is a stub | FR-8/NFR-P3 via 2.9.6 + 2.9.9 (backlog) | **Gap — OKF planned; legacy files, chat & user data unplanned** |
| Data accuracy (false negatives) | No detection on legacy path; OKF sidecar built (uncommitted); `pii_hit_count` stubbed 0 | Story 2.8 (in flight) + 4.4 steward gate | **Partial — OKF covered once 2.8 lands; legacy uncovered; no PII eval harness** |
| Lawfulness & consent | No license/consent/legal-basis/source-permission check anywhere; crawler unrestricted | FR-1/FR-2 + Story 2.7 deferred; PRD Q15 open | **Gap — unplanned** |
| Security & access control | Retrieval filters are client-supplied labels; ACL tokens never consumed; IDOR; plaintext everywhere | 6.1/6.1b + Epic 1 (backlog, gated) | **Gap — OKF authz planned; runtime/backend/infra unplanned** |
| Pseudonymization vs anonymization | OKF = irreversible placeholders (correct); original retained unredacted in doc-repo | FR-27 / ADR-okf-004 rev §5 | **By-design trade-off — retained originals need access control + erasure coverage** |

---

## 2. Verified current state

### 2.1 Existing single-document ingestion (production path)

Upload (`POST /api/files/upload`, Admin role) → MIME allowlist + size gate → ClamAV (when `VIRUS_SCANNING=true`) → disk (`doc_repo_uploads` volume) → `files` doc in ArangoDB → fire-and-forget POST to dataprep `/v1/dataprep/ingest_file` with **base64 file content and no auth** → docling parse → chunk → (optional, default-on) contextual-retrieval LLM context → LLM/embedding/BM25 labeling → `Document(page_content=…)`, embeddings computed **on raw context-augmented text** → `<GRAPH>_SOURCE/_ENTITY/_HAS_SOURCE/_LINKS_TO`.

Key facts:

- **No PII detection anywhere in this path** (no presidio/regex/masking in `genie-ai-overlay/` or doc-repo; presidio absent from dataprep requirements).
- Raw chunk text persisted **twice** per chunk (`text` + `metadata.chunk_text`); full original file persists in doc-repo uploads **and** a dataprep-container temp copy that is never deleted on success (`genieai_dataprep_microservice.py:177-182, 225, 240-241`).
- `files` doc has **no uploader identity and no tenant field**; `author` is free text; labels are category/service tags, not ACLs (`fileService.js:228-248`).
- Chunk lineage exists: `file_id`, `file_path`, `chunk_index`, `chunk_labels` (`genieai_dataprep_arangodb.py:1356-1360`) — sufficient for file-scoped retraction (which is why A1 below is a wiring gap, not a schema gap).
- ACL tokens (`t:/r:/d:`) are attached at ingest (`genieai_dataprep_arangodb.py:89-106, 1126-1133`) **but never consumed at query time**.

### 2.2 OKF path — built vs backlog

**Built (committed):** 2.1 skeleton, 2.2 meta collections + repo CRUD, 2.3 parser (trust/lifecycle/provenance families), 2.4 conformance (all non-blocking warnings), 2.5 doc-repo bundle ingest route (ClamAV scan called unconditionally — daemon only engages when `VIRUS_SCANNING=true`; MIME/language gates deliberately bypassed; fire-and-forget ingest kick), 2.6a ACL-label preserve in dataprep.

**In flight (uncommitted working tree, Story 2.8):** `components/pii-service/` sidecar (FastAPI + Presidio + spaCy `en_core_web_md`, LS/BD/GM national-ID registry, `[PII:TYPE]` placeholder redaction), Node `pii-client.js` (fail-closed) + `pii-precheck.js` (advisory regex) + `pii-service.js` (`scanConcept`, `assertPiiClean` publish-gate helper, `recordIngestVersion`), `POST /repos/:repo_id/pii-scan` (tools-admin, manual), doc-ref helper.

**Backlog:** Epic 2.9 (ingest orchestrator + worker + versions + retention sweep), Epic 1 (multi-graph fan-out — gated on OPEA bump), 6.1/6.1b (authz resolver, default-deny), 6.2 (audit), 4.3–4.7 (lifecycle/review/versioning/retention/FOI export), 5.x serving.

### 2.3 Infrastructure posture (highlights, see D7–D12)

- No encryption at rest: ArangoDB, Redis AOF, upload volumes, telemetry volumes, host log bind mounts; no LUKS in ansible.
- TLS terminates at nginx; **all east-west traffic is plaintext HTTP**, including backend→chatqna with the user's forwarded bearer token; overlay network not `encrypted`.
- ArangoDB published on host port 8529 in plaintext, root-password only.
- Cloud deploy disables TLS verification (`node_tls_reject_unauthorized: "0"`, `*_ssl_skip_verify: "1"`).
- Backups: plaintext dumps, no scheduling, `components/arangodb/dump.sh` hardcodes root password `test`.

---

## 3. Gap register

Legend — **Coverage:** `—` = no planned story anywhere; `planned (story)` = decided/ADR-backed backlog; `OKF-only` = covered for OKF but not the legacy path or backend.

### A. Right to erasure (GDPR Art. 17) & retraction

| ID | Gap | Evidence | Coverage |
|---|---|---|---|
| A1 | **File hard-delete never retracts vector data.** `DELETE /api/files/:id` deletes `files` metadata, crawl/ingestion logs, and the disk file — chunks, embeddings, entities, edges survive. Retract is a *separate* manual endpoint. | `document-repository/src/services/fileService.js:685-763`; retract only via `routes/fileRoutes.js:707` / `controllers/fileController.js:1139-1140` | — (legacy path) |
| A2 | **OKF repo delete is soft-delete with a stub retract.** Graph retract returns `{retracted:false, reason:'graph-retract-deferred-to-2.6'}`; no hard-delete sweep exists. | `okf-server/services/graph-retract-service.js:16-24`; `repository-service.js:344-391` | planned (2.6 → 2.9.6, gated; sweep 2.9.9) |
| A3 | **User-account deletion cascades nowhere.** `/api/me/delete` deletes the Keycloak user and nullifies **only** the `users` doc. Conversations, messages, `queries` (full chat text + responses), analytics, events, sessions, and the user's uploaded PII files all survive, still attributable via `userId`. | `gov-chat-backend/services/keycloak-proxy-service.js:187-236` | — |
| A4 | Conversation delete leaves the linked `queries` and `analytics` records. | `chat-history-service.js:848-925` | — |
| A5 | No purge path for analytics/events by user. | `analytics-service.js` | — |
| A6 | Dataprep container keeps a temp copy of every successfully ingested file forever. | `genieai_dataprep_microservice.py:177-182, 225` | — |
| A7 | Chat content in logs, backups, and VictoriaLogs is outside every erasure flow (see H). | §H below | — |
| A8 | `graphName` sent by doc-repo is **silently dropped** by the dataprep payload model → OKF per-repo graph chunks are unreachable by retract today; retract's default graph diverges from ingest's default when the env var is unset. | `genieai_dataprep_microservice.py:110-116` vs `fileController.js:991`; `:292` vs `:161` | planned (2.9.6, gated; = course-correction G5) |

### B. Detection accuracy / false negatives (Art. 5(1)(d))

| ID | Gap | Evidence | Coverage |
|---|---|---|---|
| B1 | **Zero PII detection on the legacy single-document ingestion path.** Embeddings and graph entities are built from unsanitized text. | grep across `genie-ai-overlay/`, doc-repo: none; presidio not in dataprep `requirements.in` | — (PRD line 420 keeps path unchanged) |
| B2 | OKF sidecar + fail-closed client + gate helper built (uncommitted); scan currently a **manual admin endpoint**, not an automatic pre-ingest enforcement. | `components/pii-service/app.py`; `okf-server/services/pii/pii-client.js`, `services/pii-service.js`, `controllers/repository-controller.js:104-151` | 2.8 (in flight); automatic sequencing = 2.9.1 |
| B3 | National-ID recognizers are conservative **placeholders** pending per-deployment format validation; threshold default 0.35. | `pii-service/app.py:30-31, 43-58` | 2.8 AC3 — operational follow-up per deployment |
| B4 | `pii_hit_count` hardcoded `0` in repo quality metrics. | `okf-server/services/conformance-service.js:161` | fixed by 2.8 |
| B5 | No recall/precision evaluation harness for PII detection (Epic 8 harnesses cover retrieval quality only). | sprint status epic-8 | — |
| B6 | Human-in-the-loop review for high-stakes content = steward approval gate. | — | planned (4.4, backlog) |

### C. Lawfulness / consent / governance-before-ingest (Art. 6)

| ID | Gap | Evidence | Coverage |
|---|---|---|---|
| C1 | No license / consent / legal-basis field or check on any input path (upload, bundle, crawl). OKF frontmatter has no `license` field; parser ignores none because none exists. | greps for `license\|consent\|legal_basis` in doc-repo + okf-server src: no matches | — (PRD §13 Q15 open) |
| C2 | Crawler fetches any scheduled URL — no robots/permission/allowlist gate. | `document-repository/src/utils/crawler.js`; `fileService.js` uploadLink | — |
| C3 | No source-permission/origin-health gate pre-ingest (source sync deferred). | sprint status 2-7 `deferred` | deferred with FR-1/FR-2 (2026-08-14 decision) |

### D. Security & access control (Art. 32, Art. 5(1)(f))

| ID | Gap | Evidence | Coverage |
|---|---|---|---|
| D1 | **No per-user/per-role enforcement at retrieval.** Filters are client-supplied label strings; a request with no labels searches the whole corpus; ACL tokens are ingested but never consumed; retriever microservice has no auth at all (internal-only network is the sole barrier). | `retriever/genieai_retriever_arangodb.py:780-814`; dataprep ACL tokens `:89-106` | planned OKF-only (6.1/6.1b + Epic 1, gated) |
| D2 | chatqna **proceeds unauthenticated** when the Authorization header is missing (warning only). | `chatqna/genieai_chatqna.py:2291-2292` | — |
| D3 | **IDOR**: get-conversation / get-messages / add-message / get-query-by-ID perform no ownership check (list endpoints do; delete does). | `chat-history-routes.js:129-146, 407-428, 477-547`; `query-routes.js:607-616` | — |
| D4 | Global cross-user reads: `/api/analytics/records` and `/events` return **all users'** analytics to any authenticated user. | `analytics-routes.js:452-472, 508-519` | — |
| D5 | Mutation/ops routes require authentication but not admin: service-category CRUD (knowledge taxonomy), DB backup/optimize. | `service-category-routes.js:13+`; `database-operations-routes.js:8, 36, 88` | — |
| D6 | Graph-traversal neighborhoods bypass the label filter (can surface out-of-scope chunk text). | `retriever/genieai_retriever_arangodb.py:619-679` | planned (1.1 "ACL on all search_start") |
| D7 | **No encryption at rest** for any store (ArangoDB no RocksDB keyfile, Redis AOF, upload volumes, vm/vlogs/vtraces volumes, log bind mounts); no LUKS in ansible. | `docker-compose.yaml:57-67, 363-365, 680, 628, 1591-1652` | — (deployment posture decision) |
| D8 | **All east-west traffic plaintext HTTP**, including backend→chatqna carrying the forwarded user bearer token; Swarm overlay network not encrypted. | `routes/query-routes.js:160-179`; `services/query-service.js:373`; `docker-compose.yaml:1767-1768` | — |
| D9 | ArangoDB published on host 8529, plaintext HTTP, root-password-only. | `docker-compose.yaml:674-682` | — |
| D10 | Cloud deployment disables TLS verification (self-signed + skip-verify) — encryption without authentication to the GPU node. | `deploy/ansible/group_vars/cloud_deploy/vars.yml:18-19, 41` | — |
| D11 | Backups: plaintext JSON/arangodump, no scheduling, hardcoded root password in `dump.sh`. | `components/arangodb/dump.sh:5-7, 35-37`; `database-operations-service.js:59-126` | — |
| D12 | Unauthenticated OTLP/fluent-forward endpoints reachable from the attachable network; Kong admin API plain HTTP on the same network. | `configs/otel/otel-collector-config.yaml:44-50`; `docker-compose.yaml:197, 222-224` | — |
| D13 | `users` collection defines **special-category** profile sections (health/medical, criminal/legal, financial/tax, identity/travel) plus per-user `Uploads/` files — unencrypted, and outside the erasure cascade (A3). | `user-profile-service.js:230-240, 311-353` | — |
| D14 | Redis translation cache stores user text **permanently** (no TTL), AOF-persisted, plaintext. | `translation-service.js:464-466`; `docker-compose.yaml:363-365` | — |
| D15 | No **structured** access-audit trail for admin reads of user chat data (Query Inspector) — general winston request logs exist (`admin-routes.js:661, 699` + request-entry middleware `:35-42`) but record no queryable admin-identity→target→timestamp audit; `okf_audit` covers OKF repo ops only. | `admin-routes.js:645-697`; `okf-server/services/audit-service.js:35-52` | OKF side planned (6.2) |

### E. Pseudonymization vs anonymization

| ID | Finding | Evidence | Coverage |
|---|---|---|---|
| E1 | OKF redaction = replace-with-typed-placeholder (`[PII:PERSON]`) — **irreversible**, no hash/encrypt operators. Correct choice if anonymization of the indexed text is the goal. | `pii-service/app.py:170-171`; Story 2.8 AC2 | OK |
| E2 | The **unredacted original is retained by design** in doc-repo (FR-27/ADR-okf-004 rev §5) and served via view/download endpoints. Consequence: the system as a whole holds *pseudonymized-at-best* data; the retained originals need access control (D1/D5) and full erasure coverage (A1/A2/A6) — including the dataprep temp copy. | ADR-okf-004 rev; `fileController.js:572-618` | by-design decision — controls pending |

### F. Pipeline ordering (PII before chunking/embedding)

| ID | Finding | Evidence | Coverage |
|---|---|---|---|
| F1 | Legacy path: **no sanitization stage exists** — embeddings, entities, and relations are computed from the raw (context-augmented) chunk text; with contextual retrieval on (the default), the raw chunk is stored verbatim a second time as `metadata.chunk_text`. | `genieai_dataprep_arangodb.py:1362-1367, 115` | — |
| F2 | OKF **today** (2.5 + uncommitted 2.8): bundle upload → ClamAV → fire-and-forget ingest (**chunks + embeddings happen first**) → PII scan is a manual endpoint afterwards. The designed ordering (parse → UPSERT meta → conformance → **PII** → dedup → enqueue — PRD FR-34, `prd.md:186`; ADR-021 context lists a compatible parse→validate→PII→index sequence) arrives with 2.9.1. Until then, unredacted OKF text is embedded; the publish gate withholds *serving*, but vectors/entities already exist in the graph. | `fileController.js:1018-1078` (setImmediate ingest); `repository-controller.js:104-151`; PRD FR-34 | planned (2.9.1, backlog) |
| F3 | Persisting `redacted_text` and re-indexing after a hit is deferred (2.8 out-of-scope note). | Story 2.8 §Out-of-scope | planned (2.9.1; idempotent re-ingest via content-hash exists in design) |

### G. Metadata tagging on chunks

| ID | Finding | Evidence | Coverage |
|---|---|---|---|
| G1 | Chunk lineage exists: `file_id`, `file_path`, `chunk_index`, `chunk_labels`. | `genieai_dataprep_arangodb.py:1356-1360` | OK (foundation for erasure) |
| G2 | `files` doc stores **no uploader identity** and no tenant; `author` is free text. Accountability/audit gap. | `fileService.js:228-248` vs `keycloak-auth-middleware.js:145-151` | — |
| G3 | No timestamps on chunks; staleness exists only OKF-side (`stale_after` metric). | `conformance-service.js:158` | OKF planned (5.4) |
| G4 | OKF `acl.required_scopes` / `acl.sensitivity` stored but not enforced. | `repository-validator.js:11-14`; `repository-controller.js:26-35` | planned (6.1) |

### H. Logging / telemetry PII (feeds A7)

| ID | Gap | Evidence | Coverage |
|---|---|---|---|
| H1 | chatqna logs the **full LLM messages array** (chat history + compiled user info) at INFO with `LOGFLAG` default on → fluentd → VictoriaLogs (30 d). Also an unconditional user-context log line. | `genieai_chatqna.py:90, 930, 1021-1025`; `otel-collector-config.yaml:183-189` (no redaction processor) | — |
| H2 | Retriever logs **full chunk text** unconditionally (not gated by logflag). | `genieai_retriever_arangodb.py:1046-1047, 1063, 1086` | — |
| H3 | Backend logs full request headers (incl. Authorization) at debug; morgan logs full URLs at info. | `gov-chat-backend/index.js:520-542` | — |
| H4 | `tracing-pii.js` redacts only credential-like keys, emails, and `Bearer <token>` values; Python spans have **no export-time redaction** (sanitize is manual, metrics-only). | `tracing-pii.js:4-14`; `genie-ai-overlay/tracing.py:146-151` | — |

---

## 4. The four-step compliant-pipeline checklist (as requested)

| Step | Legacy single-doc path | OKF path |
|---|---|---|
| 1. Governance/consent check before processing | **Absent** (C1–C3) | **Absent** — no license/consent field; source-permission deferred (C1/C3) |
| 2. PII sanitization **before** chunking/embedding | **Absent entirely** (B1, F1) | **Designed yes** (ADR-021), **not yet built** — today indexing precedes the manual scan (B2, F2) |
| 3. Metadata tagging (doc ID, source, access level) | Partial: `file_id`/labels yes (G1); uploader/tenant/access-level **no** (G2); ACL labels attached but unenforced (D1) | Designed yes (ACL labels, repo binding); enforcement is 6.1 backlog (D1, G4) |
| 4. Secure vector storage (encryption at rest + RBAC on query) | **No encryption at rest; no RBAC at query** (D1, D7) | Same substrate; authz planned (6.1/6.1b), encryption unplanned (D7) |

---

## 5. Discrepancies & decisions needed

1. **Presidio on the legacy single-document path.** Stated intent: Presidio in *both* the OKF pipeline and the existing single-document ingestion. Artifacts: OKF-only — the PRD keeps the existing flow unchanged and lists only Label Onboarding / conformance / auto-correct as shared enhancements ([prd.md:420](prds/prd-okf-server-2026-07-15/prd.md)). Either extend FR-5 with a new story (wire `pii-service` into the doc-repo→dataprep path before chunking — the sidecar is bump-ungated and already callable, so this is a bounded increment), or record the exclusion as an accepted, documented limitation. This is the single largest scope discrepancy.
2. **Erasure coverage outside OKF.** A1 (retract-on-delete), A3–A5 (user/chat-data cascade) are outside the OKF PRD and have no owner. Recommend a small backend hardening epic or explicit risk acceptance.
3. **Retained-original model (E2).** Confirm that view/download of retained originals is access-controlled and that originals (doc-repo copy **and** dataprep temp copy, A6) are included in the 2.9.9 erasure sweep and retention policy.
4. **Encryption/in-transit posture.** Deployment-level decision: ArangoDB RocksDB encryption or host-level LUKS, overlay-network encryption (`driver_opts: encrypted`), removing ArangoDB from host publication, re-enabling TLS verification on the cloud GPU path, backup encryption + scheduling.

---

## 6. Already well-covered (no action)

- ClamAV (unconditional call on bundles, gated behind `VIRUS_SCANNING=true` on standard uploads), MIME allowlist + size limits on standard uploads; Admin-role gating on doc-repo routes; dataprep→backend calls use a Keycloak service account.
- Dataprep is internal-only (no Kong route, no host port); pii-service likewise internal-only with fail-closed client and no-raw-PII logging; placeholder redaction is irreversible (E1).
- nginx TLS termination with HTTP→HTTPS redirect; ansible-vault for at-rest secrets; SSL keys 0600.
- LLM user-context is minimal (name/role only, DoB→age conversion); OTel **span attributes** are scrubbed of credential-like keys (H4 is about logs/free text, not span keys).
- Chunk-level `file_id` lineage makes file-scoped erasure a wiring problem, not a schema problem (A1).
- The OKF plan's internal sequencing is consistent: 2.8 gate → 2.9.1 scan-before-index → 2.9.6 retract fix → 2.9.9 retention/erasure → 6.1/6.1b authz. The unplanned surface is the legacy path, backend chat/user data, and the infrastructure posture.