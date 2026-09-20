---
title: "Reference"
weight: 120
description: "Canonical lookup — env-vars, HTTP API, OPEA protocol extensions, glossary."
---

## Mission

The **Reference** section is **exhaustive lookup material** — env-var
tables, HTTP API contracts, OPEA protocol extensions, the Kong / Nginx
route map, the ArangoDB collection schema, the service-registry enum.
Unlike how-to docs, the order is **alphabetical / canonical**, not
narrative.

## Pages in this section

- [Environment variables](/docs/reference/env-vars/) — every supported
  env-var with default, scope, and the container that reads it. Single
  source of truth (generated from `env` + `docker-compose.yaml`).
- [Backend HTTP API](/docs/reference/api-contracts/) — every public
  endpoint, request/response shape, auth requirement, error semantics.
- [OPEA protocol extensions](/docs/reference/opea-protocol/) — the
  GENIE.AI additions to the standard OPEA protocol
  (`genieai_api_protocol.py`).
- [Kong / Nginx routes](/docs/reference/routes/) — path-prefix → backend
  service mapping.
- [ArangoDB collections](/docs/reference/arangodb-collections/) — every
  collection with field schema.
- [Service registry enum](/docs/reference/service-registry/) — service
  roles, OTel `service.name`, Docker service block names, and image
  references (the OPEA `ServiceType` enum lives in
  `genie-ai-overlay/core/constants.py`; service names are string
  literals set per service via `setup_tracing(...)`).
- [Glossary](/docs/reference/glossary/) — full glossary, same as
  [Get started → Glossary](/docs/get-started/glossary/).

## Related sections

- **[Deploy](/docs/deploy/)** — install recipes that consume these
  references.
- **[Configure](/docs/configure/)** — runtime tunables that map onto the
  env-vars page.
- **[Backend](/docs/backend/)** — narrative version of the API contracts.