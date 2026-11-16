# Patterns + implementation reality — governed agentic document-QA

Research subagent digest, run 2026-11-16. 8 sources read, 15-call budget spent. All claims traced to this run's retrievals.

## CLAIMS

**Q1 — where teams land (workflow vs agent vs agentic search)**
- Anthropic's canonical taxonomy separates **workflows** (predefined code paths) from **agents** (model-directed, tool loop); recommendation: "find the simplest solution possible, only increase complexity when needed" — for many apps a single LLM call + retrieval suffices; workflows give predictability, agents flexibility at higher cost/error-compounding — source: https://www.anthropic.com/engineering/building-effective-agents · Anthropic · 2024-12 (page carries a 2025-26 update note: tooling advice partially superseded by Managed Agents) · accessed 2026-11-16 · confidence: high · class: pattern
- Same essay names **evaluator-optimizer** (generate→LLM-judge→re-search loop) as the fit for "complex search tasks requiring multiple rounds", and mandates explicit **stopping conditions (max iterations)** on agents — same source · high · pattern
- Prompting-only agentic search is measurably weak: "prompting advanced LLMs to use search engines during inference is often suboptimal"; RL-trained multi-turn search agent (Search-R1) beats RAG baselines by **41% (Qwen2.5-7B) / 20% (3B)** across 7 QA datasets — source: https://arxiv.org/abs/2503.09516 · arXiv (Jin et al.) · v5 2025-08 · high (for the benchmark claim) · class: perf
- Practitioner failure report: agentic RAG that demos well then in production hits **dollar-per-query cost, ~8s latency, infinite loops on untested edge cases**; call count grows from 2-3 (plain RAG) to 10-15 with routing/validation/fallbacks — source: https://towardsai.com/p/machine-learning/why-90-of-agentic-rag-projects-fail-and-how-to-build-one-that-actually-works-in-production · Towards AI (practitioner blog, advocacy register, numbers partly secondhand "Adaline Labs") · 2026-01 · confidence: low (single account, unsourced internals) · class: pattern
- Same post's cited remedy set = smart routing (skip retrieval when unneeded), Self-RAG/CRAG-style retrieval validation — low · pattern (names match peer-reviewed work but claims uncited there)

**Q2 — streaming tool activity to the client**
- OpenAI Agents SDK (Python) models streaming as two layers: `raw_response_event` (raw LLM deltas, e.g. `response.output_text.delta`) + `RunItemStreamEvent` (`tool_called`, `tool_output`) — i.e. typed tool-lifecycle events alongside token deltas; run "not complete until the iterator ends" (post-processing continues past last token); streaming compatible with mid-run approval pauses — source: https://openai.github.io/openai-agents-python/streaming/ · OpenAI · page current 2026-11-10 · high · class: pattern
- MCP spec (2025-06-18): tools are **model-controlled**; spec says there SHOULD be a human-in-the-loop with ability to deny invocations, apps SHOULD show visual indicators when tools are invoked; spec defines structured content + outputSchema on tool results — source: https://modelcontextprotocol.io/specification/2025-06-18/server/tools · MCP/Anthropic · spec version 2025-06-18 · high · class: version+pattern
- Consolidation signal: Vercel AI SDK ships an MCP client integration page (`/docs/ai-sdk-core/mcp-tools`) plus a **Tool Approvals** doc for its agent loop — MCP is consolidating the *tool layer*; but NO single client stream-event standard surfaced: AI SDK's own old `streaming-tools`/`streaming` doc paths now 404 (docs restructured; UI stream parts moved toward the separate Chat SDK at chat-sdk.dev) — source: https://ai-sdk.dev/sitemap.md (retrieved 2026-11-16) · Vercel · current · medium · class: ecosystem

**Q3 — per-request authz on tool calls**
- LangChain engineering: for agents serving humans use **delegated access** (agent limited to what the delegating user may do; actions attributable to an approver) vs direct access for autonomous agents; proposes centralized "agent auth server" consolidating audit events, RBAC + just-in-time elevated access — source: https://www.langchain.com/blog/agent-authorization-explainer · LangChain · undated (retrieved 2026-11-16) · medium-high · class: pattern
- MCP spec pushes enforcement server-side + human confirmation, but the spec's tools page defers authz mechanics to its separate Authorization spec (OAuth-based; not read this run — see LEADS) — MCP spec TOC evidence · medium · version

**Q4 — bounded execution**
- Anthropic: agents must have explicit stopping conditions (max iterations) and get "ground truth from the environment at each step" to assess progress; autonomy ⇒ higher cost + compounding errors ⇒ sandboxed testing + guardrails — Anthropic essay · high · pattern
- OpenAI Agents SDK: framework-level support for pausing a run on tool approval inside a stream (a bounded-execution primitive) — OpenAI SDK docs · high · pattern
- Production infinite-loop failures reported by practitioner post (low confidence, corroborates) — Towards AI · low · pattern

**Q5 — citation/grounding enforcement**
- Small-n empirical test (Ollama llama3.2:1b answerer + stronger checker): bare prompt invented answers on **4/4** unanswerable questions; one grounding sentence ("use only these sources; say when they fall short") → **0/4**; ADDING a citation instruction on top made it **worse (1/4 invented)**; model attached a citation to an invented fact; skipped citations on 5/6 answerable questions; **citation verification = automated check that the cited source supports the claim**; a keyword-based refusal check itself miscounted ("measurement needs measuring") — source: https://kodekloud.com/blog/ground-llm-answers-with-citations/ · KodeKloud (engineering blog, reproducible test code included) · 2026-09 · confidence: medium (n small but method published) · class: pattern
- Training-side grounding exists (Search-R1 outcome-based reward over retrieval-augmented trajectories) but requires model training — arXiv Search-R1 · high · perf
- Practical upshot for the decision: grounding instruction ≠ citation enforcement — citations need a separate mechanical verification pass over structured tool results, not just prompt asks.

**Q6 — vLLM tool-calling reality (docs page current 2026-11-12)**
- Server must run `--enable-auto-tool-choice` + a **model-family-specific `--tool-call-parser`** (hermes, mistral, llama3_json, granite, qwen, deepseek_v3/v31, gpt-oss `openai`, kimi_k2, glm47, hf response-template parser, …); without a loaded parser, named/`required` `tool_choice` requests get **HTTP 400** — source: https://docs.vllm.ai/en/latest/features/tool_calling/ · vLLM project · page 2026-11-12 · high · class: compat
- `tool_choice`: `auto`, named function, `required` (since vllm≥0.8.3), `none`; named/required route through the **structured-outputs backend** (guided JSON) — "guaranteed a validly-parsable function call — not a high-quality one"; **first named/required call pays seconds of FSM compile latency** before caching — same source · high · compat+perf
- Strictness trap: "most OpenAI-compatible clients and agent frameworks never set `strict` on their tools", so with `auto` the model emits tool calls **without any grammar** and malformed markup leaks into responses; remedies: per-tool `strict: true` (envelope + argument schema), server floor `--tool-strict-level function|parameter`, or default-on `VLLM_ENFORCE_STRICT_TOOL_CALLING=true` — same source · high · version
- Streaming quirk (hf/checkpoint parsers): each tool call is **emitted whole once its region parses** (no argument-delta streaming); a call truncated before its closer is parsed from partial text; a non-parsing call is **dropped silently**; hf parser **rejects** `strict` tools, required/named tool_choice, and `parallel_tool_calls=false` — same source · high · compat
- No parser = no tool calls at all (auto included requires the flag+parser); guided-JSON via structured outputs interacts with custom grammars (parser boundary tokens must match) — same source · high · compat

**Q7 — 6-12 months later**
- Anthropic itself flags its Dec-2024 agent-building advice as overtaken (Managed Agents) within ~1 year — evidence of fast pattern churn in this space — Anthropic page note · high · maturity
- Practitioner retrospective (1 year enterprise agentic RAG) surfaced but blocked (Reddit 403) — NOT verified; the Towards AI post (2026-01) is the best retrospective-form source read: complexity kills, observability neglected, router misrouting cited at 40% (unsourced) — low · maturity
- McKinsey "10-20% of AI POCs scale" quoted secondhand in that post — treat as unverified · low · ecosystem

## LEADS
- **CONTRADICTION to chase**: framework guidance says "start simple, workflows first" (Anthropic) vs practitioner posts claiming routing/multi-step is where the wins are (Towards AI citing Adaline 30-45% cost cut) — the latter's numbers are unsourced; needs the Adaline primary.
- Oso "Authorization in LLM Applications" chapter (https://www.osohq.com/academy/authorization-in-llm-applications) — fetch failed (ad-tracker redirect); retry directly, it looked directly on-point for per-request tool authz (actor = the human user).
- IETF draft `draft-klrc-aiagent-auth-00` — OAuth 2.0 delegation for AI agents; primary source for identity propagation into tool executors.
- MCP Authorization spec page (basic/authorization, 2025-06-18) — not read; the authz mechanics reference.
- Supertokens "capability tokens per task" + Nango "credentials injected server-side" posts — model-driven-authz anti-pattern and per-call capability patterns; not read.
- Vercel Chat SDK (chat-sdk.dev) — where AI SDK UI message stream parts (tool-input/output-available) now live; old ai-sdk.dev paths 404.
- vLLM parser set churns fast (page updated 2026-11-12; glm47/kimi_k2/deepseek_v31 all recent) — re-pin parser choice at build time, verify against the deployed vLLM version.
- Reddit r/Rag thread "one year of agentic RAG in enterprise production" (1xqvb1r) — 403 to fetch; if reachable via another route, directly answers Q7.

## NOT FOUND
- **Cancellation/client-disconnect propagation** into an agent loop (AbortController → vLLM abort, SSE close → tool-loop halt): nothing retrieved; no framework doc read covers it. Unverified belief only — must be designed in and tested locally.
- **Token-budget-capped loops** (max_tokens across a multi-step run): no source.
- **Node-vs-Python agent-loop placement** lessons: nothing retrieved. Observable ecosystem fact only: OpenAI Agents SDK streaming doc is Python; Vercel AI SDK is TS — no production comparison found.
- Named "model-driven authz" anti-pattern write-ups: not read (leads above may cover).
- Per-tool **result filtering** (post-filtering tool output before the model sees it): not found in sources read; only inference-level support in MCP's server-side enforcement model.
- Streaming tool-call **argument deltas** on vLLM for non-hf parsers: docs detail the hf parser's whole-call emission; other parsers' streaming granularity not confirmed either way this run.
