# Worklog — `feat/okf-server` branch (OKF Server initiative)

**Date:** 2026-08-15 · **Branch:** `feat/okf-server` (MR !278) · **Head at writing:** `af3a6907a`
**Purpose:** consolidated record of ALL work on this branch (across every Claude session/context that produced it), for team communication and roadmap planning. Commit hashes are the authoritative record; this is the human-readable index.

---

## 1. OKF write-side delivered (Epics 2 + 2.9)

| Story | What landed | Commits / status |
|---|---|---|
| 2.1 OKF server skeleton + deploy wiring | Express service, Kong route, CI lane, health/ready | done |
| 2.2 ArangoDB meta collections + repo CRUD | `okf_repositories`/`okf_concepts_meta`/`okf_audit`/`okf_sources` + CRUD API + audit | done |
| 2.3 OKF parser | frontmatter v0.2 families (trust/lifecycle/provenance), structural links | done |
| 2.4 Conformance validation + metrics | OKF §11 warnings, repo quality metrics | done |
| 2.5 Doc-repo bundle ingest route | `POST /api/files/ingest-bundle` (ClamAV, ownership assertion, 202 fire-and-forget) + code-review fixes (416 tests green) | done |
| 2.6a ACL-label preserve fix (UNGATED P0) | `t:/r:/d:` labels preserved verbatim into `chunk_labels` at ingest (G4); code-review approved, pipeline #6102 | done (#916) |
| 2.7 Source sync (Git/S3) | **deferred 2026-08-14** — v1 inputs are file-picker/crawler/manual (FR-1/FR-2 deferred) | deferred |
| 2.8 PII redaction + versions + doc-refs | **`components/pii-service/`** Presidio sidecar (NER, national-ID registry config, fail-closed) + `assertPiiClean` publish gate + `recordIngestVersion` + doc references; adversarial code-review fixes applied; CI lane fixed (pytest install, unpinned deps) | done (#884) — `6d96b894e`, `49d997e5b`, `329c77036`, `613432e2c` |
| 2.9.2 `okf_concepts_meta` UPSERT writer (G9) | Canonical `concept-meta-service.upsertConceptMeta` + conformance rewire (fixes silent zero-row UPDATE); smoke-caught fixes; **OKF smoke harness + kenya bundle fixtures** | review (#918) — `230867922`, `1e49da4da` |
| (smoke-test findings) | Ingestion state machine (`_markIngestFailure`), repo `firstExample`, `tools-admin` realm role provisioning in `genie-realm.yaml` | `e1d1a3c03` |

## 2. Split-URL OIDC + bundle labels (2026-08-15)

- **`3663cc807` fix(oidc):** split-URL OIDC support — `KEYCLOAK_PUBLIC_URL` issuer alias in backend + doc-repo (converges with the committed shared/lib pattern okf-server uses); `KEYCLOAK_INTERNAL_URL` for dataprep service-account mint + chatqna JWKS; compose/env-template/ansible-`env.j2` wiring (all empty-default, cloud-neutral no-ops); 7 contract tests. Root cause fixed locally via Keycloak `KC_HOSTNAME` full-URL issuer pin (local override only — cloud needs nothing).
- **`2fa4d5f5d` feat(okf):** bundle ingest accepts `labels[]` (knowledge-hierarchy selections persist on the files doc and scope chunk labeling); 3 route tests.
- **Local-build verification (2026-08-15, explicit success criteria, all passed):** uniform issuer across all mint paths; doc-repo accepts service + user tokens (UI doc-repo API breakage fixed); single-`.md` full lifecycle (upload→ingest→`Ingested` 8 chunks→retract cascade→0); 5-file kenya bundle all `Ingested` (40 chunks, 12 hierarchy labels each); control-plane smoke PASS with the **PII publish gate correctly blocking** (`pii_state=hit` ×5).
- **Boundaries proven by the smoke run** (known gated stories, now with evidence): zip bundles rejected by dataprep format allowlist → server unzip is **2.9.5**; concurrent ingest kicks race on the single-ingest lock → worker is **2.9.4**; `graphName` still dropped by the dataprep payload model → per-repo graphs are **2.9.6** (OPEA-bump-gated).

## 3. Story specs created

- **6.1 authn/authz default-deny (G3/G15 P0)** — `af3a6907a`, ready-for-dev (#905): scope grammar `okf:{tenant}:{repo}:{read|admin}`, `requireScope`/`requireRepoScope`, default-deny list + 404 foreign repos, opt-in RFC 8707 audience binding (additive shared-service change), genie-realm provisioning, denial audit, red-green isolation matrix. All flagged doc ambiguities resolved as D1–D7 in the story.
- **2.9.1 ingestService** is the next trunk story (not yet specced) — today's smoke learnings feed it directly.

## 4. Planning artifacts (cross-context)

- **PII/GDPR gap assessment** (`pii-gdpr-gap-assessment-2026-08-14.md`) — whole-codebase, 51 findings adversarially verified (49 confirmed / 2 corrected / 0 refuted): erasure gaps (file hard-delete never retracts vectors; user-account delete cascades nowhere; IDOR), zero PII detection on the legacy single-document path (Presidio is OKF-write-path only), no license/consent checks, encryption-at-rest absent, chat content logged at INFO into 30-day VictoriaLogs. **5 decisions distilled into the pending-decisions doc.**
- **Admin-logs / VictoriaLogs migration assessment** (`admin-logs-victorialogs-migration-assessment-2026-08-15.md`) — **IN PROGRESS (another session is finalizing it)**: admin Logs + Security-scanning facilities are still 100% Winston-file-based; no app code queries VictoriaLogs; cloud has observability **off** (`enable_observability: "0"`); producer-side mandate — the shared logger needs a first-class VictoriaLogs transport. Roadmap item.
- **OPEA 1.5 considerations doc** restructured by the parallel session (team-discussion input for the bump decision).

## 5. Deploy/ops

- `deploy/ansible/group_vars/cloud_deploy/` (vault-encrypted) + `inventory/cloud_deploy.ini` + root operational scripts (`deploy-cloud*.sh`, `redeploy-*.sh`, `ssh-cloud.sh`, `check-logs.sh`) — the cloud-deploy (10.0.0.101) workflow tooling.

## 6. Open items (tracked elsewhere, listed for completeness)

- Label semantics (file_labels scope vs forced-attach) — **deliberately deferred by David**; captured in pending-decisions.
- `2-9-2` awaiting formal code-review; story files 2.8/2.9.2 say `review`, sprint is the tracker.
- Next dev order per plan: **6.1 → 2.9.1** (then 2.9.3/2.9.4/2.9.5/2.9.7/2.9.8/2.9.9 ungated; Epic 1 gated on the OPEA bump).