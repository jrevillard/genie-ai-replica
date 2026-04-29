# Step 3 — v2 Text Translation Path (no RAG yet)

**Date:** 2026-04-20
**Result:** 167/167 tests passing in 1.46s (Step 1: 50 + Step 2: 51 + Step 3: 66).

## What changed

Additive only. One v2 file (flags.py) gained two new flags; one v2 stub (router.py) was replaced with a real implementation; three v2 provider stubs were replaced with real implementations. **No existing code outside `translation_v2/` was edited**, including `main.py`, `agent_routes.py`, `translator.py`, `docker-compose.*`, `requirements.txt`, or any `.env` file.

### Production files

| File | Status | Role |
|---|---|---|
| `flags.py` | Edited (v2, mine) | Added `USE_V2_PII_LOCAL_ROUTING` and `V2_SHADOW_PERCENT`; changed default `V2_FALLBACK_PROVIDER` from `gemma` to `nllb` (Gemma not yet GPU-confirmed for the Gambia deployment). |
| `prompts.py` | New | `build_system_prompt`, `build_batch_user_prompt`; keeps clinical "do not translate" rules explicit. |
| `providers/_openai_compatible.py` | New | Shared `OpenAICompatibleProvider` base: translate, translate_batch, quote stripping, numbered-line batch parsing, system-prompt injection. |
| `providers/openai.py` | Rewritten from stub | `OpenAIProvider(OpenAICompatibleProvider)`; `from_env()` classmethod reads `settings.OPENAI_*` the same way legacy does. |
| `providers/gemma.py` | Rewritten from stub | `GemmaProvider(OpenAICompatibleProvider)`; `from_env()` reads `GEMMA_*` env vars. |
| `providers/nllb.py` | Rewritten from stub | HTTP-based provider (httpx) against a separate container. Maps `en`/`ma`/`mnk` → NLLB's `eng_Latn`/`mnk_Latn` codes. |
| `router.py` | Rewritten from stub | Full decision tree: TM hit / header override / PII-local gate / primary / fallback / shadow mode / TM write-back. |
| `api/__init__.py` | New | |
| `api/schemas.py` | New | `TranslateRequest`, `TranslateResponse`, `HealthResponse` (pydantic v2). |
| `api/bootstrap.py` | New | Router singleton construction; `set_v2_router_for_testing` hook. |
| `api/routes.py` | New | `POST /agent/translate`, `GET /agent/translate/health`. |
| `main_with_translation_v2.py` | New (in `haystack-chatqna/src/`) | Matches the existing `main_with_*.py` pattern. Just `from src.main import app` + `include_router(v2_router, prefix="/api/v2")`. Zero edits to `main.py`. |

### Tests (66 new)

| File | Tests | Scope |
|---|---|---|
| `test_prompts.py` | 10 | system prompt composition, glossary injection, batch prompt format |
| `test_provider_openai_compat.py` | 14 | translate / translate_batch / quote stripping / system-prompt injection / error propagation / concrete names |
| `test_provider_nllb.py` | 13 | httpx MockTransport: lang code mapping, single/batch, HTTP error, length-mismatch fallback |
| `test_router.py` | 19 | every decision branch: primary, header override, PII routing (including no-cloud-fallback guarantee on PII-local failure), fallback, shadow mode (fire-and-forget, no result impact, failure swallowed), TM hit/write-back |
| `test_api_routes.py` | 10 | FastAPI TestClient: 503 disabled / 200 enabled / header bypass / schema validation / `X-V2-Provider` override / 502 provider failure / health endpoint |

## Activation

### Defaults (no env vars set, no code change)

- Legacy v1 endpoints unchanged.
- v2 endpoint at `/api/v2/agent/translate` responds **503** with an instruction message.
- `GET /api/v2/agent/translate/health` is always available and safe to call (shows flags + bootstrap errors if any).

### Per-request (no deployment change)

```
curl -X POST https://<host>/api/v2/agent/translate \
  -H 'Content-Type: application/json' \
  -H 'X-Translation-Pipeline: v2' \
  -H 'X-V2-Provider: nllb' \
  -d '{"text":"How are you feeling today?","source":"en","target":"ma"}'
```

`X-Translation-Pipeline: v2` bypasses the global flag for that single request. `X-V2-Provider: <openai|gemma|nllb>` forces a specific provider for that single request.

### Env-gated rollout

```
USE_V2_TRANSLATION_PIPELINE=true    # enable /api/v2/agent/translate globally
V2_PRIMARY_PROVIDER=openai          # openai (default) | gemma | nllb
V2_FALLBACK_PROVIDER=nllb           # set to "" (or same as primary) to disable fallback
USE_V2_TM_CACHE=true                # v2 TM in front of providers
USE_V2_PII_LOCAL_ROUTING=true       # PII → NLLB force-route
V2_SHADOW_PERCENT=10                # 0..100 — shadow-compare sample rate
```

### Deployment

Override the uvicorn entry point to mount the v2 router:

```yaml
command: uvicorn src.main_with_translation_v2:app --host 0.0.0.0 --port 8000 --workers 4
```

This is a docker-compose command override; the checked-in compose files are not edited.

## Decisions locked in

1. **Default fallback changed from Gemma to NLLB** (flags.py). Rationale: Gemma requires a GPU we haven't confirmed is available in Gambia (Q6). NLLB can run on CPU in a pinch. Gemma stays fully-wired — set `V2_PRIMARY_PROVIDER=gemma` or `V2_FALLBACK_PROVIDER=gemma` when the GPU is confirmed.

2. **PII gate does not fall back to cloud on local-provider failure.** This is a hard privacy guarantee, tested by `TestPIIRouting.test_pii_route_does_not_fall_back_to_cloud_on_failure`. If `USE_V2_PII_LOCAL_ROUTING=true` and NLLB is down, the request fails rather than silently leaking PII to OpenAI.

3. **Shadow mode is fire-and-forget.** Primary result is returned immediately; fallback runs in the background via `asyncio.create_task`. Mismatches are logged via `observability.log_event`, never returned. Shadow failures are caught and logged, never raised.

4. **Router is not a `TranslationProvider`.** It's a higher-level coordinator. Batch translation is not wired in Step 3 (brief: "simple chat translation case only"). The legacy batch path is still the only batch-capable path. Batch joins the v2 router in Step 5.

5. **Bootstrap lazy-loads providers.** `bootstrap.py` catches per-provider construction exceptions and continues. A missing `OPENAI_API_KEY` means OpenAI isn't registered, but Gemma and NLLB still work. `/health` surfaces bootstrap errors so operators don't need to dig through logs.

6. **v2 TM is router-level now, not adapter-level.** The adapter-level TM wiring from Step 2 still works for legacy routes; the router uses its own TM with namespace `router_v2` (distinct from the adapter's `legacy`). No cross-contamination, and roles are clear.

## Open questions status

From the inventory's § 9:

| Q | Status |
|---|---|
| Q5 TTS failure UX | Default decided: keep strict mode. TTS is Step 4+ scope — no code changes in Step 3. |
| Q6 Gambia GPU for Gemma | Default decided: build Gemma fully, keep it non-default. User flips `V2_PRIMARY_PROVIDER=gemma` when GPU is confirmed. |
| Q9 PII policy | Partial: detect-only + optional PII-local routing via `USE_V2_PII_LOCAL_ROUTING`. Masking still deferred — not required now that local routing is available. |
| Q1 Mobile Mandinka | Still deferred — Step 6 cutover scope |
| Q2 Wolof / Fula / Jola | Still deferred — Step 6+ scope |
| Q3 Native Mandinka NLP | Still deferred — not needed for Step 3–5 |
| Q4 Detection validation set | Still open — infra is ready, blocker is Gambian labelers |
| Q7 Cache namespacing | Resolved in Step 2 (`v2:tm:*` for adapter, `router_v2` provider key for router). |
| Q8 Batch cap | Still open; the frontend autoTranslator batch cap is not touched in Step 3 |
| Q10 Frontend translate-failure retry | Still open — frontend work, not in Step 3 |
| Q11 `/v2/*` URL shape | Resolved: `/api/v2/agent/*` — matches existing `/api/v1/agent/*` pattern |
| Q12 Legacy Express-backend translation envs | Still look unused; no action in Step 3 |

## Rollback

**Zero-effort rollback:** revert the uvicorn command to `src.main:app` (or any of the other `main_with_*.py` entry points). The v2 router stops being mounted. Legacy v1 continues unchanged.

**File-level rollback:**
```bash
rm -rf haystack-chatqna/src/translation_v2/api/
rm -rf haystack-chatqna/src/translation_v2/providers/_openai_compatible.py
rm haystack-chatqna/src/translation_v2/prompts.py
rm haystack-chatqna/src/main_with_translation_v2.py
rm haystack-chatqna/src/translation_v2/tests/test_prompts.py \
   haystack-chatqna/src/translation_v2/tests/test_provider_*.py \
   haystack-chatqna/src/translation_v2/tests/test_router.py \
   haystack-chatqna/src/translation_v2/tests/test_api_routes.py
# Revert providers/{openai,gemma,nllb}.py to their Step 0 NotImplementedError stubs.
# Revert router.py to its Step 0 NotImplementedError stub.
# Revert flags.py: remove USE_V2_PII_LOCAL_ROUTING and V2_SHADOW_PERCENT;
#   restore V2_FALLBACK_PROVIDER default to "gemma" if desired.
```

## Production impact if deployed today

- `src.main:app` → zero change. Legacy is the only live path.
- `src.main_with_translation_v2:app` with no env vars set → `/api/v2/agent/translate` returns 503. Legacy still untouched.
- `src.main_with_translation_v2:app` + `USE_V2_TRANSLATION_PIPELINE=true` → v2 endpoint available. Legacy `/api/v1/agent/translate` still untouched. v1 traffic still goes through legacy.

At no point does Step 3 cause v1 callers to start hitting v2 code. That cutover is Step 6.

## Running tests

```bash
cd haystack-chatqna/src/translation_v2
../../../.venv/Scripts/python.exe -m pytest tests/
```

Expected: `167 passed in ~1.5s`.

## Next step

**Step 4 — PDF Ingest + Retrieval (no generation yet).**

- `rag/ingest.py` — native-text vs scanned PDF detection, layout-aware chunking, embedding, vector storage.
- `rag/retrieve.py` — hybrid BM25 + dense + RRF + rerank.
- CLI entry points for manual validation: `python -m translation_v2.rag.ingest <pdf>`, `python -m translation_v2.rag.query <question>`.
- Not wired to any user-facing endpoint.
- Fixture PDFs (native, scanned, table-heavy) for tests.

Requires explicit "proceed" ack.

### Pre-requisites the tech lead should sort before Step 4

- **NLLB container** deployment (the one this step wires but doesn't deploy). Can be done in parallel; not blocking Step 4 itself.
- **PDF corpus** — at least 2-3 representative documents (clinical, bilingual, Gambia-specific) for fixtures. If these don't exist, I'll synthesize them.
- **Embedding model choice confirmation** — `BGE-M3` or `multilingual-e5-large` are the two real options for mnk-aware retrieval. Current legacy uses `tei` at port 80 (unspecified model). I'll verify at Step 4 start.
