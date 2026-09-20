---
title: Streaming Translation
description: Translate the answer in the target language WHILE the English stream is being delivered — unit-by-unit with markdown AST preservation, controlled by STREAMING_TRANSLATION_ENABLED.
weight: 11
mode: explanation
audience: developer, deployer
last_reviewed: 2026-09-18
persona: developer
owner: "docs-stewards"
---

> **For backend developers and deployers.** This page explains the
> `STREAMING_TRANSLATION_ENABLED` toggle that fixes [issue #829](https://gitlab.com/un/itu/genie-ai/-/issues/829):
> when a user asks in Spanish, the chat must show Spanish text **as it
> streams**, not an English stream that flips at the end. The flag is
> off by default — turning it on requires the GPU translation service and
> a recent enough deployment to support unit boundaries.

## The problem (issue #829)

Before this feature, the flow for a Spanish-speaking user was:

1. The frontend requested an English-streamed answer (the only path
   ChatQnA supports).
2. The backend proxied the English SSE stream to the browser.
3. **At the end** of the stream, the backend ran a full `translate`
   call on the complete English text and emitted a single
   `data: {"type":"chunk","content":"<full translation>"}` frame.
4. The browser replaced the just-streamed English with the Spanish.

The user saw:

| Time | What the user reads |
|------|---------------------|
| 0–8 s | English streaming, paragraph by paragraph |
| 8 s | Whole screen flips to Spanish |

Three problems:

- **Latency.** Spanish arrives only after the full English stream completes + one translation call.
- **Inconsistency.** The English-then-flip UX is jarring — users read "the application..." and then the screen suddenly says "la solicitud..." mid-thought.
- **Reliability.** A translation failure on the final call kills the entire reply; the user sees the English stream remain in place but no error.

## The solution: stream-translate per markdown unit

With `STREAMING_TRANSLATION_ENABLED=1`, the backend buffers the English
stream from ChatQnA and **commits complete units** (sentences, paragraph
breaks) to the translator as soon as they are safe to translate:

```text
ChatQnA English SSE stream:    "Sentence one. Sentence two.\n\nParagraph two begins."
                                      ↓
                              stream-boundary.js commits at "\n\n"
                                      ↓
                     ┌───────────────┴───────────────┐
                     ▼                                ▼
              "Sentence one. Sentence two."   "Paragraph two begins."
                     │                                │
                     ▼ translateMarkdown             ▼ translateMarkdown
                     │                                │
                     ▼                                ▼
              "Frase uno. Frase dos."            "Comienza el párrafo dos."
                     │                                │
                     ▼ SSE frame                       ▼ SSE frame
              data: {"type":"chunk",             data: {"type":"chunk",
                     "content":"Frase uno.          "content":"Comienza
                      Frase dos."}                    el párrafo dos."}
```

The user reads Spanish **incrementally**, in the same rhythm as English
would have arrived.

## How unit boundaries are detected

The boundary detector lives in
[`components/gov-chat-backend/services/translation/stream-boundary.js`](https://gitlab.com/un/itu/genie-ai/-/blob/main/components/gov-chat-backend/services/translation/stream-boundary.js).
It picks the **latest** of these boundaries in the current buffer:

1. **Paragraph break** (`\n\n`) — Markdown blank line; commits at the
   highest level of confidence (structure is unambiguous).
2. **Sentence terminator** (`.`, `!`, `?`) **followed by a closing
   quote/bracket and a whitespace character**.

Two refinements matter:

- A terminator preceded by a **digit** is ignored — that is a list
  marker (`1.`, `2.`) or a decimal (`3.14`), neither of which ends a
  sentence. Splitting there would fragment Markdown lists.
- A terminator with **no following whitespace** does NOT commit — in a
  stream, that whitespace typically arrives in the next chunk and must
  become the separator (re-appended verbatim after translation).
  Committing on a bare end-of-buffer terminator yields an empty
  separator; the space then lands at the start of the next unit's content
  and the translator trims it — collapsing
  `"Sentence one. Sentence two"` into
  `"Sentence one.Sentence two"`.

This is what keeps formatting intact during streaming translation. See
the inline rationale in `stream-boundary.js:1-29` (the function starts at
line 30).

## How structure survives translation

`translationService.translateMarkdown` ([`services/translation/`](https://gitlab.com/un/itu/genie-ai/-/tree/main/components/gov-chat-backend/services/translation))
parses the unit as Markdown, translates **only the text leaf nodes**, and
reassembles the AST — so structure **within** the unit (bold, lists,
inner paragraphs) is preserved by the skeleton, never left to the model.
The `separator` (the exact trailing whitespace that followed the unit in
the source) is passed through verbatim, so structure **between** units
(the `\n\n` paragraph breaks, line breaks) survives too.

> If you want to debug the structural fidelity on a live deployment, set
> `LOG_LEVEL=debug` on the backend — every unit emits
> `[STREAM-TRANSLATE] IN=… sep=… OUT_head=… OUT_tail=…` at debug level
> (see `query-routes.js:243`). Production logs at `LOG_LEVEL=info` are
> silent.

## Configuration

| Env var | Default | Effect |
|---------|---------|--------|
| `STREAMING_TRANSLATION_ENABLED` | `0` | Off by default. Set to `1` or `true` (case-insensitive) to enable unit-by-unit streaming translation. |
| `TRANSLATION_BACKEND` | `cpu` | Backend used for the translation calls (`cpu` workers or `gpu`). The streaming path calls the same backend as the post-stream fallback. |
| `VLLM_TRANSLATION_MODEL_ID` | `google/gemma-3-4b-it` | The model that produces the translations. Must be in the GPU node's `model_store`. |

Enable in `.env`:

```bash
STREAMING_TRANSLATION_ENABLED=1
```

The flag is **read on every request** at
[`query-routes.js:208`](https://gitlab.com/un/itu/genie-ai/-/blob/main/components/gov-chat-backend/routes/query-routes.js#L208)
— no service restart needed. Restart only if you also change the
underlying model or backend.

## When the feature activates

The feature is **request-scoped**, not deployment-wide. It activates only
when **all three** conditions are met
([`query-routes.js:208-213`](https://gitlab.com/un/itu/genie-ai/-/blob/main/components/gov-chat-backend/routes/query-routes.js#L208)):

```javascript
const streamingTranslationEnabled = ['1', 'true'].includes(
  (process.env.STREAMING_TRANSLATION_ENABLED || '').toLowerCase()
);
const targetLanguage = queryData.context?.language?.toLowerCase();
const useStreamingTranslation =
  streamingTranslationEnabled && targetLanguage && targetLanguage.toUpperCase() !== 'EN';
```

1. `STREAMING_TRANSLATION_ENABLED` is truthy (`1` or `true`).
2. The request carries a non-empty `context.language`.
3. `context.language` is not `EN` (English).

The third condition is the safety net for English users — even if an
operator accidentally turns the flag on, English responses are not
double-processed.

## Failure handling

If the translator throws on a unit
([`query-routes.js:251-262`](https://gitlab.com/un/itu/genie-ai/-/blob/main/components/gov-chat-backend/routes/query-routes.js#L251)),
the backend:

1. Emits the unit as-is (English) with the original separator.
2. Sets `streamingTranslationFailed = true`.
3. On the next unit, **falls back to the original English stream** for
   the remainder of the response (the `streamingTranslationFailed` short
   circuit at `query-routes.js:303`).
4. Continues with the post-stream full-translation as before.

The user never sees a half-translated answer: if streaming translation
fails, they get the original English stream + the final translation at
the end (the old behaviour).

## Verifying it works

### 1. Confirm the flag is set

```bash
docker exec genieai_backend sh -c 'echo $STREAMING_TRANSLATION_ENABLED'
# Expect: 1 (or true)
```

### 2. Confirm the SSE wire format

Send a Spanish query and observe the response:

```bash
ADMIN_TOKEN=...   # any user with the chat permission

curl -sk -N -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message":"¿Cuáles son los requisitos para una subvención?",
       "context":{"language":"es"}}' \
  https://<NGINX_PUBLIC_DOMAIN>/api/queries/stream
```

Expected: a stream of `data: {"type":"chunk","content":"…"}` events
where the `content` is in Spanish **from the first frame**. With the
flag off, the early frames are English and only the final frame is
Spanish.

### 3. Toggle the debug instrumentation

For a single conversation, drop the backend log level to debug
temporarily to see the unit-by-unit commits:

```bash
docker service update --env-add LOG_LEVEL=debug genieai_backend
docker service logs genieai_backend --since 1m 2>&1 | grep STREAM-TRANSLATE
# Expect: one [STREAM-TRANSLATE] IN=… line per committed unit
docker service update --env-rm LOG_LEVEL genieai_backend    # revert
```

### 4. Force the fallback path

To confirm the fallback short-circuit fires correctly, point
`TRANSLATION_BACKEND` at a service that is intentionally down
(`TRANSLATION_BACKEND=nonexistent` or scale the workers to 0). Send a
Spanish query: you should still see a complete answer (English stream +
English + a final Spanish-only frame from the post-stream translate).

## Failure modes and troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Spanish stream is **all-English** then flips at the end | `STREAMING_TRANSLATION_ENABLED=0`, or the request did not carry `context.language` | Confirm the env var. Confirm the frontend sets `context.language` from `currentLocale` (see [Frontend → Chat UX](/docs/frontend/chat-ux/)). |
| Spanish stream is **half English, half Spanish** | Translator threw on one unit, fallback fired for the rest | Check `docker service logs genieai_backend --since 5m 2>&1 \| grep stream_translation_unit_failed`. Common causes: GPU node down, model not loaded, OOM in the GPU. |
| Spanish stream has collapsed spacing (`"Frase uno.Frase dos."`) | Boundary detector missing the whitespace separator | This is the bug the boundary detector was designed to prevent — open an MR with a repro and the debug logs (`grep STREAM-TRANSLATE`). |
| Translation latency is higher than the English stream rate | Translator is CPU-bound and falling behind | Switch `TRANSLATION_BACKEND` to `gpu` (much faster for the model). See [Deploy → Remote GPU node](/docs/deploy/gpu/). |
| Every unit emits a debug line in production | `LOG_LEVEL=debug` was set and not reverted | The default `LOG_LEVEL=info` suppresses the `[STREAM-TRANSLATE]` lines. Confirm via `docker exec genieai_backend sh -c 'echo $LOG_LEVEL'`. |

## Related

- [Generation](/docs/rag-pipeline/generation/) — the prompt and
  temperature settings that affect English-stream quality.
- [Frontend → Chat UX](/docs/frontend/chat-ux/) — how the browser
  injects `context.language` from `currentLocale`.
- [Architecture → RAG pipeline](/docs/architecture/architecture/) — the
  end-to-end flow including translation.
- [Translation service reference](/docs/backend/api-contracts-backend/#translate)
  — the `POST /api/translate` endpoint used for the post-stream fallback.