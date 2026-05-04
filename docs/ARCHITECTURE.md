# ARCHITECTURE — AMINA

This document describes the components and data flow of AMINA as it exists in this working tree. Every container, port, file path, and Python module mentioned here was verified by `Test-Path` / `docker ps` / running the file at the time of writing. Components on the architectural roadmap that don't yet have shipping code are listed at the bottom under [Sprint backlog](#sprint-backlog) — they are deliberately **excluded** from the diagram so a reader can map every node back to a real file or container.

## 1. System diagram

```mermaid
flowchart TB

  subgraph CLIENT[Client]
    BROWSER["Browser (Vite dev server)<br/>localhost:5174"]
  end

  subgraph EDGE[Edge / Perimeter]
    GATEWAY["amina-gateway (FastAPI)<br/>:8443<br/>components/api-gateway/app/main.py"]
    GW_JB["jailbreak_detector.py<br/>20 patterns / 65 cases"]
    GW_JWT["jwt_auth.py<br/>JWT signing + scopes"]
    GW_SCHEMA["schema_validator.py"]
    GW_PHI["phi_redactor.py<br/>outbound + inbound"]
    GW_RATE["rate_limit.py<br/>(disabled in demo)"]
    GW_AUDIT["audit.py<br/>tamper-evident log"]
    GW_PROXY["proxy.py<br/>-> haystack-chatqna:8000"]
    GATEWAY --> GW_JB
    GATEWAY --> GW_JWT
    GATEWAY --> GW_SCHEMA
    GATEWAY --> GW_PHI
    GATEWAY --> GW_RATE
    GATEWAY --> GW_AUDIT
    GATEWAY --> GW_PROXY
  end

  subgraph BACKEND[Backend brain]
    HAYSTACK["haystack-chatqna (FastAPI, uvicorn workers=4)<br/>:8000<br/>haystack-stack/haystack-chatqna/src/main_with_rag_tuning.py"]
    AGENT["agent / agent_platform<br/>13 .py files in agent_platform"]
    ABUSE["abuse_defense/<br/>26 .py files; 105/105 eval cases"]
    SAFETY["safety/<br/>clinical-constitution prompt"]
    PIPELINES["pipelines/ + evidence_layer/<br/>RAG + citations"]
    TRANS["translation_v4/<br/>16 .py files; 8-stage pipeline"]
    HAYSTACK --> AGENT
    HAYSTACK --> ABUSE
    HAYSTACK --> SAFETY
    HAYSTACK --> PIPELINES
    HAYSTACK --> TRANS
  end

  subgraph VOICE[Voice (CPU-only)]
    STT["voice-stt (whisper.cpp)<br/>:8087  base.en (148 MB)"]
    TTS_EN["voice-tts (Piper)<br/>:5500  Lessac (63 MB)"]
    TTS_MNK["voice-tts-mnk (MMS)<br/>:5501  facebook/mms-tts-mnk"]
  end

  subgraph TRANSLATE[Translation sidecar]
    NLLB["nllb-translate (NLLB-200)<br/>:7860  ~7.6 GB image"]
  end

  subgraph DATA[Data]
    ARCADE["arcadedb<br/>:2480 (HTTP), :2424 (binary), :5433 (Postgres wire)<br/>KG + vector + TranslationMetric"]
    REDIS["amina-redis<br/>(internal redis:6379)<br/>working memory + abuse-defense state"]
    DATAPREP["dataprep-worker<br/>:8001<br/>ingest / docling / chunker"]
  end

  subgraph ANALYTICS[Analytics]
    SUPERSET["amina-superset<br/>:8080"]
  end

  BROWSER -->|public chat| GATEWAY
  BROWSER -->|legacy/agent| HAYSTACK
  HAYSTACK --> STT
  HAYSTACK --> TTS_EN
  HAYSTACK --> TTS_MNK
  HAYSTACK --> NLLB
  HAYSTACK --> ARCADE
  HAYSTACK --> REDIS
  DATAPREP --> ARCADE
  ARCADE --> SUPERSET
```

Every node above maps to a verified container or source path:

| Node | Verified by |
|---|---|
| Browser → Vite | `components/frontend/vite.config.js` (`port: 5174, strictPort: true`) |
| `amina-gateway` | `docker ps` shows container, `:8443/health` returns `{"status":"ok"}` |
| `jailbreak_detector.py` | `Test-Path components/api-gateway/app/jailbreak_detector.py` → True; `pattern_count() == 20` |
| `jwt_auth.py`, `schema_validator.py`, `phi_redactor.py`, `rate_limit.py`, `audit.py`, `proxy.py` | All present under `components/api-gateway/app/` |
| `haystack-chatqna` | `docker ps`; `:8000/health` returns 200 |
| `abuse_defense/` | 26 `.py` files; `python -m src.abuse_defense.eval.run_all` → 105/105 |
| `agent_platform/` | 13 `.py` files |
| `translation_v4/` | 16 `.py` files; 8 numbered stages (`stage1_simplifier.py` … `stage8_telemetry.py`) |
| `voice-stt`, `voice-tts`, `voice-tts-mnk` | All `(healthy)` in `docker ps` |
| `nllb-translate` | Container running; canary `GET /api/v4/translator?text=hello&source=eng_Latn&target=bam_Latn` returns text |
| `arcadedb` | Healthy; ports `2480`, `2424`, `5433` exposed |
| `amina-redis` | Healthy; internal-only as documented |
| `dataprep-worker` | Healthy on `:8001` |
| `amina-superset` | Healthy on `:8080` |

## 2. Safety architecture

There are **three** safety perimeters. They are intentionally layered — a single perimeter would be brittle, three independent ones means an attacker needs to defeat all three to get a harmful clinical answer out.

### Layer 1 — Gateway perimeter (`amina-gateway`, `:8443`)

The first line of defence. Stateless pattern matching, runs **before** any LLM call.

| Sub-layer | File | What it blocks |
|---|---|---|
| Schema validation | `app/schema_validator.py` | malformed/oversized payloads (10 KB cap on `/chat`, 50 KB on `/translate`) |
| Jailbreak detector | `app/jailbreak_detector.py` | 20 patterns: ignore_previous, system_prompt_leak, new_instructions, secret_instructions_leak, dan_jailbreak, role_play_pretend, evil_twin, prescribe_specific_drug, diagnose_demand, override_safety, patient_data_exfil, base64_payload, rot13_marker, hex_payload, unicode_smuggling, hypothetical_for_real, harmful_intent_direct, sql_injection, nosql_injection, path_traversal |
| JWT auth + scopes | `app/jwt_auth.py`, `app/scopes.py` | unauthenticated callers, scope-mismatch |
| Inbound PHI rejection | `app/phi_redactor.py` | obvious patient identifiers in *inbound* free text (clinicians should be using the structured fields) |
| Outbound PHI redaction | `app/phi_redactor.py` | accidental PHI leakage in LLM responses |
| Audit log | `app/audit.py` | tamper-evident chain of every public-API request |

Tested by `components/api-gateway/tests/test_jailbreak_detector.py` (65 cases, all passing) and `components/api-gateway/tests/test_phi_redactor.py`, `components/api-gateway/tests/test_rate_limit.py`.

### Layer 2 — In-process abuse defense (`haystack-chatqna`, `src/abuse_defense/`)

Stateful, per-user, runs at the agent boundary. Designed to handle abusive *behaviour* (not just abusive *strings*) — the gateway can't tell whether a benign-looking request is the third in a coordinated abuse cycle.

| Phase | File | Role |
|---|---|---|
| A — classifier | `classifier.py` + `wordlists/` | classify each turn into CLEAN / WARN / DISTRESS / EMERGENCY |
| B — shadow log | `shadow.py` + `audit.py` | non-blocking telemetry mode |
| C — warn ladder | `responses.py`, `defender.py` | WARN1 → WARN2 (3 abuses per cycle, revised 2026-05-05 — was 4) |
| D — enforce + cooldown | `cooldown.py`, `state.py` | session_terminate → 30 min → 24 h → 7 d (`AMINA_ABUSE_COOLDOWN_FIRST/SECOND/THIRD`) |
| E — admin reports | `admin_api.py`, `admin_flag.py` | auto-flag at lifetime threshold (`AMINA_ABUSE_ADMIN_FLAG_THRESHOLD=3`) |
| F — Mandinka | `responses_mn.py` | localised warning copy |
| G — semantic | `semantic.py` | embedding-similarity backstop for paraphrased abuse |

State is stored in Redis (under `chatqna_default` network as `redis:6379`) so all 4 uvicorn workers share one view. Eval suite (`src/abuse_defense/eval/run_all.py`) runs 8 phases — verified at 105/105 by running it now.

### Layer 3 — Agent + clinical-constitution prompt (`src/agent/`, `src/safety/`)

Last-mile semantic check. Even if a request reaches the LLM, the system prompt forbids:

- Prescribing a specific drug + dose ("AMINA must never prescribe").
- Definitive diagnosis without a clinician in the loop.
- Acting on instructions from the user that contradict the system prompt.

The agent platform (`src/agent_platform/`) exposes tool calls (read-only assist mode in `assist`, write-mode in `enforce`). Phase 3+ adds safety tests for the agent surface itself — see `_agent_platform_phase3_safety_test.py` at the repo root.

## 3. Data flow trace — one chat turn

This is what happens when the demo user types "What is hypertension?" and presses Enter:

1. **Frontend** (`components/frontend/`) sends `POST http://localhost:8000/api/v1/agent/chat` with the message + the session JWT (`JWT_SECRET` from `.env`).
   In gateway-mediated mode, the same call goes to `:8443/api/v1/public/chat` and the gateway forwards to `:8000`.
2. **Gateway** (if `:8443` path) walks the perimeter:
   - schema validator caps body at 10 KB.
   - JWT auth verifies signature + scope.
   - PHI redactor rejects inbound free-text patient identifiers.
   - jailbreak detector scans for any of 20 patterns. **No match → continue. Match → return `400 input_rejected` and never call the backend.**
   - Audit log appends one tamper-evident record.
3. **Backend** (`haystack-chatqna`) receives the call.
   - Abuse-defense classifier runs (`src/abuse_defense/classifier.py`). Result CLEAN → continue.
   - Working-memory lookup in Redis (`amina-redis`).
   - Knowledge-graph + vector retrieval in ArcadeDB (`arcadedb` on `:2480`). Citations are gathered for the evidence layer (`src/evidence_layer/`).
   - If the query needs translation (Mandinka path), `src/translation_v4/pipeline.py` orchestrates 8 stages: simplifier → multi_engine (NLLB or LLM) → bambara_adapter → back_translator → quality_scorer → clinical_gate → sentence_router → telemetry. NLLB is invoked over HTTP at `nllb-translate:7860`.
   - Agent platform (`src/agent_platform/`) runs the LLM call with the clinical-constitution prompt + retrieved evidence + user message.
   - Response is post-processed: PHI scrub, citation insertion, literacy mode adaptation.
4. **Voice path** (when applicable): the response is sent to `voice-tts:5500` (English) or `voice-tts-mnk:5500` (Mandinka). Audio is streamed back as OGG.
5. **Telemetry**: a `TranslationMetric` row is written to ArcadeDB. Abuse-defense audit records (if any) are appended to a tamper-evident log.
6. **Frontend** renders the response. If the abuse-defense layer triggered `session_terminate`, the chat history stays visible, the input is disabled, and a red banner appears with a "New Conversation" button.

## 4. Component details

| Component | Source | Container | Port(s) | Notes |
|---|---|---|---|---|
| Frontend | `components/frontend/` | host (vite dev) | 5174 | React 19 + Vite 5; `strictPort: true` |
| API Gateway | `components/api-gateway/` | `amina-gateway` | 8443 | FastAPI; reports phase `0+1+2a+3+4` at `/api/v1/public/security/status` |
| Backend brain | `haystack-stack/haystack-chatqna/` | `haystack-chatqna` | 8000 | uvicorn workers=4; entry `src.main_with_rag_tuning:app` (override) |
| Abuse defense | `haystack-stack/haystack-chatqna/src/abuse_defense/` | (inside `haystack-chatqna`) | n/a | Redis-backed state; 105/105 cases |
| Translation v4 | `haystack-stack/haystack-chatqna/src/translation_v4/` | (inside `haystack-chatqna`) | n/a | 8 stages; calls NLLB sidecar |
| NLLB sidecar | `haystack-stack/docker-compose.nllb.yml` | `nllb-translate` | 7860 | image `ghcr.io/winstxnhdw/nllb-api:main`; ~7.6 GB |
| Whisper STT | `haystack-stack/docker-compose.yml` | `voice-stt` | 8087 | image `ghcr.io/ggml-org/whisper.cpp:main`; base.en model bind-mounted |
| Piper TTS (EN) | `haystack-stack/tts-service/` | `voice-tts` | 5500 | Lessac medium ONNX bind-mounted |
| MMS TTS (Mandinka) | `haystack-stack/tts-mms-service/` | `voice-tts-mnk` | 5501 (-> 5500) | facebook/mms-tts-mnk; CPU=4 threads (override) |
| ArcadeDB | upstream `arcadedata/arcadedb:latest` | `arcadedb` | 2480 / 2424 / 5433 | Postgres-wire on 5433 for Superset |
| Redis | upstream `redis:7-alpine` | `amina-redis` | (internal 6379) | working memory + abuse-defense state |
| Dataprep worker | `haystack-stack/haystack-dataprep/` | `dataprep-worker` | 8001 (-> 8000) | docling + chunker + ingester |
| Superset | `components/apache-superset/` | `amina-superset` | 8080 (-> 8088) | analytics; bind-mounted init script |
| Telegram webhook watcher | `components/multichannel-access/` | `telegram-webhook-watcher` | (internal) | disabled in demo (`TELEGRAM_BOT_TOKEN=disabled`) |
| Cloudflare quick-tunnel | (operator-supplied) | `amina-cf-quick-tunnel` | (none host) | optional public-tunnel front-door for demo |

## 5. Compose file overlays

The stack is composed with a base `docker-compose.yml` and several optional overlays. `start.ps1` layers each one only if the file exists; if you skip an overlay, the corresponding services don't start and the rest degrades gracefully.

| File | Purpose | Adds |
|---|---|---|
| `docker-compose.yml` | Base | arcadedb, redis, voice-stt, voice-tts, voice-tts-mnk, dataprep-worker, haystack-chatqna, superset |
| `docker-compose.demo.yml` | Demo overlay | sets `DEMO_MODE=true`, tightens healthchecks |
| `docker-compose.nllb.yml` | Translation v4.2 | nllb-translate sidecar |
| `docker-compose.gateway.yml` | API gateway | amina-gateway on `:8443` |
| `docker-compose.override.yml` | Resource caps + voice tuning | CPU/memory limits, Whisper threads=6 |
| `docker-compose.meta-channels.yml` | Multichannel | Messenger / WhatsApp env vars (no new container — applied to `haystack-chatqna`) |
| `docker-compose.dhis2-history.yml`, `docker-compose.gap-closers.yml`, `docker-compose.inbox.yml`, `docker-compose.oauth.yml`, `docker-compose.resilience.yml` | Feature overlays | listed in `haystack-stack/`; not auto-layered by `start.ps1` |

`start.ps1` automatically layers `docker-compose.yml`, `docker-compose.demo.yml` (when `.env` was just bootstrapped from defaults), `docker-compose.override.yml`, `docker-compose.meta-channels.yml`, `docker-compose.nllb.yml`, and `docker-compose.gateway.yml`.

## Sprint backlog

These appear in the safety status response with `false` — they are roadmap, not production-shipped, and are deliberately **omitted from the diagram above** so a reader can verify every drawn node:

- `L1_input_classifier` (statistical input classifier in front of the regex perimeter)
- `L2_clinical_constitution` (separate constitutional pass before the LLM call)
- `L2_adaptive_rate_limit` (the engine ships, but `AMINA_GATEWAY_RATE_LIMIT_ENABLED=false` for demo)
- `L3_mtls_client_cert` (mTLS at the gateway)
- `L3_faiss_sbert_similarity` (semantic similarity backstop on user intents)
- `L6_multi_turn_escalation` (cross-turn jailbreak escalation detector)

The honest disclosure is in the `_disclaimer` field of `/api/v1/public/security/status`:

> "Phase 0+1+2a+3 implementation. Pattern-based input filtering, JWT auth, PHI redaction, audit log. Multi-turn escalation, ML-based detection, and mTLS are sprint backlog."
