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

The model the vLLM container serves defaults to
**`meta-llama/Meta-Llama-3.1-8B-Instruct`**
(`--served-model-name ${VLLM_LLM_MODEL_ID:-…}`, `docker-compose.yaml:820`). The
**recommended and validated** model is **`ibm-granite/granite-4.1-8b`**
because it supports the OpenAI-compatible guided JSON
(`response_format={"type":"json_object"}`) that dataprep needs for
labelling — without guided JSON, labels fall back to per-chunk markdown
parsing (slower, lower quality). There is **no in-code fallback model
name**: chatqna discovers whatever model the LLM endpoint actually serves
(`/v1/models`, TTL-cached) and fails the request loudly when nothing
answers — a hardcoded name would be rejected by vLLM's model-name
validation. The legacy `LLM_MODEL` env var is no longer read.

| Source | Variable | Default | Reachable? |
|---|---|---|---|
| vLLM container | `VLLM_LLM_MODEL_ID` | `meta-llama/Meta-Llama-3.1-8B-Instruct` | The model vLLM loads and serves. |
| Recommended validated | `VLLM_LLM_MODEL_ID` override | `ibm-granite/granite-4.1-8b` | Override in `.env` to switch. |
| Discovery (chatqna, retriever summarizer, dataprep labelling/graph) | the endpoint's `/v1/models` | whatever is served | Always-on; `VLLM_MODEL_ID` (empty by default) pins a name and skips the probe. |

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
> event carries `is_grounded: false`. When the retrieval returned no
> document at all — the label filter matched nothing — the metadata
> event also carries `abstained: true` with
> `abstention_reason: no_documents_retrieved`, the `chatqna.stream_outcome`
> span records `answer.abstained` and its cause (`answer.abstention_reason`)
> on a streamed turn, and
> `genie_ai_chat_request_total` counts the turn under `abstained="true"` —
> all derived from the same retrieval signal. The flag is reported while
> the abstention instructions are enforced (`CHATQNA_ENFORCE_ABSTENTION`,
> the default); a deployment that turned the guardrail off answers instead
> of abstaining, and the flag stays unset. When the retrieval DID match
> documents but the reranker kept none, the turn is also an abstention —
> with `abstention_reason: reranker_selected_nothing`, so a healthy scope
> is not mistaken for a stale label.
> The metadata event also carries
> `filter_labels` — the labels the retrieval filtered on, by the pipeline's
> own rule — so the admin Query Inspector names the scope without
> re-deriving it (see [Admin Dashboard](/docs/frontend/admin-dashboard/)).
> The `chatqna.orchestrate` root span in VictoriaTraces reflects the same
> request for trace-level correlation.

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
**`google/gemma-3-4b-it`** (`docker-compose.yaml:580`, configured via
`VLLM_TRANSLATION_MODEL_ID`). Two optional alternatives commented in
the `env` template are `google/translategemma-4b-it` and
`google/translategemma-12b-it`.

**Supported language codes** come from two places: the UI's own locale
whitelist (`components/gov-chat-frontend/src/i18n/locales/`) — `ar, bn, de,
en, es, fr, id, man, pt, ru, st, sw, th, zh` (Mandinka uses the `man` code
only; there is no separate `mnk` file) — and the translation models'
registry (`language-registry.json`), which decides what the translator
itself accepts. A language the registry does not cover is refused, not
guessed; see
[Multilingual Architecture]({{< relref "/docs/architecture/multilingual-ssot" >}}).

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
falsy in the request body, triggering auto-detection), ChatQnA
**translates prior-turn user and assistant messages to English** before
the pipeline runs. This keeps the `bge-large-en-v1.5` embedding space
consistent regardless of UI language and feeds the
[multi-turn blending]({{< relref "multi-turn-retrieval" >}}) embedding
only when `MULTI_TURN_BLEND_ENABLED=true`. See
[Multilingual Architecture]({{< relref "/docs/architecture/multilingual-ssot" >}})
for the full query-side picture.

The translation cost is one translation call per request for the whole
budget-capped history. Disable by serving English-only.

## User profile enrichment

ChatQnA calls `GET /api/me/context` (the backend's sanitized user
profile endpoint) after JWKS validation. The returned fields (role,
organisation, preferences — PII stripped by the backend) are injected
into the LLM prompt as persona context. If the call fails, ChatQnA
proceeds without enrichment — no hard error.

See [Reference → API contracts → `/api/me/context`]({{< relref "/docs/reference/api-contracts" >}})
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