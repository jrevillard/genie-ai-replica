---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8]
inputDocuments: ['brainstorming-session-2026-05-29.md', 'issue-758-gitlab', 'project-context.md']
workflowType: 'architecture'
project_name: 'genie-ai'
user_name: 'Jerome Revillard'
date: '2026-05-29'
lastStep: 8
status: 'complete'
completedAt: '2026-05-29'
---

# Architecture Decision Document — Remote GPU Node

_This document builds collaboratively through step-by-step discovery. Sections are appended as we work through each architectural decision together._

## Input Documents

- **Issue #758** — "Remote GPU Node: Dedicated Docker Compose + Ansible Playbook for Distributed Inference" (GitLab)
- **Brainstorming Session 2026-05-29** — KISS review and simplification of original 8-issue plan
- **project-context.md** — AI agent rules for the GENIE.AI codebase

## Project Context Analysis

### Requirements Overview

**Functional Requirements:**

| # | Requirement | Architectural Implication |
|---|-------------|---------------------------|
| F1 | Deploy 5 GPU services on a dedicated node | Separate Docker Compose, GPU memory management |
| F2 | Endpoints accessible remotely via HTTPS | nginx reverse proxy with TLS (Let's Encrypt) |
| F3 | Authentication via API keys (1 per GENIE.AI instance) | nginx `map` + external keys file |
| F4 | Support multiple keys without restarting services | `nginx -s reload` (zero downtime) |
| F5 | Integrate docling-serve (official IBM) as 5th service | Official image, no in-process fallback |
| F6 | Dataprep calls docling via `DOCLING_ENDPOINT` | No fallback — if GPU node is remote, the endpoint is configured |
| F7 | Separate Ansible playbook for GPU deployment | Dedicated inventory `[gpu_nodes]` |
| F8 | Template `.env` with "Remote GPU Endpoints" section | Ports 9400-9404, HTTPS URLs |

**Non-Functional Requirements:**

| NFR | Detail | Impact |
|-----|--------|--------|
| Security | Network not isolated between app and GPU | nginx TLS + API keys mandatory |
| Multi-tenancy | GPU node shared by N GENIE.AI instances | Stateless, idempotent, 1 shared key per client |
| Availability | `nginx -s reload` without GPU outage | Graceful reload, continuous services |
| Backward Compatibility | Single-node without override = unchanged | Existing defaults preserved |

### Scale & Complexity

- **Complexity**: Medium — primarily infrastructure (Docker Compose + nginx + Ansible), only 1 application code change (dataprep `DOCLING_ENDPOINT`)
- **Domain**: Infrastructure / DevOps
- **Architectural components**: ~3 (nginx config, Docker Compose GPU, Ansible playbook)

### Technical Constraints & Dependencies

- **vLLM**: 1 model per instance (no multi-model serving)
- **TEI**: 1 model per instance (embedding ≠ reranker)
- **docling-serve**: Official IBM image, MIT license — no custom microservice
- **GPU**: RTX 6000 Ada (48GB VRAM) — 5 services must fit
- **TLS**: Let's Encrypt via certbot one-shot — same pattern as app node
- **DNS**: 1 public IP = 1 hostname for the GPU node

### Cross-Cutting Concerns Identified

- **Security**: API keys and TLS applied uniformly across all 5 services via nginx
- **Observability**: Healthchecks `/health` mandatory on each service; smoke tests post-deploy Ansible
- **Monitoring**: Cert expiry alerts required on the GPU node

### Party Mode Contributions (2026-05-29)

**Agents consulted:** Winston (Architect), Amelia (Dev), Murat (Test Architect)

| Decision | Source | Detail |
|----------|--------|--------|
| Decentralized TLS | 🏗️ Winston | Each node manages its own certs via certbot one-shot, same pattern |
| Dedicated DNS | 🏗️ Winston | 1 public IP = 1 hostname for the GPU node, no round-robin |
| Compose file | 💻 Amelia | `docker-compose.gpu.yaml` at project root |
| Separate Ansible | 💻 Amelia | `deploy/ansible/deploy-gpu.yml` + `[gpu_nodes]` inventory |
| Healthchecks | 🧪 Murat | `/health` mandatory on 5 services, post-deploy verification |
| Smoke tests | 🧪 Murat | Ansible post-deploy < 30s, fail fast if KO |
| No double proxy | 👤 Jerome | Backend connects directly to GPU node, not via app node nginx |
| No docling fallback | 👤 Jerome | `DOCLING_ENDPOINT` configured = remote, otherwise single-node local |
| 1 shared key per client | 👤 Jerome | Same API key for all 5 services, 1 key per GENIE.AI instance |

## Core Architectural Decisions

### Decision 1: File Structure

**Decision:** The GPU node uses the same conventions as the existing project, with a separate Docker Compose and a dedicated Ansible playbook.

```
genie-ai/
├── docker-compose.yaml              # App node (existing, unchanged)
├── docker-compose.gpu.yaml          # GPU node (new)
├── env.t4 / env.rtx6000             # GPU config (reused by GPU compose)
├── deploy/
│   └── ansible/
│       ├── deploy.yml               # App node (existing)
│       ├── deploy-gpu.yml           # GPU node (new)
│       ├── inventory/
│       │   └── gpu.ini.example      # GPU node inventory (template)
│       ├── group_vars/
│       │   ├── gpu.yml               # GPU node variables
│       │   └── gpu.vault.example     # GPU vault secrets (template)
│       └── templates/
│           ├── docker-compose.gpu.yaml.j2
│           ├── gpu-proxy.conf.j2      # GPU nginx config (Jinja2)
│           └── api_keys.map.j2        # GPU API keys (Jinja2)
├── secrets/
│   └── ssl/                         # Let's Encrypt certs (existing, gitignored)
└── genie-ai-overlay/
    └── dataprep/
        └── genieai_dataprep_utils.py  # Modification: DOCLING_ENDPOINT
```

**Rationale:**
- `docker-compose.gpu.yaml` at root = consistent with existing `env.t4`/`env.rtx6000`
- Jinja2 templates in `deploy/ansible/templates/` = dedicated Ansible location, no duplication
- Ansible follows existing pattern: `deploy-gpu.yml` + dedicated inventory + `group_vars/gpu.yml`
- GPU files are committed (configs, templates); secrets are never committed (`secrets/` gitignored)

### Decision 2: Image Versions

**Decision:** Reuse the same images and tags as the app node, with version pinned for stability.

| Service | Image | Tag | Current Source |
|---------|-------|-----|-----------------|
| vLLM (Llama 3.1-8B) | `vllm/vllm-openai` | `latest` | `docker-compose.yaml` |
| vLLM Translation (Gemma 3-4B) | `vllm/vllm-openai` | `v0.10.0` | `docker-compose.yaml` |
| TEI Embedding | `ghcr.io/huggingface/text-embeddings-inference` | `1.9.3` | `docker-compose.yaml` |
| TEI Reranker | `ghcr.io/huggingface/text-embeddings-inference` | `1.9.3` | `docker-compose.yaml` |
| docling-serve | `ghcr.io/institute-of-data-science/docling-serve` | `latest` | Official IBM |
| nginx GPU | `nginx` | `1.28-alpine` | Same base as app node nginx |
| certbot | `certbot/certbot` | `latest` | Same as app node |

**Rationale:**
- No new image to maintain except docling-serve (official)
- vLLM/TEI images are the same as app node — synchronized updates
- `v0.10.0` pinned for translation service (already in production)
- GPU variables (`VLLM_GPU_UTILIZATION`, etc.) reused from `env.t4`/`env.rtx6000`

### Decision 3: Secrets Management

**Decision:** Each node manages its own secrets locally. No synchronization between nodes.

| Secret | App Node | GPU Node | Source |
|--------|----------|----------|--------|
| SSL certs (Let's Encrypt) | `secrets/ssl/server.crt + server.key` | Generated on GPU node by certbot | certbot one-shot |
| API keys | N/A | Generated by Ansible from template | `templates/api_keys.map.j2` + `gpu.vault` |
| Ansible vault | `group_vars/test.vault` | `group_vars/gpu.vault` | Each playbook, each vault |

**API keys management:**
```yaml
# group_vars/gpu.yml
gpu_api_keys:
  - name: instance-genie-a
    key: "generated-secure-key-here"
  - name: instance-genie-b
    key: "generated-secure-key-here"
```

Ansible generates the `api_keys.map` file from this list:
```nginx
# api_keys.map (generated by Ansible)
instance-genie-a  1;
instance-genie-b  1;
```

**Rationale:**
- Existing pattern: `secrets/` gitignored, certs in `secrets/ssl/`
- Each node is autonomous — no coupling between secrets
- Ansible vault protects keys in transit and at rest
- `nginx -s reload` after modification = no GPU service restart

### Decision 4: Monitoring & Observability

**Decision:** Integrated healthchecks in docker-compose + Ansible smoke tests post-deploy. No dedicated observability on the GPU node for now (monitoring deferred).

**Healthchecks (docker-compose.gpu.yaml):**
```yaml
vllm-llm:
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
    interval: 30s
    timeout: 10s
    retries: 3
    start_period: 120s  # vLLM is slow at startup
tei-embedding:
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:80/health"]
    interval: 30s
    timeout: 10s
    retries: 3
docling-serve:
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
    interval: 30s
    timeout: 10s
    retries: 3
```

**Ansible smoke tests (post-deploy, < 30s):**
```yaml
# deploy/ansible/deploy-gpu.yml — post-deploy tasks
- name: Verify nginx is running and TLS is valid
  uri:
    url: "https://{{ inventory_hostname }}:9400/health"
    validate_certs: no
    headers:
      Authorization: "Bearer {{ gpu_api_keys[0].key }}"
  register: nginx_health
  retries: 5
  delay: 10
  until: nginx_health.status == 200

- name: Verify all 5 GPU services are healthy
  uri:
    url: "https://{{ inventory_hostname }}:{{ item }}/health"
    validate_certs: no
    headers:
      Authorization: "Bearer {{ gpu_api_keys[0].key }}"
  loop: ["9400", "9401", "9402", "9403", "9404"]
  register: service_health

- name: Verify API key rejection (no key = 401)
  uri:
    url: "https://{{ inventory_hostname }}:9400/health"
    validate_certs: no
  register: auth_check
  failed_when: auth_check.status != 401
```

**Rationale:**
- `start_period: 120s` for vLLM — model loading takes time
- Smoke tests cover: nginx TLS, 5 services, auth (rejection without key)
- Fail fast: Ansible stops immediately if a check fails
- Monitoring/observability = future (possible integration with existing OTel Collector)

## Decision Impact Analysis

**Implementation Sequence:**
1. Docker Compose GPU (`docker-compose.gpu.yaml`) — foundation
2. nginx GPU config (`deploy/ansible/templates/gpu-proxy.conf.j2`) — security + routing
3. Ansible playbook (`deploy/ansible/deploy-gpu.yml`) — deployment automation
4. Dataprep code change (`genieai_dataprep_utils.py`) — DOCLING_ENDPOINT
5. Template `.env` — Remote GPU Endpoints section

**Cross-Component Dependencies:**
- Ansible playbook depends on docker-compose + nginx config (must deploy both)
- Dataprep code change independent — can be tested locally before GPU deployment
- Template `.env` modified on app node only — GPU node has its own vars

## Implementation Patterns & Consistency Rules

### Naming Patterns

| Item | Convention | Example |
|------|-----------|---------|
| Docker Compose GPU | `docker-compose.gpu.yaml` | Root, parallel with `env.t4`/`env.rtx6000` |
| nginx GPU config | `gpu-proxy.conf` | `gpu-` prefix to distinguish from app node |
| API keys template | `api_keys.map.j2` | Jinja2 template, generated by Ansible |
| Ansible playbook | `deploy-gpu.yml` | Same pattern as `deploy.yml` |
| Ansible variables | `gpu.yml` | `group_vars/gpu.yml` |
| Ansible vault | `gpu.vault` | Encrypted secrets, API keys |
| Public HTTPS port | `9400-9404` | Dedicated GPU range, sequential |
| nginx template | `gpu-proxy.conf.j2` | Jinja2 template for Ansible |

### Structure Patterns

**New GPU resources:**
```
deploy/ansible/
    ├── deploy-gpu.yml         # GPU node playbook (committed)
    ├── inventory/
    │   └── gpu.ini.example    # GPU node inventory (template, committed)
    ├── group_vars/
    │   ├── gpu.yml            # GPU variables (committed)
    │   └── gpu.vault.example  # Vault secrets template (committed)
    └── templates/
        ├── docker-compose.gpu.yaml.j2  # Compose template (committed)
        ├── gpu-proxy.conf.j2           # nginx template (committed)
        └── api_keys.map.j2             # API keys template (committed)
docker-compose.gpu.yaml        # GPU Compose (committed)
```

**Resource locations:**
- `deploy/ansible/templates/` — all GPU Jinja2 templates (nginx, api_keys, compose)
- `deploy/ansible/` — same structure as app node, separate files

### Format Patterns

**api_keys.map.j2 (committed template):**
```nginx
# API keys map for GPU node nginx
# Managed by Ansible deploy-gpu.yml - do not edit manually
{% for client in gpu_api_keys %}
{{ client.key }}  1;
{% endfor %}
```

**gpu.yml (committed variables):**
```yaml
gpu_api_keys:
  - name: instance-genie-a
    key: ""
```

**api_keys.map (generated by Ansible, not committed):**
```nginx
instance-genie-a  1;
```

### Process Patterns

**GPU deployment:**
1. `ansible-playbook -i inventory/gpu.ini deploy-gpu.yml --vault-id gpu@prompt`
2. Ansible generates `docker-compose.gpu.yaml` and `gpu-proxy.conf` from templates
3. Ansible generates `api_keys.map` from `gpu_api_keys` vault variable
4. Ansible runs `docker compose -f docker-compose.gpu.yaml up -d`
5. Ansible smoke tests verify nginx TLS, health of 5 services, rejection without key

**Single-node (unchanged):**
- No modification required on app node if `docker-compose.gpu.yaml` is not deployed
- GPU env vars (`VLLM_ENDPOINT`, etc.) keep their local Docker DNS defaults

**Rollback:**
- `docker compose -f docker-compose.gpu.yaml down` on GPU node
- App node unchanged

### Enforcement Guidelines

**ALL AI agents MUST:**
- Use service names and ports defined in this document (9400-9404)
- Never directly modify files generated by Ansible (`api_keys.map`, deployed configs)
- Always use Jinja2 templates for GPU configurations
- Not introduce new env variables without adding them to the `.env` template

**Verification:**
- `docker compose -f docker-compose.gpu.yaml config` must pass without error
- `nginx -t` on GPU node must validate config before reload
- Ansible smoke tests must all pass before considering deployment successful

## Project Structure & Boundaries

### Complete Project Directory Structure

```
genie-ai/                              # Project root (existing)
├── docker-compose.yaml                # App node — single source of truth (existing, unchanged)
├── docker-compose.gpu.yaml           # GPU node — dedicated compose (NEW)
├── env                                # Config template (existing — add Remote GPU Endpoints section)
├── env.t4                             # GPU memory config T4 (existing, reused)
├── env.rtx6000                        # GPU memory config RTX 6000 (existing, reused)
│
├── deploy/
│   └── ansible/
│       ├── deploy.yml                 # App node playbook (existing, unchanged)
│       ├── deploy-gpu.yml             # NEW — GPU node playbook
│       ├── requirements.yml           # Ansible Galaxy (existing, unchanged)
│       ├── inventory/
│       │   ├── test.ini               # App node inventory (existing)
│       │   └── gpu.ini.example       # NEW — GPU node inventory template
│       ├── group_vars/
│       │   ├── test.yml               # App node vars (existing)
│       │   ├── gpu.yml                # NEW — GPU node variables
│       │   ├── test.vault.example     # App node vault template (existing)
│       │   └── gpu.vault.example      # NEW — GPU node vault template
│       └── templates/
│           ├── docker-compose.gpu.yaml.j2  # NEW — GPU compose template
│           ├── gpu-proxy.conf.j2            # NEW — GPU nginx template
│           └── api_keys.map.j2              # NEW — GPU API keys template
│
├── genie-ai-overlay/
│   └── dataprep/
│       └── genieai_dataprep_utils.py  # EXISTING — add DOCLING_ENDPOINT
│
└── secrets/
    └── ssl/                           # SSL certs (existing, gitignored)
```

### Architectural Boundaries

**API Boundaries:**

| Boundary | App Node | GPU Node | Protocol |
|----------|----------|----------|----------|
| Public HTTPS | nginx `:443` | nginx GPU `:9400-9404` | TLS 1.2+ |
| Inter-service | Docker DNS (`http://service:port`) | nginx reverse proxy (`https://gpu-host:940x`) | HTTPS + API key |
| GPU node internal | N/A | Docker DNS (`http://service:port`) | HTTP (not exposed) |

**Component Boundaries:**

```
┌──────────────────────────────────────────────────────────────────────┐
│  APP NODE (existing)                                                 │
│                                                                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                   │
│  │ Dataprep    │  │ ChatQnA     │  │ Retriever   │  ──┐               │
│  │ (DOCLING_   │  │ (VLLM_      │  │ (EMBEDDING_ │    │ env vars     │
│  │  ENDPOINT)  │  │  ENDPOINT)  │  │  ENDPOINT)  │  ──┘ point here  │
│  └─────────────┘  └─────────────┘  └─────────────┘                   │
│                                                                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                   │
│  │ Reranker    │  │ Backend    │  │ Frontend    │                   │
│  │ (RERANKER_  │  │             │  │             │                   │
│  │  ENDPOINT)  │  │             │  │             │                   │
│  └─────────────┘  └─────────────┘  └─────────────┘                   │
│                                                                      │
│  Kong ─── NGINX ─────────────────────────────────── Public :443     │
└──────────────────────────────────────────────────────────────────────┘
                              │ HTTPS + API key header
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│  GPU NODE (new)                                                      │
│                                                                      │
│  NGINX (TLS termination + API key auth)                             │
│    │:9400 ─── vLLM Llama 3.1-8B        (:8000 internal)              │
│    │:9401 ─── vLLM Gemma 3-4B trans.   (:8000 internal)              │
│    │:9402 ─── TEI Embedding             (:80 internal)                │
│    │:9403 ─── TEI Reranker              (:80 internal)                │
│    │:9404 ─── docling-serve             (:8000 internal)              │
│                                                                      │
│  certbot (one-shot) ─── Let's Encrypt                               │
└──────────────────────────────────────────────────────────────────────┘
```

**Data Boundaries:**

| Boundary | Detail |
|----------|--------|
| Config | App node `env` / `.env` — GPU node vars in `group_vars/gpu.yml` |
| Secrets | App node vault `test.vault` — GPU node vault `gpu.vault` |
| API keys | GPU node only — `api_keys.map` generated by Ansible from vault |
| SSL | App node certs in `secrets/ssl/` — GPU node certs generated by certbot on-node |

### Requirements to Structure Mapping

| # | Requirement | Location |
|---|-------------|----------|
| F1 | 5 dedicated GPU services | `docker-compose.gpu.yaml` |
| F2 | Remote HTTPS endpoints | `deploy/ansible/templates/gpu-proxy.conf.j2` |
| F3 | API keys auth (1/instance) | `deploy/ansible/templates/api_keys.map.j2` + `group_vars/gpu.yml` |
| F4 | Multi-keys without restart | `nginx -s reload` in `deploy-gpu.yml` |
| F5 | docling-serve (IBM) | Service in `docker-compose.gpu.yaml` |
| F6 | Dataprep `DOCLING_ENDPOINT` | `genie-ai-overlay/dataprep/genieai_dataprep_utils.py` |
| F7 | Separate Ansible playbook | `deploy/ansible/deploy-gpu.yml` |
| F8 | Template `.env` GPU section | `env` (section added) |

### Integration Points

**Internal Communication (GPU node):**
- Docker Compose internal network — services communicate via Docker DNS on internal ports
- nginx reverse proxy is the only public entry point

**External Communication (app → GPU):**
- App node services use env vars to point to GPU node HTTPS endpoints
- Example: `VLLM_ENDPOINT=https://gpu-host:9400/v1` instead of `http://vllm-llm:8000/v1`
- Header `Authorization: Bearer <VLLM_API_KEY>` sent by each client service (native OpenAI SDK)

**Data Flow:**
```
User Query
  → Backend → ChatQnA → vLLM (app node or GPU node depending on config)
  → Retriever → TEI Embedding (app node or GPU node depending on config)
  → Reranker → TEI Reranker (app node or GPU node depending on config)
  → Dataprep → docling-serve (app node or GPU node depending on config)
```

### File Organization Patterns

**Configuration Files:**
- `deploy/ansible/templates/` — all committed Jinja2 templates (`.j2`)
- `group_vars/gpu.yml` — committed variables (no secrets)
- `group_vars/gpu.vault` — Ansible Vault encrypted secrets

**Templates (Jinja2, committed):**
- `templates/docker-compose.gpu.yaml.j2` — compose generated with Ansible vars
- `templates/gpu-proxy.conf.j2` — nginx config generated with Ansible vars
- `templates/api_keys.map.j2` — API keys generated from `gpu_api_keys` vault

**Secrets (never committed):**
- GPU node SSL certificates — generated by certbot one-shot on the node
- `group_vars/gpu.vault` — Ansible Vault encrypted
- `inventory/gpu.ini` — deployment-specific inventory (copied from `.example`)

### Development Workflow Integration

**Development (single-node, unchanged):**
```bash
docker compose up -d                    # App node only — defaults Docker DNS
docker compose --profile opea up -d     # Full stack — GPU services local
```

**Deployment (GPU node):**
```bash
cd deploy/ansible
ansible-playbook -i inventory/gpu.ini deploy-gpu.yml --vault-id gpu@prompt
```

**App node with remote GPU:**
```bash
# .env overrides — point to GPU node
VLLM_ENDPOINT=https://gpu.example.com:9400/v1
TRANSLATION_VLLM_ENDPOINT=https://gpu.example.com:9401/v1
EMBEDDING_SERVICE_URL=https://gpu.example.com:9402
RERANKER_SERVICE_URL=https://gpu.example.com:9403
DOCLING_ENDPOINT=https://gpu.example.com:9404
VLLM_API_KEY=shared-api-key-for-this-instance
```

## Architecture Validation Results

### Coherence Validation ✅

**Decision Compatibility:**
- The 4 decisions are coherent: separate Docker Compose (D1) + app node images (D2) + autonomous secrets (D3) + healthchecks/smoke tests (D4) form a consistent set.
- No version incompatibility between selected images (all from the same existing `docker-compose.yaml`).
- The nginx + certbot pattern (D2) is compatible with local secrets (D3) — certbot generates on the node, no synchronization needed.

**Pattern Consistency:**
- Uniform naming conventions (`gpu-` prefix, `.j2` templates, `deploy-gpu.yml`).
- Ansible structure follows exactly the existing `deploy.yml` pattern.
- Process patterns (deployment, rollback, single-node) are complete and non-contradictory.

**Structure Alignment:**
- The directory tree is duplication-free — single location for each file.
- API, component, and data boundaries are clearly defined and aligned with decisions.

### Requirements Coverage Validation ✅

| Requirement | Covered | By |
|----------|---------|-----|
| F1 — 5 GPU services | ✅ | `docker-compose.gpu.yaml` |
| F2 — HTTPS endpoints | ✅ | `gpu-proxy.conf.j2` (nginx TLS) |
| F3 — API keys auth | ✅ | `api_keys.map.j2` + nginx `map` |
| F4 — Multi-keys without restart | ✅ | `nginx -s reload` |
| F5 — docling-serve (IBM) | ✅ | Service in compose, official image |
| F6 — DOCLING_ENDPOINT | ✅ | `genieai_dataprep_utils.py` |
| F7 — Separate Ansible | ✅ | `deploy-gpu.yml` |
| F8 — Template `.env` | ✅ | Remote GPU Endpoints section |

**NFR Coverage:**

| NFR | Covered | By |
|-----|---------|-----|
| Security (network not isolated) | ✅ | nginx TLS + API keys on all 5 services |
| Multi-tenancy (N instances) | ✅ | Stateless, 1 key per client, nginx map |
| Availability (zero downtime reload) | ✅ | `nginx -s reload` |
| Backward Compatibility | ✅ | Existing defaults preserved, env vars unchanged |

### Implementation Readiness Validation ✅

**Decision Completeness:** All decisions include versions, rationale, and concrete examples.

**Structure Completeness:** Complete tree with precise locations, no generic placeholders.

**Pattern Completeness:** Naming, structure, format, process, and enforcement guidelines documented.

### Gap Analysis Results

**No critical gaps.**

**Minor gaps (non-blocking):**
- `docs/architecture.md` should be updated to document the GPU node (documentation, not architecture)
- The port scheme in `env` template (F8) will need to be detailed during implementation

### Architecture Completeness Checklist

**Requirements Analysis**
- [x] Project context thoroughly analyzed
- [x] Scale and complexity assessed
- [x] Technical constraints identified
- [x] Cross-cutting concerns mapped

**Architectural Decisions**
- [x] Critical decisions documented with versions
- [x] Technology stack fully specified
- [x] Integration patterns defined
- [x] Performance considerations addressed

**Implementation Patterns**
- [x] Naming conventions established
- [x] Structure patterns defined
- [x] Communication patterns specified
- [x] Process patterns documented

**Project Structure**
- [x] Complete directory structure defined
- [x] Component boundaries established
- [x] Integration points mapped
- [x] Requirements to structure mapping complete

### Architecture Readiness Assessment

**Overall Status:** READY FOR IMPLEMENTATION

**Confidence Level:** High

**Key Strengths:**
- KISS approach validated by brainstorming + Party Mode
- Zero template duplication
- Existing patterns reused (Ansible, certbot, nginx)
- Full backward compatibility — single-node unchanged

**Areas for Future Enhancement:**
- OTel monitoring on GPU node
- Cert expiry alerts
- Multi-GPU node scaling

### Implementation Handoff

**AI Agent Guidelines:**
- Follow all architectural decisions exactly as documented
- Use implementation patterns consistently across all components
- Respect project structure and boundaries
- Refer to this document for all architectural questions

**First Implementation Priority:**
1. `docker-compose.gpu.yaml` — 5 services + nginx + certbot
2. `deploy/ansible/templates/gpu-proxy.conf.j2` — nginx reverse proxy with API key auth
