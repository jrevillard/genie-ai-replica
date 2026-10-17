# Provider adapters — the two-type contract

Companion to SPEC.md. From the 2026-10-18 provider-API research (official docs; OpenAI
wire facts verified via the Azure mirror).

## Why exactly two types

One `openai-compatible` type covers OpenAI, vLLM (already the local path), LiteLLM, and
OpenRouter — all `{base}/v1/chat/completions` + Bearer + `GET {base}/v1/models`. One
`anthropic` type covers the native Messages API. Azure-classic is standardized on its
`/openai/v1` data-plane path (or a later subtype if needed).

## Adapter interface (both types implement)

```
chat(request)      -> { text, finishReason, usage{in,out}, refused }
chatStream(request)-> async chunks of {textDelta} | {finishReason}     # inference leg
listModels()       -> [{ id, name, contextTokens? }]
testConnection()   -> { ok, detail }                                    # config screen
```

`request = { messages[{role,content}], system?, maxTokens, temperature?, schema?,
contextTokens }` — `schema` present means the schema-forced-JSON op.

## Per-type mechanics

| Concern | openai-compatible | anthropic |
|---|---|---|
| Chat path | `POST {base}/v1/chat/completions`; base ends `/v1` (OpenRouter: `/api/v1`) | `POST {host}/v1/messages`; base is the bare host |
| Auth | `Authorization: Bearer <token>` | `x-api-key: <token>` **and** `anthropic-version: 2023-06-01` (constant, easy to omit, fails confusingly) |
| System prompt | a `system` message inside `messages` | hoisted to top-level `system` param |
| max tokens | optional | **REQUIRED** — always inject per-leg defaults |
| temperature | optional; unsupported on reasoning models | optional; newest models 400 on non-default — send ONLY when explicitly set; map "cheap/fast" to `output_config.effort` |
| Text out | `choices[0].message.content` (string) | join `content[]` blocks where `type == 'text'` (thinking blocks may coexist) |
| Endings | `finish_reason`: stop/length/refusal | `stop_reason`: end_turn/max_tokens/refusal — normalize both |
| Models | `GET /v1/models` → `data[].id`; no pagination in practice | same path; **cursor-paginated, default 20** — pass `limit=1000`, follow `has_more/after_id`; rows carry `display_name`, `max_input_tokens`, `capabilities` |
| Strict JSON | `response_format {"type":"json_schema", strict:true}` (all fields required, `additionalProperties:false`; or `json_object` where schema-unsupported, e.g. vLLM guided JSON) | `output_config.format {"type":"json_schema", schema}` (SDK `messages.parse`) — do NOT use prefill-`{` or forced `tool_choice` (both 400 on current models) |

## Cross-cutting rules

- **Parse, don't regex**: Anthropic emits required-keys-first ordering; both vendors'
  refusals/truncations can still yield non-compliant output — the repo's existing
  parse+retry fallbacks stay on EVERY path.
- **`finishReason: length` is a retry-with-larger-cap event**, not a parse failure (the
  repo already salvages truncated JSON prefixes — keep that).
- **Timeouts per class**: labels/topics ~120 s; suite/RAGAS generation 300–600 s;
  inference streams (non-streaming frontier requests hit ~10-minute server ceilings).
  Honor `Retry-After` on 429 — rate limits, not GPU, govern hosted throughput.
- **Context window**: the profile carries `context_tokens` (Anthropic's models endpoint
  exposes `max_input_tokens`; OpenAI-compatible deployments enter it — no wire field).
  The router publishes per-leg budgets from it (the RAGAS `_doc_char_cap` derivation is
  the worked example).
- **Local leg**: the `openai-compatible` adapter with the deployment's vLLM config IS
  the local path — one adapter, two configs, no fork.

## Phase 2 (explicitly deferred)

Both vendors' Batch APIs (async, ~50% cost) fit the admin-only latency-insensitive
profile; same adapter, batch submission mode. Not in v1.
