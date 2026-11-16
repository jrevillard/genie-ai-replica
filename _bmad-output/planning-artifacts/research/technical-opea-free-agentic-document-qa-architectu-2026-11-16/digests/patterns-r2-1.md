# Round 2 digest — Agents SDK vLLM wiring, authz primaries, stream-part schemas

Follow-up to round-1 patterns digest. 8 sources read this round, all claims traced to
this run's retrievals. Accessed 2026-11-16 throughout.

## CLAIMS

### 1a. OpenAI Agents SDK (Python) against vLLM

- The SDK defaults to the **Responses API**; against providers that lack it (vLLM's
  primary surface is Chat Completions) you get 404s. Two documented escapes:
  `set_default_openai_api("chat_completions")` (works with `OPENAI_API_KEY` +
  `OPENAI_BASE_URL` env vars) or explicit `OpenAIChatCompletionsModel` — source:
  https://openai.github.io/openai-agents-python/models/ · OpenAI · current
  (site build 2026-11-10) · confidence: high · class: compat
- **Chat-Completions compatibility trap**: routing through Chat Completions makes the
  SDK "silently drop Responses-only fields Chat Completions cannot send, such as
  `previous_response_id`, `conversation_id`, the Responses `prompt` field, **or tool
  outputs that are not text-only**". Opt-in strict feature validation raises
  `UserError` instead — same source · high · compat. Load-bearing for tool-result
  design: keep tool outputs text-only (or validate strict mode).
- **Cancellation semantics** (fills round-1 NOT FOUND): breaking out of the
  `stream_events()` loop, a handler exception, or consumer cancellation does NOT stop
  the run — "the run can continue making model and tool calls"; `aclose()` waits
  without requesting cancellation; `cancel()` requests it; explicit warning:
  "Cancellation cannot undo tool effects that have already happened"; `cancel(mode="after_turn")`
  stops after the current tool turn — source:
  https://openai.github.io/openai-agents-python/streaming/ · OpenAI · 2026-11-10 ·
  high · pattern
- Tool-call streaming in chat-completions mode: **not explicitly documented in the
  Python docs read** (raw-event examples are Responses-API events). The JS docs
  (below) document Chat Completions streaming incl. function calls. Treat Python CC
  streaming of tool deltas as unverified — see NOT FOUND — source: both streaming docs ·
  medium · compat

### 1b. @openai/agents (JS/TS)

- Custom base URL supported two ways: `setDefaultOpenAIClient(new OpenAI({ baseURL, apiKey }))`
  (requires `openai` ≥7.2 when supplying a client directly), or `OpenAIProvider({ baseURL })` —
  documented as "HTTP base URL for OpenAI-compatible endpoints"; `useResponses: false`
  (or process-wide `setOpenAIAPI(...)`) selects Chat Completions for string model
  names — source: https://openai.github.io/openai-agents-js/llms-full.txt (config +
  models guides) · OpenAI · current · high · compat
- **Tracing exists in JS and is ON by default in server runtimes** (off in browsers
  and `NODE_ENV=test`); "By default trace export uses the same OpenAI key" — i.e. it
  exports to OpenAI cloud even when the model client points at a custom baseURL.
  Disable: `setTracingDisabled(true)` from `@openai/agents`, or per-runner
  `new Runner({ tracingDisabled: true })`; separate export key via
  `setTracingExportApiKey()` — same source · high · compat. For a sovereign/self-hosted
  stack this is a must-set flag.
- Chat-Completions truncation handling: on `finish_reason: 'length'` the SDK preserves
  a partial choice containing text/refusal/audio/**function call**; a truncated choice
  with none of those raises `ModelBehaviorError` in streaming AND non-streaming rather
  than treating empty as success — same source · high · compat (directly relevant:
  vLLM max_tokens cut mid-tool-call)

### 2. Adaline primary — settled

- Primary exists: Adaline Labs post claims intent classification before retrieval
  ("decides whether to retrieve, call tools, or answer directly") "reduces costs by
  **40%** and latency by **35%**"; three patterns: query routing via intent
  classification, tool orchestration with error handling, cost tracking with
  continuous evaluation — source: https://labs.adaline.ai/p/building-production-ready-agentic ·
  Adaline Labs (Substack) · 2025-12 · confidence: medium (vendor blog; the retrieved
  portion shows claims + architecture, no measurement methodology) · class: perf
- The Towards AI paraphrase ("30–45% cost, 25–40% latency") **does not match the
  primary's numbers** — secondary drift; cite the primary's 40/35, flagged as
  vendor-reported — sources: both URLs · medium · ecosystem

### 3. Oso — the named per-request authz pattern

- **Effective permissions model**: "The effective permissions of an LLM operation are
  the intersection of: 1. The LLM's permissions 2. The User's permissions 3. The task
  permissions" — so even if the LLM decides to do something beyond what was asked, it
  can't. LLM apps act on behalf of a user = **impersonation** semantics; neither party
  gains permissions from the other; the user is the actor. Rationale stated bluntly:
  LLMs lack judgment/discretion, act at superhuman speed, "if they do something
  unexpected, they'll do it fast and they'll do it forever" — source:
  https://www.osohq.com/academy/authorization-in-llm-applications · Oso (Authorization
  Academy ch. VIII) · undated · confidence: high (pattern statement; it is also vendor
  education content) · class: pattern
- Same chapter structures the space: RAG with first-party data / third-party data /
  agents / MCP as separate authorization cases (chapter TOC) — same source · high · pattern

### 4. IETF draft-klrc-aiagent-auth

- Shape: individual Internet-Draft "AI Agent Authentication and Authorization" that
  "leverages existing standards such as the WIMSE architecture and the OAuth 2.0
  family"; defines **no new protocols** — a framework for applying/extending OAuth for
  agent authn/authz + gap identification for future standardization — source:
  https://datatracker.ietf.org/doc/html/draft-klrc-aiagent-auth-00.html · IETF ·
  2026 (individual draft) · confidence: high (abstract verbatim) · class: maturity
- **Status caveat**: the -00 revision "will expire on 3 September 2026" — as of
  access the revision is past its 6-month validity; check datatracker for a -01 or
  adoption before citing as a live standard — same source · high · maturity
- Relevance to the decision: endorses the "reuse OAuth 2.0 + workload identity, don't
  invent agent-auth protocols" direction for identity propagation into tool executors —
  medium (interpretation of framework scope) · pattern

### 5. Client stream-event schemas — what is consolidating

- **AG-UI (Agent User Interaction Protocol)** is a real consolidation candidate:
  spec **1.0** published; event taxonomy: Lifecycle (RunStarted/Finished), TextMessage
  {Start,Content,End,Chunk}, **ToolCall {Start, Args, End, Result, Chunk}**, State
  Management, Activity, Subagent, Special, Draft; TS + Python + .NET SDKs; repo shows
  ~18.4k GitHub stars — source: https://docs.ag-ui.com/concepts/events · AG-UI
  protocol · current (1.0) · high (existence/taxonomy) · class: ecosystem+pattern
- Bridge evidence: Vercel **Chat SDK's web adapter "speaks the AI SDK and AG-UI stream
  protocols"** — the two TS ecosystems are being made interoperable rather than
  competing head-on — source: https://chat-sdk.dev/llms.txt · Vercel · current ·
  medium-high · ecosystem
- AI SDK `streamText` chunk stream is typed: `text-delta`, `reasoning-delta`,
  **`source`**, `custom`, `tool-call`, … (on-chunk TextStreamPart union) — a `source`
  chunk type natively carries provenance events mid-stream; plus a **`repairToolCall`**
  option to repair malformed tool calls (directly applicable to vLLM's
  malformed-markup failure mode) — source:
  https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text · Vercel · current ·
  high · version+pattern
- Older AI SDK doc paths (`/docs/ai-sdk-core/streaming*`) now 404; streaming docs live
  under `/docs/foundations/streaming` — cite with current paths — source: 404 pages +
  foundations page · high · version
- Synthesis: no single ratified standard, but the shape has converged — token deltas +
  a start/args/end/result tool lifecycle + run lifecycle events — across AG-UI (formal
  spec) and AI SDK (de-facto TS standard); MCP standardizes the tool layer only, not
  the client stream — inference from the above sources · medium · pattern

## LEADS

- **IETF draft expiry**: -00 expired 2026-09-03; check for -01/adoption before any
  citation beyond "framework direction".
- **Adaline methodology**: no measurement procedure in retrieved portion; treat 40/35
  as vendor-reported until their eval details are found.
- AG-UI positioning page "MCP, A2A, and AG-UI" (docs.ag-ui.com/agentic-protocols) —
  their own layering claim; read before adopting the framing.
- Python Agents SDK has `@tool_input_guardrail` / `needs_approval` /
  human-in-the-loop docs — an approval+policy seam that maps well onto per-request
  tool authz (server code decides, not the model); worth a focused read.
- AI SDK `source` chunk type + `repairToolCall`: both directly reusable for the
  citation-enforcement and vLLM malformed-tool-call problems from round 1.
- Empirical gap to close in-house: verify tool-call delta streaming in Python
  chat-completions mode against the actual deployed vLLM parser (round-1 vLLM doc
  showed hf-parser emits whole calls only).

## NOT FOUND

- An explicit OpenAI Python SDK docs statement that tool calls stream correctly in
  chat-completions mode (JS docs do cover CC streaming incl. function calls; Python
  raw-event docs are Responses-shaped) — needs a live test against vLLM.
- Production adoption/retrospective write-ups of AG-UI (protocol exists; who runs it
  at scale unread).
- Oso's MCP-specific section content (page extraction covered glossary + effective
  permissions + chapter structure; the MCP subsection body was not fully retrieved).
- Any OpenAI Agents SDK doc on propagating an end-user identity/token into tool
  executors — the SDK leaves it to application code (guardrails/approvals seam);
  no blessed pattern documented.
