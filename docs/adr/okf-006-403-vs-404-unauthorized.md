# ADR okf-006: 403 for unauthorized access, 404 for absent resources

- **Status**: Proposed
- **Date**: 2026-07-15
- **Decision owners**: Genie.ai Dev (architect)

## Context

When an agent requests a concept it isn't authorized for, the server must choose between 403 (Forbidden — reveals existence) and 404 (Not Found — hides existence). For government/sensitive bundles, existence leakage can itself be sensitive.

### Constraints

- Do not leak the existence of restricted concepts to unauthorized callers.
- Keep behavior predictable for authorized agents.

## Decision

- **Authenticated but unauthorized** → **403 Forbidden** (the caller is known but lacks the bundle scope).
- **Genuinely absent** (no such bundle/concept/version) → **404 Not Found**.
- For **high-sensitivity** bundles (steward-marked), collapse both to **404** to avoid existence leakage (configurable per bundle sensitivity).

## Alternatives considered

| Alternative | Status |
|---|---|
| Always 404 for unauthorized (hide existence) | Rejected as default — degrades developer experience/debuggability for non-sensitive bundles; adopt only for high-sensitivity. |
| Always 403 for unauthorized | Chosen as default (predictable; existence not highly sensitive for most bundles). |

## Consequences

- **Positive**: clear default semantics; opt-in stricter mode for sensitive bundles.
- **Negative**: default 403 leaks existence for non-sensitive bundles — acceptable; sensitive bundles use the 404-collapse.
- **Mitigations**: sensitivity-driven response policy; tests covering both modes.

## References

- PRD FR-15, Open Question 6; Architecture §6.2.
