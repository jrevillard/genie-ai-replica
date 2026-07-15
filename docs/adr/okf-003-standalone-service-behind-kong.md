# ADR okf-003: Standalone OKF service behind Kong (Kong-terminated OIDC)

- **Status**: Accepted
- **Date**: 2026-07-15
- **Decision owners**: Jerome Revillard (architect), Genie.ai Dev

## Context

The agent-facing surface (REST now, MCP later) needs authentication and authorization. Genie terminates auth at NGINX/Kong and validates JWTs in-app (`jose`). The OKF Server (per okf-001) is a standalone Node component.

### Constraints

- Reuse the Keycloak + Kong stack; no new auth vendor.
- Future MCP surface must follow the MCP OAuth 2.1 profile (RFC 9728, RFC 8707).
- Per-bundle/per-tenant authorization (okf-002).

## Decision

The OKF Server **exposes its own REST (future MCP) surface**, deployed as the `okf-server` service **behind Kong**. **Kong terminates Keycloak OIDC** (validates bearer tokens via JWKS, binds audience to the OKF server per RFC 8707, no token passthrough). The OKF Server performs **defense-in-depth** `jose` validation + claim extraction and enforces per-bundle/per-tenant authz. For the future MCP surface, Kong AI MCP Proxy + AI MCP OAuth2 plugins enforce the MCP OAuth 2.1 profile at the gateway.

## Alternatives considered

| Alternative | Status |
|---|---|
| Host OKF routes inside the Node BFF (`gov-chat-backend`) | Rejected — couples agent-serving to the chat BFF; adds a hop; OKF deserves its own authz surface. |
| OKF Server validates tokens only in-app (no Kong termination) | Rejected — forgoes gateway-level rate-limiting/MCP-OAuth/metrics; less consistent with Genie's gateway-first pattern. |

## Consequences

- **Positive**: consistent gateway pattern; central rate-limiting/audit; MCP-ready via Kong plugins; OKF owns fine-grained authz.
- **Negative**: auth logic in two layers (Kong + OKF) — must stay aligned.
- **Mitigations**: Kong handles transport/authn; OKF handles fine-grained authz; document the split in the ops guide.

## References

- Architecture §2, §8; PRD FR-18; decision log ADR-3.
