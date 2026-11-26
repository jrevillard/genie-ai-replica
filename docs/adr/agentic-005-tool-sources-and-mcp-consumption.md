# ADR agentic-005: Tool sources — one registry, external tools through MCP

- **Status**: Proposed
- **Date**: 2026-11-25
- **Decision owners**: GENIE.AI engineering (operator accepts at merge)
- **Binds**: spine AD-4 (the registry is the authorization surface), AD-6 (budgets),
  AD-13 (tool results are structured data), NFR-2 (defaults-gated sovereignty)
- **Supersedes**: the basis of issue #603, Phase 1B (MCP infrastructure) and 1C (initial
  MCP servers)
- **Stories**: none yet — iteration 2 is not broken down; this record is an input of that breakdown
- **Design**: `docs/superpowers/specs/2026-11-25-agentic-iteration-2-architecture-design.md`, §4

## FR-29 traceability

```
use case (the agent must reach tools beyond the corpus — building-block APIs served over
  MCP, and web search — under the same authorization, budget and audit as the document tools,
  and a write in the user's name must never happen without consent)
  -> requirement (operator constraint: external tools through MCP; building-block servers,
     mock first, inside the sovereign deployment)
    -> decision (this record: tools enter through a ToolSource and the per-request registry;
       a static catalog decides what exists; the dispatcher executes every call the same way;
       write tools require an approval and carry an idempotency key)
      -> investigation (the tool-source contract suite; probes on the venue's vLLM, Keycloak
         and the mock servers)
        -> merge request (the iteration-2 architecture MR, stacked on the PRD branch)
          -> validation evidence (tool-source suites green; an end-to-end errand on the
             shared cluster)
            -> released version (the merge into feat/agentic-foundations/prd)
```

## Context

The agentic path registers two document tools in `document_toolset`
(`components/agent-service/agent/toolset.py`). Issue #603 planned GovStack building-block
APIs as standalone MCP servers (Auth, Payments, Scheduler, Registration), « mock for now »,
through the `mcpo` proxy. A later, merged decision dropped the proxy: « `mcpo` is not used —
the MCP SDK client replaces it » and « GENIE owns the MCP client ». The Server-Side Tools
record (MR !279, closed unmerged) added a self-hosted web search over SearXNG with
governance: authorization and parameter validation before the call, PII redaction that
blocks on failure, rate limiting and a circuit breaker during it, provenance and audit
after it.

### Constraints

- AD-4: nothing unregistered is callable; enforcement lives in the executor with
  per-request identity; the narrowing travels in the context, never in the arguments.
- AD-6: the budget is server configuration.
- AD-13: a tool result is structured data; retrieved content is never an instruction.
- NFR-2: every dependency is audited for its defaults against the exact version.
- Sovereign deployment: no external SaaS dependency.

## Decision

**One door. A tool is callable when, and only when, a declared source registers it for
the request.**

1. **The port.** A `ToolSource` returns `(ToolDefinition, ToolExecutor)` pairs for a
   caller context and a bearer. The run's registry is the concatenation of the sources
   declared at deployment, built per request as today, so each executor captures that
   request's identity.
2. **Three sources.** `DocumentToolSource` carries `search_knowledge` and `read_source`
   unchanged — the capability, its adapters and its frozen behavior
   (`docs/baselines/v02-opea-query-path-contract.md`) are untouched. `McpToolSource`
   serves the catalog's MCP servers. `WebSearchToolSource` serves SearXNG.
3. **The catalog** is a static deployment file, one entry per tool: exposed name, source,
   server, tool, `allow`, `risk` (`read` or `write`), `requires_approval`, `egress`
   (`internal` or `open_web`), required `scopes`, and an operation budget (`timeout_ms`,
   `max_results`, `max_result_bytes`). A tool absent from the catalog is neither listed to
   the model nor dispatchable. A duplicate exposed name is a startup error. MCP tools are
   discovered at startup and filtered by the catalog.
4. **The call path** is the dispatcher's, identical for every source: budget and token
   checks; `tool_call_started`; execution bounded by the operation budget; a structured
   result, an upstream error becoming an error envelope; evidence ledger and injection
   scan; `tool_call_finished`.
5. **MCP consumption.** The official Python SDK (`mcp` 2.3.0, MIT) as a client over
   Streamable HTTP, which speaks protocol revision 2026-07-28; `stdio` is not used for
   separate processes; `mcpo` is not used. Its declared requirements, read from PyPI on
   2026-11-25, set the price of the adoption: it requires `opentelemetry-api>=1.28.0` where
   the tree pins `1.27.0`, which moves the whole OpenTelemetry line; and it brings `httpx2`,
   `jsonschema`, `mcp-types`, `python-multipart`, `sse-starlette` and `cryptography`
   (through `pyjwt[crypto]`) into the audited tree. Both are work of the slice that adopts
   it, priced before it starts. The tool's input schema becomes the
   `ToolDefinition` parameters. A server's tool instructions are never added to the system
   prompt.
6. **Outbound PII.** A tool with `egress: open_web` passes its query through the existing
   `pii-service` before it leaves and fails closed if redaction fails. Building-block
   tools are exempt: their arguments legitimately carry the user's own data. Deployment
   consequence: `pii-service` currently sits behind the `okf` compose profile and must run
   when web search is enabled.
7. **Identity and visibility.** `CallerContext` gains `scopes`, assembled by the BFF. A
   tool whose required scopes are not all present is not registered for that request.
   For a write tool, a `UserCredentials` port hands the adapter a token bound to the
   target server: none for the mock servers; standard token exchange for real building
   blocks. Keycloak's current guide describes standard token exchange V2 as « fully
   supported… enabled by default » with an `audience` parameter; its availability on the
   project's 26.8.2 is unverified and is checked by a probe before the first write path.
8. **Write tools.** `requires_approval` triggers the pause of ADR agentic-006. The
   resumed run executes the approved call through the same dispatcher; there is no direct
   path. Every write call carries an idempotency key riding the MCP request `_meta`;
   honoring it is part of the mock servers' contract. The key is derived from the turn and
   the call, not from the run: `run_id` is a fresh uuid per run, so a key built on it changes
   when the user retries the turn, and the retry would land the write twice.

## Alternatives considered

| Alternative | Status | Reason |
|---|---|---|
| The `mcpo` proxy, as issue #603 planned | Rejected | dropped by a merged decision |
| An MCP proxy at the gateway | Not adopted now | no requirement that a gateway-owned fleet satisfies in iteration 2; its behavior on the project's Kong version is unverified |
| Dynamic tool management (runtime toggles, as the Server-Side Tools record designed) | Deferred | a static catalog satisfies iteration 2; the admin surface is a later decision |
| Native tools only, no MCP | Rejected | the building blocks are delivered as MCP servers |
| MCP Resources, Prompts and the Tasks extension | Deferred | tools suffice; the Tasks extension is Beta and not implemented by the official SDKs |

## Consequences

- Positive: one authorization surface for every tool; the document capability keeps its
  frozen behavior; new tools are configuration plus one adapter.
- Negative: tool definitions consume the prompt budget — the catalog is bounded and
  counted in the budget tests; more registered tools may degrade tool-calling on the
  venue's vLLM — measured by a probe before the first external tool ships. The adoption
  also moves the OpenTelemetry line and adds six packages to the audited tree.
- Neutral: a web result is a new citation variant (`source: 'web'`) that the citation
  components on web and mobile must render.

## References

- Design: `docs/superpowers/specs/2026-11-25-agentic-iteration-2-architecture-design.md` (§4, §9)
- Issue #603; the Server-Side Tools record: MR !279 and its ADR 0002 (read at `013c3e72`), disposition in `docs/adr/agentic-008-server-side-tools-disposition.md`
- `_bmad-output/archived/opea-1.5-upgrade/planning-artifacts/OPEA-1.5-upgrade-analysis.md` (« `mcpo` is not used »)
- `components/agent-service/agent/registry.py`, `components/agent-service/agent/toolset.py`, `components/agent-service/capabilities/contract.py`
- Model Context Protocol specification, revision 2026-07-28; Python SDK `mcp` 2.3.0 (PyPI)
