# Step 6 — Observability + Gradual Cutover

**Date:** 2026-04-20
**Result:** 293/293 tests passing. Runtime work on this step is code complete; the *rollout* itself is operational and unfolds over weeks.

## What changed

Code changes are small — most of Step 6 is the operational playbook.

| File | Status | Role |
|---|---|---|
| `observability.py` | Extended | Added `MetricsRegistry` (Prometheus text format, in-process) + `metrics_registry()` accessor. `timed()` now auto-emits a histogram per invocation. |
| `router.py` | Edited (v2) | Counters on successful translate / PII-local route / shadow mismatch |
| `api/routes.py` | Extended | `GET /api/v2/agent/metrics` endpoint (no flag gate) returning Prometheus text |
| `RUNBOOK.md` | New | Stage-by-stage rollout procedure: Shadow → Dev/Staging → 5% canary → 25% → 50% → 100%, with promote/rollback criteria for each |
| `tests/test_metrics.py` | New | 11 tests — counters, histogram quantiles, label escaping, type-conflict detection, `timed()` auto-histograms, endpoint content-type |

No new dependencies. Prometheus text format is emitted by hand because (a) we don't need the full `prometheus_client` featureset, (b) adding a runtime dep would be the single biggest footprint change of the entire migration, and (c) the format is tiny.

## Metrics exposed

`GET /api/v2/agent/metrics` (no flag, always available).

| Metric | Type | Labels | Source |
|---|---|---|---|
| `v2_translate_total` | counter | `provider`, `source`, `target`, `reason` | `Router.translate` on success |
| `v2_translate_duration_ms` | summary | `provider`, `source`, `target`, `status` | `timed("v2_translate", …)` block |
| `v2_translate_fallback_duration_ms` | summary | `provider`, `source`, `target`, `status` | `timed("v2_translate_fallback", …)` block on fallback fire |
| `v2_pii_local_routed_total` | counter | `provider` | PII gate activation |
| `v2_shadow_mismatch_total` | counter | `provider` | Shadow comparison disagreed |
| `v2_rag_ingest_duration_ms` | summary | `path`, `status` | `timed("v2_rag_ingest", …)` in `rag_routes.py` |
| `v2_rag_query_duration_ms` | summary | `target`, `k`, `status` | `timed("v2_rag_query", …)` in `rag_routes.py` |

Any future `log_event`-producing code path gets timing histograms for free via `timed()`.

## Rollout procedure

See `RUNBOOK.md` at the root of the `translation_v2/` package. Short version:

1. **Shadow (0 user impact).** Switch uvicorn target to `main_with_translation_v2`, `USE_V2_TRANSLATION_PIPELINE=false`, `V2_SHADOW_PERCENT=100`. Drive synthetic traffic with `X-Translation-Pipeline: v2`. Watch `v2_shadow_mismatch_total`.
2. **Dev + staging.** `USE_V2_TRANSLATION_PIPELINE=true`, TM cache on. Run the 293-test suite plus an E2E smoke of the RAG path against a fixture PDF.
3. **5% canary.** Gateway-level split (nginx `split_clients` or cookie-hash). `USE_V2_PII_LOCAL_ROUTING=true` enabled for the first time in prod. Hold 72 h; check P95 latency, error ratio, user reports.
4. **25% → 50% → 100%.** Each stage ≥ 48 h. Promote only when error ratio stays < 0.3% and P95 stays within 30% of legacy.

**No advance without metrics.** `RUNBOOK.md` lists explicit promote/hold criteria per stage.

## Design decisions

1. **No `prometheus_client` dep.** Hand-rolled rendering is ~50 LOC and avoids pulling in a dep the legacy image doesn't already have. If we later need native histograms (as opposed to summary quantiles), swap the registry implementation — the API stays.

2. **`/metrics` has no flag gate.** Metrics must be visible *even when v2 is disabled* so operators can see "zero traffic" as an explicit signal. Counters just report 0.

3. **Histograms emit quantiles, not buckets.** We use the "summary" Prometheus type, reporting P50/P95/P99 per label combo. Simpler to reason about than HDR-style buckets for an in-process registry. Real Prometheus scraping infrastructure can aggregate across workers.

4. **Labels are stringified automatically.** Int `k` or `status` gets coerced to string before going into the label tuple — otherwise the registry would emit two distinct time-series for `k=5` (int) and `k="5"` (str), which is the kind of silent duplication that hides real traffic patterns.

5. **Error histograms are separate from ok histograms via a `status` label**, not a separate metric. This keeps the metric surface small while letting dashboards filter `status="error"` trivially.

6. **Canary split is gateway-level, not in-app.** The app already has per-request `X-Translation-Pipeline` and `X-V2-Provider` override headers, which is plenty for controlled experimentation. A percentage splitter inside the app would require editing v1 endpoints (or adding middleware that intercepts every request) — against the preservation discipline.

## Not in Step 6 (deliberately)

- `v2_translate_error_total` as a dedicated counter. The summary histogram's `status="error"` labelset is sufficient for now; Step 6.5 can add an explicit counter if alerting rules prefer it.
- Distributed tracing / OpenTelemetry. Legacy doesn't use it; adding it unilaterally is out of scope for the translation refactor.
- Metrics persistence across restarts. Prometheus pulls from the endpoint on a scrape interval; persistence lives there.
- Alerting rules / Grafana dashboards. Those live in ops config, not application code.

## Open questions post-Step 6

All inventory questions (§9) are either resolved or deferred to Step 7:

| Q | Status |
|---|---|
| Q1 Mobile Mandinka | Out of scope — web-only rollout first |
| Q2 Wolof / Fula / Jola | Deferred — Step 7+ once Mandinka is green |
| Q3 Native Mandinka NLP | Deferred — not needed for the v2 translation/RAG surface |
| Q4 Detection validation set | Still needs Gambian labelers; infrastructure to collect is ready |
| Q5 TTS failure UX | Strict-default from Step 2 stays; frontend error envelope is Step 7 frontend work |
| Q6 Gambia GPU | Gemma wired-not-default; ops team confirms hardware before flipping |
| Q7 Cache namespacing | Resolved (Step 2) |
| Q8 Batch cap | Frontend concern; not touched by translation refactor |
| Q9 PII masking | Resolved — detection + optional local-route (`USE_V2_PII_LOCAL_ROUTING`) |
| Q10 Frontend translate-failure retry | Frontend concern, Step 7+ |
| Q11 `/v2/*` URL shape | Resolved — `/api/v2/agent/*` matches `/api/v1/agent/*` |
| Q12 Legacy Express translation envs | Still look unused; no action |

## Rollback (all stages)

Any of these reverses Step 6:

1. **Uvicorn level** (seconds): swap command back to `src.main:app`. v2 vanishes.
2. **Flag level** (no restart): `USE_V2_TRANSLATION_PIPELINE=false` + `USE_V2_RAG=false`. Endpoints 503.
3. **Gateway level**: remove the `split_clients` block. 100% of traffic goes back to v1.

Counters/histograms accumulate in-memory; a restart resets them — which is fine, Prometheus is the source of historical truth.

## Post-rollout (Step 7 trigger)

30 days at 100% with no regressions → write `MIGRATION_COMPLETE.md` summarising final QE / latency / cost deltas, the list of legacy quirks we preserved vs fixed, and the final flag state. Move `translation/legacy/` → `translation/legacy_archived/` with re-enable instructions frozen in file headers. Never delete.
