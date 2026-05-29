---
stepsCompleted: [1, 2, 3]
inputDocuments: ['issue-758-distributed-architecture']
session_topic: 'Challenge the distributed architecture plan (issue #758) with KISS approach'
session_goals: 'Simplify the 8-issue plan to the minimum viable for remote GPU node deployment'
selected_approach: 'Progressive exploration'
techniques_used: ['assumption-challenging', 'existing-solution-discovery', 'scope-reduction']
ideas_generated: ['eliminate-layer-2-core-services', 'use-existing-env-vars', 'docling-stays-in-process-or-official-serve', 'nginx-reverse-proxy-gpu-node', 'single-docker-compose-gpu', 'single-ansible-playbook-gpu']
context_file: ''
---

# Brainstorming Session Results

**Facilitator:** Jerome Revillard
**Date:** 2026-05-29

## Session Overview

**Topic:** Challenge and simplify the distributed architecture plan for GENIE.AI (GitLab issue #758)
**Goals:** Reduce the 8-issue plan to the minimum viable scope for remote GPU node deployment

### Context

Issue #758 proposes a comprehensive plan to make all inter-service communication configurable via `${VAR:-default}` pattern, enabling 5 deployment profiles (single-node to Kubernetes). The plan includes 8 child issues covering OPEA endpoints, core service URLs, Kong upstreams, and Docling microservice creation.

### Session Setup

The user's core insight: **KISS approach** — vLLM and TEI already expose HTTP APIs and env vars already support full URLs. Why add complexity when the services are already remote-ready? The only real need is a **remote GPU node** with the 4 model services.

## Key Findings

### 1. Layer 2 (Core Services) — Eliminated

Issues #765 (ArangoDB, Backend, Redis, Keycloak, Doc-repo URLs) and #766 (Kong upstreams) are **unnecessary**. The only distributed use case is the GPU node. All other services remain collocated.

### 2. Layer 1 — Already Works

All 9 inter-service URLs (vLLM, TEI embedding, TEI reranker, translation, Kong, frontend) already use configurable full URL env vars. **Zero code changes needed** for these.

### 3. Docling — Use Official `docling-serve`

Issue #764 proposed building a custom FastAPI microservice. **Unnecessary** — IBM's official `docling-serve` (https://github.com/docling-project/docling-serve) provides:
- FastAPI-based REST API with stable v1
- Official Docker images
- GPU/CPU support
- MIT license (compatible)
- All required features (PDF/DOCX/PPTX/XLSX/HTML, OCR, table extraction)

The only code change needed: add `DOCLING_ENDPOINT` env var in dataprep with HTTP call + in-process fallback (same pattern as existing services).

### 4. Security — nginx + vLLM API Key

Network between app node and GPU node is **NOT isolated**. Standard security approach:
- **vLLM**: Native `--api-key` flag (supplemental defense-in-depth)
- **TEI**: No native auth — **nginx reverse proxy** on GPU node with TLS termination + auth
- **docling-serve**: Protected behind same nginx proxy

### 5. Deployment — Separate GPU Stack

- New `docker-compose-gpu.yaml` (or separate compose directory) for the 5 GPU services
- New Ansible playbook for GPU node deployment
- Internal healthchecks only (monitoring deferred to future)

## Simplified Plan

### Original Plan (8 issues) → KISS Plan (1 consolidated initiative)

| Original Issue | Status in KISS Plan |
|---|---|
| #759 — ChatQnA env var overrides | **Eliminated** — already configurable |
| #760 — Docker Compose env var URLs | **Merged** — into GPU docker-compose |
| #761 — Expose GPU service ports | **Merged** — into GPU docker-compose |
| #762 — Fix placement constraints | **Merged** — into GPU docker-compose |
| #763 — Environment templates section | **Merged** — into `.env` template update |
| #764 — Docling microservice | **Simplified** — use official `docling-serve` + 1 env var in dataprep |
| #765 — Core service URLs | **Eliminated** — out of scope |
| #766 — Kong upstreams | **Eliminated** — out of scope |

### Consolidated Work Items

| # | Deliverable | Description |
|---|---|---|
| 1 | GPU Docker Compose | New compose file: vLLM x2 + TEI x2 + docling-serve + nginx reverse proxy |
| 2 | Dataprep Remote Docling | Add `DOCLING_ENDPOINT` env var + HTTP call with in-process fallback |
| 3 | GPU Ansible Playbook | Deploy GPU compose on remote node |
| 4 | GPU Node Security | vLLM `--api-key` + nginx TLS + auth configuration |
| 5 | `.env` Template | Add "Remote GPU Endpoints" section to existing template |

### Architecture

```
┌─────────────────────────────┐         ┌─────────────────────────────┐
│   APP NODE                  │         │   GPU NODE                  │
│   (existing GENIE.AI stack) │  HTTPS  │   (new dedicated compose)   │
│                             │────────▶│                             │
│  Dataprep (+Docling CPU      │         │  nginx (TLS + auth)         │
│   fallback when no endpoint) │────────▶│    ├── vLLM (Llama 3.1)    │
│  ChatQnA                    │         │    ├── vLLM (Gemma trans.)  │
│  Retriever                  │         │    ├── TEI (Embedding)      │
│  Reranker                   │         │    ├── TEI (Reranker)       │
│  Backend / Frontend / etc.   │         │    └── docling-serve        │
│  Kong / Nginx / Keycloak    │         │                             │
└─────────────────────────────┘         └─────────────────────────────┘
```

## Decisions Made

1. **GPU-only scope** — No need to distribute core services (ArangoDB, Backend, Redis, Keycloak)
2. **Existing env vars sufficient** — No `${VAR:-default}` pattern needed; URLs already configurable
3. **Official docling-serve** — No custom microservice; use IBM's official implementation
4. **nginx + vLLM API key** — Security model for non-isolated network
5. **Separate compose + playbook** — GPU node is independently deployed and managed
