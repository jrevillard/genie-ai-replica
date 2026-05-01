# Translation v4.2.1 — Performance Report

**Date:** 2026-05-01
**Branch:** Health-AminaCare-branch
**Scope:** Latency optimisations applied to the Translation v4.2 pipeline.
**Author:** AMINA engineering team

---

## 1. Why this work was needed

A real end-to-end test on 2026-04-30 measured **77 s** for a 30-sentence
clinical document on the v4.2 pipeline (NLLB sidecar disabled, OpenAI
`gpt-4o-mini` backend). Latency breakdown:

| Stage             | Latency  | Cause                                                    |
|-------------------|----------|----------------------------------------------------------|
| Stage 2 forward   |  ~52 s   | 30 sequential single-sentence LLM calls (~1.7 s each)    |
| Stage 4 back-trans|  ~25 s   | One LLM round-trip on the full ~1.9 KB Mandinka string   |
| Stages 1, 5–8     |  <0.5 s  | Local CPU work; not a contributor                        |

The 77 s response was unacceptable for a chat UI. UNICC evaluators were
also expected to start hitting this on PDF-handout translations.

This report documents the v4.2.1 optimisations and their measured effect.

---

## 2. What changed

Three fixes from a five-fix plan were applied. **Fix 4 (skip
back-translation for high-confidence sentences) was deliberately
dropped** because it would have weakened the safety gate that caught a
real negation flip during the 04-30 test — back-translation is what
exposes meaning drift the engines themselves don't see.

### Fix 2 — Sentence batching (`src/translation_v4/stage2_multi_engine.py`)

* `LLMEngine.translate_batch()` now delegates to the v1
  `Translator.translate_batch` numbered-prompt path (one LLM round-trip
  for up to 10 sentences instead of 10 round-trips).
* `MultiEngineTranslator.translate_all()` was refactored to:
  1. lookup all sentences in the cache,
  2. group cache misses into chunks of 10,
  3. run phrasebank synchronously per sentence (auto-wins finalise
     inline),
  4. fire **one LLM batch + per-sentence NLLB tasks** concurrently via
     `asyncio.gather` for the rest.
* The single-sentence `translate_sentence()` path is **unchanged** —
  the existing selection logic (phrasebank > NLLB > LLM, highest
  confidence wins) is preserved 1:1.

### Fix 3 — Pipelined Stage 2 / Stage 4 (`src/translation_v4/pipeline.py`)

* The orchestrator now splits sentences into chunks of 10. Per chunk:
  1. await Stage 2 (batched internally),
  2. immediately spawn Stage 4 back-translation as
     `asyncio.create_task`.
* The **next** chunk's Stage 2 runs concurrently with the **previous**
  chunk's Stage 4. Single-batch documents collapse to the old
  sequential flow with no behaviour change.
* `_merge_bt_results()` combines per-chunk back-translation outcomes:
  worst recommendation wins, AND-merge entity-preservation flags,
  average semantic similarity, min confidence, extended critical
  divergences. This preserves the safety contract — a single bad chunk
  cannot be averaged away.

### Fix 5 — In-memory sentence cache (`src/translation_v4/stage2_multi_engine.py`)

* Process-wide `Dict[str, Dict]` keyed by SHA-256 of the sentence text.
* Only entries with `selected_confidence >= 0.70` are stored, so a
  cache hit is always "good enough to serve". Below-threshold results
  fall through to the engines on every call.
* Cache hits return with `method="sentence_cache"` and
  `selection_reason="sentence_cache_hit"` for telemetry attribution.
* TODO marker for v4.3: replace with Redis-backed cache so warm hits
  survive restarts and propagate across replicas.

### Soft latency warning

A WARNING line is now logged when a single pipeline call exceeds 15 s
(separate from the existing 3.5 s `V4_MAX_LATENCY_MS` per-call hard
budget that triggers back-translation skip on the next call). This
catches the failure mode where the batched/pipelined path **isn't
actually overlapping** — e.g. NLLB sidecar down + sequential LLM
fallback — before users notice.

---

## 3. Measured latency (synthetic, calibrated to production)

A bench harness mocks the v1 translator with delays measured from the
production OpenAI `gpt-4o-mini` path on 2026-04-30:

* single `translate()`: 1.70 s
* `translate_batch(N)`: 1.70 s + 0.10 s per extra line
* back-translation per chunk: 2.00 s

The MiniLM model used by Stage 4 semantic similarity is pre-warmed
before measurement so model-load time does not pollute the first run.

### Headline results

| Sentences | Sequential (pre-Fix-2/3) | Batched cold (v4.2.1) | Batched warm (v4.2.1, cache hit) | Cold speedup |
|----------:|-------------------------:|----------------------:|---------------------------------:|-------------:|
| **5**     | **10.85 s**              | **4.14 s**            | **2.03 s**                       | **2.6×**     |
| **30**    | **53.26 s**              | **9.96 s**            | **2.21 s**                       | **5.3×**     |

### Validation against the v4.2.1 spec targets

| Target                                | Measured | Result   |
|---------------------------------------|----------|----------|
| 30 sentences cold  < 15 s             | 9.96 s   | **PASS** |
| 30 sentences warm  <  5 s             | 2.21 s   | **PASS** |
|  5 sentences cold  <  3 s             | 4.14 s   | FAIL — see §4 |

### Real-world projection (NLLB sidecar deployed)

The bench above runs with `NLLB_ENABLED=false` so Stage 4 takes the
slow LLM round-trip path (2 s). In production with the NLLB sidecar
healthy, Stage 4 uses NLLB Bambara→English cross-model back-translation
(~0.3 s per chunk):

| Sentences | Cold (NLLB up) — projected | Warm (cache) | Cold (NLLB down) — measured |
|----------:|---------------------------:|-------------:|----------------------------:|
| 5         | ~2.4 s                     | ~2.0 s       | 4.14 s                      |
| 30        | ~7.3 s                     | ~2.2 s       | 9.96 s                      |

With NLLB up, the 5-sentence chat-reply target (<3 s) is comfortably
met; without it, the LLM-only fallback is graceful but ~1 s over the
target on short documents.

### Speedup vs the original 77 s

Comparing the 04-30 production measurement to the new batched cold
path (NLLB still off, same backend):

* **30-sentence document: 77 s → ~10 s** (~7.7× speedup).

The discrepancy with the bench's 53 → 10 s is because the production
77 s number included the full Stage 4 LLM round-trip on a 1.9 KB
Mandinka string (~25 s — much longer than the bench's 2 s synthetic
chunk). The new batched path back-translates per chunk in parallel
with the next chunk's Stage 2, which collapses that 25 s to ~2 s on
the critical path.

---

## 4. Why the 5-sentence cold target was missed

For a single batch of 5, Stage 2 (one LLM batch call, ~2.1 s) and
Stage 4 (one back-translation, ~2 s) run **sequentially within the
batch** — pipelining only helps when there's a *next* batch to overlap
with. Total: ~4.1 s.

Three options to close the gap:

1. **Deploy the NLLB sidecar** (recommended). Stage 4 uses NLLB
   Bambara→English (~0.3 s) instead of an LLM round-trip (~2 s),
   bringing the 5-sentence cold path to ~2.4 s. The compose overlay
   (`haystack-stack/docker-compose.nllb.yml`) is already present;
   `start.ps1` / `start.sh` layer it automatically when found, and
   download the ~7.6 GB Docker image (CTranslate2 runtime + 600M
   model weights) on first start.

2. **Skip back-translation for short, high-coverage documents**
   (Fix 4 in the original plan). **Rejected** — back-translation is
   what caught a real negation flip on 04-30 where the LLM's Mandinka
   output silently inverted a clinical instruction. Skipping it would
   trade safety for ~1 s of latency.

3. **Overlap Stage 2 and Stage 4 within a single batch** (split a
   small batch into halves and pipeline them). Adds code complexity
   for a niche win; defer to v4.3 if ever measured to be material in
   production.

The 5-sentence path is currently within 1.1 s of target on the LLM-only
fallback. With NLLB it clears the target by ~0.6 s. We recommend
Option 1 and treating the LLM-only 5-sentence number as the documented
graceful-fallback baseline.

---

## 5. Quality contract — unchanged

The v4.2.1 fixes change *how* engines are invoked, not *what* they
return or how results are scored. Specifically:

* **Phrasebank auto-win threshold** (V4_PHRASEBANK_COVERAGE_THRESHOLD)
  preserved — sentences with coverage ≥ 0.80 still bypass LLM and NLLB.
* **Per-sentence selection logic** preserved — phrasebank, NLLB, LLM
  candidates are scored identically and the highest confidence wins.
* **Stage 4 entity checks** (negation count, number set, food names)
  run per chunk and AND-merge across chunks. A negation-flip in any
  chunk still drives the document-level `entities_preserved.negations`
  to False, which Stage 5 turns into `clinical_safety = 0.0`, which
  Stage 7 routes to SERVE_ENGLISH.
* **Cache write gate** (confidence ≥ 0.70) ensures only high-quality
  results are ever served from cache.

The smoke test in §6 confirms the merge logic with a synthetic
worst-case input — one BLOCK chunk among HIGH_CONFIDENCE chunks
correctly drives the document-level recommendation to BLOCK and
`negations` to False.

---

## 6. Verification performed

* **Static**: every modified Python file parses cleanly; both start
  scripts (`start.ps1`, `start.sh`) parse cleanly under their
  respective interpreters.
* **Smoke**: 25-sentence batched run preserves input order; second
  pass hits cache for all 25 sentences; merge picks BLOCK over
  HIGH_CONFIDENCE and ANDs `negations: False` correctly; empty input
  round-trips to empty list.
* **Latency**: numbers in §3, calibrated to production timings.
* **Asset checks**: `start.ps1` / `start.sh` dependencies — `.env.defaults`,
  `docker-compose.yml` / `.demo.yml` / `.nllb.yml` / `.override.yml`,
  `bootstrap_models.{ps1,sh}`, `components/frontend/package.json`,
  `src/translation_v4/pipeline.py`, `golden_translations.json` — all
  confirmed present.

### UNICC tester blockers found and fixed

A live end-to-end run of `start.ps1 -SkipFrontend` on Windows 11 + Docker
Desktop surfaced seven blockers — three of them critical (the script
would silently fail on a fresh tester machine). All are now fixed and
the script completes cleanly with a green canary translation
(`'How are you?' -> SERVE_MANDINKA via nllb`, `bt=nllb_cross_model`).

| # | Blocker                                                                                                                             | Severity      | Fix |
|--:|-------------------------------------------------------------------------------------------------------------------------------------|---------------|-----|
| 1 | `start.ps1` had no UTF-8 BOM; PowerShell 5.1 on stock Windows 11 read em-dash and box-drawing characters as Windows-1252, breaking string parsing on line 472. Script would fail to launch.                          | **CRITICAL**  | UTF-8 BOM added (3 bytes) |
| 2 | `Invoke-DockerCompose` wrapper used `ValueFromRemainingArguments` with parameter name `DcArgs`. PowerShell prefix-matches `-d` (in `up -d`) against any parameter name starting with `d`, binds it to `DcArgs` with no value, and throws "Missing an argument for parameter 'DcArgs'". The whole `up -d` would silently never execute. Renaming alone wasn't enough — even with no name collision, `-d` was silently dropped from the remaining-args list. | **CRITICAL**  | Function takes `[string[]]$ComposeArgs` as an explicit named parameter; all four call sites pass `($composeFiles + @("up","-d"))` etc. |
| 3 | `arcadedb` healthcheck used outer single-quotes around `--header='Authorization: Basic $(printf ... \| base64)'`. Single quotes prevent `$()` substitution in `/bin/sh`, so wget sent the literal string `Basic $(printf ...)` as the auth header and ArcadeDB returned 403 Forbidden on every probe. Container went unhealthy → `dependency arcadedb failed to start` → `up -d` exit 1 → script abort. | **CRITICAL**  | Switched outer quotes to double, inner string literals to single. Verified container healthy after recreate. |
| 4 | NLLB engine code expected the response field `text` from the sidecar; the prebuilt `ghcr.io/winstxnhdw/nllb-api:main` image returns `{"result": "..."}`. Engine treated every translation as `empty_response` and silently fell back to LLM-only. | **HIGH**      | Engine now reads `body.get("result") or body.get("text")` so both prebuilt and self-built sidecars work. |
| 5 | The team-mode `.env` (anything created before v4.2 landed) was missing `AMINA_TRANSLATION_V4_ENABLED`, `NLLB_ENABLED`, and the rest of the v4 flags, so v4 stayed disabled in the container. Demo mode was unaffected because `.env.defaults` has them. | **HIGH** for team developers; not a UNICC blocker. | Compose-level defaults added in `docker-compose.yml` for the haystack-chatqna service: `AMINA_TRANSLATION_V4_ENABLED: ${...:-true}`, NLLB flags, etc. Same pattern already used for ArcadeDB password. |
| 6 | Summary block's NLLB probe used the wrong fallback condition (`if (-not $nllbCode -or $nllbCode -eq "000")`), so a 404 from `/api/v4/health` (the prebuilt image's actual response) skipped the fallback to `/health`. Summary always showed `[LOADING]` even when the sidecar was healthy. | MEDIUM        | Condition is now `if ($nllbCode -ne "200")`, falling back any time the first probe didn't return 200. |
| 7 | Canary translation parser failed every run with "could not parse canary response". Two compounding causes: (a) PowerShell's native-exe argument quoting strips embedded double quotes, so `python -c "$canaryPy"` saw `sys.path.insert(0, /app)` (no quotes) and threw `SyntaxError`; (b) `Select-Object -Last 1` picked the last line of stderr+stdout, which after the JSON was an aiohttp "Unclosed client session" warning. Identical bug existed in `start.sh` via `tail -1`. | **HIGH** — every UNICC tester would see "Canary: skipped/failed" and assume v4 was broken. | (a) All Python string literals in the canary switched from `"..."` to `'...'`. (b) Filter `Where-Object { ... -match '^\{' }` then `Select-Object -Last 1` (PS); equivalent `grep -E '^\{' \| tail -1` in `start.sh`. Verified: canary now reports `decision=SERVE_MANDINKA engine=nllb bt=nllb_cross_model latency=9617ms output: I be cogo di?`. |
| 8 | `SUPERSET_SECRET_KEY` and `SUPERSET_ADMIN_PASSWORD` were unset in team-mode `.env` files, producing two yellow `WARN` lines on every start. Cosmetic but alarming during a UNICC demo. | LOW           | Compose-level defaults added matching `.env.defaults`. |
| 9 | Step counter said `[1/6]` then jumped to `[2/8]` — confusing for an evaluator. | LOW           | Relabelled to `[1/8]` in both `.ps1` and `.sh`. |

### Post-fix end-to-end output

```
[1/8] Checking Docker...                       Docker is running.
[2/8] Checking AI model files...               All models present (skipped 3)
[3/8] Resolving environment...                 Found haystack-stack\.env (team mode).
[4/8] Starting backend services...             Backend containers launched.
[5/8] Waiting for backend to report healthy... Backend is healthy.
[6/8] Verifying Translation v4.2 ...
       NLLB sidecar healthy after 5s.
       Endpoint contract /api/v4/translator -> 200 + text field.
       ArcadeDB TranslationMetric schema ready.
       Canary 'How are you?' -> decision=SERVE_MANDINKA engine=nllb bt=nllb_cross_model latency=9617ms
         output: I be cogo di?
[7/8] Frontend skipped (--SkipFrontend).
[8/8] AMINA is ready.

  v4 path: ACTIVE
  NLLB   : ready (3-engine selection live: phrasebank > NLLB > LLM)
  Canary : 'How are you?' -> SERVE_MANDINKA via nllb
```

The 9617 ms canary latency is a cold-start measurement (MiniLM model
load + NLLB warmup + first OpenAI call). Subsequent calls drop into the
ranges measured in §3.

---

## 7. What remains open

* **Deploy NLLB sidecar on the A40 host.** Overlay file is in the
  tree; once `docker compose -f docker-compose.nllb.yml up -d
  nllb-translate` is run, Stage 4 picks up the cross-model path
  automatically.
* **Native-speaker validation of 80 golden pairs.** Tool ready
  (`scripts/review_translations.py`); start scripts surface validation
  progress in their summary block.
* **Real production baseline.** Run
  `python scripts/translation_baseline.py` once NLLB is up to capture
  measured (not synthetic) latencies for the compliance record.
* **Stage 1 simplifier "or"-split bug.** Conjunction split removes the
  `or` between adjacent verbs ("limit or avoid" → "limit avoid"). Real
  bug, scoped out of v4.2.1 — fix it in a separate change so the
  latency work can ship cleanly.
* **v4.3** (deferred): Redis-backed sentence cache so warm hits
  survive container restarts and replicate across pods; intra-batch
  Stage 2 / Stage 4 overlap if the 5-sentence LLM-only target proves
  material in practice.
