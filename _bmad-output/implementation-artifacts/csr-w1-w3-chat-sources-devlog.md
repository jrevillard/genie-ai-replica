# Dev log — W1-W3 chat-source resolution (CAP-1..3 live-verified)

**Branch:** `feat/okf-chat-source-w1` · **Spec:** `_bmad-output/specs/spec-okf-chat-source-resolution/` · **Date:** 2026-11-04
**Status:** code-complete, unit-verified, LIVE-verified (smoke 7/7 PASS on the local build). Not pushed (GitLab git-http 403 all day — retry loop armed); not merged.

## What shipped (commit order)

| Commit | Wave | Summary |
|---|---|---|
| `e91cb7100` | W1/CAP-1 | Retriever identity: second batched AQL joins `okf_concepts_meta` on (graph_name, concept_id) → `repo_id` + `bundle_version` ride chunk metadata → provenance → chatqna mint. No graph-name parsing; legacy byte-identical; failure-isolated. |
| `a91d2f7b2` | W2/CAP-2 | `assertRepoReadableByCaller` fence on the concept read family (getConcept/listConcepts/getRepoManifest/getRepoLinks) — RESTRICTED repos serve only privileged/granted callers, 404 + audited (anti-enum). Closed a real pre-existing gap: the read routes applied only the scope-set filter. |
| `97f05de69` | W3/CAP-3 | Frontend: okf-concept cards never take the doc-repo URL family; open = markdown rendered via okf-server route (markdown-it → blob → tab); titles resolve async (frontmatter, session-cached); rehydrate grafts identity from raw metadata onto persisted rows; legacy rows byte-identical; i18n ×14. |
| `a90f58f` | W2 fix | The concept GET registered on `servingReads` (allowScopelessWhenOpen) — the strict router gate 403'd citizens before the fence could run. |
| `c0b2dde` | W1+W2 fix | `readAuthzForService` (deriveReadAuthz — the retrieval-side verdict) for the serving read; `stampRepoGraphName` now binds `bundle_version` at ingest-arm (meta rows were born null and nothing bound them). |
| `3b12e904`→`1df9f145` | smoke | `run-smoke-chat-sources.mjs` — the live harness. |

## Verification

- okf-server Jest 1991+3 green; overlay pytest +7 new green (suite delta vs stash baseline: zero new failures); frontend Jest 3748 green, coverage **88.96%** vs 88.21% baseline; eslint/prettier/ruff clean.
- **Live smoke 7/7** (`node data/okf/smoke-test/run-smoke-chat-sources.mjs`, host-side, real Keycloak/Kong/dataprep/remote-GPU): lifecycle ladder → drain → CAP-2 (scopeless open read 200; RESTRICTED fenced 404; admin reads; strict editor index 403) → CAP-1 (graph set visible; every okf citation carries repo_id + bundle_version + graph_name) → retract+delete cleanup.

## Live lessons baked into the smoke (each one cost an attempt)

1. Lifecycle ladder is `submit → approve → publish → INGEST` — ingest is what enqueues the drain; publishing stops at the mint.
2. PII gates publish: `DATE_TIME` hits (my "08:00–16:00") block it — smoke text is PII-clean by construction.
3. Access tokens expire in minutes; an expired-token poll looks exactly like a stuck drain — the smoke re-mints at start.
4. The server mints repo/concept ids itself — read them back, never reuse the request's names.
5. `INGESTED_DELETE_BLOCKED`: sweeps must retract-then-delete (silent delete failures left serving zombies that polluted the next run's citations).
6. A left-behind serving repo gets cited by the next run → the smoke defaults to full cleanup.
7. CAP-1's contract is identity ON the citations; which repo the query-affinity router cites is routing's business (this build serves ~16 repos).

## Bugs found & filed

- **#1437** — flat `uploaded_files` namespace collides across repos when two repos mint the same `concept_id` under concurrent lanes (ENOENT dead-letter + cross-repo Retracted 404s). Mitigated in the smoke (sequential drains); real fix belongs to the ingest lane.

## Not done yet (deliberate)

- Push (git-http 403 since ~16:00 — loop retries both branches every 90s).
- W2 structured security review (before the MR — the fence + serving-read change is the authz-sensitive surface).
- Browser-level citation-click pass (W3 UI behavior is unit-covered; the click-through rides W9's Playwright work or David's manual pass — the smoke leaves `OKF_SMOKE_CLEANUP=none` runs for exactly that).
- W4–W9 per the remediation plan.
