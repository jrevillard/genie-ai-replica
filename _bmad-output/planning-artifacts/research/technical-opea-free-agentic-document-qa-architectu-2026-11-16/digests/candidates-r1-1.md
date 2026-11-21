# Agent-runtime screen — governed self-hosted document-QA (G1–G6)

Research subagent digest, run 2026-11-16. ~12 primary sources read (GitHub API, raw repo files, npm/PyPI registries, two retrospectives). Budget: 14 tool calls.

## CLAIMS

**Licences (G2) — all five candidates pass**

- [DSH] Licence MIT, verified two ways: GitHub API licence field + raw LICENSE file ("MIT License, Copyright (c) 2026 DeepSeek") — source: api.github.com/repos/deepseek-ai/deepseek-harness + raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/LICENSE · publisher: GitHub primary · accessed: 2026-11-16 · confidence: high · class: license
- [DSH] npm package `@deepseek-ai/dsh` also declares MIT — source: registry.npmjs.org/@deepseek-ai/dsh · accessed: 2026-11-16 · confidence: high · class: license
- [LangGraph] Licence MIT (GitHub API; README carries MIT badge link) — source: api.github.com/repos/langchain-ai/langgraph + repo README.md · accessed: 2026-11-16 · confidence: high · class: license
- [Agents SDK] openai-agents-python repo licence MIT; JS package `@openai/agents` licence MIT — source: api.github.com/repos/openai/openai-agents-python + registry.npmjs.org/@openai/agents · accessed: 2026-11-16 · confidence: high (python side single API source) · class: license
- [pydantic-ai] Licence MIT (GitHub API; PyPI `license` field empty, no license classifier — repo is the evidence) — source: api.github.com/repos/pydantic/pydantic-ai · accessed: 2026-11-16 · confidence: medium-high · class: license

**Versions / status / cadence**

- [DSH] npm latest 0.2.2-rc.1 published 2026-11-04; repo created 2026-08-13, pushed 2026-11-13; ~282k stars — source: registry.npmjs.org + api.github.com · accessed: 2026-11-16 · confidence: high · class: version
- [DSH] Self-declared **developer preview**: "iterating rapidly. THERE WILL BE COMPATIBILITY-BREAKING CHANGES" — source: raw README.md L13 · accessed: 2026-11-16 · confidence: high · class: maturity
- [DSH] SAFETY.md: "experimental developer-preview software. It has not undergone a security audit and must not be treated as secure or production-ready"; "can execute model-generated code and commands… may damage the host computer"; sandboxing "cannot guarantee isolation" — source: raw SAFETY.md · accessed: 2026-11-16 · confidence: high · class: maturity
- [LangGraph] PyPI version 1.2.22, classifier Production/Stable; repo pushed 2026-11-16; ~45k stars — source: pypi.org/pypi/langgraph/json + api.github.com · accessed: 2026-11-16 · confidence: high · class: version
- [Agents SDK] openai-agents PyPI 0.24.0 (python ≥3.10); JS `@openai/agents` 0.22.0 published 2026-11-12; python repo pushed 2026-11-16; ~30.7k stars — source: pypi.org + registry.npmjs.org + api.github.com · accessed: 2026-11-16 · confidence: high · class: version
- [pydantic-ai] PyPI version 2.68.0, classifier **Production/Stable (5)** — no longer beta; repo pushed 2026-11-16; ~21k stars — source: pypi.org/pypi/pydantic-ai/json + api.github.com · accessed: 2026-11-16 · confidence: high · class: version

**G3 — self-hosted against OpenAI-compatible endpoint (vLLM)**

- [Agents SDK] Three documented mechanisms: env `OPENAI_BASE_URL`; `set_default_openai_client(AsyncOpenAI(base_url=..., api_key=...))`; `OpenAIChatCompletionsModel(model=..., openai_client=client)` — docs example literally does `set_tracing_disabled()` + custom `base_url` in the same snippet — source: raw docs/models/index.md L368–422, L674 · publisher: OpenAI (repo docs) · undated (living) · accessed: 2026-11-16 · confidence: high · class: compat
- [Agents SDK] Caveat: some OpenAI-compatible providers stream unreliable tool-call deltas → SDK option to buffer tool calls until stream end — source: docs/models/index.md L703 · accessed: 2026-11-16 · confidence: high · class: compat
- [Agents SDK] Tracing is **enabled by default** and exports to OpenAI using your key; disable via `set_tracing_disabled()`, or custom processor / separate `set_tracing_export_api_key`; `trace_include_sensitive_data=False` exists. Cloud optional but off-by-default behaviour must be actively disabled — source: raw docs/config.md L36–191 · accessed: 2026-11-16 · confidence: high · class: compat
- [LangGraph] LangGraph hard-depends on `langchain-core>=1.4.7` (+ langgraph-checkpoint, -prebuilt, -sdk): "standalone" means no langchain chains, not no langchain-core — source: pypi.org/pypi/langgraph/json requires_dist · accessed: 2026-11-16 · confidence: high · class: compat
- [LangGraph] vLLM mechanism = langchain-openai `ChatOpenAI` passed as model (version 1.8.0 current); exact base_url wiring docs NOT read this run — source: pypi.org/pypi/langchain-openai/json + README "used standalone… integrates with any LangChain product" · accessed: 2026-11-16 · confidence: medium · class: compat
- [DSH] Provider abstraction = `LlmAdapter` implementing `stream()` (provider-neutral request → provider API → StreamChunk); shipped adapters: `llm-deepseek` and `llm-pi-ai` only. No OpenAI-compat adapter confirmed shipped; whether pi-ai covers vLLM base_url unverified this run — source: raw docs/user/develop/practice/llm-adapter.md + repo tree packages/llm/* · accessed: 2026-11-16 · confidence: high (architecture), medium (pi-ai/vLLM) · class: compat
- [pydantic-ai] Model selection "every model a string swap away" (OpenAI, Anthropic, Google, Bedrock, Groq, Mistral, Ollama, "dozens more"); OpenAI-compatible base_url wiring not read this run — source: raw README.md · accessed: 2026-11-16 · confidence: medium · class: compat

**G4 — server-defined tools, server-side execution**

- [DSH] `ToolDefinition` = model-facing JSON-schema `ToolSchema` + server `execute(args, exec)`; registry builds model schemas via explicit allowlist so `execute`/`timeoutMs`/presenters "must never leak into a model request"; canonical output schema validated against every result — source: raw docs/subsystems/tools.md · accessed: 2026-11-16 · confidence: high · class: pattern
- [Custom loop] Tool = function + JSON schema kept in one place; registry "does not let the model call anything not explicitly registered. That is the entire authorization model at this layer" — source: algomindset.com/blog/agent-loop-from-scratch-no-framework · publisher: AlgoMindset (engineering blog) · published: 2026-09-10 · accessed: 2026-11-16 · confidence: medium · class: pattern

**G5 — streaming (token + tool progress)**

- [DSH] `StreamChunk` protocol: adapters yield text/reasoning/tool-call chunks; `ToolCallBlock`, `ToolResultMessage` first-class; per-tool `presentCall`/`presentResult` UI presenters — source: raw docs/subsystems/llm-streaming.md + tools.md · accessed: 2026-11-16 · confidence: high · class: compat
- [Agents SDK] `Runner.run_streamed()` → `stream_events()`: `RawResponsesStreamEvent` (token deltas) + `RunItemStreamEvent` (`tool_called`, `tool_output`); streamed runs compatible with tool-approval pauses — source: raw docs/streaming.md · accessed: 2026-11-16 · confidence: high · class: compat
- [pydantic-ai] Streaming first-class across interfaces (web UI event streams AG-UI/Vercel AI, voice transcripts) — source: raw README.md · accessed: 2026-11-16 · confidence: medium · class: compat
- [LangGraph] Streaming modes documented as feature (README bullet "streaming" guides); modes detail not read this run — source: README.md · accessed: 2026-11-16 · confidence: low-medium · class: compat

**G6 — limits / cancellation**

- [DSH] Per-tool `timeoutMs`, cancellation `AbortSignal` threaded into `execute`, agent `cancel(cause, options)` clearing queued work; explicit turn/step budget NOT found in greps — source: raw docs/subsystems/tools.md + core.md · accessed: 2026-11-16 · confidence: high (cancellation), low (step budget) · class: compat
- [Agents SDK] `result.cancel(mode=...)` incl. `after_turn`; cancellation semantics documented in streaming page — source: raw docs/streaming.md L63-65 · accessed: 2026-11-16 · confidence: high · class: compat
- [pydantic-ai] Harness ships `spend_limits` and `tool_output_limits` packages; core `UsageLimits` API not read this run — source: repo tree (src/pydantic_ai_harness/.../spend_limits/README.md) · accessed: 2026-11-16 · confidence: medium · class: compat
- [LangGraph] No limit/cancellation evidence gathered this run (recursion_limit known by reputation only — unverified belief) — class: compat

**Maturity / ecosystem / language fit**

- [DSH] TypeScript/Node only (npm + pnpm + Cordis DI; a Python SDK exists per AM-1); runs as local Web UI / desktop harness ("npx @deepseek-ai/dsh web") — **[the "agent *workstation*, not an embeddable server library" clause below is SUPERSEDED by AM-1 — see research.md §Amendments; the rest of this bullet stands, including developer-preview status and zero evidenced adoption]**; ships public postmortems in docs/ (engineering-practice signal); no production-use accounts found — source: README + repo tree · accessed: 2026-11-16 · confidence: high · class: maturity
- [LangGraph] "Trusted by Klarna, Replit, Elastic" (vendor claim, unverifiable here); JS sibling LangGraph.js exists (Node fit) — source: README.md · accessed: 2026-11-16 · confidence: medium · class: ecosystem
- [LangGraph] Consultancy retrospective (12 agentic projects): 8 started LangChain, 4 rewritten to LangGraph when *state management* became bottleneck; verdict: "LangGraph's debugging story is still worse than a custom loop. If you need full control over observability and error handling, consider building the loop yourself" — source: kalviumlabs.ai/blog/langgraph-vs-langchain-production/ · publisher: Kalvium Labs (consultancy, deployed at Maersk/TradeLab/Eternz per their claim) · published: ~2026 (undated page, "2026" in title) · accessed: 2026-11-16 · confidence: medium (single consultancy, marketing-adjacent) · class: maturity
- [LangGraph] Reddit r/LangChain thread "Is LangGraph suitable for enterprise production? 1000s of users" — search snippet: "They suck. Hard to maintain, expensive to run and unreliable" — thread body UNREAD (Reddit JSON blocked) — source: reddit.com/r/LangChain/comments/1twu3j5 · confidence: low · class: maturity
- [Custom loop] Pattern essay: "Every agent framework you will ever use is a wrapper around one while loop"; ~80-line loop covers the production core; failure modes live in the loop (tool-result ordering rule, unsatisfied stop condition burning turns) not the abstraction — source: algomindset.com (2026-09-10) · confidence: medium · class: pattern
- [pydantic-ai] Python-only (team's Node services cannot share it); instrumentation is plain OpenTelemetry, "any backend you already run works" (fits sovereign observability); built by Pydantic team, 2.x stable — source: README.md · accessed: 2026-11-16 · confidence: high · class: ecosystem

## LEADS

- **Contradiction to chase**: Agents SDK docs *recommend* Responses-API model shape as default while compat endpoints need explicit `OpenAIChatCompletionsModel` + `set_default_openai_api("chat_completions")` — verify vLLM tool-call streaming works under chat-completions shape with an actual vLLM version (release cadence of both is fast).
- **DSH pi-ai adapter**: verify whether `llm-pi-ai` (Badlogic pi-ai) exposes OpenAI-compatible base_url config → if yes DSH hits vLLM out-of-the-box despite no dedicated adapter. Also: DSH postmortem dir (`docs/postmortem/0002-*`) readable as maturity signal.
- **LangGraph gaps this run**: exact vLLM wiring (ChatOpenAI base_url), streaming modes (`astream_events` values vs updates), recursion_limit/step budget semantics, checkpointer ops burden (Redis/Postgres) — all primary-doc lookups, not done.
- **Reddit thread** (1twu3j5) unread — fetch via search cache or manual browse for real user complaints 6–12 months in.
- **Candidates the list missed**: Strands Agents (strandsagents.com — surfaced with agent-loop lifecycle events, AWS-backed); Microsoft Agent Framework `learn.microsoft.com/agent-framework/agents/looping`. Both worth a screen if pool widens.
- **OpenAI Agents SDK JS**: base_url/tracing story for the **JS** package unverified (only npm version+MIT read) — relevant given Node services.

## NOT FOUND

- DSH: production-deployment accounts; explicit max-steps/total-time budget knob; shipped OpenAI-compat adapter confirmation.
- LangGraph: operational-burden post-mortems from a named engineering org (only consultancy + one unread Reddit thread); direct doc evidence for vLLM base_url, streaming modes, execution limits.
- pydantic-ai: exact `UsageLimits` API doc page (guessed paths 404); OpenAI-compatible base_url doc.
- Agents SDK: adoption figures; whether `set_tracing_disabled` silences all telemetry (read from example, config page confirms default-on only).
- Any candidate: independent (non-vendor) production reference in a public-sector/sovereign context.
