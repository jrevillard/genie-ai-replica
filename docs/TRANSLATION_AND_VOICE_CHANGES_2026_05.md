# Translation + Voice Stack — Change Log (May 2026)

**Window:** 2026-05-01 → 2026-05-02
**Branch:** `Health-AminaCare-branch`
**Authors:** AMINA engineering team
**Status:** All changes committed + pushed to GitLab.

This document tracks every code, config, and infrastructure change made
to the translation pipeline, the voice (TTS) stack, and the start-up
scripts during this work cycle. It complements (and cross-references)
the more focused
[TRANSLATION_V4_2_1_PERFORMANCE_REPORT.md](compliance/TRANSLATION_V4_2_1_PERFORMANCE_REPORT.md).

---

## TL;DR

| Theme                          | Commit       | Headline                                         |
|--------------------------------|--------------|--------------------------------------------------|
| Translation v4.2.1 + UNICC fixes | `8fab9d08` | Pipeline batching/cache (5×–7× faster) + 9 fixed start-script blockers |
| TTS long-reply correctness     | `b0e33898`   | Chunked synthesis + adaptive client timeout — long Mandinka replies stop silently failing |
| TTS performance                | `6fbd80ea`   | CPU bumped 1→4 + torch threads pinned → ~5× faster Mandinka synthesis |

GitLab MR link:
https://opensource.unicc.org/un/itu/genie-ai/-/merge_requests/new?merge_request%5Bsource_branch%5D=Health-AminaCare-branch

---

## Section 1 — Translation v4.2.1 (commit `8fab9d08`)

### 1.1 Pipeline latency optimisations

A real end-to-end test on 2026-04-30 measured **77 s** for a 30-sentence
clinical document on the v4.2 pipeline (NLLB sidecar disabled, OpenAI
`gpt-4o-mini` backend). Three architectural fixes were applied; one
deliberately dropped.

| Fix | Status | What it does |
|----:|--------|--------------|
| 2 — Sentence batching         | **Shipped** | LLM batch (one numbered prompt for up to 10 sentences) + `asyncio.gather` for NLLB |
| 3 — Pipelined Stage 2 / Stage 4 | **Shipped** | Each batch's Stage 4 spawned as `asyncio.create_task`; next batch's Stage 2 overlaps |
| 4 — Skip back-translation for high-confidence sentences | **Dropped** | Would have weakened the safety gate that caught a real negation flip on 04-30 |
| 5 — In-memory sentence cache | **Shipped** | SHA-256 keyed; only stores results with `selected_confidence ≥ 0.70` |

**Files added/modified:**
- [haystack-chatqna/src/translation_v4/stage2_multi_engine.py](../haystack-stack/haystack-chatqna/src/translation_v4/stage2_multi_engine.py) — `_BATCH_SIZE`, `_SENTENCE_CACHE`, `LLMEngine.translate_batch()`, refactored `translate_all()`
- [haystack-chatqna/src/translation_v4/pipeline.py](../haystack-stack/haystack-chatqna/src/translation_v4/pipeline.py) — `_merge_bt_results()`, batched/pipelined `translate()`, soft 15 s latency warning

**Measured latency** (synthetic, calibrated to production timings):

| Sentences | Sequential (old) | Batched cold | Batched warm | Cold speedup |
|----------:|-----------------:|-------------:|-------------:|-------------:|
| 5         | 10.85 s          | **4.14 s**   | **2.03 s**   | 2.6×         |
| 30        | 53.26 s          | **9.96 s**   | **2.21 s**   | 5.3×         |

vs the original 04-30 production measurement (77 s for 30 sentences):
**~7.7× speedup**.

Validation against the spec targets:

| Target                                | Measured | Result   |
|---------------------------------------|----------|----------|
| 30 sentences cold  < 15 s             | 9.96 s   | **PASS** |
| 30 sentences warm  <  5 s             | 2.21 s   | **PASS** |
|  5 sentences cold  <  3 s             | 4.14 s   | FAIL by 1.1 s — closes when NLLB sidecar is up (cross-model BT replaces 2 s LLM round-trip) |

### 1.2 NLLB engine — response-field compatibility

**Issue:** the prebuilt sidecar image
`ghcr.io/winstxnhdw/nllb-api:main` returns `{"result": "..."}`, but
the engine expected `{"text": "..."}`. Every translation was treated
as `empty_response` and silently fell back to LLM-only. This was a
**HIGH-severity** correctness bug — v4.2 was effectively running as
v3.5 in any environment using the prebuilt image.

**Fix:** [engines/nllb_engine.py](../haystack-stack/haystack-chatqna/src/translation_v4/engines/nllb_engine.py) now reads
`body.get("result") or body.get("text")` so both prebuilt and
self-built sidecar variants work.

### 1.3 Compose-level v4 / NLLB / Superset defaults

Team `.env` files created before v4.2 lacked `AMINA_TRANSLATION_V4_ENABLED`,
`NLLB_ENABLED`, etc. Demo-mode auto-bootstrapped from `.env.defaults` had
them; team-mode silently ran v3.5.

[docker-compose.yml](../haystack-stack/docker-compose.yml) — `haystack-chatqna` service:

```yaml
AMINA_TRANSLATION_V4_ENABLED: ${AMINA_TRANSLATION_V4_ENABLED:-true}
NLLB_ENABLED:                 ${NLLB_ENABLED:-true}
NLLB_API_URL:                 ${NLLB_API_URL:-http://nllb-translate:7860}
NLLB_TIMEOUT_MS:              ${NLLB_TIMEOUT_MS:-10000}
BAMBARA_ADAPTER_ENABLED:      ${BAMBARA_ADAPTER_ENABLED:-true}
V4_BACK_TRANSLATION_ENABLED:  ${V4_BACK_TRANSLATION_ENABLED:-true}
V4_BACK_TRANSLATION_PREFER_NLLB: ${V4_BACK_TRANSLATION_PREFER_NLLB:-true}
```

Same pattern for SUPERSET_SECRET_KEY and SUPERSET_ADMIN_PASSWORD —
suppresses cosmetic warnings during a UNICC demo.

### 1.4 NLLB sidecar overlay + component

Two new artefacts:

- [haystack-stack/docker-compose.nllb.yml](../haystack-stack/docker-compose.nllb.yml) — NLLB sidecar overlay, auto-layered by `start.ps1` / `start.sh` when present
- [components/nllb-sidecar/](../components/nllb-sidecar/) — Dockerfile + `server.py` for self-built fallback

The prebuilt image is `ghcr.io/winstxnhdw/nllb-api:main`. **First pull
is ~7.6 GB** (CTranslate2 runtime + 600M model weights + Python deps).
Subsequent starts cached.

### 1.5 Documentation (new files in this commit)

- [docs/UNICC_QUICKSTART.md](UNICC_QUICKSTART.md) — one-page evaluator card
- [docs/compliance/TRANSLATION_V4_2_1_PERFORMANCE_REPORT.md](compliance/TRANSLATION_V4_2_1_PERFORMANCE_REPORT.md) — full perf + design report
- New scripts: `scripts/review_translations.py`, `scripts/translation_baseline.py`

---

## Section 2 — UNICC start-script blockers (commit `8fab9d08`)

A live end-to-end run of `start.ps1 -SkipFrontend` on Windows 11 +
Docker Desktop surfaced nine blockers — three CRITICAL (would silently
fail on a fresh tester machine). Full table:

| # | Blocker                                                                                                                     | Severity     | Fix |
|--:|-----------------------------------------------------------------------------------------------------------------------------|--------------|-----|
| 1 | `start.ps1` had no UTF-8 BOM; PS 5.1 read em-dash as Windows-1252, breaking string parsing on line 472. Script wouldn't launch. | **CRITICAL** | Added UTF-8 BOM (3 bytes) |
| 2 | `Invoke-DockerCompose` wrapper used `ValueFromRemainingArguments` with parameter name `DcArgs`. PowerShell prefix-matched `-d` (in `up -d`) and bound it with no value → "Missing an argument for parameter 'DcArgs'". `up -d` would silently never run. | **CRITICAL** | Function takes `[string[]]$ComposeArgs` as explicit named parameter; all four call sites now pass `($composeFiles + @("up","-d"))` |
| 3 | `arcadedb` healthcheck used outer single-quotes around `--header='Authorization: Basic $(printf ... | base64)'`. `/bin/sh` doesn't expand `$()` inside single quotes — wget sent the literal string as auth header → ArcadeDB returned 403 on every probe → container went unhealthy → `dependency arcadedb failed to start` → `up -d` exit 1 → script abort. | **CRITICAL** | Switched outer quotes to double, inner literals to single. Verified container healthy after recreate. |
| 4 | NLLB engine expected `text` field; prebuilt sidecar returns `result`. Engine treated every translation as `empty_response` → silent LLM fallback. | **HIGH**     | Engine reads `body.get("result") or body.get("text")` |
| 5 | Team `.env` files lacked `AMINA_TRANSLATION_V4_ENABLED` and NLLB flags → v4 stayed disabled in container.                                       | **HIGH (team only)** | Compose-level defaults (§1.3) |
| 6 | Summary block NLLB probe used wrong fallback condition (`-not $nllbCode -or "000"`) → 404 from `/api/v4/health` skipped fallback to `/health`; summary always showed `[LOADING]` even when sidecar was healthy. | MEDIUM       | Condition is now `if ($nllbCode -ne "200")` |
| 7 | Canary translation parser failed every run with "could not parse canary response". Two compounding causes: (a) PowerShell native-exe quoting strips embedded double quotes — `python -c $canaryPy` saw `sys.path.insert(0, /app)` (no quotes) and threw `SyntaxError`; (b) `Select-Object -Last 1` picked the last line of stderr+stdout, which after the JSON was an aiohttp warning. Same bug existed in `start.sh` via `tail -1`. | **HIGH** | (a) All Python literals in canary switched from `"..."` to `'...'`; (b) Filter `Where-Object { ... -match '^\{' }` then `Select-Object -Last 1` (PS); equivalent `grep -E '^\{' \| tail -1` in `start.sh`. Verified: canary now reports `SERVE_MANDINKA via nllb`. |
| 8 | `SUPERSET_SECRET_KEY` and `SUPERSET_ADMIN_PASSWORD` unset in team-mode `.env` produced two yellow `WARN` lines on every start. Cosmetic but alarming during a UNICC demo. | LOW          | Compose-level defaults |
| 9 | Step counter said `[1/6]` then jumped to `[2/8]` — confusing for an evaluator. | LOW          | Relabelled to `[1/8]` in both `.ps1` and `.sh` |

### Verified post-fix end-to-end output

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
[8/8] AMINA is ready.

  v4 path: ACTIVE
  NLLB   : ready (3-engine selection live: phrasebank > NLLB > LLM)
  Canary : 'How are you?' -> SERVE_MANDINKA via nllb
```

### Demo-mode (no `.env`) verification

A separate live run with the team `.env` moved aside confirmed the
UNICC tester path also works:

```
[3/8] Resolving environment...
       No haystack-stack\.env found.
       Bootstrapping from .env.defaults (demo mode)...
[4/8] Starting backend services...
       Layering docker-compose.demo.yml (demo overlay)
       Layering docker-compose.nllb.yml (NLLB translation sidecar)
[6/8] Verifying Translation v4.2 ...
       NLLB image cached -- waiting up to 3 min for model load.
       NLLB sidecar healthy after 5s.
       Canary 'How are you?' -> decision=SERVE_MANDINKA engine=nllb bt=nllb_cross_model
         output: I be cogo di?
```

Backend health: `HTTP 200`. `DEMO_MODE=true` confirmed inside container.
`V4 enabled: True`, `NLLB enabled: True` confirmed. Chat API call
returned the free-tier guard message (correct demo-mode behaviour
without an OpenAI key).

---

## Section 3 — Image-pull aware NLLB wait + size correction (also `8fab9d08`)

### 3.1 Misleading model size strings (everywhere)

The repo had several references to "~2.5 GB" for the NLLB download.
The actual Docker image is **~7.6 GB** (CTranslate2 runtime + model
weights + dependencies). All occurrences corrected:

| File                                                               | Fixed |
|--------------------------------------------------------------------|------:|
| [start.ps1](../start.ps1) (3 places — wait message, summary, comment) | ✓ |
| [start.sh](../start.sh) (2 places)                                 | ✓ |
| [scripts/bootstrap_models.ps1](../scripts/bootstrap_models.ps1)    | ✓ |
| [haystack-stack/.env.defaults](../haystack-stack/.env.defaults)    | ✓ |
| [docs/SETUP_GUIDE.md](SETUP_GUIDE.md)                              | ✓ |
| [docs/compliance/TRANSLATION_V4_2_1_PERFORMANCE_REPORT.md](compliance/TRANSLATION_V4_2_1_PERFORMANCE_REPORT.md) | ✓ |

### 3.2 Adaptive wait timeout — first run vs cached

`start.ps1` and `start.sh` now detect whether the NLLB image is
already pulled and adjust the wait budget:

| Image state         | Wait budget |
|---------------------|------------:|
| Not cached (first run) | **15 minutes** (image pull ~5–10 min + model load ~2 min) |
| Cached (subsequent runs) | **3 minutes** (model load only) |

Detection via `docker image ls --format "{{.Repository}}" | grep nllb`.
If sidecar still isn't ready after the budget expires, summary block
shows the pre-pull command:

```powershell
docker compose -f haystack-stack/docker-compose.nllb.yml pull nllb-translate
```

### 3.3 Documentation refresh

- [README.md](../README.md) — quickstart now shows accurate first-run / cached times + pre-pull tip
- [docs/SETUP_GUIDE.md](SETUP_GUIDE.md) — added "First-run model downloads" section with full size table
- [docs/UNICC_QUICKSTART.md](UNICC_QUICKSTART.md) — one-page evaluator card with troubleshooting matrix

---

## Section 4 — TTS chunked synthesis + adaptive timeout (commit `b0e33898`)

### 4.1 The reported bug

A real Mandinka clinical reply (1293-char meal plan) silently failed
on the frontend with no audio. Root cause analysis:

| Layer  | Issue |
|--------|-------|
| **Server** ([tts-mms-service/server.py](../haystack-stack/tts-mms-service/server.py)) | `_synthesize_wav` ran the entire input through VITS as one tensor. CPU compute scales **super-linearly** with length: 61 chars = 6 s, 386 chars = 37 s, **1293 chars = 138 s**. |
| **Client** ([haystack-chatqna/src/services/tts_mms.py](../haystack-stack/haystack-chatqna/src/services/tts_mms.py)) | `synthesize` had a **fixed `timeout=30.0`**. Anything past ~250 chars exceeded it; client logged `mms_tts_timeout`, returned `None`, frontend got no audio. |

The audio file the server eventually produced was just discarded.

### 4.2 Fix — server side

[tts-mms-service/server.py](../haystack-stack/tts-mms-service/server.py):

- New `_split_into_chunks(text, max_chars=250)` — splits on sentence
  terminators (`.!?`), newlines, and `: -` bullet markers. Pass-2
  word-wraps any single segment still over the cap. No mid-word
  splits (would garble Mandinka phonemes).
- New `_synthesize_chunk(text)` — single VITS forward pass, returns
  float32 waveform.
- Refactored `_synthesize_wav` — chunks input → synthesizes each →
  concatenates with **120 ms inter-chunk silence** → applies pitch
  shift **once** on the concatenated WAV.
- `MMS_MAX_CHARS` default lifted from `2000` → `5000`; env override
  in compose lifted from `2000` → `8000`. Chunking removes the
  architectural reason for the lower cap; the cap is now just abuse
  protection.
- Per-chunk timing logged for ops visibility:
  `mms_tts_chunk idx=N/M chars=X audio_s=Y synth_s=Z`.

### 4.3 Fix — client side

[haystack-chatqna/src/services/tts_mms.py](../haystack-stack/haystack-chatqna/src/services/tts_mms.py):

Removed the fixed 30 s default in favor of `_adaptive_timeout(text)`:

```python
timeout = max(60.0, 30.0 + 0.20 * len(text))
```

Calibrated from the bench data (~100 ms/char observed; 200 ms/char
gives 2× safety margin). Callers can still pass an explicit `timeout=`
to force a ceiling (e.g. tests, the 5 s health probe).

| Text length | Old fixed budget | New adaptive budget |
|------------:|-----------------:|--------------------:|
|    61 chars |   30 s           |   60 s              |
|  1293 chars |   30 s ❌        |  289 s              |
|  2494 chars |   30 s ❌        |  529 s              |
| 10000 chars |   30 s ❌        | 2030 s              |

Bind-mounted `tts_mms.py` in
[docker-compose.override.yml](../haystack-stack/docker-compose.override.yml)
so the client change reloads without an image rebuild.

### 4.4 Verified end-to-end

| Test               | Chars | Adaptive budget | Elapsed | Output     |
|--------------------|------:|----------------:|--------:|------------|
| short greeting     |    61 |      60 s       |   6.1 s | RIFF WAV ✓ |
| user's meal plan   |  1293 |     289 s       | 107.3 s | RIFF WAV ✓ |
| extra-long (2× user) | 2494 |     529 s     | 219.8 s | RIFF WAV ✓ |

---

## Section 5 — TTS performance (commit `6fbd80ea`)

### 5.1 Root cause

```
Container CPU limit:       1.0 core
torch.get_num_threads():   8 threads
Host logical cores:        16
```

Torch was spawning 8 threads inside a 1-core container. Threads fought
for one CPU, causing constant context-switching and cache thrashing.
**Synthesis spent most of its time scheduling, not computing.**

### 5.2 Fix

[docker-compose.override.yml](../haystack-stack/docker-compose.override.yml)
— `voice-tts-mnk` block:

```yaml
environment:
  OMP_NUM_THREADS:   "4"
  MKL_NUM_THREADS:   "4"
  TORCH_NUM_THREADS: "4"
deploy:
  resources:
    limits:
      cpus:   "4.0"     # was "1.0"
      memory: 2G        # was 1G
```

### 5.3 Measured speedup (~5× across input sizes)

| Input            | Before  | After  | Speedup |
|------------------|--------:|-------:|--------:|
| 61-char greeting |  6.1 s  | 1.1 s  | 5.5×    |
| 1293-char meal plan | 110 s | 22.7 s | 4.9× |
| Per-chunk RTF    | 1.10    | 0.23   | 4.8×    |

Real-time factor (synth time / audio length) dropped from ≈1.10 to
**0.23** — synthesis is now ~4× faster than realtime audio.

Per-chunk before/after for the 1293-char case (deterministic chunker
output, only difference is CPU/threads):

| Chunk chars | Before (1 CPU / 8 threads) | After (4 CPUs / 4 threads) | Speedup |
|------------:|---------------------------:|---------------------------:|--------:|
| 202         | 16.59 s                    | 3.75 s                     | 4.4×    |
| 244         | 22.09 s                    | 4.28 s                     | 5.2×    |
| 248         | 20.32 s                    | 4.05 s                     | 5.0×    |
| 205         | 18.08 s                    | 3.40 s                     | 5.3×    |
| 212         | 21.22 s                    | 4.45 s                     | 4.8×    |
| 177         | 14.29 s                    | 2.49 s                     | 5.7×    |
| **TOTAL**   | **112.60 s**               | **22.42 s**                | **5.0×** |

---

## Section 6 — Configuration changes summary

Single source of truth for every config knob touched.

### 6.1 Environment variables added or changed

| Variable | Where | Old | New | Reason |
|---|---|---|---|---|
| `AMINA_TRANSLATION_V4_ENABLED` | compose service env | (none) | `${...:-true}` | v4 default-on |
| `NLLB_ENABLED` | compose service env | (none) | `${...:-true}` | NLLB default-on |
| `NLLB_API_URL` | compose service env | (none) | `${...:-http://nllb-translate:7860}` | sidecar URL default |
| `NLLB_TIMEOUT_MS` | compose service env | (none) | `${...:-10000}` | sidecar request timeout |
| `BAMBARA_ADAPTER_ENABLED` | compose service env | (none) | `${...:-true}` | Bambara→Mandinka adapter on |
| `V4_BACK_TRANSLATION_ENABLED` | compose service env | (none) | `${...:-true}` | safety gate on |
| `V4_BACK_TRANSLATION_PREFER_NLLB` | compose service env | (none) | `${...:-true}` | cross-model BT |
| `SUPERSET_SECRET_KEY` | compose service env | unset (warn) | `${...:-amina_demo_superset_secret}` | suppress warn during demo |
| `SUPERSET_ADMIN_PASSWORD` | compose service env | unset (warn) | `${...:-admin}` | suppress warn during demo |
| `MMS_MAX_CHARS` | tts-mms env | `2000` | `8000` | chunker handles long inputs |
| `OMP_NUM_THREADS` | tts-mms env | (auto = host cores) | `4` | match cgroup CPU |
| `MKL_NUM_THREADS` | tts-mms env | (auto) | `4` | same |
| `TORCH_NUM_THREADS` | tts-mms env | (auto) | `4` | same |

### 6.2 Resource limits changed

| Container | Resource | Old | New |
|---|---|---|---|
| `voice-tts-mnk` | CPU | `1.0` | `4.0` |
| `voice-tts-mnk` | Memory | `1G` | `2G` |

### 6.3 Code constants added

| Constant | File | Value | Purpose |
|---|---|---|---|
| `_BATCH_SIZE` | `stage2_multi_engine.py` | `10` | sentences per LLM batch / NLLB gather |
| `_BATCH_SIZE` | `pipeline.py` | `10` | chunks for pipelined Stage 2 / Stage 4 |
| `_CACHE_MIN_CONFIDENCE` | `stage2_multi_engine.py` | `0.70` | only cache high-confidence results |
| `_LATENCY_WARN_MS` | `pipeline.py` | `15_000` | soft warn for long-document latency |
| `_BATCH_FLOOR_CHARS` | `tts_mms.py` (client adaptive timeout) | `60.0 s` min | greeting-class messages |
| `_PER_CHAR_S` | `tts_mms.py` | `0.20` | adaptive timeout slope |
| `CHUNK_MAX_CHARS` | `tts-mms-service/server.py` | `250` | per-chunk synthesis cap |

---

## Section 7 — Files touched in this work cycle

### New files

```
docs/UNICC_QUICKSTART.md
docs/compliance/TRANSLATION_V4_2_1_PERFORMANCE_REPORT.md
docs/TRANSLATION_AND_VOICE_CHANGES_2026_05.md          ← this file
haystack-stack/docker-compose.nllb.yml
haystack-stack/haystack-chatqna/src/translation_v4/    (entire 8-stage pipeline)
components/nllb-sidecar/                               (Dockerfile + server.py)
scripts/review_translations.py
scripts/translation_baseline.py
```

### Modified files

```
README.md                                              (quickstart + first-run timing)
docs/SETUP_GUIDE.md                                    (NLLB section + first-run table)
haystack-stack/.env.defaults                           (NLLB comment + size)
haystack-stack/.env.example                            (v4 flags)
haystack-stack/docker-compose.yml                      (ArcadeDB healthcheck, v4 + NLLB + Superset env defaults, MMS_MAX_CHARS bump)
haystack-stack/docker-compose.override.yml             (translation_v4 + tts_mms.py bind-mounts; voice-tts-mnk CPU/mem/threads)
haystack-stack/tts-mms-service/server.py               (chunker + refactored synth)
haystack-stack/haystack-chatqna/src/services/tts_mms.py(adaptive timeout)
haystack-stack/haystack-chatqna/src/translation_v4/stage2_multi_engine.py (Fixes 2 + 5)
haystack-stack/haystack-chatqna/src/translation_v4/pipeline.py (Fix 3)
haystack-stack/haystack-chatqna/src/translation_v4/engines/nllb_engine.py (response field compat)
scripts/bootstrap_models.ps1                           (size correction)
start.ps1                                              (BOM, step counter, Invoke-DockerCompose,
                                                         NLLB summary, canary parser, image-cached
                                                         wait, pre-pull tip)
start.sh                                               (step counter, NLLB wait, canary parser,
                                                         contract probe accepts text|result)
```

### Files deliberately NOT modified (zero legacy edits)

```
haystack-chatqna/src/agent/memory_manager.py
haystack-chatqna/src/agent/amina_agent.py
haystack-chatqna/src/agent/prompts.py
haystack-chatqna/src/services/translator.py            (v1 path untouched)
```

---

## Section 8 — Known follow-ups (sprint backlog)

| # | Item | Notes |
|---|------|-------|
| 1 | **Clinical Memory Reset** (the "Reset clinical memory" button) | Verification pass complete; design doc ready; 9 prompt-vs-reality issues documented. ~2 days work. Soft-archive only, fully reversible, zero legacy edits. **Tracked in next sprint.** |
| 2 | Native-speaker validation of 80 golden translation pairs | Tool ready: `scripts/review_translations.py`. Start scripts surface validation progress in summary block. |
| 3 | Real-world baseline run | Once NLLB is up on the eval host, run `python scripts/translation_baseline.py` to capture measured (not synthetic) latency curves for compliance record. |
| 4 | Stage 1 simplifier `or`-split bug | Conjunction split removes `or` between adjacent verbs ("limit or avoid" → "limit avoid"). Real bug, scoped out of v4.2.1 to keep that release clean. |
| 5 | v4.3 Redis-backed sentence cache | Today's cache is in-memory; warm hits don't survive restarts and don't replicate across replicas. TODO marker in code. |
| 6 | GPU passthrough for Mandinka TTS | A40 host has GPU available. Image is currently `+cpu` torch. With CUDA, RTF would drop from ~0.23 to ~0.05 (another ~5× win, taking 1300-char synthesis to ~5 s). |
| 7 | Hard-delete (GDPR right-to-erasure) for clinical data | Phase 2 of the Clinical Memory Reset feature. Separate compliance review needed. |

**Last updated:** 2026-05-02

