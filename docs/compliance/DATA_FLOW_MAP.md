# AMINA — Data Flow Map

**Audience:** clinical reviewer, ministry liaison, security reviewer.
**Purpose:** show every place a piece of user data lands, who can access it, and which trust boundary it crosses.

---

## 1. Channels (intake)

| Channel | Inbound code | Trust boundary |
|---|---|---|
| Web chat (browser → uvicorn on `:8000`) | `src/api/agent_routes.py::POST /chat` | Browser ↔ AMINA server |
| Voice (web mic → `:8000` → whisper.cpp on `:8087`) | `src/api/agent_routes.py::POST /voice-chat`, `voice-stt` container | Browser ↔ AMINA server ↔ STT container |
| Telegram | `telegram-webhook-watcher` container | Telegram cloud ↔ tunnel ↔ AMINA server |
| Meta WhatsApp + Messenger | `src/api/meta_routes.py` | Meta cloud ↔ AMINA server |
| Twilio WhatsApp Sandbox / SMS | `src/api/twilio_whatsapp_routes.py` | Twilio cloud ↔ AMINA server |
| Caregiver / clinician portal (web) | React frontend → `/api/v1/agent/*` | Browser ↔ AMINA server |
| Admin observatory | `src/api/observatory_*.py` (separate auth surface) | Authenticated admin ↔ AMINA server |

## 2. Data classes (what flows)

| Class | Sensitivity | Where it appears |
|---|---|---|
| **User message text** | High (free-form, may contain PHI) | inbound channel → AminaAgent → policy stack → LLM provider → outbound channel |
| **Voice audio** | High | inbound mic → STT container → text; raw audio deleted after STT (see retention) |
| **Session id** | Medium (correlation key, not identity) | every layer; surfaces in traces only as `session_hash` (sha256[:10]) |
| **Phone / channel id** | High | channel routes only; never emitted to LLM provider; redacted before it reaches AGENT_TRACE |
| **Patient profile** (name, age, conditions, meds, region) | High | ArcadeDB; reachable only with valid auth + same-patient binding |
| **Vitals (BP, glucose, weight)** | High | ArcadeDB; same access controls as profile |
| **Care plan, consultation record** | High | ArcadeDB; same access controls |
| **Trace metadata** (`AGENT_TRACE` + evidence layer) | Low (PHI-redacted by construction) | stdlib logger → container stdout → host log |
| **Eval reports** | Low (synthetic only) | `haystack-stack/evidence_reports/` (gitignored) |
| **OTP code** | Critical (short-lived secret) | Redis with TTL ≤ 10 min; never logged |
| **Auth session token** | Critical | HTTP `Authorization: Bearer ...`; never logged |

## 3. Storage map

| Store | Container | Path / volume | What lives here | Backup? |
|---|---|---|---|---|
| **Redis** (`amina-redis`) | redis | `data/redis` (bind) | session cache, OTP, conversation state, dialogue snapshots | per pilot operator |
| **ArcadeDB** | arcadedb | `data/arcadedb/genie/` (bind) | patient profiles, vitals, care plans, consultation records, consent audit edges, training-consent edges, DHIS2 audit edges, intent classification logs | per pilot operator |
| **Local FS — evidence** | haystack-chatqna | `evidence_reports/` (bind, gitignored) | per-turn JSONL traces + markdown reports (PHI-redacted by construction) | NO — opt-in eval artefacts only |
| **Local FS — scribe audio** | haystack-chatqna | `scribe_audio/` (bind, gitignored) | short-lived WebM audio captures | NO — meant to expire |
| **Local FS — inbox files** | haystack-chatqna | `inbox_files/` (bind, gitignored) | signed-URL-backed PDFs etc. | NO — TTL-bounded |
| **Local FS — education certs** | haystack-chatqna | `education_certs/` (bind, gitignored) | uploaded literacy certificates | per pilot |
| **Local FS — caregiver uploads** | haystack-chatqna | `caregiver_uploads/` (bind, gitignored) | caregiver-side files | per pilot |
| **Container stdout / host log** | haystack-chatqna | `docker logs` | redacted application logs incl. AGENT_TRACE lines | depends on host log driver |

## 4. Provider / processor inventory

| Processor | What they receive | What they return | Subject to |
|---|---|---|---|
| **OpenAI** | redacted user message + tool schemas (15 read-only tools) | text + native tool calls | OpenAI's data-processing addendum + their published retention/usage policy |
| **Groq** | redacted user message | text | Groq DPA + retention policy |
| **Google Gemini** | redacted user message | text | Google AI ToS + DPA |
| **Mistral** (cloud) | redacted user message | text | Mistral DPA |
| **AMINA Mistral (vLLM)** | redacted user message | text | self-hosted; no third-party processor |
| **whisper.cpp (local)** | audio → text | text | local; no third-party processor |
| **Piper TTS (local)** | text → audio | audio | local |
| **Meta** (WhatsApp/Messenger) | message body | webhook | Meta DPA |
| **Twilio** | SMS / WhatsApp body | webhook | Twilio DPA |
| **Telegram** | message body | webhook | Telegram ToS |
| **DHIS2** | aggregated, de-identified events | ack | National HMIS terms |
| **FHIR (SMART) endpoint** | structured FHIR resources for tracker push | ack | Per-deployment endpoint terms |
| **Cloudflare quick tunnel** | TLS terminator for inbound webhooks | passthrough | Cloudflare ToS |

## 5. PHI minimisation pipeline

```
inbound channel
    ↓
src/services/phi_deid.py    ← strips obvious PHI markers from anything
    ↓                          forwarded to LLM providers / log lines
AminaAgent.process_message
    ↓
src/services/safety_consensus.py + safety_contract.py
    ↓
LLM provider (sees redacted message + tool schemas only)
    ↓
src/services/safety_consensus_patch.py (post-generation safety pass)
    ↓
outbound channel (full text returned to the same user only)
```

Trace lines emitted by `agent_platform/tracing.py` go through `AgentTrace.to_safe_dict()` which has been red-team-tested to never surface raw message, phone, patient_id, session_id, authorization, or api_key. See [AGENT_PLATFORM_PHASE3_ROLLOUT_AND_EVALS.md](../AGENT_PLATFORM_PHASE3_ROLLOUT_AND_EVALS.md) §2.

## 6. Trust boundaries

A trust boundary is any place where data crosses an authority change:

1. **Browser ↔ AMINA server** — TLS in front (operator must enforce — current dev setup uses Cloudflare quick tunnel; production must use a managed cert).
2. **AMINA server ↔ LLM provider** — outbound TLS to the provider's API. No PHI raw fields per §5.
3. **AMINA server ↔ DHIS2** — only de-identified, aggregated events.
4. **AMINA server ↔ channel cloud** (Meta / Twilio / Telegram) — TLS, webhook signature verification (must be enabled with `*_VALIDATE_SIGNATURE=true`).
5. **AMINA server ↔ caregiver/clinician portal** — same auth model as patient web, plus role-based admin route gating (`observatory_admin.py`).
6. **AMINA server ↔ admin observatory** — separate auth surface (`observatory_auth.py` / `observatory_phone_auth.py`); admin reads should NOT touch live PHI without an audit edge.

## 7. Cross-cuts

- **Logs** — must pass through `phi_deid` before `print()` / `logger.*` calls in any new code. Existing log lines audited at PHI-deid v1; future audit needed.
- **Backups** — see [RETENTION_POLICY.md](RETENTION_POLICY.md). Backups inherit the same retention class as source.
- **Tests + evals** — synthetic data only, scoped under `_agent_platform_*_test.py` files and the evidence layer.

## 8. Linked controls

- PRIV-001 .. PRIV-008 in [COMPLIANCE_CONTROL_MATRIX.md](COMPLIANCE_CONTROL_MATRIX.md).
