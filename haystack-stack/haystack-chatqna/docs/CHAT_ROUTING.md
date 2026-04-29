# AMINA Chat Routing — End-to-End Reference

**Last updated:** 2026-04-27
**Scope:** all chat traffic through `/api/v1/agent/chat` and `/api/v1/agent/chat-stream`
**Status:** production-routed; all listed patches active by default

This document describes how a single chat request flows through the
AMINA stack today, layer by layer. It is the canonical reference for
the four chat-routing changes shipped on this branch:

1. **Guest chat patch** — bypass the CHW pipeline for unauthenticated sessions
2. **LLM provider policy** — env-driven cascade fallback + observability
3. **Basic/Beginner intent router (V2)** — deterministic UX gate for simplified shells
4. **`X-AMINA-*` response-header observability** — admin badge / per-request metadata

It does **not** describe the advanced clinical pipeline (LoRA prompts,
RAG retrieval, ReAct loop, medication-safety gate, four-layer intent
router). Those are deliberately untouched and remain authoritative for
all substantive medical reasoning.

---

## 1. Mental model

```
                                 ┌─────────────────────────────────┐
HTTP request                     │  ASGI middleware stack          │
  POST /api/v1/agent/chat        │                                 │
    + body                       │  • ModeHeaderMiddleware         │
    + Authorization?             │      reads X-AMINA-Mode          │
    + X-AMINA-Mode? ─────────────┤  • LLMProviderHeaderASGIMW       │
                                 │      projects X-LLM-* on resp.   │
                                 └────────────────┬────────────────┘
                                                  │
                                                  ▼
                                 ┌─────────────────────────────────┐
                                 │  agent_routes.chat              │
                                 │   • is_guest = !valid_auth      │
                                 │   • _call_agent(pref) →         │
                                 │     agent.process_message(...)  │
                                 └────────────────┬────────────────┘
                                                  │
                              monkey-patched call chain (outermost ⇒ innermost)
                                                  │
       ┌──────────────────────────────────────────▼───────────────────────────────────────────┐
       │  basic_beginner_chat_patch  (only acts when X-AMINA-Mode in {basic,beginner})        │
       │     • classify with basic_beginner_intent_router                                     │
       │     • short-circuit greeting/goodbye/thanks/ack/vague/guest-records                  │
       │     • emergency / medical / unknown → fall through                                   │
       └──────────────────────────────────────────┬───────────────────────────────────────────┘
                                                  │ fall through
       ┌──────────────────────────────────────────▼───────────────────────────────────────────┐
       │  llm_provider_policy        (always active)                                          │
       │     • track preferred provider; cascade fallback (LoRA → groq → gemini → openai)    │
       │     • strict mode → 503 amina_lora_unavailable                                       │
       │     • detect agent's swallowed Connection error and retry                            │
       └──────────────────────────────────────────┬───────────────────────────────────────────┘
                                                  │
       ┌──────────────────────────────────────────▼───────────────────────────────────────────┐
       │  guest_chat_patch           (acts only on session_id starting with "guest_")         │
       │     • short-circuit to Groq/Gemini with a guest-safe system prompt                   │
       │     • zero patient context, zero RAG                                                 │
       └──────────────────────────────────────────┬───────────────────────────────────────────┘
                                                  │ fall through
       ┌──────────────────────────────────────────▼───────────────────────────────────────────┐
       │  AminaAgent.process_message  (ORIGINAL — UNCHANGED)                                  │
       │     • LoRA / Gemini / Groq / OpenAI per model_preference                             │
       │     • full ReAct loop, RAG, intent_router, four_layer_router,                        │
       │       stance_classifier, medication-safety gate, prompts.py                          │
       └──────────────────────────────────────────┬───────────────────────────────────────────┘
                                                  │
                                                  ▼
                                       JSON response back through stack
                                       (middlewares add X-LLM-* + X-AMINA-* headers)
```

**Key invariant:** if no `X-AMINA-Mode` header is sent and the user is
authenticated with a valid `model_preference`, the new patches add a
single contextvar read each and pass through unchanged. The advanced
flow is byte-identical to pre-routing-changes behaviour.

---

## 2. Layer 1 — `basic_beginner_chat_patch` (V2)

### 2.1 Purpose

Stop the simplified Beginner / Basic shells from handing a literal
`"hi"` to the full ReAct loop, which would respond with unsolicited
diet advice ("Test 11, let's talk about your diabetes…").

### 2.2 Activation

* Frontend ([`BeginnerShell.jsx`](../../components/frontend/src/BeginnerShell.jsx) / [`BasicShell.jsx`](../../components/frontend/src/BasicShell.jsx)) renders `<BeginnerChat mode="beginner|basic" />`.
* [`BeginnerChat.jsx`](../../components/frontend/src/BeginnerChat.jsx) sends an `X-AMINA-Mode: <mode>` header on every chat POST.
* `ModeHeaderMiddleware` (pure ASGI) reads the header and stores `"basic"` or `"beginner"` on `mode_var` (a `contextvars.ContextVar`).
* The patched `process_message` reads `mode_var`. If empty or any other value, **it falls through immediately** with one contextvar read overhead.

### 2.3 Intent classifier

[`src/services/basic_beginner_intent_router.py`](../src/services/basic_beginner_intent_router.py) — pure regex, **no imports from intent_router / four_layer_router / stance_classifier**.

```
classify_basic_beginner_intent(message, is_guest, mode) -> {
    intent:               greeting | goodbye | thanks | acknowledgement |
                          vague | personal_records_request | emergency |
                          medical_question | unknown,
    confidence:           0.0–1.0,
    matched:              string (back-compat; same as `reason` family),
    reason:               human-readable reason string,
    route:                deterministic | emergency_fallthrough |
                          fallthrough | unknown_fallthrough,
    should_short_circuit: bool — caller MUST honour this,
    language_hint:        en | ma | mixed | unknown,
    domain_hint:          NCD-first metadata (see §2.4),
    normalized_text:      lowercased / collapsed / typo-corrected,
}
```

### 2.4 NCD domain hints (metadata only)

Returned on every Basic/Beginner classification. **Never drives a
deterministic medical answer** — used only for logging and the
`X-AMINA-Domain-Hint` response header.

| Domain | Examples |
|---|---|
| `medication_adherence` | "I missed my BP medicine", "I forgot to take my pill" |
| `medication_safety` | "side effects", "allergic to metformin", "too much insulin" |
| `pregnancy_ncd` | "I am pregnant and have diabetes" |
| `vitals_bp` | "my BP is 160/100", "blood pressure too high" |
| `vitals_glucose` | "my sugar is high", "HbA1c is 9" |
| `diabetes` | "I have diabetes", "metformin", "insulin" |
| `hypertension` | "hypertension", "high blood pressure", "amlodipine" |
| `asthma_copd` | "asthma", "inhaler", "wheezing" |
| `cardiovascular_risk` | "heart disease", "cholesterol", "atherosclerosis" |
| `mental_health` | "depressed", "anxious", "stressed", "mood" |
| `diet_nutrition` | "what should I eat", "food", "meal", "salt intake" |
| `physical_activity` | "exercise", "workout", "walking" |
| `tobacco_alcohol` | "smoking", "alcohol", "tobacco" |
| `obesity_weight` | "lose weight", "BMI", "overweight" |
| `caregiver_support` | "caregiver", "CHW", "Alkalo", "home care" |
| `appointment_followup` | "next appointment", "follow up", "schedule" |
| `referral` | "refer me to", "EFSTH", "specialist" |
| `records` | "my care plan", "my history", "my chart" |
| `symptoms` | catch-all for pain/fever/cough/dizzy when no specific NCD matches |
| `emergency` | set when emergency intent fires |
| `unknown` | default |

Order in `_DOMAIN_HINT_PATTERNS` matters — adherence and pregnancy are
checked **before** vitals and specific NCDs so context-overriding
classifications win.

### 2.5 Routing decision matrix

| Intent | Guest | Auth | Behaviour |
|---|---|---|---|
| `greeting` | short-circuit, NCD-menu reply | short-circuit, NCD-menu reply with patient name | deterministic, no LLM call |
| `goodbye` | short-circuit | short-circuit | deterministic |
| `thanks` | short-circuit | short-circuit | deterministic |
| `acknowledgement` | short-circuit | short-circuit | deterministic |
| `vague` (single low-info token) | short-circuit, NCD-menu clarifier | same | deterministic |
| `personal_records_request` | short-circuit, "please sign in" | **fall through** to existing agent/tools | guest-only short-circuit |
| `emergency` | fall through | fall through | emergency intent never short-circuits — existing safety pipeline owns the response |
| `medical_question` | fall through | fall through | LoRA / RAG / agent path |
| `unknown` | fall through | fall through | LoRA / RAG / agent path |

### 2.6 Vague single-token allowlist

Only the message normalised to **exactly one** of these tokens (no
modifiers) short-circuits to the clarification menu:

```
help, pain, medicine, food, sugar, pressure, sick, dizzy, tired, symptoms
```

`"I have sugar"`, `"my sugar is high"`, `"I have diabetes"` all fall
through. The vague gate is intentionally narrow.

### 2.7 Deterministic response copy

| Intent | Wording |
|---|---|
| Greeting (guest) | *"Hello, I'm Amina. I can help with blood pressure, blood sugar, medicines, food, exercise, symptoms, or appointments. What would you like help with today?"* |
| Greeting (auth) | *"Hello, {name}. I can help with blood pressure, blood sugar, medicines, food, exercise, symptoms, or appointments. What would you like help with today?"* |
| Goodbye | *"Take care! I'm here whenever you have a health question."* |
| Thanks | *"You're welcome. Is there anything else I can help with?"* |
| Acknowledgement | *"Got it. Let me know if you have more questions."* |
| Vague | *"What would you like help with: blood pressure, blood sugar, medicines, food, exercise, symptoms, or appointments?"* |
| Guest records request | *"Please sign in to access your personal records, medications, appointments, or care plan."* |

### 2.8 Logging

Patch logs **safe metadata only** — never the raw user message:

```
[basic_beginner] mode=beginner guest=True intent=greeting conf=0.95
                 route=deterministic domain=unknown lang=en
                 short_circuit=True reason='standalone greeting'
```

---

## 3. Layer 2 — `llm_provider_policy`

### 3.1 Purpose

Make the LoRA optional in production. Add cascade fallback for
authenticated users (previously only guests had this), expose
provider metadata for admin observability, and provide a strict mode
for audit / paid-tier enforcement.

### 3.2 Env vars

| Var | Default | Effect |
|---|---|---|
| `LLM_FALLBACK_MODE` | `warn` | `graceful` \| `warn` \| `strict` |
| `SHOW_LLM_PROVIDER_BADGE` | `true` | hint to the admin frontend |
| `AMINA_REQUIRE_LORA` | `false` | strict-mode lock for auth users |
| `AMINA_REQUIRE_LORA_FOR_GUEST` | `false` | strict-mode lock for guests |
| `LLM_FALLBACK_CHAIN` | `groq,gemini,base` | cascade order; "amina" excluded |

### 3.3 Mode behaviour

| Mode | LoRA up | LoRA down |
|---|---|---|
| `graceful` | LoRA serves | silent cascade through fallback chain; logs the swap |
| `warn` | LoRA serves | cascade serves; response carries `X-LLM-Fallback-Used: true` so admin UI can flag it |
| `strict` + `AMINA_REQUIRE_LORA=true` | LoRA serves | HTTP **503** with `{code: amina_lora_unavailable, message, preferred_provider}` |

### 3.4 Swallowed-error detection

The agent's [`amina_agent.py:2311`](../src/agent/amina_agent.py#L2311) `except Exception` returns
`{response: "I apologize…", error: "Connection error."}` instead of
raising. The policy patch treats a non-empty `result["error"]` as an
attempt failure and triggers the fallback chain.

### 3.5 Strict-mode 503 unwrapping

The chat route at [`agent_routes.py:369`](../src/api/agent_routes.py#L369) does `except Exception:
raise HTTPException(500, str(e))`. That mangles our 503 into a 500. The
middleware's exception handler detects the wrapped pattern (`detail`
starts with `"503: {…amina_lora_unavailable…}"`) and re-emits a clean
503 JSON. No edits to `agent_routes.py`.

### 3.6 Diagnostic endpoint

```
GET /api/v1/llm/policy
{
  "mode": "warn",
  "show_badge": true,
  "require_lora": false,
  "require_lora_for_guest": false,
  "fallback_chain": ["groq", "gemini", "base"],
  "default_preference": "amina"
}
```

---

## 4. Layer 3 — `guest_chat_patch`

### 4.1 Purpose

Stop the agent's hardcoded CHW system prompt ("ALWAYS recommend
moringa porridge / Lumo market") from being served to guests who have
no patient context, no consent, and no expectation of personalised
local advice.

### 4.2 Detection

A request is treated as a guest if **either**:
1. `session_id` starts with `"guest_"` (the format set by
   [`ChatPage.jsx`](../../components/frontend/src/router/pages/ChatPage.jsx) and
   [`BeginnerChat.jsx`](../../components/frontend/src/BeginnerChat.jsx)
   for unauthenticated users).
2. `patient_id`, `patient_name`, `phone`, AND `user_role` are all empty.

### 4.3 Behaviour

* Bypasses the entire CHW pipeline.
* Calls Groq → Gemini in cascade with a guest-safe system prompt:
  > *"You are Amina, a general health-information assistant. The user
  > is NOT signed in. You DO NOT know their name, age, conditions,
  > medications, location, or care plan. Do not invent personal
  > context. Do not refer to specific local foods, markets, or place
  > names unless the user mentions them first."*
* Maintains a small per-session in-memory ring buffer (4 turns) so
  follow-ups stay coherent — completely isolated from the patient
  memory store.
* Returns a result dict with `user_role: "guest"` so the outer
  policy patch can mark `provider_used = groq` accordingly.

### 4.4 Authenticated path

`is_guest_by_sid == False` AND any of `patient_id` / `patient_name` /
`phone` / `user_role` is set → falls through to `_orig_process_message`
unchanged.

---

## 5. Composition order (install + call)

Three monkey-patches stack on `AminaAgent.process_message`. Install
order in [`main_with_rag_tuning.py`](../src/main_with_rag_tuning.py) determines wrapper layering:

```
import order              wrapper layer
─────────────────────     ─────────────────────────────────────────
guest_chat_patch          innermost (wraps the original)
llm_provider_policy       middle (wraps guest_chat_patch's wrapper)
basic_beginner_chat_patch outermost (wraps llm_provider_policy's wrapper)
```

Resulting call chain when `process_message(...)` is invoked:

```
basic_beginner_chat_patch._patched
    └─ if mode in {basic,beginner} AND should_short_circuit:
       │     return deterministic envelope
       └─ else: call inner ────────────►
                                          llm_provider_policy._patched
                                              └─ try preferred provider
                                              │  ├─ on swallowed error → cascade
                                              │  └─ in strict mode → 503
                                              └─ call inner ────────────►
                                                                          guest_chat_patch._guest_aware
                                                                              └─ if session_id starts "guest_":
                                                                              │     call Groq with guest prompt
                                                                              └─ else: call inner ───►
                                                                                                       ORIGINAL
                                                                                                       process_message
```

---

## 6. Headers reference

### 6.1 Request headers (frontend → backend)

| Header | Set by | Effect |
|---|---|---|
| `Authorization: Bearer <jwt>` | every authed call | unlocks LoRA / personalised path |
| `X-AMINA-Mode: beginner\|basic` | `BeginnerChat.jsx` only | activates the basic_beginner gate |

### 6.2 Response headers (backend → frontend)

| Header | When | Value |
|---|---|---|
| `X-LLM-Provider` | every chat | `groq` \| `gemini` \| `openai` \| `amina-lora` |
| `X-LLM-Preferred` | every chat | the preference that was requested |
| `X-LLM-Fallback-Used` | every chat | `true` \| `false` |
| `X-LLM-Latency-Ms` | every chat | int |
| `X-LLM-Context` | every chat | `guest` \| `auth` |
| `X-LLM-Mode` | every chat | `graceful` \| `warn` \| `strict` |
| `X-LLM-Show-Badge` | every chat | mirrors env var |
| `X-LLM-Provider-Error` | when fallback fired | first 120 chars of primary error |
| `X-AMINA-Intent-Router` | only when basic_beginner short-circuits | `basic_beginner` |
| `X-AMINA-Intent` | alongside above | `greeting` \| `vague` \| … |
| `X-AMINA-Domain-Hint` | every Basic/Beginner chat | NCD domain (see §2.4) |

### 6.3 Why pure ASGI middleware (not `BaseHTTPMiddleware`)

Starlette's `BaseHTTPMiddleware` (the implementation behind
`@app.middleware("http")`) wraps the downstream call in
`anyio.create_task_group()`, spawning a child task. ContextVar
changes made in the child do not propagate back to the parent task
once the child finishes, so reading the contextvar from the
middleware after `call_next(request)` returns gives stale defaults.

Both `LLMProviderHeaderASGIMiddleware` and `ModeHeaderMiddleware` are
**pure ASGI** (`async def __call__(self, scope, receive, send)`),
which keeps everything in the same task. ContextVar values written
inside `process_message` are visible when we wrap `http.response.start`.

---

## 7. Frontend touchpoints

| File | Purpose |
|---|---|
| [`components/frontend/src/router/pages/ChatPage.jsx`](../../components/frontend/src/router/pages/ChatPage.jsx) | Generates `guest_*` session IDs for unauthenticated users; sends only `Authorization` if logged in. |
| [`components/frontend/src/BeginnerChat.jsx`](../../components/frontend/src/BeginnerChat.jsx) | Adds `X-AMINA-Mode` header from a `mode` prop. |
| [`components/frontend/src/BeginnerShell.jsx`](../../components/frontend/src/BeginnerShell.jsx) | Renders `<BeginnerChat mode="beginner" />`. |
| [`components/frontend/src/BasicShell.jsx`](../../components/frontend/src/BasicShell.jsx) | Renders `<BeginnerChat mode="basic" />`. |
| [`components/frontend/src/admin/LLMProviderBadge.jsx`](../../components/frontend/src/admin/LLMProviderBadge.jsx) | Admin-only floating badge that reads the `X-LLM-*` headers. |
| [`components/frontend/src/admin/LLMProviderBadgeBootstrap.jsx`](../../components/frontend/src/admin/LLMProviderBadgeBootstrap.jsx) | Self-mounting + fetch interceptor for the badge. |

The admin badge is hidden for non-admin sessions (no `AMINA_ADMIN_TOKEN`).

---

## 8. Backend file inventory

### 8.1 New files

| File | Role |
|---|---|
| [`src/services/basic_beginner_intent_router.py`](../src/services/basic_beginner_intent_router.py) | Regex classifier + deterministic-response builder (V2 metadata) |
| [`src/services/basic_beginner_chat_patch.py`](../src/services/basic_beginner_chat_patch.py) | Monkey-patch + `ModeHeaderMiddleware` |
| [`src/services/llm_provider_policy.py`](../src/services/llm_provider_policy.py) | Env-driven mode + cascade + tracking |
| [`src/services/llm_provider_middleware.py`](../src/services/llm_provider_middleware.py) | ASGI X-LLM-* header projection + `/llm/policy` + 503 unwrapper |
| [`src/services/guest_chat_patch.py`](../src/services/guest_chat_patch.py) | Guest-mode short-circuit |
| [`_basic_beginner_router_test.py`](../_basic_beginner_router_test.py) | 104-assertion suite |

### 8.2 Edited files (additive only — no logic changed)

| File | Change |
|---|---|
| [`src/main_with_rag_tuning.py`](../src/main_with_rag_tuning.py) | 4 try/except installer blocks (one per service) |
| [`docker-compose.override.yml`](../../docker-compose.override.yml) | Mount the 5 new services + LLM env vars |

### 8.3 Files deliberately NOT touched

| File | Why |
|---|---|
| `src/agent/amina_agent.py` | LoRA prompts + ReAct + medication safety — authoritative |
| `src/agent/prompts.py` | LoRA prompts |
| `src/agent/greeting.py` | advanced intent / greeting context |
| `src/services/intent_router.py` | advanced intent router |
| `src/services/four_layer_router.py` | advanced router |
| `src/services/stance_classifier.py` | advanced classifier |
| `src/services/medication_safety.py` | drug-safety gate |
| `src/api/agent_routes.py` | chat endpoint — response shape unchanged |
| `src/api/streaming_routes.py` | SSE endpoint — response shape unchanged |

---

## 9. Test inventory

| Suite | Cases | Where |
|---|---|---|
| Basic/Beginner classifier (intent + routing) | 50 | [`_basic_beginner_router_test.py`](../_basic_beginner_router_test.py) §1 |
| V2 metadata fields + types | 14 | §1 |
| NCD domain hint classifier | 20 | §2 |
| E2E smoke against `/agent/chat` | 25 (10 scenarios) | §3 |
| Policy review regression E2E | 55 | [`_policy_review_test.py`](../_policy_review_test.py) |
| **Combined** | **164** | all green |

To run:
```bash
# Inside or outside the container — works either way.
python _basic_beginner_router_test.py
python _policy_review_test.py
```

---

## 10. How to add a new layer

If you need another mode-specific gate (e.g. a "voice-only mode" that
short-circuits long-form questions), follow the existing pattern:

1. **Pure-Python classifier** in `src/services/<your_layer>_intent_router.py`. Regex only. No imports from `intent_router.py` / `four_layer_router.py` / agent code.
2. **Patch + middleware** in `src/services/<your_layer>_chat_patch.py`. Monkey-patch `AminaAgent.process_message` and install your ASGI middleware via `install_middleware(app)`.
3. **Wire** in `main_with_rag_tuning.py` with a `try/except` block, *after* the layers you want to wrap. Outer layers see the request first.
4. **Mount** the new files in `docker-compose.override.yml` so dev gets them without rebuilding.
5. **Tests**: a focused `_<layer>_test.py` covering classifier unit + E2E smoke.
6. **Headers**: project any new metadata as `X-AMINA-*` (kebab-case, lowercase encoding) so the admin badge can read it.
7. **Logging**: never log the raw user message. Stick to safe metadata.

---

## 11. Quick reference — what runs when

| Scenario | Layers that act | Result |
|---|---|---|
| Beginner-mode `"hi"` (auth) | `basic_beginner` short-circuits | deterministic NCD-menu greeting; 0 LLM calls |
| Beginner-mode `"my BP is 160/100"` (auth) | `basic_beginner` falls through → `llm_provider_policy` → original `process_message` | LoRA / cascade fallback; `X-AMINA-Domain-Hint: vitals_bp` |
| Beginner-mode `"hi I have chest pain"` (auth) | `basic_beginner` detects emergency, falls through; original `process_message` runs emergency path | Emergency-aware response; `X-AMINA-Intent-Router` absent |
| Advanced-mode `"hi"` (auth) | `llm_provider_policy` → original | Standard CHW prompt (unchanged from pre-routing) |
| Guest `"hi"` | `basic_beginner` may or may not act (depends on UI); `llm_provider_policy` → `guest_chat_patch` short-circuits | Generic Groq reply with guest-safe prompt |
| Strict mode + `model_preference=amina` + LoRA down (auth) | `llm_provider_policy` raises 503 | HTTP 503 `amina_lora_unavailable`; admin badge surfaces error |
| LoRA up + auth + advanced mode | `llm_provider_policy` records LoRA used; original runs | LoRA reply; `X-LLM-Provider: amina-lora`, `X-LLM-Fallback-Used: false` |

---

## 12. Roadmap pointers (not in this branch)

* SSE streaming for deterministic short-circuits — currently the
  short-circuit path returns a single non-streaming response;
  `streaming_routes.py` still streams the full reply word-by-word but
  for canned greetings the visible delta is small.
* Admin badge surfacing `X-AMINA-Domain-Hint` — 5-line addition to
  `LLMProviderBadge.jsx`.
* Mandinka-aware deterministic greetings — currently always English.
  The `language_hint` metadata is already classified; just needs a
  copy table.
