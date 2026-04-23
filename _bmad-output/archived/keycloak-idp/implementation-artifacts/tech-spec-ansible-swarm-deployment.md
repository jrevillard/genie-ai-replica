---
title: 'Ansible Automation for Docker Swarm Deployment'
slug: 'ansible-swarm-deployment'
created: '2026-03-31'
status: 'done'
stepsCompleted: [1, 2, 3, 4, 5]
tech_stack:
  - Ansible 2.15+ / ansible-core 2.15+ (playbooks, inventory, vault, templates)
  - community.docker 4.x collection
  - Docker Engine 23+ + Docker Compose v2
  - Docker Swarm (init, stack deploy, overlay networking)
  - NVIDIA Container Toolkit (GPU nodes)
  - Ansible Vault (secret management)
  - Jinja2 templates (.env generation)
files_to_modify:
  - deploy/ansible/ansible.cfg (NEW)
  - deploy/ansible/inventory.example (NEW)
  - deploy/ansible/requirements.yml (NEW)
  - deploy/ansible/group_vars/all.yml (NEW - shared non-secret config)
  - deploy/ansible/group_vars/test.yml (NEW - test non-secret config)
  - deploy/ansible/group_vars/test.vault.example (NEW - test secrets template)
  - deploy/ansible/group_vars/production.yml (NEW - production non-secret config)
  - deploy/ansible/group_vars/production.vault.example (NEW - production secrets template)
  - deploy/ansible/templates/env.j2 (NEW)
  - deploy/ansible/files/certificates/README.md (NEW - placeholder)
  - deploy/ansible/deploy.yml (NEW - main playbook)
  - deploy/ansible/.gitignore (NEW)
  - deploy/ansible/README.md (NEW)
  - deploy/ansible/teardown.yml (NEW)
  - CLAUDE.md (update deployment section)
code_patterns:
  - EduLift pattern: monolithic playbook with phased sections (system prep, docker install, deploy)
  - ansible.cfg: inventory dir, SSH pipelining, become=root, no host key checking
  - Inventory: INI format with host groups (swarm_managers, swarm_workers, gpu_nodes)
  - Secrets: Ansible Vault encrypted group_vars (not Docker Secrets)
  - Templates: Jinja2 for .env generation from vault variables
  - Kong config: one-shot service in compose (restart_policy: on-failure, max_attempts: 5)
  - 10 images to build via explicit `docker build -f Dockerfile -t <tag> <context>` (NOT docker compose build)
  - Image build uses `Dockerfile` (default) for non-OPEA, custom names for OPEA (e.g., Dockerfile-chatqna_genie-ai)
  - Swarm node labels: gateway=true (5 services), genieai=true (7 services), gpu=true (12 OPEA + 2 disabled)
  - ~12 external images from Docker Hub / GHCR / OPEA (pulled at deploy time by Swarm)
  - docker stack deploy does NOT support build: or --env-file
  - Local registry (registry:2) on manager for image distribution
  - Single compose file docker-compose.yaml (Swarm-compatible, single source of truth)
  - Docker Secrets block in compose requires files on disk (SSL certs, prompts) — verified before deploy
  - DEPLOY_OPEA=0 to skip OPEA/AI services (no GPU needed)
  - 4 playbook tags: install, prepare, build, deploy
  - Separate teardown.yml for stack removal
test_patterns: []
---

# Tech-Spec: Ansible Automation for Docker Swarm Deployment

**Created:** 2026-03-31
**Last Updated:** 2026-03-31 (gateway=true label, per-environment vaults, code review fixes)

## Overview

### Problem Statement

The Docker Swarm deployment is currently a manual runbook (~13 steps in `docs/docker-swarm-setup.md`). Each deployment or update requires executing these steps by hand on each node, which is slow, error-prone, and non-reproducible.

### Solution

Create an Ansible project (`deploy/ansible/`) that automates the full deployment lifecycle: Docker + NVIDIA toolkit installation, Swarm init, node labeling, local registry, image build/push, `docker stack deploy`. Secrets managed via Ansible Vault, `.env` generated via Jinja2 template. Structure follows the EduLift Ansible pattern.

### Scope

**In Scope:**
- Ansible project structure (`deploy/ansible/`) following EduLift pattern
- Inventory with groups: `swarm_managers`, `gpu_nodes` (single-node: one host in all groups)
- Docker Engine + Docker Compose v2 installation on Ubuntu 22.04/24.04
- NVIDIA Container Toolkit installation (GPU nodes only)
- Swarm initialization (single-node: `docker swarm init`)
- Node labeling (`gateway=true`, `genieai=true`, `gpu=true`)
- Local Docker registry setup on manager
- Required directories and file prerequisites creation on node
- Build + push 10 GENIE.AI images to local registry (explicit `docker build` commands)
- Deploy stack via `set -a && source .env && set +a && docker stack deploy -c docker-compose.yaml genieai`
- Kong config: one-shot service in compose (no external script needed)
- Ansible Vault for secrets (`.env` vars, SSL certs)
- Jinja2 template `env.j2` for `.env` generation
- `inventory.example` template
- `requirements.yml` for Ansible collections
- README with usage instructions
- `teardown.yml` for stack removal
- Single-node Swarm deployment (initial implementation)

**Out of Scope (future):**
- Multi-node deployment (inventory structure is multi-node-ready, but playbook targets single-node; multi-node requires: firewall ports 2377/7946/4789, cross-node registry reachability, external image pre-pull to registry)
- VM provisioning (VMs exist, SSH access available)
- CI/CD pipeline integration
- High availability / node failover
- Monitoring (Prometheus, Grafana, etc.)
- Docker Secrets native (using Ansible Vault instead)
- Image versioning / rollback beyond git checkout + rebuild

## Context for Development

### Codebase Patterns

- Ansible structure follows EduLift pattern (`deploy/ansible/`): `ansible.cfg`, `inventory/`, `group_vars/`, `templates/`, `files/`, playbooks
- `ansible.cfg`: inventory dir, SSH pipelining, become=root, no host key checking
- Inventory: INI format with host groups (`swarm_managers`, `gpu_nodes`) and environment groups (`test`, `production`) for per-environment vars
- Secrets: Per-environment Ansible Vault encrypted files in `group_vars/` (e.g., `test.vault`, `production.vault`) — not Docker Secrets
- Swarm node labels: `gateway=true` (Kong, NGINX, PostgreSQL), `genieai=true` (Frontend, Backend, ArangoDB, Redis, etc.), `gpu=true` (OPEA AI/ML services)
- Templates: Jinja2 for `.env` generation from vault variables
- Kong config: `kong-config` is a one-shot service in compose (`restart_policy.condition: on-failure`, `max_attempts: 5`). Builds from `api-gateway-solution/new-config/Dockerfile`. No external post-deploy script needed.
- Build uses **explicit `docker build -f Dockerfile -t <tag> <context>` commands** — the compose file has NO `build:` directives. Each service has a custom Dockerfile path.
- 10 images to build with explicit commands (see Task 13 for complete mapping)
- `docker stack deploy` does NOT support `--env-file` — must use `set -a && source .env && set +a`
- `docker stack deploy` does NOT support `build:` — images must be pre-built and pushed to registry
- `DEPLOY_OPEA` controls OPEA service replicas: `1` (default, with GPU) or `0` (core services only)
- Docker Secrets block in compose (`secrets:` section) requires files on disk at deploy time — these are NOT validated by `docker compose config`

### Files to Reference

| File | Purpose |
| ---- | ------- |
| `docker-compose.yaml` | Swarm-compatible compose (single source of truth, all services) |
| `docs/docker-swarm-setup.md` | Manual runbook (13 steps to automate) |
| `env` | Environment variable template (~20 secrets + config vars) |
| `components/gov-chat-frontend/Dockerfile` | Frontend image build (multi-stage) |
| `components/gov-chat-backend/Dockerfile` | Backend image build |
| `components/document-repository/Dockerfile` | Document repository image build |
| `genie-ai-overlay/dataprep/Dockerfile-dataprep_genie-ai` | Dataprep image build (custom Dockerfile name) |
| `genie-ai-overlay/retriever/Dockerfile-retriever_genie-ai` | Retriever image build (custom Dockerfile name) |
| `genie-ai-overlay/chatqna/Dockerfile-chatqna_genie-ai` | ChatQnA image build (custom Dockerfile name) |
| `genie-ai-overlay/reranker/Dockerfile-reranker_genie-ai` | Reranker image build (custom Dockerfile name) |
| `api-gateway-solution/nginx/Dockerfile` | Custom nginx image build |
| `api-gateway-solution/new-config/Dockerfile` | Kong config image build |
| `secrets/ssl/server.crt`, `secrets/ssl/server.key` | SSL certificates (managed via Ansible files/) |
| `configs/prompts/*.txt` | LLM prompt files (committed to git, not secrets) |
| `~/git_projects/EduLift/edulift/deploy/ansible/` | Reference Ansible structure pattern |

### Technical Decisions

- Single-node Swarm now, inventory groups designed for multi-node later (future)
- Ansible Vault (not Docker Secrets) for secret management — simpler, no Swarm changes needed. Per-environment vault files (`test.vault`, `production.vault`) with separate vault passwords via `--vault-id <env>@prompt`
- Template `.env.j2` (not template the compose file) — keeps compose as standard source of truth, usable manually
- Build images via explicit `docker build -f Dockerfile -t <tag> <context>` commands — NOT `docker compose build` (compose has no `build:` directives)
- Kong config: one-shot service in compose, no external post-deploy script
- 10 images to build (includes nginx and kong-config added by Swarm consolidation)
- Local registry (registry:2) on manager node for image distribution
- EDU pattern: `ansible.cfg`, `inventory/` dir, `group_vars/`, `templates/`, `files/`
- Inventory INI format (consistent with EduLift)
- Project repo synced to node via `git clone` + `git pull` (deploy key for SSH auth)
- 4 playbook tags: `install`, `prepare`, `build`, `deploy` — allows targeted re-runs without full rebuild
- Separate `teardown.yml` for stack removal (not mixed into deploy.yml)
- Image tag mapping hardcoded with explicit Dockerfile paths and source/registry tag names
- `docker compose config` validates YAML + variable interpolation only — does NOT validate Docker Secrets file existence
- GPU env file sourcing: `set -a && source .env && source {{ gpu_env_file }} && set +a` (all exports, then unset)

## Implementation Plan

### Tasks

- [ ] **Task 1: Create Ansible project skeleton**
  - File: `deploy/ansible/ansible.cfg` (NEW)
  - Action: Create `ansible.cfg` based on EduLift pattern. Inventory dir = `inventory`. SSH pipelining enabled. `become = True`, `become_method = sudo`, `become_user = root`. Host key checking disabled. Retry files disabled.
  - Notes: Copy structure from `~/git_projects/EduLift/edulift/deploy/ansible/ansible.cfg`

- [ ] **Task 2: Create `.gitignore`**
  - File: `deploy/ansible/.gitignore` (NEW)
  - Action: Ignore: `inventory/` (real host IPs), `*.retry`, `files/certificates/**/*.crt`, `files/certificates/**/*.key`, `*.vault.unencrypted`, `group_vars/*.vault` (actual encrypted vaults), `.vault-pass-*`. Allow: `inventory.example`, `group_vars/all.yml`, `group_vars/*.vault.example` (templates), `group_vars/*.yml` (non-secret config), `requirements.yml`, `README.md`.
  - Notes: Vault-encrypted `.vault` files are gitignored (contain real secrets). Only `.vault.example` templates are committed. Vault password files are also gitignored.

- [ ] **Task 3: Create inventory example**
  - File: `deploy/ansible/inventory.example` (NEW)
  - Action: Create INI-format inventory with environment group (`[test]` or `[production]`) and role groups (`[swarm_managers]`, `[gpu_nodes]`). Single-node example: one host in all groups. The environment group triggers loading of matching `group_vars/<env>.yml` and `group_vars/<env>.vault`. Group vars section with: `ansible_user` (default: `ubuntu`). Shared vars (paths, timeouts, repo) go in `group_vars/all.yml`. Environment-specific vars (domains, email, OPEA settings) go in `group_vars/<env>.yml`.
  - Notes: Single-node: one host in `[test]` + `swarm_managers` + `gpu_nodes`. No `swarm_workers` group for single-node — workers join is only for multi-node (future).

- [ ] **Task 4: Create group_vars with shared and per-environment configuration**
  - File: `deploy/ansible/group_vars/all.yml` (NEW), `deploy/ansible/group_vars/test.yml` (NEW), `deploy/ansible/group_vars/production.yml` (NEW)
  - Action: Create `all.yml` with shared config only: `deploy_dir`, `data_dir`, `stack_name`, `compose_file`, `deploy_stabilization_timeout`, `teardown_*`, `repo_*`. Create per-environment files (`test.yml`, `production.yml`) with environment-specific non-secret config: `deploy_opea`, `gpu_env_file`, `nginx_public_domain`, `vue_app_api_url`, `csp_connect_src`, `cors_allowed_origins`, `email_*`, `swarm_registry_url`.
  - Notes: Ansible auto-loads `group_vars/<group>.yml` for hosts in that group. When a host is in `[test]`, both `all.yml` and `test.yml` are loaded. Secret vars go in per-environment `.vault` files (Task 5). Variables with compose defaults (ARANGO_DB, KONG_DATABASE, etc.) do NOT need to be in templates.

- [ ] **Task 5: Create per-environment vault secrets templates**
  - File: `deploy/ansible/group_vars/test.vault.example` (NEW), `deploy/ansible/group_vars/production.vault.example` (NEW)
  - Action: Create vault template files with all secret variables from `env` template Section 1: `arango_password`, `jwt_secret`, `session_secret`, `translation_cache_password`, `postgres_password`, `auth_service_username`, `auth_service_password`. Also include: `email_password`, `hugging_face_hub_token`. These are `.example` templates — the user copies to `.vault` and encrypts with `ansible-vault encrypt --vault-id <env>@prompt`.
  - Notes: Each environment has its own vault password. Use `--vault-id test@prompt` or `--vault-id test@.vault-pass-test` for password files. SSL certs are handled separately via `files/certificates/<env>/` directories. Actual `.vault` files are gitignored (contain real secrets); only `.vault.example` templates are committed.

- [ ] **Task 6: Create `.env.j2` template**
  - File: `deploy/ansible/templates/env.j2` (NEW)
  - Action: Create Jinja2 template that generates the `.env` file. Include ALL variables from the `env` template that do NOT have working defaults in docker-compose.yaml code. Template structure:
    - Section 1 (secrets): Reference vault vars (`arango_password`, `jwt_secret`, etc.)
    - Section 2 (email): Reference vault/non-secret vars
    - Section 3 (API keys): `hugging_face_hub_token`
    - Section 3b (deploy options): `deploy_opea` set to `{{ deploy_opea }}`
    - Sections 4-5: Model configs (only override vars, not defaults). Section 5 includes `VUE_APP_CSP_CONNECT_SRC` (CSP sources for frontend, must match `CSP_CONNECT_SRC` value)
    - Section 10 (proxy): Commented out by default
    - Section 12 (Swarm multi-node): `swarm_registry_url` set to `{{ swarm_registry_url }}`
  - Notes: Variables with working defaults in docker-compose.yaml (ARANGO_DB=root, ARANGO_USER=root, KONG_DATABASE=postgres, etc.) should NOT be in the template unless the user needs to override them. Preserve comments from `env` template. Use `{{ variable | default('') }}` pattern — empty string means "use compose default".

- [ ] **Task 7: Set up SSL certificates directory**
  - File: `deploy/ansible/files/certificates/README.md` (NEW)
  - Action: Create `files/certificates/` directory with a README explaining: "Place `server.crt` and `server.key` files here. These will be copied to the target node during deploy. Certificates are gitignored — never commit real certificates." No actual cert files committed.
  - Notes: The `.gitignore` excludes `*.crt` and `*.key` from this directory. Only the README is committed.

- [ ] **Task 8: Create `requirements.yml`**
  - File: `deploy/ansible/requirements.yml` (NEW)
  - Action: Create Ansible requirements file:
    ```yaml
    collections:
      - name: community.docker
        version: ">=3.0.0"
    ```
  - Notes: Install with `ansible-galaxy collection install -r requirements.yml`.

- [ ] **Task 9: Create main playbook — System preparation** `[tags: install]`
  - File: `deploy/ansible/deploy.yml` (NEW)
  - Action: Create main playbook targeting `all`. Include plays:
    1. **System preparation** (target `all`): Update apt cache, install required packages (curl, wget, gnupg2, ca-certificates, python3-pip, python3-docker, git).
    2. **Docker installation** (target `all`): Add Docker GPG key, add Docker repository, install `docker-ce`, `docker-ce-cli`, `containerd.io`, `docker-compose-plugin`. Enable and start Docker service. Add `ansible_user` to docker group.
  - Notes: Follow Docker's official Ubuntu installation docs. Use raw `apt`/`shell` tasks (no dependency on `community.docker` for install). Idempotent: use `creates` or `when` conditions to skip if already installed. The playbook is structured as distinct plays with descriptive names for readability. Estimated ~500-600 lines total.

- [ ] **Task 10: Create main playbook — NVIDIA Toolkit (GPU nodes)** `[tags: install]`
  - File: `deploy/ansible/deploy.yml` (append)
  - Action: Add play targeting `gpu_nodes` only (skip when `deploy_opea == 0`). Install NVIDIA Container Toolkit: add NVIDIA GPG key, add repository, install `nvidia-container-toolkit`. Configure Docker daemon for NVIDIA runtime: **merge** NVIDIA config into existing `/etc/docker/daemon.json` using `ansible.builtin.copy` with `content` filtered from existing file + NVIDIA addition. If file doesn't exist, create it with NVIDIA config only. Restart Docker. Verify with `docker run --rm --gpus all nvidia/cuda:12.0-base nvidia-smi`.
  - Notes: Do NOT overwrite existing `daemon.json` — merge to preserve mirror registries, log drivers, storage drivers, etc. Use `ansible.builtin.slurp` to read existing file, then merge with NVIDIA config. Only runs on hosts in `gpu_nodes` group. Skip entirely when `deploy_opea == 0`.

- [ ] **Task 11: Create main playbook — Swarm initialization** `[tags: install]`
  - File: `deploy/ansible/deploy.yml` (append)
  - Action: Add plays:
    1. **Manager init** (target `swarm_managers`): Check `docker info` for "Swarm: active". If not active, run `docker swarm init --advertise-addr {{ ansible_host }}`.
    2. **Node labels**: Apply `gateway=true`, `genieai=true`, `gpu=true` to `swarm_managers` (single-node: all labels on one node). Use `docker node update --label-add` (idempotent: check existing labels with `docker node inspect` first, skip if already set).
  - Notes: Three Swarm labels control service placement: `gateway=true` (Kong, NGINX, PostgreSQL), `genieai=true` (Frontend, Backend, ArangoDB, Redis, etc.), `gpu=true` (OPEA AI/ML). Single-node: all three labels on the manager. Multi-node (future): each label on its dedicated node. No `swarm_workers` group for single-node MVP.

- [ ] **Task 12: Create main playbook — Local registry** `[tags: install]`
  - File: `deploy/ansible/deploy.yml` (append)
  - Action: Add play targeting `swarm_managers`. Start local Docker registry: `docker run -d -p 5000:5000 --name registry --restart=unless-stopped registry:2` (idempotent: check if container `registry` already exists and running). Verify with `curl -s http://localhost:5000/v2/_catalog`.
  - Notes: Uses `docker_container` module from `community.docker` or `docker_container_info` for idempotency check.

- [ ] **Task 13: Create main playbook — Project sync and directories** `[tags: prepare]`
  - File: `deploy/ansible/deploy.yml` (append)
  - Action: Add plays:
    1. **Clone project repo** (target `swarm_managers`): `git clone {{ repo_url }} --branch {{ repo_branch }} {{ deploy_dir }}` (idempotent: check if `{{ deploy_dir }}/.git` exists, then `git pull`).
    2. **Verify Docker Secrets files** (target `swarm_managers`): Assert that `{{ deploy_dir }}/secrets/ssl/server.crt`, `{{ deploy_dir }}/secrets/ssl/server.key`, `{{ deploy_dir }}/configs/prompts/chatqna-system.txt`, `{{ deploy_dir }}/configs/prompts/chatqna-abstention.txt`, `{{ deploy_dir }}/configs/prompts/label-selector.txt` all exist. Fail immediately with clear message if any is missing.
    3. **Create required directories** (target `swarm_managers`): `data/logs/kong`, `data/logs/backend`, `data/logs/doc-repo`, `data/database_backups`, `data/huggingface`, `secrets/ssl`.
    4. **Copy SSL certificates**: From `files/certificates/` to `{{ deploy_dir }}/secrets/ssl/` with `mode: 0600`. Only copy if source files exist.
  - Notes: All on manager (single-node). Git clone is preferred over synchronize — idempotent, no large file copies of data/ volumes. If `deploy_dir` exists but is not a git repository, the playbook will fail on `git pull` — manual cleanup required. Docker Secrets verification is critical: `docker compose config` does NOT check file existence.

- [ ] **Task 14: Create main playbook — Build and push images** `[tags: build]`
  - File: `deploy/ansible/deploy.yml` (append)
  - Action: Add play targeting `swarm_managers`. Build all 10 images using **explicit `docker build` commands** (NOT `docker compose build` — the compose file has no `build:` directives):

    | # | Image Name | Dockerfile | Build Context | Registry Tag |
    |---|-----------|-----------|---------------|--------------|
    | 1 | frontend | `components/gov-chat-frontend/Dockerfile` | `components/gov-chat-frontend/` | `{{ swarm_registry_url }}/genie-ai-frontend:latest` |
    | 2 | backend | `components/gov-chat-backend/Dockerfile` | `components/gov-chat-backend/` | `{{ swarm_registry_url }}/genie-ai-backend:latest` |
    | 3 | document-repository | `components/document-repository/Dockerfile` | `components/document-repository/` | `{{ swarm_registry_url }}/genie-ai-document-repository:latest` |
    | 4 | dataprep-arango | `genie-ai-overlay/dataprep/Dockerfile-dataprep_genie-ai` | `genie-ai-overlay/dataprep/` | `{{ swarm_registry_url }}/genie-ai-dataprep-arango:latest` |
    | 6 | retriever-arango | `genie-ai-overlay/retriever/Dockerfile-retriever_genie-ai` | `genie-ai-overlay/retriever/` | `{{ swarm_registry_url }}/genie-ai-retriever-arango:latest` |
    | 7 | chatqna-server | `genie-ai-overlay/chatqna/Dockerfile-chatqna_genie-ai` | `genie-ai-overlay/chatqna/` | `{{ swarm_registry_url }}/genie-ai-chatqna-server:latest` |
    | 8 | reranker | `genie-ai-overlay/reranker/Dockerfile-reranker_genie-ai` | `genie-ai-overlay/reranker/` | `{{ swarm_registry_url }}/genie-ai-reranker:latest` |
    | 9 | nginx | `api-gateway-solution/nginx/Dockerfile` | `api-gateway-solution/nginx/` | `{{ swarm_registry_url }}/genie-ai-nginx:latest` |
    | 10 | kong-config | `api-gateway-solution/new-config/Dockerfile` | `api-gateway-solution/new-config/` | `{{ swarm_registry_url }}/genie-ai-kong-config:latest` |

    Build command: `docker build -f <dockerfile> -t <local_tag> <context>` from `{{ deploy_dir }}`.
    Tag command: `docker tag <local_tag> {{ swarm_registry_url }}/<registry_tag>`.
    Push command: `docker push {{ swarm_registry_url }}/<registry_tag>`.
    Use a loop over the image mapping list. Skip OPEA images (rows 5-8) if `deploy_opea == 0`.
  - Notes: All paths are relative to `{{ deploy_dir }}`. OPEA Dockerfiles have custom names (e.g., `Dockerfile-chatqna_genie-ai`). The registry tag names must match `docker-compose.yaml` image references exactly.

- [ ] **Task 15: Create main playbook — Generate .env and deploy stack** `[tags: deploy]`
  - File: `deploy/ansible/deploy.yml` (append)
  - Action: Add play targeting `swarm_managers`:
    1. **Validate vault variables**: `ansible.builtin.assert` on mandatory vault variables (`arango_password`, `jwt_secret`, `session_secret`, `translation_cache_password`, `postgres_password`). Fail immediately with clear message if any required variable is empty or undefined.
    2. **Generate .env**: Render `templates/env.j2` to `{{ deploy_dir }}/.env` with `mode: 0600`.
    3. **Validate compose syntax**: Run `set -a && source {{ deploy_dir }}/.env && set +a && docker compose config > /dev/null` from `{{ deploy_dir }}` to catch YAML and variable interpolation errors. Uses same sourcing pattern as `docker stack deploy` for consistency.
    4. **Deploy stack**: `set -a && source {{ deploy_dir }}/.env && source {{ deploy_dir }}/{{ gpu_env_file }} && set +a && docker stack deploy -c {{ deploy_dir }}/{{ compose_file }} {{ stack_name }}`.
    - Notes: GPU env file sourcing: `set -a` at start, source `.env` AND `gpu_env_file`, then `set +a`. This ensures ALL variables from both files are exported before `docker stack deploy` runs. If `gpu_env_file` is empty string, the `source` is skipped (use `when` condition). The `set +a` after deploy unsets the export to avoid polluting the shell.

- [ ] **Task 16: Create main playbook — Post-deploy verification** `[tags: deploy]`
  - File: `deploy/ansible/deploy.yml` (append)
  - Action: Add play targeting `swarm_managers`:
    1. **Wait for services**: Use `ansible.builtin.command` with `retries` and `delay` to loop until `docker service ls` shows expected service count. Timeout: `{{ deploy_stabilization_timeout }}` seconds (default: 900 = 15 min). Expected services: 24 (full) or 12 (no OPEA when `deploy_opea == 0`).
    2. **Smoke tests**: `curl -sk https://localhost/api/health` expects HTTP 200. `curl -sk https://localhost/` expects HTML response.
    3. **Report**: Display `docker service ls` output using `debug` callback.
  - Notes: Use `register` + `until` with `retries`/`delay` pattern. Kong config one-shot service runs automatically — no manual action needed. First deploy takes longest (5-15 min) due to Swarm restart cycles. Service count: gateway services (kong-database, kong-migrations, kong, kong-config, nginx) + app services (frontend, backend, redis-cache, document-repository, clamav, arango-vector-db, http-service) = 12 base + OPEA services when `deploy_opea == 1` = 24 total. 2 additional OPEA services (chatqna-xeon-ui-server, chatqna-xeon-nginx-server) have `replicas: 0` and never run.

- [ ] **Task 17: Create README**
  - File: `deploy/ansible/README.md` (NEW)
  - Action: Document:
    1. Prerequisites (Ansible 2.14+, `community.docker` 3.x, SSH access to node, Vault password)
    2. Quick start (copy inventory.example, edit vars, run playbook)
    3. Inventory setup (single-node example)
    4. Vault setup (`ansible-vault encrypt group_vars/all.vault`, edit with `ansible-vault edit`, `--ask-vault-pass` vs `--vault-password-file`)
    5. SSL certificates (place in `files/certificates/`)
    6. GPU configuration (`deploy_opea: 0` for no GPU, `gpu_env_file`)
    7. Available plays and tags (`--tags install,prepare,build,deploy`)
    8. Teardown (`ansible-playbook teardown.yml`)
    9. Troubleshooting (common issues)
  - Notes: Follow EduLift README structure as reference.

- [ ] **Task 18: Create teardown playbook**
  - File: `deploy/ansible/teardown.yml` (NEW)
  - Action: Create separate teardown playbook targeting `swarm_managers`:
    1. **Remove stack**: `docker stack rm {{ stack_name }}`. Wait 30s for cleanup.
    2. **Verify services removed**: Assert `docker service ls | grep {{ stack_name }}` returns empty.
    3. **Remove volumes** (conditional): `docker volume rm` for kong_data, nginx_conf, redis_data, doc_repo_uploads, arango_data. Controlled by `teardown_remove_volumes` variable (default: `false`).
    4. **Stop registry** (conditional): `docker stop registry && docker rm registry`. Controlled by `teardown_remove_registry` variable (default: `false`).
  - Notes: Separate file to prevent accidental teardown when running deploy.yml. Document in README.

- [ ] **Task 19: Update CLAUDE.md**
  - File: `CLAUDE.md` (MODIFY)
  - Action: Add Ansible deployment section to CLAUDE.md under "Docker Deployment" with:
    1. Ansible project location (`deploy/ansible/`)
    2. Quick deploy command: `ansible-playbook -i inventory deploy.yml --ask-vault-pass`
    3. Tagged deploy: `ansible-playbook -i inventory deploy.yml --tags deploy --ask-vault-pass`
    4. Teardown: `ansible-playbook -i inventory teardown.yml --ask-vault-pass`
    5. Reference to `deploy/ansible/README.md` for full documentation
  - Notes: Keep existing manual deployment commands. Add Ansible as the recommended method.

### Acceptance Criteria

- [ ] **AC 1:** Given a fresh Ubuntu 22.04/24.04 VM with SSH access, when the playbook runs with a valid inventory and vault secrets, then Docker Engine 23+ and Docker Compose v2 are installed and running (requires Ansible 2.15+ / ansible-core 2.15+).
- [ ] **AC 2:** Given a GPU node in the inventory and `deploy_opea != 0`, when the playbook runs, then NVIDIA Container Toolkit is installed and `docker run --rm --gpus all nvidia/cuda:12.0-base nvidia-smi` succeeds.
- [ ] **AC 3:** Given `deploy_opea == 0`, when the playbook runs, then NVIDIA Toolkit installation is skipped and OPEA images (dataprep-arango, retriever-arango, chatqna-server, reranker) are not built or pushed.
- [ ] **AC 4:** Given a single-node inventory (one host in all groups), when the playbook runs, then Docker Swarm is initialized, the node has `gateway=true`, `genieai=true`, and `gpu=true` labels, and a local registry is running on port 5000.
- [ ] **AC 5:** Given the project repo is accessible, when the playbook runs, then the repo is cloned to `{{ deploy_dir }}` and all required directories are created.
- [ ] **AC 6:** Given SSL certificates in `files/certificates/`, when the playbook runs, then they are copied to `{{ deploy_dir }}/secrets/ssl/` with `mode: 0600`.
- [ ] **AC 7:** Given the build completes, when the playbook runs, then 10 images (or 6 if `deploy_opea == 0`) are built via explicit `docker build -f` commands, tagged with `{{ swarm_registry_url }}/` prefix, and pushed to the local registry.
- [ ] **AC 8:** Given vault-encrypted secrets in `group_vars/all.vault`, when the playbook runs, then `{{ deploy_dir }}/.env` is generated from `env.j2` template with all secrets populated, with `mode: 0600`.
- [ ] **AC 9:** Given `.env` is generated, when `set -a && source .env && set +a && docker compose config` runs, then no validation errors are reported.
- [ ] **AC 10:** Given the stack is deployed, when `docker service ls` runs, then the expected number of services are listed and running after `{{ deploy_stabilization_timeout }}` seconds (24 for full, 12 for no-OPEA).
- [ ] **AC 11:** Given the stack is deployed and services are healthy, when `curl -sk https://localhost/api/health` runs, then HTTP 200 is returned.
- [ ] **AC 12:** Given the playbook runs a second time with `--tags install,prepare` (idempotent), then no changes are made — Docker install, Swarm init, registry, labels, and directory creation are all skipped.
- [ ] **AC 13:** Given `--tags deploy` is used, when the playbook runs, then only vault validation, .env generation, stack deploy, and verification execute (no install, no build, no prepare).
- [ ] **AC 14:** Given `teardown.yml` runs, when `teardown_remove_volumes` is `false`, then the stack and services are removed (verified by `docker service ls` returning no services for the stack) but named volumes persist. When `true`, volumes are also removed.
- [ ] **AC 15:** Given a required vault variable is missing or empty, when the deploy play runs, then the playbook fails immediately with a clear error message identifying the missing variable (before any .env generation or stack deploy).
- [ ] **AC 16:** Given the prepare play runs, when Docker Secrets files (SSL certs, prompt files) are missing on the node, then the playbook fails immediately with a clear error listing the missing files (before any stack deploy).
- [ ] **AC 17:** Given the build play runs, when `docker build -f <dockerfile>` executes for each of the 10 services, then each build succeeds and produces a tagged image.
- [ ] **AC 18:** Given `deploy_opea == 0`, when the build play runs, then only 5 non-OPEA images are built (frontend, backend, document-repository, nginx, kong-config).

## Additional Context

### Dependencies

- **Ansible control machine**: Ansible 2.14+, `community.docker` 3.x (installed via `requirements.yml`)
- **Project repo**: Must be accessible from the target node (git clone via SSH deploy key)
- **Docker Hub / GHCR access**: Target node needs internet access to pull external images and base images at build time
- **SSL certificates**: Must exist in `deploy/ansible/files/certificates/` before deployment
- **Vault password**: Operator must have the Ansible Vault password to decrypt secrets

### Testing Strategy

**Manual testing (primary):**
1. Provision a fresh Ubuntu 22.04 VM (single-node) with GPU
2. Configure inventory.example with the VM's IP and deploy key
3. `ansible-galaxy collection install -r requirements.yml`
4. `ansible-vault encrypt group_vars/all.vault` and set vault secrets
5. Place SSL certificates in `files/certificates/`
6. Run `ansible-playbook -i inventory deploy.yml --ask-vault-pass`
7. Verify all services are running: `ssh vm 'docker service ls'`
8. Run smoke tests: `ssh vm 'curl -sk https://localhost/api/health'`
9. Run playbook a second time to verify idempotency (no changes on `--tags install,prepare`)
10. Run `--tags deploy` alone to verify redeploy without rebuild
11. Test `deploy_opea: 0` to verify OPEA skip
12. Run `ansible-playbook teardown.yml -i inventory --ask-vault-pass` and verify cleanup
13. Full redeploy after teardown to verify clean re-deployment

**Automated testing (future):**
- Molecule tests for individual roles (not in scope for initial implementation)
- CI/CD integration (not in scope)

### Notes

- Single-node only for initial implementation — multi-node is future work
- Three Swarm node labels: `gateway=true` (Kong, NGINX, PostgreSQL), `genieai=true` (Frontend, Backend, ArangoDB, Redis, etc.), `gpu=true` (OPEA AI/ML)
- GPU nodes identification via `gpu=true` label — NVIDIA toolkit only installed when `deploy_opea != 0`
- Single-node: one VM with all three labels (`gateway=true`, `genieai=true`, `gpu=true`)
- `docker stack deploy` requires `set -a && source .env && set +a` (no `--env-file` support). Same pattern used for `docker compose config` validation for consistency.
- `.env` file exists in plaintext on the node — same as current manual workflow, not a regression
- Kong config runs as one-shot service in compose — no external post-deploy script needed
- First deployment takes 5-15 minutes for full stabilization due to Swarm restart cycles
- The `kong-config` image requires `curl` + `jq` inside the container (handled by its Dockerfile)
- Rollback strategy (future): implement image versioning with date-stamped tags (e.g., `genie-ai-backend:20260331-1`). Current `:latest` approach means overwritten images cannot be restored without rebuild.
- `daemon.json` merge: preserve existing Docker config (mirrors, log drivers) when adding NVIDIA runtime config
- `docker compose config` validates YAML + variable interpolation only — does NOT verify Docker Secrets file existence on disk
- Build uses explicit `docker build -f <Dockerfile>` commands because `docker-compose.yaml` has no `build:` directives
- OPEA Dockerfiles have custom names (e.g., `Dockerfile-chatqna_genie-ai`, not just `Dockerfile`)
- External images (vllm, opea/*, postgres, kong, etc.) are pulled by Swarm at deploy time — no pre-pull needed for single-node
- `data_dir` variable controls all bind mount paths under `./data/` (logs, backups, huggingface) — must exist on all nodes
