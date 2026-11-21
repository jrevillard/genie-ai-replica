# Landscape + ecosystem health — agentic document QA + agent runtimes (2026)

Research subagent digest, run 2026-11-16. Sources: GitHub API (primary, live), official READMEs/docs, HN Algolia API, one maintainer comparison article. jina-reader was down (connection refused) — fell back to Bash curl per brief.

## CLAIMS

**Q1 — Agentic document QA / agentic RAG landscape**
- Agentic RAG = retrieval inside an agent loop with 4 primitives: decision-to-retrieve, query transformation/decomposition, iterative retrieval, self-check; 5 recurring production patterns (query rewrite/decompose, multi-hop w/ state, tool routing across retrievers, faithfulness self-check on draft, re-retrieval-until-supported with step budget) — source: https://futureagi.com/blog/agentic-rag-systems-2025/ · Future AGI (vendor blog, methodology grounded in named papers) · undated (2026 content) · confidence: high · class: pattern
- Typical budget bounds: 1–6 retrieves/turn, cap 4–6; cost trade is 3–8 LLM calls + 2–6 retrieves per turn; classic single-shot RAG remains correct for single-doc lookup, agentic wins on multi-hop/ambiguous — same source · confidence: medium (single publisher) · class: pattern
- Multi-hop-with-state shape is natively exposed by LangGraph's state machine, OpenAI Agents SDK's tool-call loop, LlamaIndex AgentWorkflow — same source · confidence: medium · class: pattern
- Self-check gate framing: trace must score faithfulness per span and the judge gates the shipped answer (their motivating production failure: fabricated paragraph traced to missing self-check) — same source · confidence: medium · class: pattern
- IRCoT (interleave retrieval+CoT) reports up to +21pt retrieval / +15pt QA on HotpotQA-class multi-hop benchmarks — same source (secondary citation of paper) · confidence: low · class: perf
- Corroboration that "merger of RAG with agent loops" is THE 12-month shift: snippets from https://medium.com/@elammarisoufiane/rag-in-2026-architecture-shifts-emerging-patterns-and-what-it-means-for-java-developers-6f2803e39787 and https://www.scalacode.com/guides/the-complete-guide-to-agentic-rag-in-2026/ · confidence: medium · class: pattern

**Q2/Q4 — Framework vitality (GitHub API, primary, accessed 2026-11-16; format: stars · last push · releases last 6mo · license)**
- langgraph: 45,026★ · 2026-11-16 · 71 releases · MIT — confidence: high · class: ecosystem
- openai-agents-python: 30,713★ · 2026-11-16 · 28 releases · MIT — high · ecosystem
- pydantic-ai: 21,237★ · 2026-11-16 · 100 releases (fastest cadence measured) · MIT — high · ecosystem
- deepseek-harness (DSH): 282,164★ · pushed 2026-11-13 · 39 releases, ALL since 2026-08-13 (repo created then — 3 months old) · 34,933 forks · MIT · 0 open issues (support routed to GitHub Discussions, not issues) — high · ecosystem
- smolagents: 30,390★ · pushed 2026-11-15 (daily commits continue) · but only 1 release in 6mo (2026-05-29) — release train stalled, repo not dead — high · maturity
- crewAI: 60,989★ · pushed 2026-11-16 · 1,261 open issues · MIT — high · ecosystem
- microsoft/autogen: 61,870★ · pushed 2026-11-12 · license field CC-BY-4.0 (docs license; code moved) — high · ecosystem. Successor microsoft/agent-framework: 14,710★ · created 2025-04 · pushed 2026-11-16 · MIT — high · ecosystem
- ag2 (AutoGen fork): 5,069★ · pushed 2026-11-16 · Apache-2.0 — alive but 12× smaller than CrewAI/autogen — high · ecosystem
- llama_index: 52,920★ · pushed 2026-11-14 — repo now self-describes as "the document processing platform for AI" (pivot away from agents/framework positioning) — high (description) / medium (interpretation) · ecosystem
- mastra: 29,543★ · pushed 2026-11-16 · license NOASSERTION (non-standard license file — likely disqualifying for a permissive-licence requirement; verify) — high (field) / medium (reading) · license
- beeai-framework (IBM Bee): 3,461★ · pushed 2026-11-13 · Apache-2.0 — alive, small traction — high · ecosystem
- cloudflare/agents: 5,997★ · pushed 2026-11-16 · MIT — high · ecosystem
- google/adk-python: 22,239★ · pushed 2026-11-16 · Apache-2.0 — high · ecosystem
- agno: 43,207★ · pushed 2026-11-16 · Apache-2.0 — high · ecosystem

**Q2 — Positioning (maintainer comparison, read in full)**
- Pydantic's own framework guide (Douwe Maan, published 2026-11-02, data re-verified monthly, methodology stated: read each project's own docs+license): Pydantic AI = typed Agent, 30+ providers, 9 durable-execution engines (Temporal, DBOS, Prefect, Restate, Lambda, Absurd, pgtask, Azure Durable Task, Airflow), 10 sandboxes, MCP, human-approval pause, OTel; "Pydantic AI Harness" layer adds 80+ capabilities incl. complete coding agent. LangGraph/LangChain if already on LangSmith; OpenAI Agents SDK if OpenAI is provider+tracing stack; Google ADK if Google/Gemini or need Java/Go; Microsoft Agent Framework if Azure/.NET; Strands if AWS/Bedrock; CrewAI if declarative roles/tasks; Claude Agent SDK = Claude Code's loop, Claude models; Agno if you want server+management UI — source: https://pydantic.dev/articles/best-python-ai-agent-frameworks · Pydantic (self-interested but transparent methodology) · 2026-11 · confidence: medium-high · class: maturity. NOTE for scoring: their positioning implies OpenAI Agents SDK is OpenAI-centric; verify multi-provider story independently before scoring it for a vLLM stack.
- Same source leaves LlamaIndex, smolagents, Haystack OUT of the comparison set entirely (no demand for comparison pages) — weak proxy, treat as one signal among the GitHub data · medium · ecosystem
- Microsoft Agent Framework 1.0 shipped 2026-04-03, merging Semantic Kernel + AutoGen — corroborated by particula.tech snippet + microsoft/agent-framework repo existence + pydantic.dev naming it · medium-high · ecosystem

**Q4 — DSH deep-dive**
- DSH is officially in developer preview; README states verbatim: "iterating rapidly. THERE WILL BE COMPATIBILITY-BREAKING CHANGES" + safety notice required reading — source: https://github.com/deepseek-ai/deepseek-harness README (fetched raw via API) · DeepSeek · 2026-11 · confidence: high · class: maturity
- DSH is a Node.js/TypeScript runtime (npm `@deepseek-ai/dsh web` → local Web UI :3080; pnpm build from source), everything-is-a-plugin architecture, built on Cordis DI framework (design paper arxiv 2608.25512), docs at deepseek-harness.github.io — same README · high · maturity
- DSH traction: HN launch thread 747 pts/314 comments (2026-08-13); "DeepSeek Harness Desktop" 417 pts (2026-10-02) — sustained attention — source: https://hn.algolia.com API hits (ids 49285244, 49929489) · confidence: high · class: ecosystem
- DSH production-adoption signal BEYOND launch: an "Ask HN: Anyone using DSH in a customer-facing agent?" thread (2026-09-19) drew 6 points and ZERO comments — no retrieved evidence of anyone running it customer-facing — same API (id 49770744) · confidence: medium (absence evidence) · class: ecosystem
- DSH bus-factor note: core dependency Cordis is a niche research DI framework — single-point risk not quantified this run — low · maturity

**Wildcard screening (Q3)**
- Agno (Apache-2.0, 43k★, active) and Google ADK (Apache-2.0, 22k★, active, same framework in Java/Go) both fit self-host + permissive + tool-calling + streaming requirements on paper — GitHub API + pydantic.dev · medium-high · ecosystem. ADK's own positioning is Google/Gemini-first (pydantic.dev) — verify vLLM/OpenAI-compat path before shortlisting.
- Cloudflare Agents SDK: MIT and active but designed around Workers runtime — poor self-host fit (inference from positioning, not measured) · low · ecosystem

## LEADS
- PRIORITY: DSH ↔ vLLM/OpenAI-compatible endpoints — NOT verified (docs site unread, budget out). Docs at https://deepseek-harness.github.io/deepseek-harness/ — check the model-provider plugin before scoring DSH at all.
- Naming collision: "Pydantic AI Harness" vs "DeepSeek Harness" — two different products share the 2026 buzzword "harness". Keep eval docs disambiguated.
- DSH support channel is GitHub Discussions only (issues disabled) — no bug-tracker surface to gauge quality; check Discussions volume manually.
- smolagents contradiction: 30k★ + daily pushes vs 1 release in 6mo — check commit graph before calling it fading; could be a release-process change, not decay.
- Strands Agents: official repo not located (two name guesses 404'd; search surfaced only samples) — resolve org/repo before screening.
- LlamaIndex description pivot ("document processing platform") — if true pivot, it may still be relevant to your project as the DOC-side pipeline, just not the agent runtime.

## NOT FOUND
- DSH model-provider/vLLM compatibility (highest-value gap).
- Strands official repo + licence confirmation.
- LangChain Inc funding/backing durability beyond org attribution (no funding data retrieved).
- Any LangChain "State of AI Agents" 2026 adoption survey numbers (searched framework-comparison angle only).
- Bee adoption beyond IBM/LF pages; second independent source for CrewAI 2026 production sentiment.
- Mastra license text (NOASSERTION — needs a manual read of LICENSE file).
