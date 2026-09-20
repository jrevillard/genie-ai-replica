---
title: "Backend (gov-chat-backend)"
description: "Node.js / Express backend-for-frontend: HTTP API contracts, auth flow, service boundaries, observability gates."
weight: 80
section: "backend"
---

The GENIE.AI backend-for-frontend (`gov-chat-backend`) is a Node.js / Express
service that exposes the public HTTP API used by the web and mobile clients.
It sits behind Kong (TLS + rate-limiting + OIDC routing) and forwards work
to ArangoDB, Keycloak, OPEA, the document-repository, and the dataprep
service.

## Documents in this section

1. [API Contracts — gov-chat-backend](/docs/backend/api-contracts-backend/) — every public
   endpoint, request/response schemas, auth model, SSE protocol, rate
   limiting, CORS, observability gates, and the sibling-service boundary
   with `document-repository`.

## Related

- [Architecture Overview](/docs/architecture/architecture/) — service topology and BFF role.
- [Keycloak Admin Guide](/docs/configure/keycloak-admin-guide/) — realm setup,
  client credentials, admin user creation, ROPC enable/revert.
- [Observability Configuration](/docs/observe/configuration/) — OTel,
  VictoriaLogs, Grafana dashboards.
- [Troubleshooting](/docs/operate/troubleshooting/) — debug-yesterday
  logs, security-blocker diagnostics.