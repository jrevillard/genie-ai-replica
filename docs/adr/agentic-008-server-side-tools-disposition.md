# ADR agentic-008: Disposition of the Server-Side Tools record

- **Status**: Proposed
- **Date**: 2026-11-25
- **Decision owners**: GENIE.AI engineering (operator accepts at merge)
- **Binds**: ADR agentic-005 (tool sources), ADR agentic-006 (pipelines), NFR-2
  (defaults-gated sovereignty, license posture)
- **Subject**: MR !279, « feat(sst): Server-Side Tools — web search, stream ingestor,
  admin UI », closed unmerged on 2026-11-07
- **Stories**: none yet — iteration 2 is not broken down; this record is an input of that breakdown

## FR-29 traceability

```
use case (a closed initiative left a design and a governance model for tools outside the
  corpus; iteration 2 needs to know which of its decisions still bind, in what form)
  -> requirement (one canonical home per decision: no second source of truth beside the
     agentic spine)
    -> decision (this record: the governance is kept and re-based on the registry; pipeline
       fusion as the execution model is dropped)
      -> investigation (a read of the record's ADR 0002 and 0003 at its last commit, and of
         the tracking issues)
        -> merge request (the iteration-2 architecture MR, stacked on the PRD branch)
          -> validation evidence (the kept decisions are stated in ADR agentic-005 and
             agentic-006; nothing of the record is on main)
            -> released version (the merge into feat/agentic-foundations/prd)
```

## Context

MR !279 was closed with the comment « Closed as a historical record of intent... more
analysis and design is being done on agentic and tools ». Nothing of it reached `main`.
Its ADR 0002 (status Proposed, 2026-08-18) decided: tools run as pipeline-fused
augmentations, « deterministically by the pipeline, not by the LLM »; SearXNG as the
web-search backend; a stream ingestor for feeds; administration through the Node.js BFF;
two realm roles, `tools-admin` and `tools-reader`; citation rendering in the frontend.
Its planning architecture added a governance pipeline in three phases — before the call:
authorization, parameter validation, PII redaction that blocks on failure; during it:
rate limit, circuit breaker, timeout; after it: provenance and domain check, audit — as
an in-process library. Its ADR 0003 (status Accepted in the record) approved SearXNG
under AGPL-3.0 as an unmodified, API-consumed service.

The agentic path reverses the record's premise: a model now chooses tool calls inside a
governed run (ADR agentic-002).

### Constraints

- ADR agentic-004: the dispatcher is the single execution path for every tool.
- ADR agentic-005: a static catalog; no dynamic tool management in iteration 2.
- NFR-2: license posture recorded, not assumed.

## Decision

**The record's governance is kept and re-based on the registry. Pipeline fusion as the
execution model is dropped.**

| Intent of the record | Disposition | Where it lands |
|---|---|---|
| Authorization and parameter validation before a tool call | Kept | the per-request registry (AD-4) and the dispatcher |
| PII redaction of outbound queries, blocking on failure | Kept | `egress: open_web` tools pass through `pii-service` (ADR agentic-005) |
| Rate limit, circuit breaker and timeout during a call | Kept, reduced | the operation budget bounds time and size per call; a circuit breaker is deferred until a tool needs one |
| Provenance check and audit after a call | Kept | the evidence ledger and the tool-call audit summary (ADR agentic-007) |
| Realm roles for tool administration | Kept as `scopes` | `CallerContext.scopes` (ADR agentic-005); the admin surface is a later decision |
| SearXNG as an unmodified, API-consumed service under AGPL-3.0 | Kept; re-recorded here | the license decision of ADR 0003 applies to `WebSearchToolSource` |
| Web search as a tool | Re-based | a tool source behind the registry; also the first step of the extended-research pipeline (ADR agentic-006) |
| Runtime whitelist and tool toggles without redeployment | Re-based | a static catalog in iteration 2; dynamic management deferred |
| Audit log viewer and health overview | Deferred | the audit summary exists first; the surfaces are a later decision |
| « Pipeline fusion, not agent loop » as the execution model | Dropped | superseded by the agentic path |
| Stream ingestion of feeds (RSS, Atom, JSON API, webhooks) | Not part of the agentic iteration | a background ingestion service, not a conversational tool; its intent remains in the record |

## Alternatives considered

| Alternative | Status | Reason |
|---|---|---|
| Reopen MR !279 and merge it | Rejected | 101 files against a pipeline its premise has reversed; conflicts with `main` |
| Ignore the record and redesign the governance | Rejected | its three-phase governance and its PII rule are the product's existing decisions |
| Keep the record's decisions only in this record | Rejected | each kept decision must live in the ADR that binds the code |

## Consequences

- Positive: one reading path for the tool governance — ADR agentic-005, 006 and 007; the
  license decision survives the closed merge request.
- Negative: two admin surfaces designed in the record (tool toggles, audit viewer) are
  deferred, not delivered.
- Neutral: the stream ingestor remains an unmerged intent with no iteration assigned.

## References

- MR !279 and its ADR 0002 and 0003, read at `013c3e72`
- Issue #603; triage report #1904 (the `mcpo` note)
- `docs/adr/agentic-004-runtime-port-governance-by-construction.md`, `docs/adr/agentic-005-tool-sources-and-mcp-consumption.md`, `docs/adr/agentic-006-pipelines-and-pause-as-run-outcome.md`, `docs/adr/agentic-007-persistence-for-iteration-2.md`
- Design: `docs/superpowers/specs/2026-11-25-agentic-iteration-2-architecture-design.md`
