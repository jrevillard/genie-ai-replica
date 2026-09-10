# Smoke Plan — Session Work 2026-09-01/02 (feat/okf-server)

Scope: everything this context built or fixed. Target: LOCAL BUILD (C:\Dev\builds\main, `main-*` containers).
Run order matters — later phases depend on earlier state. Each check has an explicit PASS criterion.

Work under test:
- A. Audit log (okf_audit_logs, every action audited, GET logs, Logs UI on editor shell + dashboard cards)
- B. Born-right graph naming (OKF_<slug>_v{N} at first write; READ ONLY while serving; promote/demote)
- C. service-token endpoint failover (4757ec684)
- D. Drain-authority promote/demote — version-skew safety (8b4e9384b)
- E. doc-repo born-right bundle names (8b4e9384b)
- F. Frontmatter conformance rejection escape (1ba04a06d)
- G. mint-tokens credential self-heal (1ba04a06d)

---

## Phase 0 — Preconditions (5 min)

| # | Step | PASS |
|---|------|------|
| 0.1 | `docker ps` from C:\Dev\builds\main — okf-server, document-repository, frontend, keycloak, dataprep, nginx Up (healthy) | all healthy; no `itu-gitlab-*` stack running |
| 0.2 | Marker check (the commit-before-sync lesson): `docker exec main-okf-server-1 grep -c tokenEndpointCandidates /app/services/service-token.js` → 3; `grep -c conformanceFm /app/services/concept-meta-service.js` → 2; `grep -c drainedGraphNames /app/services/graph-lifecycle-service.js` → 3; `docker exec main-document-repository-1 grep -c born-right /app/src/controllers/fileController.js` → 2 | all counts match |
| 0.3 | `cd data/okf/smoke-test && node mint-tokens.mjs` | 3 tokens minted, ROPC reverted (self-heal G live-proven every run) |
| 0.4 | Queue check (AQL): `FOR m IN okf_concepts_meta FILTER m.index_status=='parsed' COLLECT WITH COUNT INTO z RETURN z` | note the depth. If > ~20 (crawler backlog), plan to use the manual-drain workaround for Phase 2 drains (never delete/reorder other repos' rows) |
| 0.5 | Frontend bundle: `docker exec main-frontend-1 sh -c "grep -l onLogs /app/dist/js/*.js"` | ≥1 chunk matches (dashboard Logs, A) |

## Phase 1 — Unit/CI evidence (3 min)

| # | Step | PASS |
|---|------|------|
| 1.1 | `components/okf-server`: `npx jest` | 410/410 (incl. service-token failover ×10, graph-lifecycle drain-authority, frontmatter escape, audit payload tests) |
| 1.2 | `components/document-repository`: `npx jest src/__tests__/routes/bundleIngest.test.js` | 19/19 (born-right accepted; foreign legacy name still 400 OWNERSHIP_MISMATCH) |
| 1.3 | `components/gov-chat-frontend`: `npx jest src/__tests__/components/okf/lifecycle-ui.test.js` | 15/15 (card Logs between Versions and Export + dialog opens for that repo) |

## Phase 2 — Born-right lifecycle smoke (core; ~20 min + drain time)

Fresh repo, full machine walk. Use concept fixtures WITH `type:` (conformance) and FR-7 body links.

| # | Step | PASS (feature) |
|---|------|----------------|
| 2.1 | POST /api/okf/repos `{name:"Smoke <uniq>", domain:"social", acl:{required_scopes:["okf:default:*:admin"]}}` | 201; registry `graph_name` is the legacy anchor `OKF_<uuid>` only (B) |
| 2.2 | Enqueue 3 concepts: `index.md` (type: index, body links to health/water), `health.md` (type: service, link to water), `water.md` (type: service) — AND one extra `bad.md` with NO `type:` | 202; summary `rejected: 1` (bad) `parsed: 3`; audit rows `repo.ingest` + `concept.ingest` exist |
| 2.3 | AQL: `FOR c IN okf_concepts_meta FILTER c.repo_id==RID RETURN {cid, graph_name}` | every row `graph_name == "OKF_smoke-<uniq>_v1"` — BORN RIGHT at enqueue (B) |
| 2.4 | Arango collections list | `OKF_smoke-<uniq>_v1_{SOURCE,ENTITY,HAS_SOURCE,LINKS_TO}` exist (worker/dataprep created them under the born-right name, never OKF_<uuid>) (B) |
| 2.5 | Fix `bad.md` by adding `type: service` ONLY (body byte-identical) → re-enqueue | row flips `rejected → parsed` (F — frontmatter escape; the body-hash-only escape would leave it rejected forever) |
| 2.6 | Wait for drains (worker; if starved use the in-container manual dataprep POST with 429 retries) | all 4 `indexed`; audit rows `ingest.ingested` ×4 with description; `repo.edges_written` rows exist |
| 2.7 | AQL graph integrity: counts + `IS_SAME_COLLECTION` on every `_from/_to` of both edge collections; `FOR g IN _graphs FILTER g._key=='OKF_smoke-<uniq>_v1'` | 100% canonical endpoints; named definition with both edge defs; traversal from `is_index` root reaches ≥ 20 vertices; concept edges index→health, index→water, health→water present (B) |
| 2.8 | Lifecycle: submit → approve → pii-ack (if flagged) → publish | publish mints **v1**, response `bundle.file_name == "smoke-<uniq>-v1.zip"`; doc-repo files doc has `graph_name == "OKF_smoke-<uniq>_v1"` (E — born-right name accepted) |
| 2.9 | Lifecycle: ingest | 200 `graph_name == "OKF_smoke-<uniq>_v1"` and `renamed: 0` in the `repo.graph_promote` audit description — the drain graph IS the serving graph (no-op promote) (B, D) |
| 2.10 | GET /api/okf/repos/RID/logs?limit=200 | rows in order incl. repo.create, concept.ingest, ingest.ingested, repo.edges_written, repo.submit, repo.approve, repo.version_mint, repo.publish, repo.graph_promote, repo.ingest — each with actor, actor_name, ts, non-empty description (A) |
| 2.11 | Serving repo is READ ONLY: PATCH a concept, PUT repo, POST publish | all 409 `REPO_READ_ONLY`; each refusal audited (B, A) |
| 2.12 | UI: dashboard → the repo card shows **Logs between Versions and Export**; open it | dialog shows this repo's rows (when/user/action/description); same via editor shell strip (A) |
| 2.13 | Retract | 200; `repo.graph_demote` audit: `OKF_smoke-<uniq>_v1 -> OKF_smoke-<uniq>_v2`; collections renamed, endpoints still 100% canonical; repo editable again (B) |
| 2.14 | Edit a concept + re-drain, then publish + ingest again | version 2; serving graph `OKF_smoke-<uniq>_v2` with data (B) |

## Phase 3 — Version-skew safety (the drain-authority fix, D; ~10 min)

| # | Step | PASS |
|---|------|------|
| 3.1 | While a repo sits at `approve` with a drained graph, force a publish to fail AFTER the mint (e.g. stop document-repository: `docker compose stop document-repository`) | publish → 502 `EXPORT_FAILED`; version consumed; state stays `approve` |
| 3.2 | Restart document-repository; publish again (mints v2), then ingest | ingest response `graph_name == OKF_smoke-<uniq>_v2` AND AQL shows **all data under v2** (counts match the pre-publish drain; NOT an empty v2) — the promote resolved the source from meta rows |
| 3.3 | `docker logs main-okf-server-1` | no `dataprep POST failed: ... token request failed` anywhere; the `repo.graph_promote` audit names the drained graph as `from` |

## Phase 4 — service-token failover (C; 5 min, no downtime)

| # | Step | PASS |
|---|------|------|
| 4.1 | In-container: `node -e` — unset KEYCLOAK_INTERNAL_URL, set KEYCLOAK_PUBLIC_URL=https://localhost/auth (dead in-container) + KEYCLOAK_URL=http://kong:8000/auth, `_resetForTesting()`, mint | token minted via the fallback; log line names the winning `endpoint` |
| 4.2 | All-endpoints-down: point INTERNAL+URL+PUBLIC at unreachable hosts, mint | error message lists EVERY endpoint tried with its failure (`failed for N endpoint(s): ...`) — visible in `docker logs` (Winston strips metadata; message must be self-describing) |
| 4.3 | Restore env; verify the live service still drains (Phase 2.6 evidence suffices) | no regression |

## Phase 5 — Audit-log negatives + logs API contract (5 min)

| # | Step | PASS |
|---|------|------|
| 5.1 | GET logs for a foreign/nonexistent repo (scoped token without access) | 404; an `authz.denied.repo` audit row exists (if a Set-authz caller) |
| 5.2 | GET logs `?limit=0` / `?limit=99999` | clamped (200 default / 500 max), 200 response |
| 5.3 | Create repo, patch it, delete it → GET logs before deletion | `repo.create`, `concept.patch` (description says "re-index queued (content changed)" or links-only variant), `repo.delete` rows all present with actor_name "Admin GENIE" (A) |
| 5.4 | AQL: `FOR l IN okf_audit_logs FILTER l.repo_id==RID SORT l.ts RETURN l` | rows carry trace_id where the request had one; ts ISO-formatted |

## Phase 6 — Cleanup (5 min)

| # | Step | PASS |
|---|------|------|
| 6.1 | Retract (if serving) then DELETE the smoke repo | 202; cascade drops all `OKF_smoke-<uniq>_*` collections AND both graph definitions (v1 + v2) |
| 6.2 | Collections/graphs sweep: any `OKF_smoke-*` left? | zero orphans |
| 6.3 | `docker exec main-okf-server-1 sh -c "rm -f /tmp/manual-drain*.js"` as a root-capable context if used (harmless if it fails — app user can't remove root-owned docker-cp files) | best-effort |

## Automated-harness follow-ups (extend run-smoke-lifecycle.js per the per-story smoke rule)

1. Assert born-right `graph_name` on every meta row right after enqueue (2.3).
2. Assert the audit trail: fetch /logs after the walk and require the exact action set + non-empty descriptions (2.10) — replaces manual inspection.
3. Assert the frontmatter-escape: enqueue bad → rejected → re-enqueue fixed → parsed (2.5).
4. Assert promote `renamed: 0` on a clean flow and the version-skew promote moves data (Phase 3) — needs doc-repo stop/start, keep it a separate flagged section.
5. Assert every dashboard card strip order (UI test already pins it in jest — 1.3).

## Known environmental caveats

- The ingest worker queue is GLOBAL: a crawler backlog starves probe drains — use the manual dataprep POST (429-retry) from inside main-okf-server-1; never mutate other repos' rows.
- Never run `docker compose` from d:\ITU-Gitlab (creates the `itu-gitlab-*` second stack) — build dir only.
- GitLab may still 502: this plan is local-build only; push + CI retries are separate.
- Do not stop dataprep/okf-server while the other session's crawler is mid-conversion (their crawl→OKF feature writes through the same services).