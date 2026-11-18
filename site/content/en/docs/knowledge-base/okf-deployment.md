---
title: "OKF Deployment & Lifecycle"
description: "Deploying and operating the OKF knowledge-base stack: feature flag, authentication wiring, service-account seeding, the repository lifecycle, import contracts, and troubleshooting."
weight: 19
---

The OKF stack (repositories, concepts, Studio, the OKF retrieval path) ships
**disabled by default**. This page covers enabling it, wiring authentication,
seeding content by API, and the repository lifecycle — with the failure
signatures operators actually hit.

> ROCm/AMD deployments: the same steps apply, with two venue additions
> (split-URL auth for okf-server and document-repository) documented in
> [GPU deployment](/docs/deploy/gpu/) and the agent runbook
> (`docs/rocm-venue-okf-runbook.md` in the repository).

## Enabling the OKF stack

`OKF_ENABLED=1` (compose default `0`) turns on four things at once:

| Effect | Mechanism |
|---|---|
| okf-server + pii-service containers start | compose profile `okf` (bring up with `--profile okf`, or `deploy.replicas` in Swarm) |
| Kong serves `/api/okf/*` | the kong-config init applies the declarative config honoring the flag (it **strips** the route when `0`) |
| Frontend shows OKF surfaces | `VUE_APP_OKF_ENABLED` mirrors the flag into `window.APP_CONFIG.okfEnabled` |
| Admin Dashboard OKF tab | same runtime config |

After changing the flag: bring up `kong-config okf-server pii-service` and
**recreate every flag consumer** — compose reads `OKF_ENABLED` in the
backend, the frontend (`VUE_APP_OKF_ENABLED` runtime config) and the
one-shot `kong-config` in addition to the profile-gated services, and a
running container only picks up the new value when recreated. A backend
left at the old value short-circuits chat retrieval to the legacy default
(zero serving graphs → every query answers nothing).

Check: `GET /api/okf/repos` should answer `401` (unauthenticated) — a
`404 {"message":"Resource not found"}` means the Kong route is still
stripped (flag off or kong-config not re-run).

## Authentication wiring

Three services verify tokens and need consistent Keycloak wiring:

- **backend**, **okf-server**, **document-repository** — each derives its
  Keycloak URL from the public edge by default. On deployments where the
  edge serves self-signed TLS or the internal issuer differs from the
  browser-facing one, set the split-URL trio (per service):
  `KEYCLOAK_DISCOVERY_URL` (fetch-host **base**), `KEYCLOAK_JWKS_URL`
  (full certificates URL), `KEYCLOAK_PUBLIC_URL` (the browser-facing
  issuer, added as a trusted alias).
- Document-repository's copy is load-bearing for OKF publishing: the
  `publish` transition hands the bundle zip to doc-repo, and an auth-layer
  outage there surfaces as `EXPORT_FAILED: bundle store failed (doc-repo
  status 503)`.
- Publishing additionally requires `KC_OKF_SERVER_CLIENT_SECRET` (the
  okf-server → doc-repo service account). Empty secret = doc-repo rejects
  the bundle.

## TLS certificate (self-signed dev path)

When no volume certs exist, nginx generates a self-signed certificate at
container start. The generator includes a **subjectAltName** covering the
deployment domain (IP literal → `IP:` entry, otherwise `DNS:`) plus
`localhost`, so browsers can accept it cleanly. When replacing or accepting
certificates: browsers reject XHR/subresource fetches that were never
covered by the exception — a page that renders but fails every API call with
`ERR_CERT_AUTHORITY_INVALID` means the exception does not cover fetches;
trust the certificate in the OS store (then restart the browser) instead of
relying on click-through.

## Seeding by API (service account)

`POST /api/okf/repos` requires the **realm role `tools-admin`**. For
scripted seeding, grant it to a service account and mint
`client_credentials` tokens:

1. Assign the existing `tools-admin` realm role to the service account's
   user (Keycloak Admin REST → role-mappings).
2. Mint tokens per operation: `grant_type=client_credentials` with the
   service account's client. Tokens are short-lived — mint fresh.

### Import contract

```json
POST /api/okf/repos
{"name": "…", "domain": "…", "acl": {"required_scopes": []}}

POST /api/okf/repos/<repo_id>/import
{"concepts": [{"path": "Page.md", "frontmatter": {"title": "Page", "type": "topic"}, "body": "… [[Other.md|Other]] …"}]}
```

- A `path` ending in `.md` keeps the basename **verbatim** as the concept
  id (case and spaces preserved). Without `.md`, the name is slugified.
- **`frontmatter.type` is mandatory** — a concept without it is rejected
  with the conformance error `MISSING_TYPE` (the import response shows
  `created: N, rejected: N`).
- `[[Target.md|label]]` links in bodies become the concept tree edges the
  Studio browser renders; targets resolve case-sensitively to concept ids.
- Re-importing the same paths **updates** in place.

## Repository lifecycle

`register → review → approve → publish → serving` (transitions:
`submit`, `approve`, `publish`, `ingest`; `retract`/`unpublish` to leave
serving; delete is soft with a 168-hour grace).

- **PII gate**: the scanner flags person-name-like strings as `hit`.
  `hit` blocks publish; a steward acknowledgement
  (`POST /:repo_id/pii-acknowledge`) waives it, audited. A scanner
  *error* blocks regardless.
- **publish** mints a version and stores the bundle zip in
  document-repository. **ingest** flips the repo to serving and starts
  the RAG drain (chunking → embedding → labeling → graph drain). The
  repository metrics show the drain as `rag_ingestion.status`.
- A serving repository is read-only — retract before further edits.

## LLM-assisted import

The Studio wizard's LLM-Assisted mode needs the OKF LLM legs enabled:
set `VLLM_ENDPOINT` (and `VLLM_API_KEY`) for okf-server. Without it the
wizard stores the raw import and stalls (the curation call refuses with
"LLM not configured"). The topic-link enrichment leg is tunable:

| Variable | Default | Purpose |
|---|---|---|
| `OKF_TOPIC_LINK_TIMEOUT_MS` | 60000 | per-batch LLM budget — raise for slower serving models |
| `OKF_TOPIC_LINK_BATCH` | 8 | concepts per LLM call |
| `OKF_TOPIC_LINK_LANES` | 4 | parallel batches |
| `OKF_TOPIC_LINK_MAX_PER_CONCEPT` | 6 | cap on links accepted per concept |

Batch failures are fail-soft (skipped, import continues); re-running the
pass on the same repository densifies links.

## Troubleshooting quick table

| Symptom | Cause | Fix |
|---|---|---|
| `404 {"message":"Resource not found"}` on `/api/okf/*` | flag off / kong-config not re-run | enable + re-run kong-config |
| `EXPORT_FAILED … status 503` on publish | doc-repo auth layer down | split-URL trio on document-repository |
| `created: N, rejected: N` on import | missing `frontmatter.type` | add it, re-import |
| LLM-Assisted stalls after import | `VLLM_ENDPOINT` unset for okf-server | opt in + recreate okf-server |
| topic-link batches time out | per-call budget vs model speed | raise timeout / lower batch |
| chat answers find no documents, retriever logs `Graph 'GRAPH' does not exist` | backend predates the `OKF_ENABLED=1` flip — 0 serving graphs | recreate backend; `fanout_config_resolved` must show `serving_graph_count >= 1` |
| 502 through the gateway right after recreating a service | stale upstream DNS | self-heals in ~2 minutes |
