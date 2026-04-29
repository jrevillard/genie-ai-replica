# v2 Translation Pipeline — Rollout Runbook

**Audience:** the on-call engineer running a v2 deployment.
**Pre-requisites:** Step 5 complete, all 167+ tests green, the legacy pipeline is live and unmodified.

The rollout is deliberately cautious. Each stage ends with a GO/NO-GO
decision against the metrics at `GET /api/v2/agent/metrics`. The legacy
path stays hot and callable the entire time. **One flag flip rolls back.**

---

## Stage 0 — Shadow (zero user impact)

**Objective:** exercise v2 code paths in production *without* serving v2 responses.

```
USE_V2_TRANSLATION_PIPELINE=false        # still off
V2_PRIMARY_PROVIDER=openai
V2_FALLBACK_PROVIDER=nllb
V2_SHADOW_PERCENT=100                    # shadow-compare every v2 call we do get
```

**What we do:**
- Switch the uvicorn target to `src.main_with_translation_v2:app`.
- Send synthetic traffic via `curl` with `X-Translation-Pipeline: v2` — the header lets us hit v2 without flipping the global flag.
- Monitor error counters and shadow mismatches in `/api/v2/agent/metrics`.

**Promote when:** `v2_translate_error_total == 0` for ≥ 24 h of synthetic traffic and `v2_shadow_mismatch_total` is not surprising (single digits for 100+ requests, mostly punctuation/whitespace).

**Rollback:** `unset USE_V2_TRANSLATION_PIPELINE` (no-op — it was off).

---

## Stage 1 — Dev & staging

```
USE_V2_TRANSLATION_PIPELINE=true         # globally on in dev/staging
USE_V2_TM_CACHE=true
V2_SHADOW_PERCENT=10                     # dial down shadow
```

Run:
- All 50+ internal characterization tests.
- End-to-end smoke: ingest one clinical PDF, query it, assert QE.passed.
- Manual eyeball of 20 translated answers (native speaker where possible).

**Promote when:**
- P95 latency for `v2_translate_duration_ms` < 2× the legacy baseline.
- `v2_translate_error_total / v2_translate_total < 0.5%`.
- No QE.passed regressions against last week's staging snapshot.

**Rollback:** set `USE_V2_TRANSLATION_PIPELINE=false`, restart.

---

## Stage 2 — 5% canary in production

Done at the load balancer / API gateway, not in application code.

### Option A (recommended) — nginx path-level split
Route 5% of `POST /api/v1/agent/translate` traffic to `/api/v2/agent/translate`:

```nginx
split_clients "${request_id}" $translate_target {
    5%      "/api/v2/agent/translate";
    *       "/api/v1/agent/translate";
}
location = /api/translate { rewrite ^.*$ $translate_target last; }
```

### Option B — header injection by user-cookie hash
For sticky per-user assignment (so a single user always sees one version), hash the user cookie into a bucket.

### Environment in the canary replica
```
USE_V2_TRANSLATION_PIPELINE=true
USE_V2_TM_CACHE=true
USE_V2_PII_LOCAL_ROUTING=true            # first time enabled in prod
V2_SHADOW_PERCENT=5
```

**Promote when (after ≥ 72 h):**
- `v2_translate_error_total / v2_translate_total < 0.3%`.
- P95 latency within 30% of legacy.
- User-reported translation issues in Slack `#amina-quality` do not increase.
- **No PII-route failures.** `v2_pii_local_routed_total` is non-zero *and* has zero error spikes.

**Rollback:** remove the split_clients block (or flip the percentage to 0). v2 replica can stay running.

---

## Stage 3 — 25% → 50% → 100%

Advance only when the prior stage's 72-h window cleared. Hold **each** stage for ≥ 48 h.

At 100%, the v1 endpoint is still served — it's just receiving less traffic as the split converges.

```
V2_SHADOW_PERCENT=1                      # drop to low continuous monitoring
```

---

## Metrics reference

`GET /api/v2/agent/metrics` (Prometheus text format, no auth gate).

| Metric | Type | Labels | Meaning |
|---|---|---|---|
| `v2_translate_total` | counter | `provider`, `source`, `target`, `reason` | Every translate call that returned a result |
| `v2_translate_duration_ms` | summary | `provider`, `source`, `target`, `status` | Wall-clock duration |
| `v2_translate_fallback_duration_ms` | summary | `provider` | Just the fallback leg when it fires |
| `v2_pii_local_routed_total` | counter | `provider` | Count of PII-forced local routes |
| `v2_shadow_mismatch_total` | counter | `provider` | Shadow run produced a different answer |
| `v2_rag_ingest_duration_ms` | summary | `path` | PDF ingestion time |
| `v2_rag_query_duration_ms` | summary | `target`, `k` | PDF Q&A time |

No `_error_total` is emitted explicitly yet — errors surface as `status="error"` in the duration histograms. Add an explicit counter in Step 6.5 if we need ops-friendlier alerting.

---

## Flag cheat-sheet

| Flag | Default | Meaning |
|---|---|---|
| `USE_V2_TRANSLATION_PIPELINE` | `false` | Master gate for `/api/v2/agent/translate` |
| `USE_V2_RAG` | `false` | Master gate for `/api/v2/agent/pdf-*` |
| `USE_V2_TM_CACHE` | `false` | Router consults v2 TM before providers |
| `USE_V2_GLOSSARY` | `false` | Reserved for Step 6.5 |
| `USE_V2_QE` | `false` | Reserved for Step 6.5 |
| `USE_V2_PII_LOCAL_ROUTING` | `false` | PII → NLLB (local) force-route; never falls back to cloud on failure |
| `USE_V2_FOR_V1_ENDPOINTS` | `false` | Transparently route `/api/v1/agent/translate{,batch}` through v2 (frontend-transparent cutover) |
| `V2_SHADOW_PERCENT` | `0` | 0..100; shadow-compare sample rate |
| `V2_PRIMARY_PROVIDER` | `openai` | openai \| gemma \| nllb |
| `V2_FALLBACK_PROVIDER` | `nllb` | same; `""` or same as primary disables |
| `V2_RAG_DEFAULT_STRATEGY` | `answer_then_translate` | Alternative: `cross_lingual_direct` |
| `V2_RAG_DEFAULT_K` | `5` | Default retrieval depth |
| `V2_RAG_QE_THRESHOLD` | `0.5` | Composite QE pass threshold |

---

## Full rollback procedure

Any stage:

1. **Uvicorn level** (~5 seconds): swap the command back to `src.main:app` (or whichever `main_with_*.py` you were on pre-v2). `/api/v2/*` vanishes.
2. **Flag level** (no restart): set `USE_V2_TRANSLATION_PIPELINE=false`; subsequent requests to `/api/v2/agent/translate` return 503.
3. **Gateway level**: remove the canary split block. 100% of `/api/translate` goes back to v1.

Do *not* delete anything. The entire point of the preservation
discipline is that a rollback is a click, never an archaeology dig.

---

## Post-rollout (30 days at 100% green)

1. Drop `V2_SHADOW_PERCENT` to 0.
2. Write `MIGRATION_COMPLETE.md` summarizing:
   - Which legacy quirks were preserved vs fixed (reference the
     characterization tests).
   - Final QE / latency / cost deltas vs pre-migration baseline.
   - Final flag state in each environment.
3. Consider (Step 7) moving `legacy/` into `legacy_archived/`. Do not
   delete — re-enable instructions in file headers stay in the repo forever.
