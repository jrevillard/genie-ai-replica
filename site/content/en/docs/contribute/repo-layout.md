---
title: "Repo layout & module map"
weight: 2
description: "Where each module lives — components, overlay, deploy, tests, docs, site."
mode: reference
persona: contributor
owner: docs-stewards
last_reviewed: 2026-09-18
---

## Top-level layout

```
genie-ai/
├── api-gateway-solution/   # Kong configuration scripts
├── components/
│   ├── gov-chat-backend/   # Node.js / Express BFF
│   ├── gov-chat-frontend/  # Vue 3 SPA
│   └── document-repository/# Upload + ClamAV + dataprep proxy
├── configs/                # LLM prompts, OTel collector, Grafana dashboards
├── deploy/
│   └── ansible/            # Production Swarm deploy playbook
├── docs/                   # Internal dev docs (NOT published)
├── genie-ai-overlay/       # OPEA Python microservices
│   ├── chatqna/            # Mega-service that orchestrates the RAG DAG
│   ├── retriever/          # ArangoDB hybrid search
│   ├── reranker/           # Cross-encoder reranker wrapper
│   ├── embedding/          # TEI embedding wrapper
│   ├── textgen/            # vLLM text-generation wrapper
│   ├── dataprep/           # Document ingestion + labeling + contextual retrieval
│   ├── core/               # Shared types, protocols, constants
│   ├── tests/              # Pytest suite (mocks comps + ArangoDB)
│   └── contracts/          # In-image contract tests (real vendored comps)
├── mobile/
│   └── genie_ai_mobile/    # Flutter app (Android + iOS)
├── secrets/                # SSL certs (NOT committed)
├── site/                   # Hugo + Docsy user-facing docs site
├── tests/                  # E2E tests, config validator, log assertions
├── docker-compose.yaml     # Single dual-mode compose (compose + swarm)
└── env                     # Configuration template (committed; cp env .env)
```

## Components

### `components/gov-chat-backend/`

Node.js 22 / Express backend-for-frontend. Owns authentication
delegation to Keycloak, the chat proxy to ChatQnA, the analytics store, and
the admin surface. Tests in `__tests__/` (Jest). Uses `createApp()` pattern
for supertest isolation.

### `components/gov-chat-frontend/`

Vue 3 + Vuex 4 + vue-i18n single-page app. State managed via Vuex: an
`auth` module (`store/modules/auth.js`) and a `chatHistory` module
(`store/chatHistoryStore.js`), both registered as Vuex modules in
`store/index.js`. Tests in `src/__tests__/`.

### `components/document-repository/`

Express service that handles file uploads, runs ClamAV, and proxies the
dataprep ingest pipeline. Owns the `uploads/` directory (mounted at
`/app/uploads` in the container; `backend_uploads` mounts `/app/Uploads`
for the backend service, not doc-repo).

## OPEA overlay (`genie-ai-overlay/`)

Each subdirectory is a standalone microservice built on the OPEA
`comps` library. They wire together at deploy time via the ChatQnA DAG.

| Directory | Role | Image |
|---|---|---|
| `chatqna/` | Mega-service orchestrating the DAG | `genie-ai-chatqna-server` |
| `retriever/` | Hybrid vector + BM25 over ArangoDB | `genie-ai-retriever-arango` |
| `reranker/` | Cross-encoder wrapper | `genie-ai-reranker` |
| `embedding/` | TEI encoder wrapper | `genie-ai-embedding` |
| `textgen/` | vLLM text-gen wrapper | `genie-ai-textgen` |
| `dataprep/` | Ingest + label + chunk | `genie-ai-dataprep-arango` |
| `core/` | Shared types/protocols/constants | (library, no image) |

Translation is provided upstream by the official OPEA image
`opea/translation:1.5` (no `translation/` directory in the overlay).

### Tests

- `genie-ai-overlay/tests/` — pytest suite with mocked `comps` library.
  Conftest stubs `comps` in `sys.modules` so a parent directory won't
  accidentally contaminate.
- `genie-ai-overlay/contracts/` — in-image contract tests against the real
  vendored `comps`. Run inside the built image (per-module), not from the
  host.

## Deploy

- `deploy/ansible/` — production Swarm playbook. Per-environment inventory
  and vault (`group_vars/<env>/`).
- `docker-compose.yaml` — root, dual-mode (compose + swarm).
- `env` — committed template; `cp env .env` and edit.

## Docs

- `site/` — Hugo + Docsy user-facing site (published to GitLab Pages).
- `docs/` — internal developer reference (E2E tests, RELEASE, security).
- `site/content/en/docs/audit/` — internal docs-audit artifacts (weight 999,
  last section in nav).

## Conventions

- **`.env` is git-ignored.** Use `env` as the template.
- **`secrets/` is git-ignored.** Local SSL certs only.
- **One `docker-compose.yaml`** at the project root — profiles control
  which layers activate (`opea`, `gpu-models`, `observability`).
- **All JS components** share ESLint 10 + Prettier 3 config at the repo root.
- **All Python** uses `ruff` (`genie-ai-overlay/pyproject.toml`).

## Related

- [Dev workflow](/docs/contribute/dev-workflow/)
- [Add a new doc](/docs/contribute/add-a-doc/)
- [Architecture → OPEA microservices](/docs/architecture/opea-microservices/)