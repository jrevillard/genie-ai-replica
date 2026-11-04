# Dev log — W1-W3 chat-source resolution (CAP-1..3 live-verified)

**Branch:** `feat/okf-chat-source-w1` · **Spec:** `_bmad-output/specs/spec-okf-chat-source-resolution/` · **Date:** 2026-11-04
**Status:** code-complete, unit-verified, LIVE-verified (smoke 7/7 PASS on the local build). Pushed + rebased onto origin/main (post-outage). W2 structured security review DONE — 2 findings fixed (`6c7bee69c`); live re-verify of the review fixes pending the build-tree sync (see below).

## What shipped (commit order)

| Commit | Wave | Summary |
|---|---|---|
| `e91cb7100` | W1/CAP-1 | Retriever identity: second batched AQL joins `okf_concepts_meta` on (graph_name, concept_id) → `repo_id` + `bundle_version` ride chunk metadata → provenance → chatqna mint. No graph-name parsing; legacy byte-identical; failure-isolated. |
| `a91d2f7b2` | W2/CAP-2 | `assertRepoReadableByCaller` fence on the concept read family (getConcept/listConcepts/getRepoManifest/getRepoLinks) — RESTRICTED repos serve only privileged/granted callers, 404 + audited (anti-enum). Closed a real pre-existing gap: the read routes applied only the scope-set filter. |
| `97f05de69` | W3/CAP-3 | Frontend: okf-concept cards never take the doc-repo URL family; open = markdown rendered via okf-server route (markdown-it → blob → tab); titles resolve async (frontmatter, session-cached); rehydrate grafts identity from raw metadata onto persisted rows; legacy rows byte-identical; i18n ×14. |
| `a90f58f` | W2 fix | The concept GET registered on `servingReads` (allowScopelessWhenOpen) — the strict router gate 403'd citizens before the fence could run. |
| `c0b2dde` | W1+W2 fix | `readAuthzForService` (deriveReadAuthz — the retrieval-side verdict) for the serving read; `stampRepoGraphName` now binds `bundle_version` at ingest-arm (meta rows were born null and nothing bound them). |
| `3b12e904`→`1df9f145` | smoke | `run-smoke-chat-sources.mjs` — the live harness. |
| `6c7bee69c` | W2 review | **Publication gate + card projection** (see below). |

## W2 structured security review (EPIC-2's own review pass)

Process: identification agent over the full W1-W3 diff → per-finding false-positive-filter agents → fix. Results:

- **HIGH (confirmed 8/10) — no publication gate.** The citizen concept GET served the full meta row of any non-deleted repo subject only to the restricted fence: a retracted repo's bodies stayed readable through every persisted citation (retract keeps meta rows by design), and draft/never-drained repos served pre-PII-gate content. Exactly FR-002's publication-refusal AC, which the route shipped without.
  **Fix:** non-steward callers need the retrieval serving predicate (`lifecycle_state === 'publish' && ingested_at != null`); same 404 envelope as the fence (anti-enum) but NO audit row (expected degradation traffic). Steward class (superadmin / wildcard / a scope naming the repo — D9) keeps the editor contract: draft/retracted rows are the editor's working set.
- **MEDIUM → downgraded LOW (8/10) — full-row response.** The filter deflated it: `pii_hits_summary` is counts-only by contract (NFR-P2), and restricted repos are fenced before any file id could leak — net exposure was ops metadata. **Fixed as hardening:** the citizen response is projected to the CAP-3 card contract (identity + title/labels/summary/body/links); worker internals, curation provenance, Arango system fields and `sources[]` stay steward-only (`sources[]` returns with W5, behind the W4 D4 serve-refusal gate).
- **Clean categories:** AQL injection (bind vars throughout — retriever join, stamp), XSS (markdown-it `html:false` + default validateLink; no new v-html), internal secret on path (grep-tested), cross-repo confusion (composite keys), closed-mode fail-closed, sensitive logging (ids only).
- Tests: +7 (projection exact-shape; retracted/draft/undrained → silent 404; superadmin+retracted full row; scoped steward+draft full row; scopes-restrict-not-widen). The `deriveScopeAuthz` test double now delegates to the real pure parse — the steward check needs scope-bearing callers in `authorizedRepoIds`. Suite **2001/2001**; eslint + prettier clean.

## Verification

- okf-server Jest 1991+3+7 green; overlay pytest +7 new green (suite delta vs stash baseline: zero new failures); frontend Jest 3748 green, coverage **88.96%** vs 88.21% baseline; eslint/prettier/ruff clean.
- **Live smoke 7/7** (`node data/okf/smoke-test/run-smoke-chat-sources.mjs`, host-side, real Keycloak/Kong/dataprep/remote-GPU): lifecycle ladder → drain → CAP-2 (scopeless open read 200; RESTRICTED fenced 404; admin reads; strict editor index 403) → CAP-1 (graph set visible; every okf citation carries repo_id + bundle_version + graph_name) → retract+delete cleanup.
- Live re-verify of the review fixes **deferred**: the build tree sat at the pre-rebase w1 SHAs and `sync-local-build.sh` aborted per its ff-only rule (surfaced to David — the one-time reset is his call). The running okf-server container predates `6c7bee69c`; the smoke needs one new assertion (retracted repo → concept GET 404) when the tree syncs.

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

- Live smoke re-run with the publication-gate assertion (blocked on the build-tree sync — David's one-time reset call).
- Browser-level citation-click pass (W3 UI behavior is unit-covered; the click-through rides W9's Playwright work or David's manual pass — the smoke leaves `OKF_SMOKE_CLEANUP=none` runs for exactly that).
- W4–W9 per the remediation plan (W4 next: stamp re-measure + D4 stamped-snapshot refusal).
