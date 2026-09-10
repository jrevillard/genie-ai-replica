# ADR okf-011: No raw AQL exposed to agents — parameterized traversal only

- **Status**: Accepted
- **Date**: 2026-07-15
- **Decision owners**: Jerome Revillard (architect), Genie.ai Dev

## Context

ArangoDB is queried via AQL. An external review (Gemini) suggested exposing an AQL-execution tool so agents can run arbitrary graph traversals (e.g., a 2-hop neighborhood query). For a multi-tenant, government deployment, letting agents construct and execute AQL is an **injection and authorization risk**: a malformed or malicious query could read cross-tenant data, exhaust resources, or bypass the ACL layer.

### Constraints

- Per-tenant/per-bundle isolation is mandatory (okf-002); nothing may bypass it.
- Agents need graph traversal (multi-hop neighborhoods over OKF's structural links).
- Sovereign, auditable, FOI-exportable.

## Decision

**Agents are never given a raw AQL execution tool.** The OKF Server exposes only **parameterized, scope-checked operations**:

- `okf_search` — hybrid search, scoped to authorized bundles via the `chunk_labels` ACL.
- `okf_get_doc` — concept by id + version, ACL-checked.
- `neighbors?depth=N` — deterministic, depth-limited graph traversal over `OKF_LINKS_TO`, scoped to authorized bundles.

The server constructs the AQL internally from these parameters, binding authorized tenant/bundle filters into every query. Agents express *intent* ("the 2-hop neighborhood of concept X"), not queries.

## Alternatives considered

| Alternative | Status |
|---|---|
| Expose a `run_aql` tool to agents | **Rejected** — injection + authorization risk; bypasses ACL; unsafe for multi-tenant/government. |
| Read-only AQL tool with a low-privilege DB role | Rejected — still permits cross-tenant reads within the shared graph; defeats defense-in-depth. |
| Parameterized traversal only (chosen) | **Selected** — same agent power (multi-hop), safe-by-construction, ACL enforced in every query. |

## Consequences

- **Positive**: no injection surface; ACL enforced centrally and consistently; fully auditable; agents still get deterministic graph traversal.
- **Negative**: less ad-hoc flexibility than raw AQL (agents cannot run novel query shapes).
- **Mitigations**: expose a small, well-designed set of parameterized operations covering common cases (search, get, neighbors, outline); extend the set only if real agent needs emerge, each scoped + audited.

## References

- Architecture §8.4, §11 (Security); ADR-okf-002; external review recommendation to expose AQL — deliberately declined.
