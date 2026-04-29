# STT / TTS / LLM / Guard-Rail Fixes

**Status:** Phase 1 + Phase 5 deployed and verified. Phases 3, 4 ready to deploy on demand.
**Last updated:** 2026-04-26
**All E2E tests:** **230/230 passing** (90 phone-auth + 68 consent + 72 auth validators)

---

## Executive summary

A single root cause — a **frontend recording bug that submitted compression bombs** to STT — produced what looked like four independent failures (LLM unresponsive, TTS slow, STT timing out, dashboard hangs). The fix landed in two structural layers (**resource limits** and **WAV-duration guard**) plus a frontend patch and several pre-existing-bug repairs surfaced along the way.

The system is now defended against the same class of failure — even if a misbehaving client returns, voice-stt cannot starve the rest of the stack and compression bombs are blocked before reaching whisper-server.

---

## Root cause: the cascade

1. The mic recorder in [App.jsx](../components/frontend/src/App.jsx) ran a 3-second polling interval that submitted **the entire accumulated audio buffer** to STT every 3 seconds, never trimming. After 5+ minutes of recording, every poll shipped 5+ minutes of audio.
2. WebM/Opus voice encoding @ 12 kbps means a **1 MB upload decompresses to ~80 minutes of WAV**. The byte size looked harmless; the decoded audio was a bomb.
3. Whisper-small.en (CPU-only, 4 threads) cannot encode 80-minute WAVs in any reasonable time. Each one took ~13 minutes of CPU at full load.
4. The whisper-server process pegged 4 CPU cores at 400% sustained, **starving haystack-chatqna of CPU** — which made LLM calls slow, TTS slow, and the chat UI feel "broken".
5. New requests queued behind the stuck job; legitimate STT calls timed out.

The user's complaint of "LLM not responding, TTS broken, STT broken" was **one bug presenting in three places**.

---

## STT — the source of the problem (most fixes here)

### Frontend fix — sliding-window partial transcription
**File:** [components/frontend/src/App.jsx:2737-2776](../components/frontend/src/App.jsx#L2737)
**Type:** Surgical edit (user OK'd existing-file edit)
**Change:** Reworked `recorder.onstart`'s polling interval to:
- **Hard cap recording at 5 minutes** — auto-stops the recorder when the wall clock hits the cap, so the final blob can never be unbounded
- **Sliding window for partial transcripts** — only sends the last ~10 seconds of audio (last 20 chunks of 500 ms each) to STT for live captions, instead of the full accumulated buffer
- **In-flight guard** — `partialInFlight` flag skips a new partial transcribe if the previous one hasn't returned, preventing pile-up

### Backend fix #1 — STT upload-size guard (ASGI middleware)
**File (new):** [haystack-chatqna/src/services/stt_upload_guard.py](../haystack-stack/haystack-chatqna/src/services/stt_upload_guard.py)
**Type:** Additive ASGI middleware, no edits to existing files
**Coverage:** All 6 audio-forwarding endpoints:
- `/api/v1/stt`
- `/api/v1/voice-chat`
- `/api/v1/voice-chat-audio`
- `/api/v1/agent/voice-chat`
- `/api/v1/agent/voice-chat-audio`
- `/api/v1/caregiver/voice-chat`

**Two enforcement layers** (both required because browser fetch with FormData often uses `Transfer-Encoding: chunked` with no Content-Length header):
1. **Header check** — reject early with `413` if `Content-Length` header > 8 MB
2. **Stream check** — wraps ASGI `receive()` to count body bytes as they arrive and abort with `413` once cap exceeded

**Rejection example:**
```json
{
  "code": "audio_too_large",
  "message": "Audio upload too large (15360 KB). Maximum is 8192 KB...",
  "max_bytes": 8388608,
  "received_bytes": 15728851,
  "rejected_at": "stream"
}
```

### Backend fix #2 — STT duration guard (compression-bomb defense)
**File (new):** [haystack-chatqna/src/services/stt_duration_guard.py](../haystack-stack/haystack-chatqna/src/services/stt_duration_guard.py)
**Type:** Additive monkey-patch on `stt_whisper._normalize_audio` (same pattern as existing `main_with_stt_fix.py`)

**Why:** The byte-size guard catches obvious oversized POSTs but not compression bombs (small compressed file → huge decoded WAV). The duration guard catches the bomb at the only layer where the truth is known: the decoded WAV.

**Two-stage check:**
1. **`ffprobe` stage** (~50 ms) — read input metadata duration without decoding samples. Catches most bombs cheaply.
2. **WAV header stage** — for inputs ffprobe can't read (truncated/streamed WebM), the normal ffmpeg decode runs and the WAV header is parsed for actual sample count.

If `samples / 16000 > 360s` (6 minutes), `_normalize_audio` returns `None`, downstream `transcribe` returns `None`, route handler responds `422`.

**Live evidence in logs:**
```
WARNING:src.services.stt_duration_guard:stt_duration_guard: REJECTED 8364.5s audio at decode stage (cap 360s) -- bomb slipped past probe
```

A stale browser tab firing 2-hour audio bombs is now blocked before whisper sees it.

**Cap configurable** via `STT_MAX_DURATION_SECONDS` env var.

---

## LLM — collateral victim, fixed by Phase 1

### No direct LLM code changes
The LLM endpoints (`/api/v1/chat`, `/api/v1/agent/chat-stream`) themselves were never broken. They were victims of CPU starvation when voice-stt was eating 4 of 16 host cores.

### Indirect fix — Phase 1 resource limits
voice-stt is now hard-capped at 2 CPU / 2 GB. It can no longer steal the whole machine. Verified post-fix:
- `/api/v1/agent/chat-stream` real LLM tokens: **3.0 s**
- `/api/v1/chat` warm: **1.4 s**
- haystack-chatqna CPU under bomb load: dropped from **525% → 1.3%**

### Pre-existing LLM-adjacent bugs surfaced and fixed
1. **`/openapi.json` returning 500** — `from __future__ import annotations` + Pydantic models defined inside `get_feedback_router()` in [reranker_feedback.py](../haystack-stack/haystack-chatqna/src/services/reranker_feedback.py) created unresolvable `ForwardRef`. Fixed by moving `FeedbackRequest`/`CycleRequest` to module scope (one-time edit, OK'd) **plus** an additive defensive [openapi_recovery.py](../haystack-stack/haystack-chatqna/src/services/openapi_recovery.py) that wraps `app.openapi()` and falls back to per-route schema generation if a route's introspection fails. Result: `/docs` works, all 336 paths visible.
2. **`Protocol schema init warning: No module named 'src.repositories.protocol_repo'`** — created [protocol_repo.py](../haystack-stack/haystack-chatqna/src/repositories/protocol_repo.py) shim with full `ProtocolRepository` (CRUD + indexed schema for clinical protocols). Boot log now: `✅ ArcadeDB Protocol schema initialized`.

---

## TTS — never broken, just looked broken

### Diagnosis result: TTS was always healthy
- `/api/v1/tts` (English / Piper, port 5500): **1.6 s** for short text, valid WAV output
- `/api/v1/tts` (Mandinka / MMS, port 5501): **4.0 s**, valid WAV output

### What the user observed
TTS appeared slow during peak STT bomb load because all containers shared the same 16-core host. Phase 1 resource limits (1 CPU / 1 GB each for voice-tts and voice-tts-mnk) ensure TTS can never starve.

### No TTS code changes required.

---

## Guard rails — synthetic-data governance (Phase 4 earlier)

**Backend (additive, 2 new files):**
- [observatory_synthetic.py](../haystack-stack/haystack-chatqna/src/services/observatory_synthetic.py) — central API: `is_synthetic_mode()` / `is_production_mode()` (with HMAC-signed authorization-file validation), `synthetic_metadata()`, `record_consent()`, `get_disclaimer_text()`
- [observatory_disclaimer.py](../haystack-stack/haystack-chatqna/src/api/observatory_disclaimer.py) — 6 endpoints: `/data-mode`, `/disclaimer`, `/consent` POST/GET/DELETE, `/synthetic-metadata` template
- **Middleware** in [main_with_rag_tuning.py](../haystack-stack/haystack-chatqna/src/main_with_rag_tuning.py) injecting `X-Data-Classification: SYNTHETIC` + `X-Real-Data: false` + `X-Environment: demonstration` + `X-Data-Disclaimer` on every `/api/v1/observatory/*` response
- Boot banner logged on every worker: `[OBSERVATORY MODE] SYNTHETIC -- All data is artificially generated...`

**Frontend (4 new components):**
- [ConsentGate.jsx](../components/frontend/src/admin/ConsentGate.jsx) — full-screen mandatory consent with dual checkboxes, server-side audit, sessionStorage persistence (re-accept every session)
- [SyntheticIndicators.jsx](../components/frontend/src/admin/SyntheticIndicators.jsx) — `<SyntheticBanner>` (sticky 36px amber, animated gradient), `<SyntheticFooter>`, `<SyntheticPill>`, `<WatermarkBackdrop>`, `.synthetic-watermark` CSS class
- [DisclaimerPage.jsx](../components/frontend/src/admin/DisclaimerPage.jsx) — full legal text at `#/disclaimer` + `useScreenshotReminder()` hook
- Wired into [AdminShell.jsx](../components/frontend/src/admin/AdminShell.jsx) (consent gate intercepts gov portal opening), [GovShell.jsx](../components/frontend/src/gov/GovShell.jsx) (banner/footer), [GovPortalModal.jsx](../components/frontend/src/admin/GovPortalModal.jsx) (banner on login), [AppRouter.jsx](../components/frontend/src/router/AppRouter.jsx) (#/disclaimer route)

**Naming convention:**
3 super-admin test accounts renamed with `-Demo` suffix and `@moh.example.gm` emails, all carry `is_synthetic: true` + `generated_by: amina_synthetic_seed` per the synthetic-data spec.

| Account | Phone | PIN | Staff ID |
|---|---|---|---|
| Dr. Lamin Touray-Demo (DG) | `+2207770001` | `1111` | `MOH-2024-0001` |
| Mariama Sanneh-Camara-Demo (PS) | `+2207770002` | `2222` | `MOH-2024-0002` |
| Ousman Jallow-Demo (ICT Director) | `+2207770003` | `3333` | `MOH-2024-0003` |

---

## Phase 1 — Docker resource limits (cascade-failure prevention)

**File:** [docker-compose.override.yml](../haystack-stack/docker-compose.override.yml)
**Type:** Compose config addition, no code

| Service | CPU limit | Memory limit | Rationale |
|---|---|---|---|
| voice-stt | **2.0 cores** | 2 GB | The proven offender — must be hard-capped |
| haystack-chatqna | 6.0 cores | 5 GB | The heavy hitter; 4 uvicorn workers + room |
| voice-tts (English) | 1.0 core | 1 GB | TTS spike protection |
| voice-tts-mnk | 1.0 core | 1 GB | Mandinka TTS spike protection |
| dataprep-worker | 2.0 cores | 2 GB | PDF ingestion can spike on large docs |
| arcadedb | 2.0 cores | 3 GB | Query spikes under load |

**Total:** 14 cores limit on a 16-core host. Limits arbitrate via the kernel scheduler (not pre-allocated), so containers can use slack from each other when idle.

**Verified outcome:** voice-stt CPU now strictly capped at 200% (2 cores). Even when bombarded, it cannot affect haystack-chatqna's responsiveness.

---

## Pre-existing bugs surfaced and fixed during this work

| Bug | Type | File | Fix |
|---|---|---|---|
| `/openapi.json` returns 500 | Pydantic 2.12 + FastAPI 0.129 ForwardRef regression | reranker_feedback.py (nested BaseModel inside function) | Moved models to module scope **+** [openapi_recovery.py](../haystack-stack/haystack-chatqna/src/services/openapi_recovery.py) defensive wrapper |
| Boot warning: `No module named 'src.repositories.protocol_repo'` | Missing module | repositories/ | Added [protocol_repo.py](../haystack-stack/haystack-chatqna/src/repositories/protocol_repo.py) shim with full ProtocolRepository |
| AdminShell infinite recursion on gov portal click | `replace_all` regex hit my own function body | [AdminShell.jsx:283-292](../components/frontend/src/admin/AdminShell.jsx#L283) | Restored proper `setGovPortalOpen(true)` calls |
| GovPortal open emergencies card not clickable | UX | [CommandCenter.jsx](../components/frontend/src/admin/sections/CommandCenter.jsx) | Wrapped in `role="button"` div, added urgent-state pulsing border, navigates to `#/admin/emergencies` |

---

## Files inventory

### New backend files (all additive)
```
haystack-stack/haystack-chatqna/src/
├── services/
│   ├── observatory_synthetic.py        Phase 4: governance core
│   ├── observatory_phone_security.py   Phone-auth (PIN hashing, sessions)
│   ├── stt_upload_guard.py             8 MB ASGI body-size cap (6 paths)
│   ├── stt_duration_guard.py           6-min WAV duration cap (compression-bomb defense)
│   └── openapi_recovery.py             /docs ForwardRef workaround
├── api/
│   ├── observatory_disclaimer.py       Phase 4: 6 endpoints
│   ├── observatory_phone_auth.py       Phone-auth: init + verify-otp + verify-pin
│   ├── observatory_auth.py             Staff-ID flow
│   └── observatory_admin.py            Staff CRUD
├── models/
│   ├── phone_auth.py                   3 super-admins + facility registry + PIN validator
│   └── gov_auth.py                     NIN/Staff-ID/Phone validators
└── repositories/
    └── protocol_repo.py                Pre-existing bug shim
```

### Edited backend files (one-shot, with explicit user OK)
```
haystack-stack/haystack-chatqna/src/
├── main_with_rag_tuning.py             Wired in all the above (additive sections only)
└── services/
    └── reranker_feedback.py            Moved 2 BaseModels to module scope (ForwardRef fix)
```

### New frontend files
```
components/frontend/src/admin/
├── ConsentGate.jsx                     Pre-login mandatory consent
├── SyntheticIndicators.jsx             Banner + footer + pill + watermark
└── DisclaimerPage.jsx                  Full legal text + screenshot reminder hook
```

### Edited frontend files
```
components/frontend/src/
├── App.jsx                             Mic recorder safety guards (Phase 5 frontend)
├── admin/
│   ├── AdminShell.jsx                  Wire consent gate before gov portal
│   ├── GovPortalModal.jsx              v4 redesign + banner integration
│   └── sections/CommandCenter.jsx      Clickable Open Emergencies card
├── gov/GovShell.jsx                    Banner + footer + screenshot hook
└── router/AppRouter.jsx                Added #/disclaimer route
```

### Configuration
```
haystack-stack/docker-compose.override.yml
├── deploy.resources.limits             Phase 1 CPU/memory caps on 6 services
├── volume mounts for new files         All additive new files mounted read-only
└── existing service config             Untouched
```

---

## Test results

| Suite | File | Assertions | Status |
|---|---|---|---|
| Phone-auth E2E | [_observatory_phone_test.py](../haystack-stack/haystack-chatqna/_observatory_phone_test.py) | 90 | ✅ 90/90 |
| Consent + governance E2E | [_observatory_consent_test.py](../haystack-stack/haystack-chatqna/_observatory_consent_test.py) | 68 | ✅ 68/68 |
| Auth validators sanity | [_observatory_auth_test.py](../haystack-stack/haystack-chatqna/_observatory_auth_test.py) | 72 | ✅ 72/72 |
| **Total** | | **230** | ✅ **230/230** |

---

## Performance after fixes

| Metric | Before | After | Change |
|---|---|---|---|
| voice-stt CPU under bomb | 400%+ pegged | 0% (rejected upstream) | structural fix |
| haystack-chatqna CPU under bomb | 525% pegged | 1.3% | strict cap + bomb rejection |
| LLM `/agent/chat-stream` | 15s timeout | 3.0 s | unstarved |
| LLM `/chat` warm | 10s+ | 1.4 s | unstarved |
| TTS English | 2.1 s | 1.6 s | unstarved |
| TTS Mandinka | 4.2 s | 4.0 s | unstarved |
| STT (legitimate 1.6 s WAV) | 30s timeout | 3.5 s | queue freed |
| Bombs reaching whisper | every 11 s | 0 | guard catches them |

---

## Pending phases (in priority order)

| Phase | Item | Impact | Effort | Status |
|---|---|---|---|---|
| **3** | **Redis-backed rate limiter** on `/agent/chat-stream`, `/agent/voice-chat*`, `/api/v1/stt` | Prevents abuse + OpenAI cost explosion | 30 min | Designed, not built |
| **4** | **Voice concurrency semaphore** (`asyncio.Semaphore(3)` per worker on the 6 audio paths) | Prevents queue buildup with 10+ simultaneous callers | 30 min | Designed, not built |

## Deferred (per user's earlier priority list)

| # | Item | Effort | When |
|---|---|---|---|
| 4 | ArcadeDB automated daily backup | 30 min | This week |
| 5 | OpenAI fallback chain (gpt-4o-mini → vLLM → cached emergency response) | 2 hours | This week |
| 6 | TranslationCorrector on streaming (Mandinka responses) | 1 hour | Before pilot |
| 8 | JWT RS256 (already supported via env vars; needs keypair deployment) | 2 hours | Before pilot |

---

## Architectural posture after fixes

**Defense-in-depth on the audio pipeline (4 layers):**
1. **Frontend** (`App.jsx`) — sliding window partial transcripts, in-flight guard, 5-min recording hard cap
2. **Network ingress** (`stt_upload_guard.py`) — ASGI middleware, 8 MB byte cap with chunked-aware streaming check on all 6 audio paths
3. **After decode** (`stt_duration_guard.py`) — ffprobe + WAV header inspection, 6-min duration cap before whisper sees the audio
4. **Resource isolation** (Phase 1) — voice-stt hard-capped at 2 cores so it cannot starve the rest of the host even under sustained attack

**Defense-in-depth on data governance (8 layers, from Phase 4):**
1. Mandatory consent gate (re-accept every session)
2. Server-side audit of every consent acceptance
3. `X-Data-Classification: SYNTHETIC` headers on every Observatory response
4. Sticky amber banner on every Observatory page
5. Bottom watermark footer
6. `is_synthetic: true` metadata on every seeded record
7. Production mode gated by HMAC-signed authorization file (queryable but inert today)
8. Synthetic naming convention (`-Demo` suffix on test accounts)

---

## Operational notes

**To verify the system is healthy:**
```bash
docker stats --no-stream                                              # voice-stt should be near 0% when idle
curl -s http://localhost:8000/health                                  # 200
curl -s -m 10 -X POST http://localhost:8000/api/v1/chat \
  -H "Content-Type: application/json" -d '{"query":"hi"}'             # ~1-2 s warm
curl -s http://localhost:8000/api/v1/observatory/data-mode            # mode: synthetic
docker logs haystack-chatqna 2>&1 | grep "stt_duration_guard"         # confirms bombs blocked
```

**To clear a phone rate-lock during testing:**
```bash
docker exec amina-redis redis-cli del \
  "obs_phone_lock:+2209999999" "obs_phone_rate:+2209999999" \
  "obs_phone_lockcount:+2209999999" "obs_phone_hardlock:+2209999999"
```

**To re-run the test suites:**
```bash
cd haystack-stack/haystack-chatqna
python _observatory_phone_test.py        # 90 assertions
python _observatory_consent_test.py      # 68 assertions
python _observatory_auth_test.py         # 72 assertions
```

---

*All changes follow the additive-only constraint where possible. The few one-shot edits to existing files (`reranker_feedback.py`, `App.jsx`, `AdminShell.jsx`, `GovShell.jsx`, `GovPortalModal.jsx`, `CommandCenter.jsx`, `AppRouter.jsx`, `main_with_rag_tuning.py`) were each explicitly OK'd at the time and are documented above.*
