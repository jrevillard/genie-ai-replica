# AMINA — Healthcare AI for The Gambia

AMINA is an open-source clinical assistant built on the GENIE.AI / OPEA stack and tailored for non-communicable disease (NCD) care in Gambian primary-health workflows. It speaks English and Mandinka, runs offline-friendly local voice/translation, and ships with a measurable safety perimeter — 105/105 abuse-defense cases and 65/65 jailbreak cases passing on the bench.

This is the working tree the UNICC reviewers should evaluate. Existing project README content has been preserved at [`README.original.md`](README.original.md).

## Why this is different

| Feature | What's in the box | Verifier |
|---|---|---|
| **Abuse-defense ladder (3-per-cycle)** | WARN1 → WARN2 → `session_terminate` → 30 min cool-down → 24 h → 7 d + admin flag. Lock-and-preserve UI: chat history stays visible, input is disabled, red banner with "New Conversation" button. | `python -m src.abuse_defense.eval.run_all` (105/105) |
| **Jailbreak perimeter** | 20 hand-curated regex patterns (ignore_previous, system_prompt_leak, prescribe_specific_drug, unicode_smuggling, SQL/NoSQL injection, etc.) running at the API gateway. | `python -m tests.test_jailbreak_detector` (65/65) |
| **Local Mandinka voice** | Whisper STT + Piper EN TTS + facebook/mms-tts-mnk (Mandinka) — all CPU-only, no cloud round-trips for voice. | `voice-stt` / `voice-tts` / `voice-tts-mnk` containers |
| **Translation v4.2 (NLLB-200)** | Local NLLB sidecar with phrasebook fast-path + LLM fallback + back-translation quality gate. v4 falls back to v3.5 (LLM-only) if the sidecar is unavailable — no hard dependency. | `docker logs nllb-translate` |
| **Three literacy modes** | beginner (big-tile shell), basic (simplified chrome), advanced (full UI) — selected at signup, stored in ArcadeDB `LiteracyProfileVertex`. | `scripts/seed_literacy_demo_accounts.py` |
| **API Gateway perimeter** | JWT auth, schema validation, jailbreak filter, PHI redaction, audit log on a parallel surface (`:8443`) — UNICC tester flow on `:8000` is unchanged. | `curl http://localhost:8443/api/v1/public/security/status` |
| **No keys required to evaluate** | `.env.defaults` (committed, demo-safe) bootstraps the entire stack. Real LLM keys only needed for full clinical responses. | `.\start.ps1` with no `.env` |

## How to run

```powershell
# Windows
git clone <repo-url>
cd genie-ai
.\start.ps1
# Linux/macOS: ./start.sh
```

Then open `http://localhost:5174`. First run pulls ~210 MB of voice models + a ~7.6 GB NLLB image (5–10 min on broadband); subsequent runs are ~2 minutes.

To stop everything: `.\start.ps1 -Stop`.

## What you see

When the script reports healthy, these endpoints are live:

| Service | URL / Port | Container | Source |
|---|---|---|---|
| Frontend (chat UI) | http://localhost:5174 | (host vite dev server) | `components/frontend/vite.config.js` |
| Backend API | http://localhost:8000/health | `haystack-chatqna` | `haystack-stack/docker-compose.yml` |
| API Gateway | http://localhost:8443/health | `amina-gateway` | `haystack-stack/docker-compose.gateway.yml` |
| ArcadeDB (KG + vector) | http://localhost:2480 | `arcadedb` | `haystack-stack/docker-compose.yml` |
| ArcadeDB (Postgres wire) | localhost:5433 | `arcadedb` | `haystack-stack/docker-compose.yml` |
| Whisper STT | http://localhost:8087 | `voice-stt` | `haystack-stack/docker-compose.yml` |
| Piper EN TTS | http://localhost:5500 | `voice-tts` | `haystack-stack/docker-compose.yml` |
| MMS Mandinka TTS | http://localhost:5501 | `voice-tts-mnk` | `haystack-stack/docker-compose.yml` |
| NLLB Translation | http://localhost:7860 | `nllb-translate` | `haystack-stack/docker-compose.nllb.yml` |
| Dataprep / Ingest | http://localhost:8001 | `dataprep-worker` | `haystack-stack/docker-compose.yml` |
| Superset (analytics) | http://localhost:8080 | `amina-superset` | `haystack-stack/docker-compose.yml` |
| Redis (memory) | (internal only — `redis:6379` on `chatqna_default` net) | `amina-redis` | `haystack-stack/docker-compose.yml` |

Demo patient login (advanced literacy): `advanced@demo.aminacare` / `Demo2026` (also `beginner@demo.aminacare`, `basic@demo.aminacare` — same password).

## Where to go next

| If you want to… | Read |
|---|---|
| Set up step-by-step + troubleshoot common issues | [docs/SETUP.md](docs/SETUP.md) |
| Run the 5-minute UNICC demo from a script | [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md) |
| Understand the architecture, safety layers, data flow | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| See the abuse-defense logic + test results | [docs/compliance/ABUSE_DEFENSE_LOGIC_AND_TEST_RESULTS.md](docs/compliance/ABUSE_DEFENSE_LOGIC_AND_TEST_RESULTS.md) |
| See the abuse-defense cool-down ladder spec | [docs/compliance/ABUSE_DEFENSE_COOLDOWN.md](docs/compliance/ABUSE_DEFENSE_COOLDOWN.md) |
| See the jailbreak detector logic + test results | [docs/compliance/JAILBREAK_LOGIC_AND_TEST_RESULTS.md](docs/compliance/JAILBREAK_LOGIC_AND_TEST_RESULTS.md) |
| See the jailbreak protection report | [docs/compliance/JAILBREAK_PROTECTION_REPORT.md](docs/compliance/JAILBREAK_PROTECTION_REPORT.md) |
| Read the model card | [docs/compliance/MODEL_CARD_AMINA.md](docs/compliance/MODEL_CARD_AMINA.md) |
| Read the clinical safety case | [docs/compliance/CLINICAL_SAFETY_CASE.md](docs/compliance/CLINICAL_SAFETY_CASE.md) |
| Read the privacy notice + DPIA | [docs/compliance/PRIVACY_NOTICE.md](docs/compliance/PRIVACY_NOTICE.md), [docs/compliance/DPIA.md](docs/compliance/DPIA.md) |
| Operate the stack (admin scripts, log tail, warning reset) | `clear_abuse_warnings.py`, `tail_abuse_logs.py`, [docs/AMINA_OPS_MANUAL.md](docs/AMINA_OPS_MANUAL.md) |
| See the original GENIE.AI project README | [README.original.md](README.original.md) |

---

GENIE.AI is governed under the ITU AI for Good track on open-source generative AI for Digital Public Goods. AMINA is the Gambian healthcare reference implementation built on top of the GENIE.AI core. See [CONTRIBUTING.md](CONTRIBUTING.md), [STANDARDS.md](STANDARDS.md), and the [UNICC code-management process](UNICC-ITU-Genie-AI%20Code%20Management%20Process.md) for governance details.
