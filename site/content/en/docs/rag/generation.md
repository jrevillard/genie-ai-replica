---
title: Generation
description: LLM system prompt, abstention behaviour, self-confidence scoring, and optional streaming translation.
weight: 4
---

Generation is the final RAG stage: the kept chunks are assembled into a prompt
and sent to the LLM, which produces a grounded answer streamed back to the user.
The default LLM is `meta-llama/Meta-Llama-3.1-8B-Instruct` (the docker-compose
default). `ibm-granite/granite-4.1-8b` is the recommended and validated model;
`ibm-granite/granite-3.3-2b-instruct` is the in-code fallback. All are served by
vLLM (OpenAI-compatible API).

The generation behaviour is shaped by three things: the **system prompt**, the
**abstention** rule, and an optional **self-confidence** token. Each is an
environment variable with a built-in default.

## System prompt

The system prompt instructs the LLM to:

- answer **only** from the provided retrieved context — never invent facts,
- be concise,
- personalise the answer using the user's profile and conversation history,
- prefer information contained in the context.

Override the whole prompt with `CHATQNA_SYSTEM_PROMPT`. Partial adjustments live
in `CHATQNA_ABSTENTION_INSTRUCTIONS`.

> **Two-tier priority.** Environment variable (highest) beats the built-in
> default (lowest). This lets each deployment tailor tone and rules without
> touching code.

## Abstention {#abstention}

When the retrieved context does not contain the answer, the model is told to
**abstain** — to say so plainly rather than hallucinate. Abstention is
**enforced by default** (`CHATQNA_ENFORCE_ABSTENTION=true`). This is the single
most important guardrail for a public-sector knowledge base, where a confident
but wrong answer is far worse than an honest "I don't have that information."

## Self-confidence

Optionally, the LLM appends a self-confidence token to its answer:

```
[[CONF:90]]
```

The pipeline parses this token separately and strips it from the visible text, so
the user never sees the raw marker but the system gets a second certainty signal
(independent of the reranker-derived score). Enable with
`LLM_SELF_CONFIDENCE_ENABLED`.

| Signal | Source | Range | What it reflects |
|---|---|---|---|
| Confidence score | reranker | 0–1 | How strongly chunks support the answer. |
| Self-confidence | LLM | 0–100 | The model's own certainty. |

## Translation {#translation}

For multilingual deployments, the streamed English answer can be translated into
the user's UI language by a dedicated translation model — either **TranslaTron**
(`Infomaniak-AI/vllm-translategemma-4b-it`) or a vLLM-hosted model such as
`facebook/m2m100-12B-last`.

Two modes:

- **Default** — generate the full English answer, then translate.
- **Streaming** (`STREAMING_TRANSLATION_ENABLED=1`) — translate incrementally as
  the English tokens arrive, so the user reads the target language live instead
  of waiting for a final flip. This fixes the perceived-latency problem of
  translate-after-generate.

See [Choosing models &rarr; Translation]({{< relref "choosing-models" >}}) for the
model trade-offs.

## Streaming

The answer is streamed token-by-token from vLLM through ChatQnA to the client,
so the first tokens appear while generation is still running. When translation is
enabled, the stream the client receives is in the target language.

## Knobs

| Variable | Default | Effect |
|---|---|---|
| `VLLM_LLM_MODEL_ID` | `meta-llama/Meta-Llama-3.1-8B-Instruct` | Generation model (recommended: `ibm-granite/granite-4.1-8b`). |
| `CHATQNA_SYSTEM_PROMPT` | built-in | Full system prompt override. |
| `CHATQNA_ABSTENTION_INSTRUCTIONS` | built-in | Abstention phrasing. |
| `CHATQNA_ENFORCE_ABSTENTION` | true | Force abstention when context is insufficient. |
| `LLM_SELF_CONFIDENCE_ENABLED` | varies | Emit and parse `[[CONF:n]]`. |
| `VLLM_TRANSLATION_MODEL_ID` | — | Translation model (empty = off). |
| `STREAMING_TRANSLATION_ENABLED` | 0 | Stream the target language during generation. |

> **Model requirement.** The generation model must support OpenAI-compatible
> guided JSON (`response_format={"type":"json_object"}`) where structured output
> is expected downstream (dataprep labelling). Not every model does — see
> [Choosing models]({{< relref "choosing-models" >}}).
