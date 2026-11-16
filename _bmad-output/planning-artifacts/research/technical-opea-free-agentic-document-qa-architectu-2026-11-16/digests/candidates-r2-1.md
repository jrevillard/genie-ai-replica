# Agent-runtime screen — round 2 (gap-closing)

Research subagent digest, run 2026-11-16. Follows candidates-r1-1.md. ~9 primary sources read (DSH package README/config, LangGraph source + docs, pydantic-ai docs + source). GitHub API rate limit hit near the end — Strands/Mastra unresolved.

## CLAIMS

**1. DSH ↔ vLLM (G3) — RESOLVED: DSH passes G3 via the shipped pi-ai adapter**

- [DSH] `@deepseek-ai/dsh-llm-pi-ai` "routes model requests to multiple pi-ai providers, OpenAI-compatible gateways, or self-hosted servers from one configuration" — source: raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/llm/llm-pi-ai/README.md (Summary) · publisher: DeepSeek (repo) · undated (living) · accessed: 2026-11-16 · confidence: high · class: compat
- [DSH] Exact mechanism: `providers` YAML dict, one route per key; custom route declares `api: openai-completions` + `baseURL: https://gateway.acme.example/v1` + per-model entries (`id`, `name`, `contextWindow`); credentials via `apiKeyEnv` (env-var reference, "no secret enters the configuration file"); "settings changes take effect on the next request without a restart" — source: same README (Configure provider routes + example) · accessed: 2026-11-16 · confidence: high · class: compat
- [DSH] Adapter is a shipped workspace package (not user code), backed by `@earendil-works/pi-ai` ^1.3.0; mounts alongside `dsh-llm-deepseek` — source: packages/llm/llm-pi-ai/package.json + README (When to choose it) · accessed: 2026-11-16 · confidence: high · class: compat
- [DSH] vLLM is not named verbatim anywhere in the adapter README — the path is the generic `openai-completions` API shape + baseURL, which vLLM serves. No DSH↔vLLM tested combination evidenced this run — confidence: high (mechanism), medium (vLLM specifically) · class: compat
- [DSH] pi-ai upstream repo location unverified (`earendil-works/pi-ai` not found via API; may be rate-limit artifact) — class: ecosystem

**2. LangGraph doc gaps**

- [LangGraph] (a) ChatOpenAI → custom OpenAI-compatible endpoint, official docs resolution order (first match wins): explicit `base_url` (or `openai_api_base`) kwarg → `OPENAI_API_BASE` (read by LangChain at init) → `OPENAI_BASE_URL` (read by the underlying openai SDK client); docs frame this as "routing requests through a proxy or service emulator" — source: python.langchain.com/docs/integrations/chat/openai/ · publisher: LangChain (official docs) · undated (living) · accessed: 2026-11-16 · confidence: high · class: compat
- [LangGraph] (b) Streaming modes, from source: `StreamMode = Literal["values", "updates", "checkpoints", "tasks", "debug", "messages", "custom"]`; `"messages"` = "Emit LLM messages token-by-token together with metadata for any LLM invocations"; `"custom"` = "Emit custom data from inside nodes or tasks using `StreamWriter`"; `"updates"` = per-step node/task updates — source: raw langgraph/libs/langgraph/langgraph/types.py L132-147 · publisher: LangChain (source of truth) · accessed: 2026-11-16 · confidence: high · class: compat
- [LangGraph] (b) Tool-progress surfacing = combine `messages` (LLM/tool-call chunks) + `custom` (in-node StreamWriter events); no dedicated "tool event" mode in the Literal — source: same types.py · accessed: 2026-11-16 · confidence: high · class: compat
- [LangGraph] (c) Step budget: `self.stop = self.step + self.config["recursion_limit"] + 1` (loop engine); `GraphRecursionError(RecursionError)` — "Raised when the graph has exhausted the maximum number of steps. This prevents infinite loops. To increase… run your graph with a config specifying a higher `recursion_limit`" — source: raw langgraph/libs/langgraph/langgraph/pregel/_loop.py L1923 + errors.py L69-73 · accessed: 2026-11-16 · confidence: high · class: compat
- [LangGraph] (c) Budget is step-count only; no time-based or request-count budget found in source greps — class: compat (see NOT FOUND)
- [LangGraph] (d) Checkpointer: `langgraph-checkpoint` defines the `BaseCheckpointSaver` interface; checkpointer "save[s] graph state at every superstep, enabling human-in-the-loop, memory between interactions, durable execution"; thread model = `thread_id` (required) + optional `checkpoint_id`; `InMemorySaver` ships in the core package — source: raw langgraph/libs/checkpoint/README.md · publisher: LangChain · accessed: 2026-11-16 · confidence: high · class: compat
- [LangGraph] (d) External-backend savers (Postgres/Redis): probed `langchain-ai/langgraph-postgres`, `langgraph-redis`, `langgraph-checkpoint-postgres` — all returned None/404 this run (likely API rate-limit + name drift); their existence and ops burden UNVERIFIED — class: ecosystem

**3. pydantic-ai gaps**

- [pydantic-ai] (a) `UsageLimits` (pydantic_ai.usage.UsageLimits) — fields: `request_limit` (**default 50**, "bounds the number of turns of the agent loop, not the number of requests sent to the provider", "checked at the start of each step of the run"), `output_tokens_limit`, `total_tokens_limit`, `per_request_input_tokens_limit`; raises `UsageLimitExceeded` (imported from exceptions) — source: raw pydantic-ai/pydantic_ai_slim/pydantic_ai/usage.py L548-630 · publisher: Pydantic team (source) · accessed: 2026-11-16 · confidence: high · class: compat
- [pydantic-ai] (a) Retry story: default client `max_retries=2` (one request can hit network up to 3×), retries 408/409/429/5xx/timeouts/connection errors + honors `x-should-retry`; override per model/agent/run via `ModelSettings['max_retries']`; "Retry multiplication" doc covers layer stacking — source: raw docs/models/openai.md L77 · accessed: 2026-11-16 · confidence: high · class: compat
- [pydantic-ai] (b) OpenAI-compatible endpoints: install doc literally "To use OpenAI models **or OpenAI-compatible APIs**…"; `OpenAIProvider` defaults `base_url=https://api.openai.com/v1`; programmatic `OpenAIProvider(base_url=...)`, or full custom `AsyncOpenAI` client via `openai_client` param ("customise the `organization`, `project`, `base_url` etc.") — source: raw docs/models/openai.md L9, L56-77 · accessed: 2026-11-16 · confidence: high · class: compat
- [pydantic-ai] (b) vLLM not named in the OpenAI model page; wiring is the generic OpenAI-compatible base_url — class: compat

**4. Optional targets — unresolved**

- [Strands] GitHub org `strandsagents` and repo guesses (`strands-agents`, `sdk`, `sdk-python`, `samples`) all 404/None this run — repo URL + licence NOT verified. Round-1 lead (strandsagents.com site) stands, nothing more.
- [Mastra] LICENSE file 404 on main/develop/master × LICENSE/LICENSE.md/LICENSE.txt; repo API call rate-limited (no default_branch). Licence unresolved; "NOASSERTION" from lead unconfirmed.

## LEADS

- **DSH↔vLLM smoke remains the decider**: mechanism documented, one untested seam — confirm pi-ai's `openai-completions` API shape against a live vLLM `/v1/chat/completions` (tool-call streaming included) before scoring G5 full marks.
- **LangGraph external savers**: find current package names (postgres saver moved at least once historically); ops burden = a DB + per-superstep state writes is the structural cost — verify current names + write volume claims in docs.
- **LangGraph cancellation**: round 1+2 both silent on cancel semantics (asyncio-task cancel vs NodeCancelledError path); `NodeCancelledError` exists in errors.py exports — cheap follow-up.
- **pydantic-ai**: `FallbackModel`/`ModelFallback` appear in usage.py docstrings — failover chain relevant to a governed deployment; not screened.
- **Strands/Mastra**: retry after rate-limit window resets (GitHub unauthenticated 60/hr) — likely one API call each.

## NOT FOUND

- DSH: pi-ai upstream repo (earendil-works/pi-ai) — API lookup failed; vLLM named as tested target.
- LangGraph: time-based/request-count execution budget; current external checkpointer package names + their operational-burden docs; cancellation semantics.
- pydantic-ai: a doc page naming vLLM explicitly (only generic OpenAI-compatible wiring).
- Strands: repo URL, licence, version — all blocked.
- Mastra: licence file — blocked (rate limit + branch drift).
