---
title: Generation
description: LLM system prompt, abstention behaviour, self-confidence scoring, streaming translation, and the SSE wire format.
weight: 5
aliases:
  - /docs/rag/generation/
mode: how-to
persona: developer
owner: "docs-stewards"
last_reviewed: 2026-09-18
---

Generation is the final RAG stage: the kept chunks are assembled into a
prompt and sent to the LLM, which produces a grounded answer streamed back
to the user. The behaviour is shaped by three knobs — the **system prompt**,
the **abstention** rule, and an optional **self-confidence** token — plus
**translation** when the user's UI locale is not English.

This page is for developers tuning answer quality and operators debugging
the response stream.

## LLM defaults

The default model in docker-compose is **`meta-llama/Meta-Llama-3.1-8B-Instruct`**
(set via `VLLM_LLM_MODEL_ID`, `docker-compose.yaml:1129`). The
**recommended and validated** model is **`ibm-granite/granite-4.1-8b`**
because it supports the OpenAI-compatible guided JSON
(`response_format={"type":"json_object"}`) that dataprep needs for
labelling — without guided JSON, labels fall back to per-chunk markdown
parsing (slower, lower quality). The in-code fallback
(`genieai_chatqna.py:148`) is `ibm-granite/granite-3.3-2b-instruct`,
reached only when neither `VLLM_LLM_MODEL_ID` nor the legacy
`LLM_MODEL` env var is set.

| Source | Variable | Default | Reachable? |
|---|---|---|---|
| Docker compose (production) | `VLLM_LLM_MODEL_ID` | `meta-llama/Meta-Llama-3.1-8B-Instruct` | Yes — set by `docker-compose.yaml:1129`. |
| Recommended validated | `VLLM_LLM_MODEL_ID` override | `ibm-granite/granite-4.1-8b` | Override in `.env` to switch. |
| In-code fallback | `LLM_MODEL` (legacy) | `ibm-granite/granite-3.3-2b-instruct` | Only if `VLLM_LLM_MODEL_ID` and `LLM_MODEL` are both unset. |

All are served by vLLM (OpenAI-compatible API).

## System prompt

The built-in default (canonical source: `genieai_chatqna.py:490-502`) instructs the
model to:

- Do not invent or assume information; if the answer is not in the provided
  content, inform the user that the information is unavailable.
- Use the user's name, gender, age, preferences, and chat history to tailor
  and personalise responses.
- Keep answers informative but concise; provide detailed explanations only
  when necessary or explicitly requested.
- Prefer information contained in the context.

Override the whole prompt with `CHATQNA_SYSTEM_PROMPT`. Partial
adjustments live in `CHATQNA_ABSTENTION_INSTRUCTIONS`.

> **Two-tier priority.** Environment variable (highest) beats the built-in
> default (lowest). This lets each deployment tailor tone and rules
> without touching code.

## Abstention {#abstention}

When the retrieved context does not contain the answer, the model is told
to **abstain** — to say so plainly rather than hallucinate. Abstention is
**enforced by default** (`CHATQNA_ENFORCE_ABSTENTION=true`). This is the
single most important guardrail for a public-sector knowledge base, where
a confident but wrong answer is far worse than an honest "I don't have
that information."

| Variable | Default | Effect |
|---|---|---|
| `CHATQNA_ENFORCE_ABSTENTION` | `true` | Force abstention when context is insufficient. Setting `false` removes the rule entirely. |
| `CHATQNA_ABSTENTION_INSTRUCTIONS` | built-in | Phrasing appended to the system prompt when abstention triggers. |

> **Verifying abstention fired.** When abstention fires, the streamed
> answer ends with the configured refusal phrase, and the SSE metadata
> event carries `is_grounded: false`. The `abstained` value is exposed as
> a metric attribute on `chat_requests_total` in VictoriaMetrics (not as
> a chatqna span attribute); the `chatqna.orchestrate` root span in
> VictoriaTraces reflects the same request for trace-level correlation.

## Self-confidence {#self-confidence}

Optionally, the LLM appends a self-confidence token to its answer:

```
[[CONF:90]]
```

The pipeline parses this token separately and strips it from the visible
text, so the user never sees the raw marker but the system gets a second
certainty signal (independent of the reranker-derived score). Enable with
`LLM_SELF_CONFIDENCE_ENABLED=1` (default `0`, off).

| Signal | Source | Range | What it reflects |
|---|---|---|---|
| `confidence_score` | reranker | 0–1 | How strongly the kept chunks support the answer (rank-weighted aggregate, see [Reranking]({{< relref "reranking" >}})). |
| `self_confidence` | LLM | 0–100 | The model's own certainty, from the `[[CONF:n]]` token. |
| `is_grounded` | reranker | bool | `true` iff ≥1 chunk passed the reranker. |

The `confidence_score` displayed to the user is `_display_confidence`
(`genieai_chatqna.py:407-417`) — prefers `self_confidence` if available,
falls back to the reranker-aggregated score otherwise.

## Translation {#translation}

For multilingual deployments, the streamed English answer can be
translated into the user's UI language by a dedicated translation model
served by `vllm-translation-guardrail`. The default model is
**`google/gemma-3-4b-it`** (`docker-compose.yaml:549`, configured via
`VLLM_TRANSLATION_MODEL_ID`). Two optional alternatives commented in
the `env` template are `google/translategemma-4b-it` and
`google/translategemma-12b-it`.

**Supported language codes** are defined in
`components/gov-chat-frontend/src/i18n/locales/` (the same whitelist the UI
uses): `ar, bn, de, en, es, fr, id, man, pt, ru, st, sw, th, zh`
(Mandinka uses the `man` code only; there is no separate `mnk` file).

Two modes:

- **Default (`STREAMING_TRANSLATION_ENABLED=0`)** — generate the full
  English answer, then translate. The user waits for generation to
  finish before seeing any non-English content.
- **Streaming (`STREAMING_TRANSLATION_ENABLED=1`)** — translate
  incrementally as the English tokens arrive, so the user reads the
  target language live instead of waiting for a final flip. Uses an
  AST-based `translateMarkdown`-per-unit approach so markdown structure
  (headings, lists, code blocks, links) is preserved across translation
  boundaries, and re-appends the verbatim separator so the original
  English fallback is still available if the translation stream is
  interrupted.

For model trade-offs see
[Choosing models → Role 4: Translation & Guardrails]({{< relref "choosing-models" >}}).

> **Latency note.** Translation adds at least one extra LLM call per
> request (often more in streaming mode). The translation call itself is
> not wrapped in a dedicated `chatqna.*` span — the request hook in
> `genie-ai-overlay/tracing.py` (lines 185-216) names the OPEA HTTP
> client spans as `METHOD /path` (e.g. `POST /v1/chat/completions`),
> so look for those under the `chatqna.orchestrate` root span in
> VictoriaTraces.

## Multilingual chat history

When the UI locale differs from English (or when `original_language` is
falsy in the request body, triggering auto-detection), the backend
**translates prior-turn user and assistant messages to English** before
they reach ChatQnA. This keeps the `bge-base-en-v1.5` embedding space
consistent regardless of UI language and feeds the
[multi-turn blending]({{< relref "multi-turn-retrieval" >}}) embedding
only when `MULTI_TURN_BLEND_ENABLED=true`.

The translation cost is one translation call per prior turn at request
time. Disable by serving English-only.

## User profile enrichment

ChatQnA calls `GET /api/me/context` (the backend's sanitized user
profile endpoint) after JWKS validation. The returned fields (role,
organisation, preferences — PII stripped by the backend) are injected
into the LLM prompt as persona context. If the call fails, ChatQnA
proceeds without enrichment — no hard error.

See [Backend → API contracts → `/api/me/context`]({{< relref "/docs/backend/api-contracts-backend" >}})
for the request/response shape.

## Streaming & metadata envelope

The answer is streamed token-by-token from vLLM through ChatQnA to the
client. The exact SSE wire format, the metadata envelope, and the
stripping pass that removes internal conversation markers
(`|<-MSG->|`, `USER:`, `ASSISTANT:`) are documented in
[Streaming & metadata events]({{< relref "streaming-sse" >}}).

## Knobs

| Variable | Default | Effect |
|---|---|---|
| `VLLM_LLM_MODEL_ID` | `meta-llama/Meta-Llama-3.1-8B-Instruct` | Generation model (recommended: `ibm-granite/granite-4.1-8b`). |
| `VLLM_TRANSLATION_MODEL_ID` | `google/gemma-3-4b-it` | Translation model. Empty value (env not set) disables translation. |
| `CHATQNA_SYSTEM_PROMPT` | built-in | Full system prompt override. |
| `CHATQNA_ABSTENTION_INSTRUCTIONS` | built-in | Appended when abstention triggers. |
| `CHATQNA_ENFORCE_ABSTENTION` | `true` | Force abstention when context is insufficient. |
| `LLM_SELF_CONFIDENCE_ENABLED` | `0` (off) | Emit and parse `[[CONF:n]]` from the LLM. |
| `STREAMING_TRANSLATION_ENABLED` | `0` | Stream the target language during generation. |

> **Model requirement.** The generation model must support OpenAI-
> compatible guided JSON (`response_format={"type":"json_object"}`) where
> structured output is expected downstream (dataprep labelling). Not
> every model does — see
> [Choosing models]({{< relref "choosing-models" >}}).