# GenieAI Replica → 2.0 Convergence Report

**Date:** 2026-08-26
**Repo:** genie-ai-replica-itu (Azure DevOps) · **Upstream:** https://opensource.unicc.org/un/itu/genie-ai
**Goal:** reach GenieAI v2.0-level capabilities · **Headline:** the repos share git history until 2026-03-12 — so "adopt 2.0" is a
measured `git merge` (~130 conflicts), not a rebuild. Trial verdict: **GREEN → merge v2.0.1 (Path C)**.

---

## 1. The real relationship 

This is **not a passive fork**:

- 14 historical merges from upstream into the replica; last sync 2026-02-26 (`909209e`)
- The `components/` + `genie-ai-overlay/` restructure was done **in the replica first**
  (May 2025, `82e6755`) and later appeared in upstream v2.0
- Same ITU authors on both sides (Forden 60.7%, Chestnov 12.8%, Daigele 11.5%)
- **Merge-base: `7224b78`, 2026-03-12** — 4 days before upstream's R_1_0_0 tag.
  Verified two ways: 500/500 sampled v2.0.1 ancestors (2025) and 43/43 (Feb–Mar 2026)
  exist in the local object store. Upstream history was never rewritten.
- Divergence since: **723 upstream commits vs 141 replica commits**

## 2. Recap — upstream since the split

| Release | Date | Highlights |
|---|---|---|
| R_1_0_0 | 2026-03-16 | El Salvador agri assistant (v1.0) — what the replica is on |
| v2.0.0 | 2026-07-28 | Keycloak OIDC, SSE streaming, abstention, contextual retrieval, 4 reranking strategies, multi-turn blending, streaming translation, hybrid ingestion, Swarm+Ansible, OTel, Query Inspector, **16 security fixes**, ~30 features total |
| v2.0.1 | 2026-08-03 | 3,466 CVEs fixed, image pins, **Postgres 13→16 mandatory** |
| unreleased | now | OPEA 1.5, Python 3.11, endpoint ownership validation, mobile AppAuth MITM fix |

## 3. Recap — replica since the split (194 commits, ~65% of repo is custom)

**Use-case-specific:** farmer profiles (map/GPS/plots), Sesotho NLLB-200 CPU translation
(~45 s latency, 180 s gateway timeouts), weather-aware RAG (Open-Meteo + Nominatim),
agri knowledge areas, Lesotho branding.

**Generic:** async crawler (20 workers), document-repository service, admin dashboard
(9-probe health, AI config, Query Inspector, security scanning, logs), own Keycloak
OIDC (May–Jun 2026 — duplicated effort vs upstream), 4-tier RBAC, Flutter mobile app,
Helm/AKS charts, T4 GPU tuning.

**Overlap:** already has 6 of 14 checked v2.0 features (Keycloak-own, Query Inspector,
reranking strategies, weather 5 s timeout, non-English ingestion, account deactivation);
lacks 8 (SSE, contextual retrieval, multi-turn blending, abstention, streaming
translation, hybrid BM25, multi-crop, locale whitelist).

**Security audit (pre-fix):** 10 of 13 upstream v2.0 security issues were VULNERABLE —
admin bypass `_key<=10`, `/email` body-auth, JWT secret fallback, DB password fallbacks,
shell `exec()`, CRLF injection, path traversal, no magic bytes, unbounded arrays,
error leakage. Only AQL injection was already fixed.

## 4. Options considered

| | A: rebuild on 2.0.x | B: keep replica + backport | **C: `git merge` v2.0.1** |
|---|---|---|---|
| Effort (solo) | 12–16 weeks | ~6–7 weeks | **~8–9.5 weeks** |
| Full 2.0 platform (SSE, PG16, CVE fixes, contract tests) | yes | no | **yes** |
| End state | clean lineage | permanent drift | **re-aligned; future syncs are small merges** |

A is strictly dominated by C if the merge-base holds (it does). B is the fallback.

## 5. Phase 0 merge trial — results (2026-08-26)

| Metric | Result | Threshold | Pass |
|---|---|---|---|
| Merge-base | `7224b78` (2026-03-12) | Feb/Mar 2026, intact | ✅ |
| Conflicted files | **130** | ≤ ~150 | ✅ |
| Conflicts in `mobile/`, `helm/`, `infrastructure/` | **0** | 0 | ✅ |
| Delete/modify storms | 46, all policy-covered | < ~50 | ✅ |

- Conflict concentration: legacy scripts (23), i18n locales (14), frontend components,
  backend routes/services, root compose/env, overlay (3)
- **Overlay triage:** take upstream + re-apply replica patch for
  `chatqna.py` (replica ~390 lines vs upstream 2,363), `api_protocol.py` (3 vs 234),
  `dataprep_arangodb.py` (~329 vs 1,515). Patch saved:
  `docs/merge-trial/replica-overlay-since-fork.patch`
- **Structural finding:** upstream **deleted the entire legacy auth stack**
  (`auth-service.js`, `email-service.js`, `LoginScreen.vue`, …). Replica runs dual auth
  (legacy HS256 + Keycloak RS256). M2 decides: keep dual (policy default,
  mobile-compatible) or follow upstream to pure OIDC
- Upstream also deleted the per-GPU compose variants Vladimir's A10 plan needs —
  keep them as override files

## 6. What was executed (verify with `git log --oneline -6`)

| Commit | Content |
|---|---|
| `951afda` | Vladimir's migration plan doc cherry-picked into main |
| `f7b7bce` | **Phase S security** (51 files): admin bypass removed, /email body-auth removed, JWT_SECRET + ARANGO_PASSWORD fail-fast, `exec()`→`execFile()` whitelist, isAdmin on DB routes, CRLF + path-traversal guards, file-deletion role gates, magic-byte validation wired in (dynamic import for ESM file-type), batch array caps, 60 error-leak sites genericized |
| `67a124c` | Fixes from adversarial verification (5 agents): 6 module-scope fail-fasts reverted (broke module loading), wmic `DeviceID='C:'` query fix, veth`@if` suffix strip, remaining leak patterns; one verifier finding rejected as a misread (testDataGen `_key` 1–13 are service categories, not users) |
| `2b9dc9e0` | Decision memo `docs/merge-trial/DECISION-MEMO.md` |

Also: `upstream` remote added; tags `v2.0.0`, `v2.0.1`, `R_1_0_0` fetched locally.
**Not pushed** — main is 4 commits ahead of origin.

**Pre-deploy data migration** (removing the `_key<=10` bypass changes old behavior):

```aql
FOR u IN users
  FILTER TO_NUMBER(u._key) <= 10 AND u.role != 'Admin'
  UPDATE u WITH { role: 'Admin' } IN users
```

## 7. Roadmap ahead (Path C)

1. **M1** mechanical merge, resolve per area policy (1.5–2.5 wk) — take upstream for
   overlay + theming + compose structure; keep replica for auth (initially), mobile,
   helm, document-repository, farmer/weather/RBAC features
2. **M2** auth dedup + Postgres 13→16 (Kong DB is EOL) (1 wk)
3. **M3–M4** Vladimir Phases 1–2 unchanged: A10 + Qwen2.5-7B + TranslateGemma +
   bge-reranker-v2-m3; Sesotho translation benchmark (1.5 wk)
4. **M5** RAG flag-enablement one at a time + re-apply weather patch + re-ingest (1–1.5 wk)
5. **M6** validation + cutover, T4 rollback kept 7 days (1 wk)

**Revisit triggers:** upstream security fix to shared code → sync within 1 week;
2 consecutive releases unabsorbed → drift alarm; non-backportable must-have → re-run trial.

## 8. How to verify current state

```bash
git log --oneline -6        # expect 2b9dc9e0, 67a124c, f7b7bce, 951afda on top of fd12f7f
git status                  # clean
ls docs/merge-trial/        # DECISION-MEMO.md + replica-overlay-since-fork.patch
git remote -v               # upstream → opensource.unicc.org
git merge-base main v2.0.1  # 7224b78e...
```
