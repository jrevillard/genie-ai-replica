---
title: 'technical research: OPEA-free agentic document QA architecture and agent runtime'
type: 'technical'
topic: 'OPEA-free agentic document QA architecture and agent runtime'
decision: 'Pick the agent runtime and architecture patterns for GENIE.AI's OPEA-free agentic document-QA integration (issue #1729, stage S1); feeds the first PRD'
source: 'BMad deep-recon run, issue #1729 framing'
status: complete
preset: 'standard'
validation: 'normal'
created: '2026-11-16'
updated: '2026-11-16'
claims: {verified: 2, unverified: 22, overturned: 1}
---

# technical research: OPEA-free agentic document QA architecture and agent runtime

**Decision this research serves:** Pick the agent runtime and architecture patterns for GENIE.AI's OPEA-free agentic document-QA integration (issue #1729, stage S1); feeds the first PRD.

## Executive summary

**The evidence says: build SC-01 as a custom minimal tool-calling loop behind the GENIE document-capability contract, in a new OPEA-free service — do not adopt DeepSeek Harness (DSH) as a dependency, and do not adopt a heavyweight framework for the first iteration.** Three findings drive this:

1. **DSH is not adoptable today.** It passes the hard gates on paper (MIT; a shipped `pi-ai` adapter reaches OpenAI-compatible endpoints [22]), but it is a 3-month-old self-declared developer preview that promises breaking changes, carries an explicit "not production-ready, no security audit" safety notice [20], shows zero evidenced customer-facing adoption [21], and is architected as a TypeScript agent *workstation*, not an embeddable server library [20]. Its plugin architecture is worth borrowing as a pattern, not as a dependency.
2. **The field churns too fast to marry.** Anthropic's own agent guidance was partially superseded within a year [1]; the runtime field restructured around vendor stacks in 2026 (AutoGen→Microsoft Agent Framework [23][24]); a consultancy retrospective rates LangGraph's debugging story *worse than a custom loop* [27]. A thin loop behind a stable contract maximizes reversibility — the operator's stated preference.
3. **The hard engineering is in the seams we own either way.** vLLM tool-calling needs a family parser + `strict` schemas or malformed calls leak [2]; citations need mechanical verification, not prompting [9]; per-request authorization has a converged pattern (effective permissions = user ∩ task over the registered toolset, the user is the actor) [8][11]; cancellation and client-disconnect propagation are undocumented everywhere and must be designed in-house [3].

**Biggest caveat:** the "custom loop is enough" position rests on medium-confidence practitioner evidence ([26][27]) plus the structural argument; no public head-to-head exists at GENIE's scale, Node-vs-Python placement has no retrieved evidence at all, and the field's one documented sovereignty failure (a candidate whose tracing ships to a vendor cloud by default [4][5]) surfaces only at §2.2 — audit defaults as gates, not just features. The weighted matrix (§2.3) is presented so the operator can re-weight; **pydantic-ai is the named runner-up** and wins if typed framework support or durable multi-step execution is valued over loop ownership.

## Requirements frame (agreed at plan gate, 2026-11-16)

Hard gates (fail = cut): G1 OPEA-free (no `comps`, no OPEA service calls, no OPEA build-time downloads) · G2 Apache-2.0-compatible licence · G3 sovereign self-hosted (local vLLM/TEI, no mandatory cloud API) · G4 server-side authorization per operation (model arguments cannot widen access) · G5 compatible with existing SSE chat contract · G6 bounded server-side execution (time, tool calls, evidence volume, cancellation) · G7 provenance (citations resolvable to stable source identifiers).

Weighted preferences: simplicity/maintainability (high, weight 3) · production maturity (high, 3) · reversibility/exit cost (medium-high, 2.5) · extensibility/plugin architecture (medium, 1.5) · team fit Node.js+Python (medium, 1.5) · OTel observability fit (medium, 1.5).

Candidates screened: DeepSeek Harness, LangGraph, OpenAI Agents SDK, pydantic-ai, custom minimal loop. Wildcards surfaced during research (Agno, Google ADK; Mastra licence-blocked) are recorded in §1.

## 1. Landscape & maturity, and ecosystem health

**Where agentic document QA stands (2026).** The 12-month shift is the merger of RAG with agent loops: retrieval executed inside a model-directed tool loop with four primitives — decision-to-retrieve, query transformation/decomposition, iterative retrieval, self-check — and five recurring production patterns (query rewrite/decompose, multi-hop with state, tool routing across retrievers, faithfulness self-check on the draft, re-retrieve-until-supported under a step budget) [10]. Production bounds reported: 1–6 retrievals per turn (production systems cap them at 4–6), 3–8 LLM calls per turn; classic single-shot RAG remains the correct choice for single-document lookup, agentic wins on multi-hop and ambiguous queries (single publisher — medium) [10]. Independent corroboration of the direction from two 2026 surveys [25] (medium). This aligns with SC-01: iterative search–read–refine with explicit limits.

**The runtime field.** Live GitHub API data (accessed 2026-11-16): LangGraph 45.0k★ / 71 releases in 6 months / MIT [15]; OpenAI Agents SDK (python) 30.7k★ / 28 releases / MIT [18][19]; pydantic-ai 21.2k★ / **100 releases — fastest cadence measured** / MIT [6]; all three pushed within a day of access. The field is restructuring around vendor-ecosystem stacks — Microsoft Agent Framework 1.0 (2026-04-03) merged Semantic Kernel + AutoGen [23][24], Google ADK 22.2k★/Apache-2.0, AWS Strands — plus independents (LangGraph, pydantic-ai, smolagents 30.4k★ but release train stalled at one release in 6 months [24]) and hype entrants. Agno (43.2k★, Apache-2.0) is a credible wildcard the initial candidate list missed [23][24]; Mastra (29.5k★, TS) is licence-blocked pending a manual LICENSE read [24].

**Five-year regret signals.** Pydantic's own framework guide (2026-11-02, transparent methodology, self-interested) [23] positions: OpenAI Agents SDK if OpenAI is your provider *and* tracing stack; LangGraph if already on LangSmith; pydantic AI for typed multi-provider with 9 durable-execution engines, MCP, OTel; vendor stacks map to their clouds (medium-high). LangChain Inc funding durability could not be established from retrieved data. Anthropic's own agent-building guidance was partially superseded within ~1 year [1] — the pattern space churns fast, which argues for a thin, replaceable agent layer.

## 2. Candidate screen

### 2.1 Hard-gate screen — all five pass on paper; two with caveats

| Gate | DSH | LangGraph | Agents SDK | pydantic-ai | custom loop |
|---|---|---|---|---|---|
| G1 OPEA-free | pass | pass (brings `langchain-core` dep [16]) | pass | pass | pass |
| G2 licence | MIT, repo+npm verified [20] | MIT [15] | MIT (py+js) [19] | MIT (repo; PyPI licence field empty) [6] | n/a |
| G3 vLLM self-host | pass via shipped `pi-ai` adapter: `api: openai-completions` + `baseURL` + `apiKeyEnv` [22] (vLLM itself untested) | pass: `ChatOpenAI(base_url=…)` / `OPENAI_API_BASE` [32] | pass: `set_default_openai_api("chat_completions")` or `OpenAIChatCompletionsModel` (py) [4]; `setDefaultOpenAIClient`/`OpenAIProvider` (js) [5] | pass: `OpenAIProvider(base_url=…)` documented for OpenAI-compatible APIs [7] | pass natively (we own the client) |
| G4 server-defined tools | pass — `ToolDefinition` separates model-facing schema from server `execute`; allowlist keeps internals out of model requests [20] | pass (prebuilt ToolNode) | pass (function tools) | pass (`@tool`, typed) | pass by construction |
| G5 streaming SSE | StreamChunk protocol with tool blocks + UI presenters [20] | `messages` (token) + `custom` (in-node events) modes, source-verified [17] | `raw_response_event` + `tool_called`/`tool_output` events [3] | streaming first-class across interfaces (medium) [6] | we shape events; AG-UI taxonomy as reference [13] |
| G6 bounded execution | **partial**: per-tool `timeoutMs` + `AbortSignal` + `cancel()`; no step budget found [20] | `recursion_limit` step budget + `GraphRecursionError`; **no time/token budget** [17] | cancellation documented (`cancel()`, `after_turn`) [3]; step budget not verified this run | **most complete**: `UsageLimits` — `request_limit` (default 50, bounds loop turns), output/total/per-request token limits, `UsageLimitExceeded` [7] | ours to build (mandatory per [1]) |
| G7 provenance | structured tool results + output-schema validation [20] | — | — | — | ours to build |

**Cuts and caveats recorded:** no candidate failed a hard gate outright. DSH's G6 is partial; Agents SDK carries two sovereignty caveats (§2.2). Mastra cut (licence unverified) [24]; Strands unscreened (repo not located — rate-limited) [24]; Agno/ADK parked as wildcards (vendor-cloud-first positioning) [23].

### 2.2 Evidence per criterion (the cells that matter)

- **Agents SDK — the sovereignty landmine:** tracing is **enabled by default and exports to OpenAI cloud using the model key, even when `baseURL` points elsewhere** — in JS server runtimes [5] and Python [4]. `setTracingDisabled(true)` is a must-set flag for GENIE. Chat-Completions (CC) compatibility mode "silently drops" Responses-only fields, **including tool outputs that are not text-only** [4]. Python docs do not state that tool-call deltas stream correctly in CC mode (examples are Responses-shaped) — live test required [4][3].
- **LangGraph — maturity vs weight:** Production/Stable, strongest vitality [15], but "standalone" still hard-depends on `langchain-core` [16]; the checkpointer (state saved at every superstep, `thread_id` model) is core machinery SC-01 does not need [17]; a 12-project consultancy retrospective reports teams adopting LangGraph for state management, then concluding "LangGraph's debugging story is still worse than a custom loop" [27] (single consultancy, medium).
- **pydantic-ai — the quiet stable one:** 2.68.0 Production/Stable, fastest release cadence in the field [6]; `UsageLimits` is the only source-verified budget story covering loop turns *and* tokens [7]; OpenAI-compatible `base_url` documented [7]; plain OTel ("any backend you already run works") [6]; Python-only [6].
- **Custom loop — what the evidence says:** "Every agent framework you will ever use is a wrapper around one while loop"; the production core is ~80 lines; failure modes live in the loop (tool-result ordering, unsatisfied stop conditions), not the abstraction [26] (single practitioner source, medium). The registry *is* the authorization model at this layer: the model cannot call anything not explicitly registered [26]. Anthropic's taxonomy independently recommends the simplest construct that works, with mandatory stopping conditions [1].
- **DSH — mechanism resolved, verdict unchanged:** the shipped `dsh-llm-pi-ai` adapter routes to "OpenAI-compatible gateways or self-hosted servers" via a providers YAML with `api: openai-completions` + `baseURL`, credentials by env reference, hot-reload without restart [22] — so G3 passes. The ecosystem record: repo created 2026-08-13, 282k★ launch velocity, 39 releases in 3 months, self-declared developer preview [20]; real launch traction (HN: 747 pts launch, 417 pts desktop) but zero evidenced customer-facing adoption — an "Ask HN" thread drew no reports [21] (medium; absence evidence); a niche Cordis DI dependency (bus-factor risk, unquantified) [20] (low); GitHub Discussions as the only support surface [20]. It remains a developer-preview TS workstation — gate detail in §2.1.

### 2.3 Weighted decision matrix

Scores 1–5 per criterion; weights from the agreed frame. **The matrix is the deliverable — re-weight to taste.**

| Criterion (weight) | custom loop | pydantic-ai | Agents SDK | LangGraph | DSH |
|---|---|---|---|---|---|
| Simplicity (3) | 5 | 4 | 3 | 2 | 1 |
| Production maturity (3) | 4 | 4 | 3 | 5 | 1 |
| Reversibility / exit cost (2.5) | 5 | 4 | 4 | 2.5 | 2 |
| Extensibility / plugins (1.5) | 3 | 4 | 4 | 4 | 5 |
| Team fit Node+Python (1.5) | 4 | 3 | 5 | 4 | 3 |
| OTel / sovereign observability (1.5) | 5 | 5 | 2 | 3 | 3 |
| **Weighted total** | **57.5** | **52.0** | **44.5** | **43.8** | **27.5** |

Cell notes: custom-loop maturity 4 (no framework to deprecate, but in-house ownership of validation/retries — supported by [26][27], not proven); Agents SDK OTel 2 (cloud-default tracing [4][5]); DSH extensibility 5 is its genuine strength [20], insufficient against maturity 1 [20][21].

### 2.4 Verdict

- **Pick: custom minimal tool-calling loop**, owned by GENIE, behind the document-capability contract. Rationale: highest on the two heaviest criteria (simplicity, reversibility) *and* on sovereign observability; the risks that matter are ours under every option (§5).
- **Runner-up: pydantic-ai** — wins instead if (a) typed tool schemas + built-in `UsageLimits` [7] + MCP support are valued over loop ownership, or (b) the agent outgrows SC-01 into durable multi-step workflows (9 durable-execution engines [23]). It is also the cheapest migration target from the custom loop (same Python placement, typed tools map 1:1).
- **Strongest argument against the pick:** we own plumbing frameworks ship (retries, schema validation, tool-delta streaming quirks) — evidence is medium-confidence practitioner accounts [26][27], not a measured comparison.
- **Cheapest reversibility hedge:** keep the loop thin (≈300 LOC) behind the contract; adopt the AG-UI event taxonomy [13] for the SSE shape; exit test = a swap-in spike replacing the loop with pydantic-ai in ≤1 day.

## 3. Architecture patterns in practice

**Start simple — with teeth.** Anthropic's taxonomy: workflows (predefined paths) vs agents (model-directed loops); "find the simplest solution possible, only increase complexity when needed"; agents require explicit stopping conditions and environmental ground truth each step [1]. SC-01 as specced (one agent, small toolset, step budget) is exactly the rung above single-shot RAG that the pattern literature endorses for multi-hop/ambiguous queries [10].

**Agentic search beats prompting-only search, when trained.** Search-R1: an RL-trained multi-turn search agent beats RAG baselines by 41% (7B model) / 20% (3B model) across 7 QA datasets [31]. Not actionable for GENIE (requires model training), but it bounds the ceiling: a prompted loop over a strong retriever captures part of the gain; the rest is in the model.

**Client stream events — converging shape, no ratified standard.** AG-UI 1.0 formalizes the taxonomy (run lifecycle, text-message deltas, **ToolCall Start/Args/End/Result**, state, activity events) with TS/Python/.NET SDKs [13]; Vercel Chat SDK's web adapter "speaks both the AI SDK and AG-UI stream protocols" [14]; AI SDK's chunk stream types `text-delta`, `source`, `tool-call` and ship `repairToolCall` [14]. MCP standardizes the *tool layer* (model-controlled tools, server-side enforcement, human-in-the-loop SHOULDs), not the client stream [12]. Adoption at scale unread (OQ-4).

**Per-request authorization — converged pattern.** Oso: effective permissions of an LLM operation = **intersection of (LLM, user, task) permissions**; LLM apps acting for a user use *impersonation* semantics — the user is the actor, neither party gains permissions [8]. LangChain independently: *delegated access* — the agent is limited to what the delegating user may do, actions attributable to an approver [11]. Two independent publishers, same model (claim verified). IETF's individual draft reuses OAuth 2.0/WIMSE rather than inventing protocols — but the -00 revision expired 2026-09-03; check for -01 before citing as direction [28].

**Citation enforcement is mechanical, not rhetorical.** Small-n reproducible test: a one-sentence grounding instruction took invented answers from 4/4 to 0/4 on unanswerable questions — but *adding* a citation instruction made it worse (1/4 answers still invented): the model attached citations to invented facts and skipped them when due [9]. Enforcement = automated verification that each cited source supports its claim, over structured tool results carrying stable source ids [9]. Prompt grounding + mechanical verification + refusal path; eval sets must contain unanswerable questions (already in the framing's E01/E02 protocol).

**Bounded execution.** Explicit stopping conditions are the pattern-literature mandate [1]; production failure reports corroborate (infinite loops on untested edges, call counts 2–3→10–15) [30] (low confidence, single account). Cancellation semantics are documented only for Agents SDK: breaking the stream loop does NOT stop the run; `cancel()` does; tool effects cannot be undone [3]. Client-disconnect→loop→vLLM propagation: **no framework documents it** — design in-house, test in E01/E02.

## 4. Implementation reality

**vLLM is the minefield — pin it.** Tool calling requires `--enable-auto-tool-choice` plus a model-family parser (hermes/mistral/qwen/granite/deepseek_v3…); without one, named/required `tool_choice` returns HTTP 400 [2]. "Most OpenAI-compatible clients and agent frameworks never set `strict`" — with `auto`, tool calls emit without grammar and malformed markup leaks into responses; remedies: per-tool `strict: true`, `--tool-strict-level`, or `VLLM_ENFORCE_STRICT_TOOL_CALLING=true` [2]. First named/required call pays seconds of FSM-compile latency [2]. The hf/checkpoint parsers emit tool calls whole (no argument deltas) and drop non-parsing calls — the docs describe no error path [2]. Whatever runtime wins, GENIE must pin the parser choice against the deployed vLLM version and budget the first-call latency. AI SDK's `repairToolCall` is the reference pattern for the malformed-call path [14].

**Adaline numbers settled (and shrunk).** The primary claim: intent classification before retrieval cuts costs 40% / latency 35% — vendor-reported, no methodology in the retrieved portion [29]. The secondary's "30–45%/25–40%" was drift (claim overturned). Direction (route before retrieving) is plausible and cheap to evaluate within E02; the numbers are not evidence.

**Cost/latency reality of agentic RAG.** Practitioner failure account: demos well, then dollar-per-query cost, ~8s latency, infinite loops in production; observability neglected [30] (low confidence — the only retrospective-form source retrieved; direction matches the budget bounds in [10]).

**Node-vs-Python placement: no public evidence.** Not found in either round. What exists: OpenAI Agents SDK ships both languages [3][5]; Vercel AI SDK is TS [14]; pydantic-ai is Python-only [6]. The placement decision (agent loop in the Node BFF vs a new OPEA-free Python service) is an architecture decision from team constraints — SSE contract handling lives in the Node BFF today; AI-adjacent code lives in Python today.

## 5. Cross-dimension insights

1. **The seams, not the runtime, carry the risk** — vLLM parser/strictness [2], cancellation propagation [3], citation verification [9], per-request authz [8][11] are GENIE's under every option; this is the structural argument behind the custom-loop pick (§2.4), reinforced by measurable pattern churn (§1's regret signals — the field's half-life is months [1][23][24]).
2. **Sovereignty is attacked by defaults, not features.** The only candidate with a documented sovereignty failure ships telemetry to a vendor cloud *by default*, keyed on the same credential as a self-hosted baseURL [4][5]. Audit defaults as gates, not just capabilities — a PRD-level requirement, not a one-off flag.

Two further syntheses are consumed directly by the recommendations: DSH's `ToolDefinition` split is the G4 pattern to borrow (REC-8), and SC-01's evidence-backed refusal path is REC-5.

## 6. Recommendations (bound to issue #1729, stage S2 — PRD input)

- **REC-1 (architecture spine):** Implement SC-01 as a custom minimal tool-calling loop in a new OPEA-free service, behind the GENIE document-capability contract. Confidence basis: structural argument + [1][26][27] (medium); the matrix in §2.3 is re-weightable. → PRD core decision D03.
- **REC-2 (runner-up hedge):** Keep pydantic-ai as the designated fallback: typed tools, `UsageLimits` [7], OTel [6]. Exit test: ≤1-day swap-in spike. → PRD reversibility requirement (framing R10).
- **REC-3 (bounded execution, G6):** Step cap + wall-clock + per-run token budget + evidence-volume cap, cancellation propagated from client disconnect. No framework supplies this completely [3][7][17] — write it as explicit requirements. → PRD R07 refinement.
- **REC-4 (authz, G4):** Effective permissions = user ∩ task (the LLM leg is the registered toolset); the user is the actor; enforcement in the tool executor with per-request identity, reusing GENIE's scope-authz services [8][11]. Model-generated arguments never widen access. → PRD R03/R04 refinement.
- **REC-5 (citations, G7):** Structured tool results carrying stable source ids + mechanical citation-verification pass + grounding sentence in the system prompt + refusal path; eval sets include unanswerable questions [9]. → PRD R05 refinement, E01/E02 protocol.
- **REC-6 (vLLM ops):** Pin parser family per served model, enforce strict tool calling, budget first-call FSM latency, test tool-delta streaming against the deployed parser [2]. → PRD operational prerequisites; framing V03 baseline.
- **REC-7 (SSE contract, G5):** Adopt the AG-UI event taxonomy as the internal event shape (tool lifecycle + text deltas + run lifecycle) [13][14], mapped onto the existing SSE contract in the BFF. → PRD R06 compatibility.
- **REC-8 (DSH):** Do not adopt as a dependency. Record the revisit trigger: stable (non-preview) release + embeddable server mode + security audit [20][21]. Borrow the ToolDefinition split as a pattern now [20]. → decision register D03 evidence.

## 7. Open questions

| # | Question | Route |
|---|---|---|
| OQ-1 | Does tool-call delta streaming work in Agents-SDK Python CC mode / DSH pi-ai adapter against the *deployed* vLLM parser? | Live smoke test (only if either is reconsidered) |
| OQ-2 | LangGraph cancellation semantics; current external-checkpointer package names | Source/docs read after rate-limit window |
| OQ-3 | Strands repo+licence; Mastra LICENSE text | One API call each after rate-limit window |
| OQ-4 | AG-UI production adoption at scale | Read adoption page + repos before standardizing on it (REC-7 is pattern-level, not dependency-level) |
| OQ-5 | IETF draft-klrc-aiagent-auth continuation (-01/adoption) | datatracker check at PRD time |
| OQ-6 | Node vs Python placement of the agent loop | Architecture decision from team constraints (no public evidence exists) |
| OQ-7 | Cancellation/disconnect propagation loop→vLLM | Design + test in-house (E01/E02 must cover it) |

## Source appendix

| [n] | Supports | Publisher | Pub date | Accessed | Confidence |
|---|---|---|---|---|---|
| [1] | workflows-vs-agents taxonomy, stopping conditions, supersession note | [Anthropic engineering](https://www.anthropic.com/engineering/building-effective-agents) | 2024-12 (upd. 2025-26) | 2026-11-16 | high |
| [2] | vLLM tool-calling: parser requirement, strict trap, streaming quirks, FSM latency | [vLLM docs — tool calling](https://docs.vllm.ai/en/latest/features/tool_calling/) | 2026-11-12 | 2026-11-16 | high |
| [3] | Agents SDK streaming events + cancellation semantics | [OpenAI Agents SDK — streaming (py)](https://openai.github.io/openai-agents-python/streaming/) | 2026-11-10 | 2026-11-16 | high |
| [4] | Agents SDK py: CC-mode escapes, silent drops, tracing default-on | [OpenAI Agents SDK — models/config (py)](https://openai.github.io/openai-agents-python/models/) | 2026-11-10 | 2026-11-16 | high |
| [5] | Agents SDK js: baseURL mechanisms, tracing default-on in server runtimes | [OpenAI Agents SDK (js) docs](https://openai.github.io/openai-agents-js/) | current | 2026-11-16 | high |
| [6] | pydantic-ai: licence, stability, cadence, providers, OTel, Python-only | [pydantic-ai repo (README + GitHub API)](https://github.com/pydantic/pydantic-ai) | 2026-11 | 2026-11-16 | high / medium-high |
| [7] | pydantic-ai UsageLimits + OpenAI-compatible base_url | [pydantic-ai source + docs (usage.py, models/openai.md)](https://github.com/pydantic/pydantic-ai) | 2026-11 | 2026-11-16 | high |
| [8] | effective-permissions intersection, impersonation semantics | [Oso — Authorization in LLM Applications](https://www.osohq.com/academy/authorization-in-llm-applications) | undated | 2026-11-16 | high |
| [9] | grounding vs citation instructions, mechanical verification | [KodeKloud — ground LLM answers with citations](https://kodekloud.com/blog/ground-llm-answers-with-citations/) | 2026-09 | 2026-11-16 | medium |
| [10] | agentic-RAG patterns, budget bounds, single-shot-stays-correct | [Future AGI blog](https://futureagi.com/blog/agentic-rag-systems-2025/) | 2026 | 2026-11-16 | high/medium per claim |
| [11] | delegated-access pattern for human-serving agents | [LangChain — agent authorization explainer](https://www.langchain.com/blog/agent-authorization-explainer) | undated | 2026-11-16 | medium-high |
| [12] | MCP tools: model-controlled, HITL SHOULDs, server-side enforcement | [MCP spec 2025-06-18 — tools](https://modelcontextprotocol.io/specification/2025-06-18/server/tools) | 2025-06-18 | 2026-11-16 | high |
| [13] | AG-UI 1.0 event taxonomy | [AG-UI docs — events](https://docs.ag-ui.com/concepts/events) | 1.0, current | 2026-11-16 | high |
| [14] | AI SDK chunk types, repairToolCall, source chunks; Chat SDK dual-protocol | [ai-sdk.dev streamText ref](https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text), [chat-sdk.dev](https://chat-sdk.dev/llms.txt) | current | 2026-11-16 | high / medium-high |
| [15] | LangGraph vitality + licence | [GitHub API — langgraph](https://api.github.com/repos/langchain-ai/langgraph) | live | 2026-11-16 | high |
| [16] | langgraph standalone still requires langchain-core | [PyPI langgraph requires_dist](https://pypi.org/project/langgraph/json) | live | 2026-11-16 | high |
| [17] | LangGraph streaming modes, recursion_limit, checkpointer model | [langgraph source (types.py, _loop.py, errors.py) + checkpoint README](https://github.com/langchain-ai/langgraph) | 2026-11 | 2026-11-16 | high |
| [18] | OpenAI Agents SDK vitality | [GitHub API — openai-agents-python](https://api.github.com/repos/openai/openai-agents-python) | live | 2026-11-16 | high |
| [19] | Agents SDK package versions (py+js) | [PyPI openai-agents](https://pypi.org/project/openai-agents/), [npm @openai/agents](https://www.npmjs.com/package/@openai/agents) | live | 2026-11-16 | high |
| [20] | DSH status, licence, architecture, ToolDefinition, SAFETY, Discussions-only | [DSH repo (GitHub API + raw README/SAFETY/docs)](https://github.com/deepseek-ai/deepseek-harness) | 2026-11 | 2026-11-16 | high |
| [21] | DSH traction / adoption absence | [HN Algolia API](https://hn.algolia.com) (ids 49285244, 49929489, 49770744) | 2026-08…10 | 2026-11-16 | high / medium |
| [22] | DSH pi-ai adapter: openai-completions + baseURL mechanism | [DSH — packages/llm/llm-pi-ai (README, package.json)](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/llm/llm-pi-ai) | current | 2026-11-16 | high |
| [23] | framework positioning, MS AF merger, durable engines | [pydantic.dev framework guide](https://pydantic.dev/articles/best-python-ai-agent-frameworks) | 2026-11-02 | 2026-11-16 | medium-high |
| [24] | field vitality batch (13 repos incl. Mastra NOASSERTION, Strands unresolved) | [GitHub API](https://api.github.com) (smolagents, crewai, autogen, agent-framework, ag2, llama_index, mastra, beeai-framework, cloudflare/agents, google/adk-python, agno) | live | 2026-11-16 | high |
| [25] | agentic-RAG direction corroboration | [Medium](https://medium.com/@elammarisoufiane/rag-in-2026-architecture-shifts-emerging-patterns-and-what-it-means-for-java-developers-6f2803e39787), [ScalaCode](https://www.scalacode.com/guides/the-complete-guide-to-agentic-rag-in-2026/) | 2026 | 2026-11-16 | medium |
| [26] | custom loop: ~80-line core, registry-as-authz, failure modes in loop | [AlgoMindset — agent loop from scratch](https://algomindset.com/blog/agent-loop-from-scratch-no-framework) | 2026-09-10 | 2026-11-16 | medium |
| [27] | 12-project retrospective; debugging worse than custom loop | [Kalvium Labs — LangGraph vs LangChain in production](https://kalviumlabs.ai/blog/langgraph-vs-langchain-production/) | ~2026 | 2026-11-16 | medium |
| [28] | IETF draft shape + expiry caveat | [IETF datatracker — draft-klrc-aiagent-auth-00](https://datatracker.ietf.org/doc/html/draft-klrc-aiagent-auth-00.html) | 2026 | 2026-11-16 | high |
| [29] | Adaline primary: 40% cost / 35% latency (vendor-reported) | [Adaline Labs — building production-ready agentic](https://labs.adaline.ai/p/building-production-ready-agentic) | 2025-12 | 2026-11-16 | medium |
| [30] | agentic-RAG production failure account; Adaline drift | [Towards AI — why 90% of agentic RAG projects fail](https://towardsai.com/p/machine-learning/why-90-of-agentic-rag-projects-fail-and-how-to-build-one-that-actually-works-in-production) | 2026-01 | 2026-11-16 | low |
| [31] | Search-R1 RL-trained search agent gains | [arXiv 2503.09516](https://arxiv.org/abs/2503.09516) | v5 2025-08 | 2026-11-16 | high (benchmark claim) |
| [32] | ChatOpenAI custom base_url resolution order | [LangChain docs — OpenAI chat](https://python.langchain.com/docs/integrations/chat/openai/) | living | 2026-11-16 | high |

## Staleness map

24 ledger claims mapped against the technical pack's freshness windows (version/compat ≤1 mo · ecosystem/license/maturity/perf ≤6 mo · pattern ≤24 mo). None stale at completion. **Earliest re-check: 2026-12-01** — the compat/version class (Agents SDK tracing-default + CC-mode drops, pydantic-ai 2.68.0, LangGraph langchain-core dep, vLLM parser/strict behaviour, DSH pi-ai adapter mechanism, pydantic-ai UsageLimits, LangGraph streaming modes, AI SDK repairToolCall): every one of these moves within weeks and directly gates REC-1/REC-2/REC-6. Ecosystem/maturity claims (DSH adoption absence, framework cadences) re-check 2027-05-01; pattern claims (taxonomy, authz model, citation mechanics) up to 2028-11. This map is the Refresh work order — `bmad-deep-recon` refresh on this folder re-checks exactly these.
