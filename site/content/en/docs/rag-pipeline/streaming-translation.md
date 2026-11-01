---
title: Streaming Translation
description: Translate the answer in the target language WHILE the English stream is being delivered — unit-by-unit with markdown AST preservation, controlled by STREAMING_TRANSLATION_ENABLED.
weight: 11
mode: explanation
audience: developer, deployer
last_reviewed: 2026-10-22
persona: developer
owner: "docs-stewards"
aliases:
  - /docs/rag/streaming-translation/
---

> **For backend developers and deployers.** This page explains the
> `STREAMING_TRANSLATION_ENABLED` toggle that fixes [issue #829](https://opensource.unicc.org/un/itu/genie-ai/-/issues/829):
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

```mermaid
flowchart TB
    Src["ChatQnA English SSE stream:<br/>\"Sentence one. Sentence two.\n\nParagraph two begins.\""]
    Split["stream-boundary.js commits at \\n\\n"]
    U1["\"Sentence one. Sentence two.\""]
    U2["\"Paragraph two begins.\""]
    Tr1["translateMarkdown"]
    Tr2["translateMarkdown"]
    O1["\"Frase uno. Frase dos.\""]
    O2["\"Comienza el párrafo dos.\""]
    F1["SSE frame:<br/>data: {type:chunk,<br/>content:\"Frase uno. Frase dos.\"}"]
    F2["SSE frame:<br/>data: {type:chunk,<br/>content:\"Comienza el párrafo dos.\"}"]

    Src --> Split --> U1
    Split --> U2
    U1 --> Tr1 --> O1 --> F1
    U2 --> Tr2 --> O2 --> F2
```

The user reads Spanish **incrementally**, in the same rhythm as English
would have arrived.

## How unit boundaries are detected

The boundary detector lives in
[`components/gov-chat-backend/services/translation/stream-boundary.js`](https://opensource.unicc.org/un/itu/genie-ai/-/blob/main/components/gov-chat-backend/services/translation/stream-boundary.js).
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

`translationService.translateMarkdown` ([`services/translation/`](https://opensource.unicc.org/un/itu/genie-ai/-/tree/main/components/gov-chat-backend/services/translation))
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
| `TRANSLATION_BACKEND` | `auto` | Backend used for the translation calls (`cpu` workers or `gpu`). Ignored when a GPU API is configured — see below. |
| `VLLM_TRANSLATION_MODEL_ID` | `google/gemma-3-4b-it` | The model that produces the translations. Must be in the GPU node's `model_store`. |

Enable in `.env`:

```bash
STREAMING_TRANSLATION_ENABLED=1
```

### A configured GPU API is mandatory

A deployment that names a GPU API — `GPU_NODE_HOST` set, or a
`VLLM_TRANSLATION_ENDPOINT` of its own — always uses it. `TRANSLATION_BACKEND`
is not consulted: `cpu`, `gpu`, `auto` and unset all resolve to the GPU.

If that API does not answer, the backend **refuses to start**. This is
deliberate. The previous behaviour — probe once, switch to CPU on failure —
turned a five-second probe timeout into a permanent switch: on a remote-GPU
deployment the chat answers then came from a different, local model, with
nothing in the response to say so. The check now runs once at startup only;
after that, a failure is reported as a failure.

When no GPU API is configured, `TRANSLATION_BACKEND` decides, and `auto`
still probes once and commits:

| `GPU_NODE_HOST` / endpoint | `TRANSLATION_BACKEND` | Result |
|---|---|---|
| configured | any value | GPU — service fails to start if it does not answer |
| not configured | `auto` (default) | GPU if it answers, otherwise CPU |
| not configured | `cpu` | CPU |
| not configured | `gpu` | GPU — service fails to start if it does not answer |

`TRANSLATION_PROBE_TIMEOUT_SECONDS` (default `30`) bounds that startup check.
It must cover a cold TLS handshake to a remote node: the endpoint's `/health`
answers in tens of milliseconds once connected, so a budget that can expire on
a healthy API would stop a working deployment.

The flag is **read on every request** at
[`query-routes.js:208`](https://opensource.unicc.org/un/itu/genie-ai/-/blob/main/components/gov-chat-backend/routes/query-routes.js#L208)
— no service restart needed. Restart only if you also change the
underlying model or backend.

## When the feature activates

The feature is **request-scoped**, not deployment-wide. It activates only
when **all three** conditions are met
([`query-routes.js:208-213`](https://opensource.unicc.org/un/itu/genie-ai/-/blob/main/components/gov-chat-backend/routes/query-routes.js#L208)):

```javascript
const streamingTranslationEnabled = ['1', 'true'].includes(
  (process.env.STREAMING_TRANSLATION_ENABLED || '').toLowerCase()
);
const targetLanguage = requestedTargetLanguage(queryData); // trimmed, lower-cased
const useStreamingTranslation = streamingTranslationEnabled && targetLanguage && targetLanguage !== 'en';
```

1. `STREAMING_TRANSLATION_ENABLED` is truthy (`1` or `true`).
2. The request carries a non-empty `context.language`.
3. `context.language` is not `en` (English).

The third condition is the safety net for English users — even if an
operator accidentally turns the flag on, English responses are not
double-processed.

The requested language is normalized in one place
(`services/translation/language-request.js`) and then checked against
the language map the translation backend ships. A language the map does
not know is **not** translated: it is refused, not guessed.

The check happens **once per request**. The resolution hands back both
the decision (refuse the request, or proceed) and a translator bound to
the accepted pair, so the units of a streamed answer are translated in
the very language that was checked — and the language map is not
consulted again for every unit.

## Failure handling

A language the translation models do not cover is **refused before the
stream opens**: the request is answered `400` with
`{ "error": "UNSUPPORTED_LANGUAGE", "message": "Unsupported target language" }`
and nothing is generated. The answer is never produced in a language the
caller did not ask for — that is the whole point of the boundary.

Any other failure is not a refusal — with one exception that happens
before any request is served. The translation service is a **mandatory
boot dependency** of the backend (`components/gov-chat-backend/index.js`):
when a GPU API is configured and cannot be reached at startup, the
backend does not start at all. There is no request to answer, and no
English answer either — the deployment is down until the GPU API answers
again. This is deliberate: a deployment that named a GPU API is not
silently served by another model.

Once the backend is up, a translation failure (GPU node down, model not
loaded, OOM) is not a refusal: the request goes through and the answer
is delivered in English. The backend:

1. Emits the unit as-is (English) with the original separator.
2. Sets `streamingTranslationFailed = true`.
3. The answer stays in English **for the remainder**: the units that
   follow are emitted as they are, without another attempt at
   translating them. The English that was already buffered goes out
   before the chunks that follow it, so the answer keeps its order.
4. The post-stream translation is skipped — the same failure would
   fail it again — and the `done` frame carries `translationFailed:
   true`.

The units that were translated before the failure stay translated; from
the failure on, the answer is the original English stream. The `done`
frame says the translation failed: an `error` frame would truncate the
answer and raise a system-down notification for a translation-only
failure.

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
Spanish query: you should still see a complete answer — the English
stream, in order — and a `done` frame carrying `translationFailed:
true`. No `translation` frame follows: the post-stream translation is
skipped once the streaming translation failed.

## Failure modes and troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Spanish stream is **all-English** then flips at the end | `STREAMING_TRANSLATION_ENABLED=0`, or the request did not carry `context.language` | Confirm the env var. Confirm the frontend sets `context.language` from `currentLocale` (see [Frontend → Chat UX](/docs/frontend/chat-ux/)). |
| Spanish stream is **half English, half Spanish** | Translator threw on one unit, fallback fired for the rest | Check `docker service logs genieai_backend --since 5m 2>&1 \| grep stream_translation_unit_failed`. Common causes: GPU node down, model not loaded, OOM in the GPU. |
| The request is refused with `400 UNSUPPORTED_LANGUAGE` | The requested language is not one the translation models have | Nothing to fix on the backend: the answer would have been in a language the caller did not ask for. The covered languages are the keys of the shipped map (`components/gov-chat-backend/services/translation/language-maps/<model>-map.js`). |
| Spanish stream has collapsed spacing (`"Frase uno.Frase dos."`) | Boundary detector missing the whitespace separator | This is the bug the boundary detector was designed to prevent — open an MR with a repro and the debug logs (`grep STREAM-TRANSLATE`). |
| Translation latency is higher than the English stream rate | Translator is CPU-bound and falling behind | Switch `TRANSLATION_BACKEND` to `gpu` (much faster for the model). See [Deployment → Remote GPU node](/docs/deploy/gpu/). |
| Every unit emits a debug line in production | `LOG_LEVEL=debug` was set and not reverted | The default `LOG_LEVEL=info` suppresses the `[STREAM-TRANSLATE]` lines. Confirm via `docker exec genieai_backend sh -c 'echo $LOG_LEVEL'`. |

## Related

- [Multilingual Architecture](/docs/architecture/multilingual-ssot/) — the
  English single-source-of-truth invariant. This translator is its response
  edge.
- [Generation](/docs/rag-pipeline/generation/) — the prompt and
  temperature settings that affect English-stream quality.
- [Frontend → Chat UX](/docs/frontend/chat-ux/) — how the browser
  injects `context.language` from `currentLocale`.
- [RAG pipeline → Pipeline architecture](/docs/rag-pipeline/pipeline/) — the
  end-to-end flow including translation.
- [Translation service reference](/docs/reference/api-contracts/#9-translation-routes-apitranslate)
  — the `POST /api/translate` endpoint used for the post-stream fallback.