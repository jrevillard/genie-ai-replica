# AMINA — Healthcare AI for The Gambia

AMINA is an open-source clinical assistant tailored for non-communicable disease (NCD) care in Gambian primary-health workflows. Built on the GENIE.AI / Haystack stack, it speaks English and Mandinka, adapts to three literacy levels, and is designed to work in low-connectivity environments — putting trustworthy health guidance in the hands of patients, caregivers, and clinicians across The Gambia.

> AMINA is the Gambian healthcare reference implementation of GENIE.AI, governed under the ITU AI for Good track as an open-source Digital Public Good.

---

## What AMINA does

- 🗣️ **Multilingual voice interaction** — English and Mandinka, fully CPU-local (no cloud round-trips)
- 📋 **NCD-focused clinical guidance** — grounded in MoH/WHO sources via RAG pipeline
- 👨‍👩‍👧 **Caregiver Mode** — family members stay connected to patient progress
- 📊 **Clinician & government dashboards** — anonymized population insights via Superset + DHIS2
- 🔒 **Privacy-first** — HIPAA-aligned, GDPR-informed, Gambian Data Protection Act 2025 compliant
- 📶 **Offline-friendly** — local voice/translation models, deferred sync

---

## Literacy modes

Three modes selectable at signup, stored in ArcadeDB:

| Mode | Experience |
|---|---|
| **Beginner** | Large-tile shell, audio-first |
| **Basic** | Simplified interface |
| **Advanced** | Full UI |

Demo logins (password: `Demo2026`): `beginner@demo.aminacare` · `basic@demo.aminacare` · `advanced@demo.aminacare`

---

## How to run

```powershell
# Windows
git clone <repo-url>
cd genie-ai
.\start.ps1

# Linux/macOS
./start.sh
```

Open `http://localhost:5174`. First run pulls ~210 MB of voice models + ~7.6 GB NLLB image (5–10 min on broadband). Subsequent runs: ~2 minutes. To stop: `.\start.ps1 -Stop`.

No API keys needed to evaluate — `.env.defaults` bootstraps the full stack. Real LLM keys only required for full clinical responses.

---

## Mobile app (Android)

A Flutter patient-facing app that connects to the AMINA backend.

**Key features**
- 💬 **AI chat** — text and voice messages to the Amina agent, with TTS playback
- 💊 **Rx scanner** — photograph a prescription to log medications via OCR
- 📈 **Vitals log** — record and review blood pressure, glucose, weight, etc.
- 👨‍👩‍👧 **Caregiver circle** — browse the caregiver directory, apply, and manage assigned caregivers
- 🔐 **Secure auth** — JWT stored in FlutterSecureStorage; session expiry handled automatically

**Tech stack:** Flutter 3 · Riverpod · Dio · flutter\_secure\_storage · shared\_preferences

**Minimum device:** Android 9 (API 28) · 1 GB RAM · 720×1280


## Services

| Service | URL | Container |
|---|---|---|
| Frontend | http://localhost:5174 | host vite dev server |
| Backend API | http://localhost:8000/health | `haystack-chatqna` |
| API Gateway | http://localhost:8443/health | `amina-gateway` |
| ArcadeDB | http://localhost:2480 | `arcadedb` |
| Whisper STT | http://localhost:8087 | `voice-stt` |
| Piper EN TTS | http://localhost:5500 | `voice-tts` |
| MMS Mandinka TTS | http://localhost:5501 | `voice-tts-mnk` |
| NLLB Translation | http://localhost:7860 | `nllb-translate` |
| Superset (analytics) | http://localhost:8080 | `amina-superset` |

---

## Safety & Compliance

AMINA ships with a measurable safety perimeter validated against 170 test cases.

| Layer | What it does | Test |
|---|---|---|
| **Abuse-defense ladder** | WARN1 → WARN2 → session terminate → escalating cool-downs (30 min / 24 h / 7 d) + admin flag | `python -m src.abuse_defense.eval.run_all` (105/105) |
| **Jailbreak perimeter** | 20 regex patterns at API gateway (prompt injection, drug prescribing, PHI leaks, SQL injection, unicode smuggling, etc.) | `python -m tests.test_jailbreak_detector` (65/65) |
| **API Gateway** | JWT auth, schema validation, PHI redaction, audit log on `:8443` | `curl http://localhost:8443/api/v1/public/security/status` |

---

## Documentation

| Topic | Link |
|---|---|
| Setup + troubleshooting | [docs/SETUP.md](docs/SETUP.md) |
| 5-minute UNICC demo script | [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md) |
| Architecture & data flow | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Abuse-defense logic & results | [docs/compliance/ABUSE_DEFENSE_LOGIC_AND_TEST_RESULTS.md](docs/compliance/ABUSE_DEFENSE_LOGIC_AND_TEST_RESULTS.md) |
| Jailbreak logic & results | [docs/compliance/JAILBREAK_LOGIC_AND_TEST_RESULTS.md](docs/compliance/JAILBREAK_LOGIC_AND_TEST_RESULTS.md) |
| Model card | [docs/compliance/MODEL_CARD_AMINA.md](docs/compliance/MODEL_CARD_AMINA.md) |
| Clinical safety case | [docs/compliance/CLINICAL_SAFETY_CASE.md](docs/compliance/CLINICAL_SAFETY_CASE.md) |
| Privacy notice + DPIA | [docs/compliance/PRIVACY_NOTICE.md](docs/compliance/PRIVACY_NOTICE.md) · [docs/compliance/DPIA.md](docs/compliance/DPIA.md) |
| Ops manual | [docs/AMINA_OPS_MANUAL.md](docs/AMINA_OPS_MANUAL.md) |
| Original GENIE.AI README | [README.original.md](README.original.md) |

---

For governance details see [CONTRIBUTING.md](CONTRIBUTING.md), [STANDARDS.md](STANDARDS.md), and the [UNICC code-management process](UNICC-ITU-Genie-AI%20Code%20Management%20Process.md).
