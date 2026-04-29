# Activating the v2 Translation Pipeline for the AMINA UI

The UI has five translate call sites across three components. All of them hit one of two URLs:

| Call site | URL |
|---|---|
| Top English/Mandinka toggle (autoTranslator) | `/api/v1/agent/translate/batch` |
| `useT` React hook | `/api/v1/agent/translate/batch` |
| Per-message "Mandinka" button (BeginnerChat) | `/api/v1/agent/translate` |
| Per-message button (App classic shell) | `/api/v1/agent/translate` |
| App.jsx bulk translate | `/api/v1/agent/translate/batch` |

The backend's `V1ToV2CompatMiddleware` intercepts both URLs **when** one of three activation methods below is live.

---

## Method (a) — Global backend flag (recommended for staging/prod)

**Effect:** every v1 translate call from every user flows through v2.

Deploy with the v2 entry point and set the env var:

```yaml
# docker-compose override (no edit to checked-in files)
services:
  haystack-chatqna:
    command: uvicorn src.main_with_translation_v2:app --host 0.0.0.0 --port 8000 --workers 4
    environment:
      USE_V2_FOR_V1_ENDPOINTS: "true"        # public v1 translate URLs
      USE_V2_FOR_LEGACY_TRANSLATOR: "true"   # internal callers of translator.translate()
      V2_PRIMARY_PROVIDER: "openai"
      V2_FALLBACK_PROVIDER: "nllb"
      # Optional:
      USE_V2_TM_CACHE: "true"
      USE_V2_PII_LOCAL_ROUTING: "true"
      V2_SHADOW_PERCENT: "10"
```

**`USE_V2_FOR_V1_ENDPOINTS` vs `USE_V2_FOR_LEGACY_TRANSLATOR`:**
- **`USE_V2_FOR_V1_ENDPOINTS`** covers the public HTTP routes `/api/v1/agent/translate` and `/translate/batch`. Hits the per-message "Mandinka" button and the top language toggle.
- **`USE_V2_FOR_LEGACY_TRANSLATOR`** covers **internal callers** of the legacy `translator.translate()` singleton — e.g. `/api/v1/agent/chat` translating its own response when `language="ma"`, and `/prescription` analysis output. Implemented via `legacy_shim.py`, which monkey-patches `get_translator()` and falls back to legacy on any v2 error (chat never breaks from a v2 regression).

To fully move a deployment onto v2, **both** flags should be true.

**Verify it's live:**

```bash
curl -s http://<host>/api/v2/agent/metrics | grep v2_translate_total
```

Increments on every translate request, whether the user clicked the top toggle or a per-message "Mandinka" button. If the counter doesn't move, the middleware isn't installed (wrong entry point) or the flag isn't true.

**Rollback:** `USE_V2_FOR_V1_ENDPOINTS=false` and restart. All v1 calls revert to the legacy translator. No frontend change needed.

---

## Method (b) — Per-user client-side opt-in (recommended for dev/QA)

**Effect:** one user on one tab uses v2 without affecting everyone else. Useful for side-by-side dev comparison and for early QA before the global flag flips.

**How it works:** the additive module [`components/frontend/src/i18n/v2_optin.js`](../../../components/frontend/src/i18n/v2_optin.js) monkey-patches `window.fetch` to inject `X-Translation-Pipeline: v2` on calls to the two translate endpoints, gated on a `localStorage` key.

**Loaded automatically** via one side-effect import in `main.jsx` (same pattern as `ConsentBootstrap.jsx`, `LiteracyBootstrap.jsx`).

**Enable for this tab (DevTools console):**
```js
window.__aminaUseV2(true)   // enable
window.__aminaUseV2(false)  // disable
window.__aminaUseV2()       // query current state
```

The setting persists via `localStorage` across page reloads in the same browser profile. Clear it with:
```js
localStorage.removeItem("amina_use_v2")
```

**Backend requirement:** the backend must still be running `src.main_with_translation_v2:app` so the middleware is installed. The global flag `USE_V2_FOR_V1_ENDPOINTS` does **not** need to be true — the header alone is enough.

**Scope:** only the tab that ran `__aminaUseV2(true)`. Every other user sees legacy behaviour.

---

## Method (c) — One-off header injection (debugging a single request)

**Effect:** exactly one request goes through v2. Useful for reproducing a bug, comparing a single response, or exercising the path from curl.

**In DevTools → Network:** right-click a translate request → **Replay with headers** → add `X-Translation-Pipeline: v2` → confirm. Response shape is identical either way; compare the actual text.

**From curl:**
```bash
curl -X POST http://<host>/api/v1/agent/translate \
  -H 'Content-Type: application/json' \
  -H 'X-Translation-Pipeline: v2' \
  -d '{"text":"I have a headache","source":"en","target":"ma"}'
```

**Bookmarklet to toggle Method (b)** (drag to bookmark bar):
```javascript
javascript:(function(){var v=(window.__aminaUseV2&&window.__aminaUseV2())?false:true;if(window.__aminaUseV2){window.__aminaUseV2(v);alert('AMINA v2 translation: '+(v?'ON':'OFF'));}else{alert('v2_optin.js not loaded on this page');}})();
```

---

## Which method to use when

| Situation | Method |
|---|---|
| Production rollout | (a) Global flag + RUNBOOK canary |
| Staging validation across all users | (a) Global flag in staging env |
| One dev / one QA / one tab | (b) localStorage toggle |
| A/B-ing a specific request | (c) DevTools replay |
| Scripted comparison in curl / pytest / Postman | (c) header injection |

All three methods route through the same v2 Router and produce **byte-identical v1-shaped responses**, so the UI renders the translation exactly the same way whether legacy or v2 generated it. To see *which* pipeline served a request, check `/api/v2/agent/metrics` — v2 increments `v2_translate_total`, legacy doesn't touch any v2 counter.

---

---

## Switching to Gemma (instead of OpenAI)

**One env var flip.** No code change needed — Gemma was wired in Step 3.

```yaml
environment:
  V2_PRIMARY_PROVIDER: "gemma"
  V2_FALLBACK_PROVIDER: "openai"    # or "nllb"
  GEMMA_BASE_URL: "http://vllm-translation-guardrail:9031/v1"
  GEMMA_MODEL: "google/gemma-3-4b-it"      # or "translategemma-12b-it" (24 GB GPU)
  GEMMA_API_KEY: "not-needed"              # anon for local / tunnel endpoints
```

**Preconditions:**
1. `vllm-translation-guardrail` container is up and reachable at `GEMMA_BASE_URL`.
2. The GPU can host the chosen model. Per the legacy codebase's own notes:
   - `google/gemma-3-4b-it` — fast, but **has hallucinations on low-resource languages** like Mandinka. Also prone to the same particle-repetition loop the anti-repetition fixes (`frequency_penalty`, `presence_penalty`, stricter system prompt) now mitigate.
   - `translategemma-12b-it` — **best quality**, fits a 24 GB GPU. Recommended for Gambia prod once hardware is confirmed.
   - `translategemma-27b-it` — best of all, but exceeds an A40.

**Verify after flip:**
```bash
curl -s http://<host>/api/v2/agent/translate/health | jq .primary_provider
# expected: "gemma"

curl -X POST http://<host>/api/v2/agent/translate \
  -H 'Content-Type: application/json' \
  -H 'X-Translation-Pipeline: v2' \
  -d '{"text":"How are you feeling today?","source":"en","target":"ma"}'
```

**Safety net:** the v2 Router's fallback chain still applies. If Gemma returns an error (container down, model OOM, etc.), the request automatically falls over to `V2_FALLBACK_PROVIDER`. Set it to `openai` or `nllb` so a Gemma outage doesn't break translation.

---

## Anti-repetition (built in as of Step 7.5)

The degenerate output pattern (`"N be ne n be ne bo n be jere..."`) is now mitigated at three layers:

1. **Provider config**: `frequency_penalty=0.5`, `presence_penalty=0.3`, `max_tokens=1500` for single / `2500` for batch. Applies to OpenAI and Gemma (any OpenAI-compatible backend).
2. **System prompt**: contains an explicit "CRITICAL: Do NOT repeat phrases or particles" rule with examples.
3. **QE detection**: `RepetitionHeuristicQE` in the default QE composite. Detects trigram repetition (`> 4` repeats) and token diversity (`< 0.15`). The PDF-query pipeline retries a failing QE via the alternate strategy; future work (Step 8) will extend retry to the translate path.

The screenshot bug would now:
- **Be less likely to happen** (frequency penalty discourages the loop).
- **Be caught by QE** if it did happen (PDF-query would log `qe.passed=false` and retry).
- **Still be returned to the caller** for the plain `/translate` endpoint, because that path doesn't have automatic retry yet. Operator can spot it via `v2_translate_total` + the log line from `RepetitionHeuristicQE`.

---

## Verification checklist before rollout

1. Backend: `curl http://<host>/api/v2/agent/translate/health` returns `pipeline_active: true` (or `false` if you're running with just the header-only escape hatch).
2. Frontend smoke: `node src/i18n/v2_optin.smoke.mjs` (from `components/frontend/`) — 9 assertions must pass.
3. Backend unit tests: `pytest tests/` from `translation_v2/` — 308 pass.
4. End-to-end: open the app, run `window.__aminaUseV2(true)` in console, click per-message "Mandinka" button, confirm `v2_translate_total{provider="openai"}` in `/api/v2/agent/metrics` increments by one.
