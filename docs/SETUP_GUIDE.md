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
2. If `haystack-stack/.env` is missing, copies the committed
   `haystack-stack/.env.defaults` into place (demo mode).
3. Brings up the backend stack via `docker compose` with the demo overlay.
4. Polls `/health` until the backend is ready (~1–3 min on first run).
5. Installs frontend node_modules on first run, then launches the dev
   server in a separate terminal.

When the script prints `AMINA is ready.`, open
<http://localhost:5174> in a browser.

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
