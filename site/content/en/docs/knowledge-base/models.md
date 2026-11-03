---
title: "Model Configurations"
description: "The Admin Dashboard's Models tab — named remote-model endpoints for benchmark judging, suite generation, curation and tagging, and how the Testing Lab consumes them."
weight: 17
---

The **Models** tab — the last tab of the Admin Dashboard, under *Settings* —
manages **named remote-model configurations**: any OpenAI-compatible endpoint
(OpenAI direct, a LiteLLM gateway, vLLM, Gemini's compat surface, Ollama) or
Anthropic's native API. A configuration tells OKF's model-backed features
which model to use and whose key pays for it.

- The tab exists only when the OKF feature is enabled (`OKF_ENABLED=1`) —
  its storage and API live in okf-server.
- Managing configurations requires the **platform admin role**; other roles
  are told so plainly ("Model configurations require the platform admin
  role.").
- With **no** configuration active, every feature falls back to the
  deployment's env-configured default model — the behavior before any
  configuration exists.

## Creating a configuration

**New configuration** opens the form: **Name**, **Provider** (two choices —
*OpenAI-compatible (OpenAI, LiteLLM, vLLM…)* or *Anthropic (native API)*),
**Base URL**, **API key**, and a default **Model**.

The **Provider** and **Base URL** fields carry ⓘ info tips with live-verified
example endpoints and the exact paths the server appends:

- OpenAI-compatible: `https://api.openai.com/v1`, `https://api.minimax.io/v1`,
  `https://api.z.ai/api/paas/v4`, a LiteLLM gateway `http://your-gateway:4000/v1`.
- Anthropic-native: `https://api.anthropic.com`,
  `https://api.minimax.io/anthropic`, `https://api.z.ai/api/anthropic`.

**The URL rule for version-segment bases.** The server lists models at
`base + /models` (OpenAI-compatible) or `base + /v1/models` (Anthropic — a
trailing `/v1` on the base URL is normalized away), and Test connection
generates at `base + /chat/completions` or `base + /v1/messages`
respectively. So an OpenAI-compatible base carries its version segment
(`/v1`), while an Anthropic base does not — supplying
`https://api.anthropic.com/v1` still works because the extra `/v1` is
stripped, but the Anthropic convention is to leave it off.

### The live model dropdown

As soon as a URL and key are configured — **even before the configuration is
saved** — the Model field becomes a **dropdown combo populated live from the
endpoint**: press **Fetch models** and the *server* performs the listing. For
a saved configuration it uses the stored key; for an unsaved form the typed
key makes one server-side round trip and is never stored. The count comes
back as "{n} models loaded — pick from the dropdown or type freely", and
typing a model id by hand is always allowed. When the endpoint serves no
list ("The endpoint returned no models — type the model id.") or the listing
fails ("Model listing failed — type the model id."), the field stays an
honest free-text input — never a dead end.

### Test connection

A **Test connection** action (in the form, and on every table row) probes the
configuration before you rely on it. With a model selected it sends a
**one-token generation to the selected model** over the provider's native
wire — the truest end-to-end proof, because credentials, base URL and model
travel in a single call — and reports latency:

- `✓ Connected — the model answered (850 ms)` — success; if the model is not
  in the endpoint's list, the result adds a note saying so (a real case:
  some providers serve generation but no list — DeepSeek's Anthropic surface,
  for example, answers `/v1/messages` but has no `/v1/models`. There the
  dropdown falls back to free text while the test still passes).
- `✓ Endpoint reachable — {n} models listed (pick a model to also test
  generation)` — the endpoint answered the listing but no model was chosen.
- `✗ Endpoint OK, but the model call failed` — followed by the raw error.
- `✗ test failed — no response`.

With no model selected there is nothing to test. Testing is always
available; activating is a separate, explicit act.

## What each configuration is used for

The **Use this configuration for** checkboxes decide which features an
*active* configuration serves. The **Test Lab Pipelines** group is live:

| Checkbox | Feature | Provider constraint |
|---|---|---|
| **Benchmarks (RAGAS judge + advisor)** | RAGAS judging and the Testing Lab advisor (checked by default for a new configuration) | either provider |
| **Benchmark answers — offline replay only (the Lab answers through the deployment chat)** | steers the benchmark's *replay* answer leg through this model — the run's fidelity block records which model answered. In SERVE mode (the benchmark default) the deployment chat answers regardless, and the record says so | OpenAI-compatible only |
| **Concept curation** | the LLM curation engine (labels, frontmatter drafting) | OpenAI-compatible only |
| **Topics & tags** | frontmatter tag suggestion | OpenAI-compatible only |

Concept curation, topics/tags and benchmark answers speak the OpenAI wire
format, so those boxes are disabled for an Anthropic-provider configuration
(an Anthropic configuration can serve benchmark judging only).

The **Data Prep Pipeline** group (contextual retrieval, chunk labeling,
knowledge-graph extraction) and the **Inference Pipeline** group (chat
answering, chat translation) are shown greyed as *planned — not yet
configurable*; those endpoints are not yet configurable, and embeddings and
reranking stay deployment-local by design.

An active configuration with **nothing checked serves nothing** — the table
says *nothing (dormant)*. The active configuration only serves the features
on its list.

## Managing configurations

Configurations can be **named, renamed, copied, modified, activated,
deactivated and deleted** (deletion asks for confirmation). Exactly **one**
can be active at a time:

- **Activate** (▶ on a row) — makes it the configuration every
  unchecked-picker feature resolves to. Activating one deactivates the
  previous one.
- **Deactivate** (⏸ on the active row) — "Deactivate — the deployment default
  model will be used".
- **Copy** (⧉) — duplicates a configuration so you can variant it.
- **Rename / modify** (✎) — the form opens pre-filled; the API-key field
  shows "unchanged" plus the stored key's masked hint unless you type a new
  key.

Keys are held server-side, shown only as a masked hint, and never reach the
browser again after save. Every lifecycle action is written to the audit log.

## How the Testing Lab consumes configurations

The Lab's benchmark pickers (generation model, judge model, re-score judge)
resolve in a documented order: an explicit pick wins for that operation; the
empty choice is the **active configuration**; the explicit **.env deployment
default** bypasses the active configuration; and a deleted configuration
falls back to the default. See
[Testing Lab](/docs/knowledge-base/testing-lab/) for the picker behavior and
per-suite memory.

Two more model-backed behaviors are governed here:

- **Reasoning-capable models.** Config-routed internal tasks ask reasoning
  models not to think (the wire convention for it is dropped automatically if
  the endpoint does not know the parameter), and a call whose answer was
  starved by reasoning — the model spent its whole budget thinking and wrote
  nothing — is retried on a climbing ladder: each retry gets four times the
  token budget (to a ceiling) and twice the wall clock, so strict-JSON tasks
  (tags, curation, advice, benchmark answers) survive frontier reasoning
  models.
- **Frontmatter tag suggestion runs as a background job.** The request
  returns immediately and the editor polls until the suggestion lands — there
  is no gateway timeout in the path, and the model is given a five-minute
  clock per attempt (plus the ladder above) to think. With a reasoning model
  configured, a suggestion taking a couple of minutes is normal, not a
  failure.

## Related pages

- [OKF Studio](/docs/knowledge-base/okf-studio/) — the workflows these models
  serve.
- [Testing Lab](/docs/knowledge-base/testing-lab/) — the pickers and the
  advisor.
- [OKF variables reference](/docs/configure/okf-variables/) — the env-side
  model defaults (`RAGAS_JUDGE_*` and friends) a configuration overrides.
