# AMINA Setup Guide

This repo ships two startup paths — one for evaluators who just want to
see it running, one for team developers who need real provider keys.

---

## For UNICC evaluators / testers

**Prerequisites**

1. Docker Desktop installed and running
2. Git
3. ~5 GB free disk for Docker images on first pull
4. Ports `8000`, `5174`, and `2480` free on localhost

**Steps**

```powershell
# 1. Clone the repository
git clone <repo-url>
cd genie-ai

# 2. Start everything (Windows / PowerShell)
.\start.ps1

# 2b. Linux / macOS
./start.sh
```

That's it. The script:

1. Confirms Docker is up.
2. **Downloads AI model weights on first run** (`scripts/bootstrap_models.ps1` /
   `.sh`): Whisper STT base.en (~148 MB) and Piper TTS lessac voice
   (~63 MB). Total ~210 MB; takes 1–3 min on a typical connection.
   Subsequent runs skip the download. Failures are non-fatal — text
   chat still works without voice.
3. If `haystack-stack/.env` is missing, copies the committed
   `haystack-stack/.env.defaults` into place (demo mode).
4. Brings up the backend stack via `docker compose` with the demo overlay
   (only when bootstrapping demo defaults).
5. Polls `/health` until the backend is ready (~1–3 min on first run).
6. Installs frontend node_modules on first run, then launches the dev
   server in a separate terminal.

When the script prints `AMINA is ready.`, open
<http://localhost:5174> in a browser.

### AI model downloads — what happens, what to do if it fails

`scripts/bootstrap_models.ps1` (called by `start.ps1` automatically) reads
the file paths straight from `haystack-stack/docker-compose.yml`:

| Model file | Used by | Source |
|---|---|---|
| `components/voice-gateway/infra/whispercpp/models/ggml-base.en.bin` | `voice-stt` (Whisper.cpp server) | `huggingface.co/ggerganov/whisper.cpp` |
| `components/voice-gateway/infra/piper/models/en_US-lessac-medium.onnx` | `voice-tts` (Piper) | `huggingface.co/rhasspy/piper-voices` |
| `components/voice-gateway/infra/piper/models/en_US-lessac-medium.onnx.json` | `voice-tts` (Piper config) | same as above |

The script downloads to a `.partial` file then atomically renames on
success, so an interrupted run leaves no half-files in place.

Re-run manually (e.g. after a network blip):

```powershell
.\scripts\bootstrap_models.ps1            # only download what's missing
.\scripts\bootstrap_models.ps1 -Force     # re-download everything

# Linux / macOS:
./scripts/bootstrap_models.sh
./scripts/bootstrap_models.sh --force
```

If the auto-download is blocked by a corporate firewall or proxy,
download the three URLs above through your browser and drop the files
into the matching paths. Voice-stt and voice-tts will pick them up on
the next `docker compose up`.

The `voice-tts-mnk` (Mandinka TTS) container does not need this
bootstrap — it pulls `facebook/mms-tts-mnk` from the HuggingFace cache
that is pre-warmed at image build time.

To shut everything down:

```powershell
.\start.ps1 -Stop          # Windows
./start.sh --stop          # Linux / macOS
```

To rebuild the backend image after code changes:

```powershell
.\start.ps1 -Rebuild
./start.sh --rebuild
```

The system runs in **demo mode** with synthetic data. External providers
(OpenAI / Twilio / DHIS2 / Meta) are intentionally disabled so no API
keys are required. The agent's local fallback chain is exercised
instead, which is enough to evaluate the chat, voice, caregiver, and
admin surfaces.

---

## For team developers (real keys)

```powershell
git clone <repo-url>
cd genie-ai

# Copy the template and fill in your real keys.
cp haystack-stack/.env.example haystack-stack/.env
# (Windows PowerShell)
Copy-Item haystack-stack\.env.example haystack-stack\.env

# Edit haystack-stack/.env — paste real provider keys from your
# password manager. NEVER commit this file.

.\start.ps1
```

When `haystack-stack/.env` exists, the start script does **not**
overwrite it — your team values win. The committed `.env.defaults`
stays as the demo fallback.

`haystack-stack/.env` is gitignored. The pre-commit hook in
`.githooks/pre-commit` blocks accidental commits. Wire the hook
once per clone:

```bash
git config core.hooksPath .githooks
```

---

## What runs

| Service             | URL                                | Purpose                          |
|---------------------|------------------------------------|----------------------------------|
| Chat UI (Vite)      | <http://localhost:5174>            | Patient / caregiver interface    |
| Backend API         | <http://localhost:8000>            | AminaAgent + all REST endpoints  |
| Health check        | <http://localhost:8000/health>     | Service status                   |
| ArcadeDB Studio     | <http://localhost:2480>            | Database browser                 |
| Whisper (STT)       | <http://localhost:8087>            | Speech-to-text (internal)        |
| Piper (TTS)         | <http://localhost:5500>            | English TTS (internal)           |
| MMS-MNK (TTS)       | <http://localhost:5501>            | Mandinka TTS (internal)          |
| NLLB Translate      | <http://localhost:7860>            | English↔Bambara MT (Translation v4.2 sidecar) |

---

## Translation pipeline (v3.5 / v4.2)

`AMINA_TRANSLATION_V4_ENABLED=true` is the default in `.env.defaults`,
so a fresh-clone tester runs the v4.2 pipeline out of the box.

### What the start script handles automatically

`start.ps1` / `start.sh` step **`[6/8] Verifying Translation v4.2`**:

1. **Pulls and starts the NLLB-200 sidecar** (`ghcr.io/winstxnhdw/nllb-api:main`).
   First boot pulls a ~7.6 GB Docker image (CTranslate2 runtime +
   600M model weights + Python dependencies) — the script auto-detects
   whether the image is already cached and waits up to 15 minutes on
   first run, 3 minutes on subsequent runs, for `/api/v4/health` (or
   `/health` on the prebuilt image) to return 200.
2. **Verifies the endpoint contract** by calling
   `GET /api/v4/translator?text=hello&source=eng_Latn&target=bam_Latn`
   and checking the response shape. Catches an upstream image change
   before users hit a confusing translation failure.
3. **Eager-bootstraps the ArcadeDB `TranslationMetric` schema** via
   `docker exec`. Idempotent — subsequent process starts hit the
   in-process latch and skip. If ArcadeDB isn't reachable the lazy
   bootstrap on the first telemetry call still runs.
4. **Runs a canary translation** of `"How are you?"` through the live
   pipeline inside `haystack-chatqna`. Reports the chosen engine,
   back-translation method, and latency in the summary block so the
   operator sees a green light (or a yellow "v4 active in v3.5 fallback").
5. **Surfaces `Pending: native-speaker review of the 80 golden pairs`**
   in the summary block — the one item the script cannot automate.

### Graceful degradation paths

| Failure | Behaviour |
|---|---|
| NLLB sidecar slow to load | Pipeline stays active; phrasebank + LLM serve while NLLB warms |
| NLLB sidecar fails entirely | Pipeline runs as v3.5 (phrasebank + LLM, temp-shift back-translation) |
| ArcadeDB down | Telemetry persistence skipped; structured JSON log still emitted |
| `AMINA_TRANSLATION_V4_ENABLED=false` | `pipeline.translate()` returns `None`; v1 path runs unchanged |
| Any stage raises | Caught and logged; pipeline returns `None` → v1 fallback |

### Forcing the v1 (legacy) path

Set `AMINA_TRANSLATION_V4_ENABLED=false` in `haystack-stack/.env` and
re-run `start.ps1`. The script will skip the v4 verify block entirely
and the translator falls back to the pre-v3.5 behaviour.

### Faster restarts: `-SkipVerify`

`[6/8]` waits up to 15 minutes on first NLLB start (Docker image
pull + model load) and up to 3 minutes on subsequent runs (model
load only). For fast restarts that skip the verify block entirely:

```powershell
.\start.ps1 -SkipVerify       # PowerShell
./start.sh --skip-verify      # bash
```

## First-run model downloads

On first start, AMINA pulls AI models automatically. Sizes and
expected times on a typical 50–100 Mbit/s connection:

| Component         | Size    | Time         | Purpose                                            |
|-------------------|---------|--------------|----------------------------------------------------|
| Whisper STT       | ~148 MB | ~30 s        | English speech-to-text                             |
| Piper TTS         | ~63 MB  | ~15 s        | English text-to-speech                             |
| NLLB Translation  | ~7.6 GB | 5–10 min     | Mandinka translation engine (Docker image)         |

**To avoid waiting during a UNICC demo**, pre-pull the NLLB image
the night before:

```powershell
docker compose -f haystack-stack/docker-compose.nllb.yml pull nllb-translate
```

After the image is cached, subsequent starts take ~2 minutes (model
load only, no download). The start script auto-detects the cached
image and shortens its NLLB wait budget from 15 minutes to 3.

**If the NLLB pull fails** (firewall, proxy, slow connection), AMINA
still works — translation falls back to phrasebank + LLM with
reduced quality. Text chat is fully functional. The script never
blocks the user on NLLB readiness; the summary block flags it as
`[LOADING]` with a recovery hint.

The summary block prints `Verify : skipped (--SkipVerify)` so the
operator never thinks it ran silently.

### Native-speaker review of the 80 golden pairs

The `[6/8]` summary line `Review : X/80 golden pairs validated by
native speaker` reads directly from
`src/translation_v4/eval/golden_translations.json`. To capture
validation, run the interactive CLI:

```bash
REVIEWER_NAME="Alkalo Bah" python scripts/review_translations.py
# filter by category or single pair:
python scripts/review_translations.py --category negation_critical
python scripts/review_translations.py --id med_001
# stats only, no prompts:
python scripts/review_translations.py --summary-only
```

For each pair the reviewer can `[a]ccept`, `[e]dit & accept`, `[r]eject`,
`[s]kip`, or `[q]uit`. State persists to the same JSON file after every
decision so an interrupt never loses work. Each reviewed pair gains
`reviewed_at` (UTC ISO-8601) and `reviewed_by` (`$REVIEWER_NAME`).
Edited entries preserve the original under `original_mandinka`.

### Real-world baseline run (locks in the v4.2 quality numbers)

Once NLLB is up and the LLM keys are real, run the baseline once to
populate `docs/compliance/translation_v4_baseline_<date>.json` and the
ArcadeDB `TranslationMetric` vertex. Costs LLM credits per pair; do
not run on every CI build.

Two ways to trigger:

```powershell
# After start.ps1 finishes -- runs in-line, before the summary
.\start.ps1 -Baseline

# Or as a standalone command (existing stack stays up)
python scripts/translation_baseline.py

# Diff against a previous baseline
python scripts/translation_baseline.py \
    --compare docs/compliance/translation_v4_baseline_2026-05-01.json

# Only run pairs the native speaker has already validated
python scripts/translation_baseline.py --validated-only
```

The script writes a structured artefact:

```json
{
  "schema":  "translation_v4_baseline.v1",
  "timestamp": "2026-05-01T20:30:00Z",
  "config_snapshot": { ... },
  "summary": {
    "negation_preservation_rate":  1.000,
    "number_preservation_rate":    1.000,
    "score_overall":  { "mean": 0.81, "p50": 0.85, "p95": 0.92 },
    "engine_distribution":         { "phrasebank": 5, "nllb": 60, "llm": 15 },
    "back_translation_methods":    { "nllb_cross_model": 60, ... },
    "by_category":                 { ... }
  },
  "results": [ { ...one row per pair... } ]
}
```

The next baseline run with `--compare <previous>` shows deltas on
every metric so a regression is one diff away.

---

## File layout (configuration only)

```
genie-ai/
├── start.ps1                          # one-command start (Windows)
├── start.sh                           # one-command start (Linux/macOS)
├── .githooks/
│   └── pre-commit                     # secret guard
├── .gitignore                         # blocks .env, allows .env.defaults
└── haystack-stack/
    ├── .env.defaults                  # COMMITTED — demo-safe values
    ├── .env.example                   # COMMITTED — template for team
    ├── .env                           # GITIGNORED — created by start script
    ├── docker-compose.yml             # base stack (do not edit core service defs)
    ├── docker-compose.demo.yml        # demo overlay (DEMO_MODE + healthchecks)
    ├── docker-compose.override.yml    # team overrides (existing)
    └── docker-compose.meta-channels.yml
```

Resolution order at boot (later wins):

1. `.env.defaults` (committed)
2. `.env` (gitignored — created from defaults if missing)

The base `docker-compose.yml` references `.env` directly via
`env_file:`. The start script ensures `.env` exists by copying
`.env.defaults` on first run, so compose always finds the file.

---

## Troubleshooting

**"Docker is not running"**
→ Start Docker Desktop, wait until the whale icon stops animating, re-run
  the script.

**Backend reports unhealthy after 3 minutes**
→ First-run image pulls + ArcadeDB schema bootstrap can exceed the
  default poll window on a slow connection. Tail the logs:
  ```
  docker logs --tail 60 -f haystack-chatqna
  ```
  If you see the FastAPI banner and `Application startup complete`,
  the service is up — refresh the browser. If you see repeated import
  errors, run `.\start.ps1 -Rebuild`.

**Frontend shows 502 / 503 errors in the browser console**
→ The backend is still starting. Wait 30 s and refresh.

**"Port 8000 already in use" / "Port 5174 already in use"**
→ Another process owns the port. Find it:
  ```powershell
  Get-NetTCPConnection -LocalPort 8000     # Windows
  lsof -i :8000                            # Linux/macOS
  ```
  Stop it, or override the port via `haystack-stack/.env` (`API_PORT`)
  and `components/frontend/vite.config.js`.

**"npm install" fails on first run**
→ The script will warn but continue. Manually:
  ```
  cd components/frontend
  npm install
  npm run dev
  ```

**The pre-commit hook is not firing**
→ Hooks live in `.githooks/`, not `.git/hooks/`. Wire them once per
  clone with `git config core.hooksPath .githooks`. Verify with
  `git config --get core.hooksPath`.

**My commit was blocked but the secret is fake**
→ Use `git commit --no-verify` and explain why in the message. The
  reviewer should see your justification.

---

## What the demo deliberately does NOT do

- **No external provider calls.** OpenAI, Google, Twilio, Meta, DHIS2,
  Telegram are stubbed to `disabled` strings in `.env.defaults`. The
  agent fails over to local code paths.
- **No real PHI.** Demo data is synthetic. `OBSERVATORY_DATA_MODE=synthetic`.
- **No production gates.** `AMINA_ENV=development` so the production
  boot-refusal logic in `src/config.py` does not fire. To exercise
  that, set `AMINA_ENV=production` in your `.env` and watch the
  process refuse to start until every required env var is present.
- **No fine-tuned model.** `USE_FINETUNED_MODEL=false`. The Amina
  LoRA path needs Tailscale + a vLLM endpoint that is not part of
  the public demo.

---

## Promoting from demo to a real deployment

1. Replace every `CHANGE_ME` in `.env.example` with a real value, save
   as `.env` (still gitignored).
2. Set `AMINA_ENV=production` in `.env`.
3. Set `OTP_DEV_MODE=false` and the three `*_BYPASS=false` flags.
4. Ensure `JWT_SECRET` is at least 32 random bytes.
5. Restart with `.\start.ps1 -Rebuild`. The boot will fail fast if any
   secret is missing — that is by design.

See `docs/compliance/SECURITY_AND_BUG_AUDIT_2026_05_01.md` for the
full security checklist.
