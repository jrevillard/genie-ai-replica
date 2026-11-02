# GenieAI 2.0 Convergence — Phase 0 Decision Memo

> **Superseded in part:** the a10 environment was deleted (C1/S-4, 09-28); rtx6000 is the canonical deployment — see [`docs/deploy-rtx6000.md`](../deploy-rtx6000.md).

**Date:** 2026-08-26 · **Trial:** `git merge --no-commit --no-ff refs/tags/v2.0.1` on scratch branch from main @ `67a124c` · **Outcome: GREEN → Path C (merge upstream v2.0.1)**

## Measurements

| Metric | Result | Threshold | Pass |
|---|---|---|---|
| Merge-base | `7224b78` — **2026-03-12** (4 days before R_1_0_0 tag) | Feb/Mar 2026, history intact | ✅ |
| History sharing | 500/500 sampled v2.0.1 ancestors (Apr–Dec 2025) + 43/43 (Feb–Mar 2026) exist in local object store | any rewrite = red | ✅ |
| Conflicted files | **130** | ≤ ~150 | ✅ |
| Upstream-only commits arriving | 723 | — | — |
| Replica-only commits | 141 | — | — |
| Conflicts in replica-only dirs (`mobile/`, `helm/`, `infrastructure/`) | **0** | 0 | ✅ |
| Delete/modify storms (upstream deleted, we modified) | 46 | < ~50, policy-covered | ✅ |

## Conflict catalog (by area)

| Area | Files | Nature / resolution |
|---|---|---|
| `scripts/old-schema-scripts` | 23 | legacy scripts; mostly upstream deletions — accept upstream or keep, mechanical |
| frontend i18n locales | 14 | key parity churn — mechanical |
| frontend components/services | ~21 | includes upstream **deleting legacy auth UI** (LoginScreen, RegisterScreen, UserEditDialog) — auth collision, see below |
| backend routes/services/middleware | ~20 | upstream deleted `auth-service.js`, `email-service.js` (legacy auth stack) |
| root (compose, env, README, .gitignore) | 7 | upstream consolidated to single compose + `configs/` |
| `genie-ai-overlay` | **3** | the semantic ones (below) |
| `document-repository` | 4 | small |
| nginx conf, dist, site docs | rest | mechanical |

## Overlay triage (the 3 hard files)

| File | Replica diff since fork | Upstream diff | Resolution |
|---|---|---|---|
| `chatqna/genieai_chatqna.py` | ~390 lines (weather ×60 refs, Sesotho routing) | 2,363 lines (SSE, abstention, blending) | take upstream, re-apply replica patch (saved: `replica-overlay-since-fork.patch`) |
| `core/genieai_api_protocol.py` | 3 lines | 234 | take upstream, re-apply 3 lines |
| `dataprep/genieai_dataprep_arangodb.py` | ~329 lines (crawler/progress/graph) | 1,515 (contextual retrieval, batched labeling) | take upstream, re-apply patch |

## Key structural finding

**Upstream v2.0 deleted the entire legacy auth stack** (`auth-service.js`, `email-service.js`, `LoginScreen.vue`, …) — v2.0 is pure Keycloak OIDC. The replica runs dual auth (legacy HS256 + Keycloak RS256, routed by token alg in `auth-middleware.js`). M2 must decide: keep replica's dual-auth (policy default — mobile-compatible) or follow upstream to pure OIDC. Upstream also deleted the per-GPU compose variants (`docker-compose-t4.yaml`, `env-T4`) that Vladimir's A10 plan depends on — keep them as override files.

## Decision

> **Superseded 09-28:** the A10 environment this roadmap assumed was deleted (C1, decision S-4 — files remain in git history); the canonical deploy target is now the rtx6000 box. See [`docs/deploy-rtx6000.md`](../deploy-rtx6000.md).

**Path C: merge `refs/tags/v2.0.1` into main** per the roadmap in `GenieAI-2.0-Migration-Plan.md` + the convergence plan (M1 mechanical merge → M2 auth dedup + Postgres 16 → M3/M4 Vladimir A10 + translation eval → M5 RAG flag enablement → M6 validation/cutover). Estimated **8–9.5 weeks** solo.

Reasons: all green thresholds met; Vladimir's Phase 3 backports (2–3 weeks) collapse into flag-enablement (~1 week); the 16 upstream security fixes + 3,466 CVE base-image fixes + contract tests arrive as code; future upstream syncs become small merges instead of re-ports.

## Deployment note (pre-existing environments)

> **Superseded 09-28:** the A10 narrative below is historical — that environment was deleted (C1, decision S-4); rtx6000 is the canonical target ([`docs/deploy-rtx6000.md`](../deploy-rtx6000.md)).

Removing the `_key <= 10` admin bypass changes behavior for early users. Before deploying Phase S to any environment with real data, migrate:

```aql
FOR u IN users
  FILTER TO_NUMBER(u._key) <= 10 AND u.role != 'Admin'
  UPDATE u WITH { role: 'Admin' } IN users
```

## Artifacts

- `docs/merge-trial/replica-overlay-since-fork.patch` — replica's overlay diff vs merge-base (the M1 re-apply source)
- Upstream tags fetched: `v2.0.0`, `v2.0.1`, `R_1_0_0` (remote `upstream` added)
- Convergence analysis & full roadmap: session plan `/home/adem/.claude/plans/i-am-gonna-sak-swirling-lantern.md`
