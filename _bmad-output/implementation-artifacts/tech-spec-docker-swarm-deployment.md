---
title: 'Docker Swarm Deployment Compatibility'
slug: 'docker-swarm-deployment'
created: '2026-03-30'
status: 'complete'
stepsCompleted: [1, 2, 3, 4, 5, 6]
tech_stack:
  - Docker Swarm (docker stack deploy)
  - Docker Compose (Swarm mode, no version field)
  - Docker overlay networking (inter-node communication)
  - Docker Compose `deploy` section (placement constraints, replicas, restart_policy, shm_size)
  - Docker Compose `healthcheck` (service readiness)
  - Node labels (docker node update --label-add)
  - Local Docker registry for image distribution
files_to_modify:
  - docker-compose.swarm.yaml (NEW)
  - env (update with swarm comments)
  - CLAUDE.md (update deployment section)
  - docs/docker-swarm-setup.md (NEW)
code_patterns:
  - Swarm ignores depends_on — services handle startup ordering via healthcheck + Swarm restart policy
  - Swarm overlay network provides DNS-based service discovery across nodes
  - deploy.placement.constraints use node labels for pinning services to specific nodes
  - deploy.resources.reservations.devices for GPU allocation (Swarm-native, replaces runtime: nvidia)
  - deploy.resources.limits.shm_size replaces ipc: host (Swarm does not support ipc: host per container)
  - docker stack deploy does NOT support build: — images must be pre-built and pushed to a registry
  - Bind mounts must exist on the target node before deployment (relative paths resolved on each node)
  - Swarm distributes secrets (file:) from the manager to all nodes that need them at deploy time
  - One-shot init services use mode: replicated, replicas: 1, restart_policy.condition: none
  - network_mode: "service:X" is incompatible with Swarm overlay — use post-deploy scripts instead
  - container_name is ignored by Swarm — remove from compose
  - TCP-based healthchecks (nc -z) are more reliable than HTTP endpoint checks for services without documented health endpoints
test_patterns: []
---

# Tech-Spec: Docker Swarm Deployment Compatibility

**Created:** 2026-03-30
**Last Updated:** 2026-03-31 (complete — adversarial review + code review findings resolved)

## Overview

### Problem Statement

The docker-compose consolidation in MR !34 removed the ability to deploy across multiple nodes. The project previously supported separate compose files per node group (API Gateway, OPEA, GENIE.AI). A single-node deployment works with the current root `docker-compose.yaml`, but there is no way to distribute services across multiple machines.

### Solution

Create a new `docker-compose.swarm.yaml` file dedicated to Docker Swarm deployment. This file will be based on the current root compose but adapted for Swarm compatibility: replace `depends_on` with healthcheck-based readiness, add node placement constraints via labels, and use Swarm overlay networking. The existing `docker-compose.yaml` remains untouched.

### Scope

**In Scope:**
- New `docker-compose.swarm.yaml` Swarm-compatible
- Pre-build workflow + local registry setup (docker stack deploy cannot build images)
- Placement constraints (node labels) for 3 stacks: API Gateway, OPEA (GPU), GENIE.AI
- Healthcheck additions for 12 services using verified ports + TCP checks where HTTP endpoints are unavailable
- `shm_size` replacement for `ipc: "host"` on 12 OPEA services (Swarm does not support ipc: host)
- Swarm overlay networking (replaces bridge network)
- Removal of `container_name`, `runtime: nvidia`, `version` field, `depends_on`, `network_mode: "service:kong"` on kong-config
- Conversion of `kong-config` from compose service to post-deploy script
- Documentation in `env` template: comments for docker vs swarm variable differences
- Documentation: Swarm setup guide (init, registry, node labels, deploy commands, debugging)
- Single-node mode: requires `gpu=true` label on the single node for OPEA services
- Normalize `restart_policy` with differentiated max_attempts for GPU vs non-GPU services

**Out of Scope:**
- Modification of the existing `docker-compose.yaml`
- Shared volumes / storage migration between nodes
- High availability / node failover
- CI/CD pipeline changes
- Application-level connection retry logic (backend and OPEA services currently crash if dependencies are unavailable at startup — Swarm restart policy handles this)

**Future Considerations:**
- Docker Secrets: Replace `.env` file distribution with native Swarm secrets for centralized secret management across nodes. Benefits: encrypted at rest, automatic distribution to nodes, access-controlled per service. Would require a secret creation script and minor compose changes. Can be added in a follow-up iteration without architectural changes.
- Application-level resilience: Add retry loops in backend and OPEA services for graceful startup ordering instead of relying on Swarm restart cycles.
- OPEA UI/Nginx services (`chatqna-xeon-ui-server`, `chatqna-xeon-nginx-server`): Set `replicas: 0` by default. Activate if needed for OPEA debugging. Decision pending.

## Context for Development

### Codebase Patterns

- Root `docker-compose.yaml` contains **26 services** with 20 `depends_on` blocks — all must be removed in Swarm version (Swarm ignores `depends_on`)
- **8 services use `build:` directives** — `docker stack deploy` cannot build images. Must pre-build and push to a registry before deployment: `kong-config`, `frontend`, `backend`, `document-repository`, `dataprep-arango-service`, `retriever-arango-service`, `chatqna-xeon-backend-server`, `reranker`
- **12 services have `ipc: "host"`** — Swarm does not support per-container `ipc: host`. Must replace with `shm_size: '1g'` in `deploy.resources.limits`: `dataprep-arango-service`, `retriever-arango-service`, `chatqna-xeon-backend-server`, `chatqna-xeon-ui-server`, `chatqna-xeon-nginx-server`, `vllm`, `textgen`, `vllm-translation-guardrail`, `translation`, `guardrail`, `embedding`, `reranker`
- **~20 services have `container_name`** — Swarm ignores `container_name` and generates its own names. Remove all to avoid confusion.
- **`kong-config` uses `network_mode: "service:kong"`** — Incompatible with Swarm overlay networking. Convert to a post-deploy shell script executed via `docker exec` on the kong container.
- **12 services lack healthchecks** and need them added (excludes 2 one-shot init services):
  - `document-repository` — TCP check on port 3001
  - `clamav` — TCP check on clamd socket or port, start_period: 300s (initial DB download)
  - `dataprep-arango-service` — TCP check on port 5000 (no documented HTTP health endpoint)
  - `retriever-arango-service` — TCP check on port 7025 (no documented HTTP health endpoint)
  - `chatqna-xeon-backend-server` — TCP check on port 8888 (port 8088 was wrong; actual port is 8888 per BACKEND_SERVICE_PORT)
  - `chatqna-xeon-nginx-server` — TCP check on port 80
  - `textgen` — TCP check on port 9000
  - `translation` — TCP check on port 9030
  - `guardrail` — TCP check on port 9090 (port 8080 was wrong; actual port is 9090 per GUARDRAIL_SERVICE_PORT)
  - `embedding` — TCP check on port 6000
  - `reranker` — TCP check on port 8000
- **2 one-shot services** (`kong-migrations`) — no healthcheck needed; `restart_policy.condition: none`. Note: `kong-config` is removed from compose (see above).
- GPU services use both `runtime: nvidia` AND `deploy.resources.reservations.devices` — redundant in Swarm; `runtime: nvidia` must be removed (Swarm uses deploy only)
- All bind mounts (logs, uploads, data, HF cache) must exist on the target node before deployment
- NGINX template and Kong config use Docker service names only — **no hardcoded hostnames/IPs**, fully multi-node ready
- `env` template at project root with 10 documented sections
- GPU-specific overrides via `env.t4` / `env.rtx6000`
- Redis healthcheck in base compose does not pass `TRANSLATION_CACHE_PASSWORD` — existing bug, not Swarm-specific, noted but not in scope

### Files to Reference

| File | Purpose |
| ---- | ------- |
| `docker-compose.yaml` | Base for swarm adaptation (26 services, all configs) |
| `env` | Root environment template (add swarm comments) |
| `api-gateway-solution/nginx/conf/default.conf.template` | NGINX config — already parameterized, no changes needed. Verify secrets paths reference `/run/secrets/` for Swarm. |
| `api-gateway-solution/new-config/kong_config.json` | Kong config — uses Docker service names, no changes needed |
| `api-gateway-solution/new-config/restore-kong-config.sh` | Kong config restore script — becomes the post-deploy kong-config replacement |
| `components/docker-compose.yaml` | GENIE.AI services subset (dev reference) |

### Technical Decisions

- Dedicated `docker-compose.swarm.yaml` instead of modifying existing compose — zero risk to current deployments
- No `version:` field — Docker Compose v2 ignores it, and omitting avoids deprecation warnings
- Node labels for placement:
  - `node.role == manager` — API Gateway stack (Kong, NGINX, PostgreSQL)
  - `node.labels.gpu == true` — OPEA stack (vLLM, TEI, Retriever, Dataprep, ChatQnA, etc.)
  - No label constraint = GENIE.AI stack (Frontend, Backend, ArangoDB, Redis, Doc Repo, ClamAV)
- Single-node Swarm: requires `docker node update --label-add gpu=true <node>` even on a single node — OPEA services have placement constraint for `gpu==true`
- No shared volumes — each node is dedicated to a stack, if the node goes down the stack goes down
- `.env` file approach kept (Docker Secrets deferred to future iteration)
- `depends_on` removal strategy: remove all, add missing healthchecks, rely on Swarm restart policy (`on-failure`) for startup race conditions
- `kong-config`: removed from compose, converted to post-deploy script (`restore-kong-config.sh` executed via `docker exec` on kong container after kong is healthy)
- One-shot init service (`kong-migrations`): `mode: replicated, replicas: 1, restart_policy.condition: none`
- Port exposure strategy: in Swarm, only nginx:80/443 exposed on host (gateway node). backend:3000 and vllm:8000 become internal-only (routed through Kong). Debug internal services via `docker exec` or `docker service logs`.
- Healthcheck strategy: use TCP checks (`nc -z localhost <port>`) for services without verified HTTP health endpoints. More reliable than guessing endpoints.
- Restart policy differentiation:
  - GPU-dependent services: `max_attempts: 30, delay: 10s` (5 minutes tolerance for vLLM model loading)
  - Non-GPU services: `max_attempts: 10, delay: 5s` (50 seconds tolerance)
  - One-shot services: `condition: none`
- `shm_size: '1g'` on all OPEA services that had `ipc: "host"` — provides shared memory for PyTorch/ONNX without requiring host IPC namespace
- Image distribution: local Docker registry on the manager node (`registry:2` on port 5000) for on-prem deployments. Pre-build all images and push to local registry before `docker stack deploy`.
- GPU contention: 5 services request `count: 1` GPU on the GPU node. This is the same behavior as standalone Docker. VRAM requirements are managed by `env.t4` / `env.rtx6000` GPU config files (batch size, model length limits). Recommend 24GB+ VRAM (RTX 6000 ADA or equivalent).

### Multi-Node Variable Matrix

Variables that differ between docker and swarm deployment:
| Variable | Docker (single-node) | Docker Swarm (multi-node) |
|----------|---------------------|--------------------------|
| `NGINX_PUBLIC_DOMAIN` | `localhost` | `<gateway-node-fqdn>` |
| `VUE_APP_API_URL` | `/api` or `http://localhost:3000/api` | `https://<gateway-node-fqdn>/api` |
| `CSP_CONNECT_SRC` | `http://localhost:3000,http://localhost:8090` | `https://<gateway-node-fqdn>` |
| `CORS_ALLOWED_ORIGINS` | `http://localhost:3000,...` | `https://<gateway-node-fqdn>` |

Variables that must be identical across all nodes:
- All secrets: `ARANGO_PASSWORD`, `JWT_SECRET`, `SESSION_SECRET`, `TRANSLATION_CACHE_PASSWORD`, `POSTGRES_PASSWORD`
- AI model IDs: `EMBEDDING_MODEL_ID`, `RERANKER_MODEL_ID`, `VLLM_LLM_MODEL_ID`

Note: In Swarm, `.env` variables are resolved once at deploy time on the manager. Changing a variable requires redeploying the entire stack.

## Implementation Plan

### Tasks

- [ ] **Task 0: Set up local Docker registry and pre-build workflow**
  - Files: `docs/docker-swarm-setup.md` (documented), `docker-compose.swarm.yaml` (image references)
  - Action: Document and implement the image build + push workflow:
    1. Start local registry on manager: `docker run -d -p 5000:5000 --name registry --restart=unless-stopped registry:2`
    2. Build all images: `docker compose build`
    3. Tag and push to local registry: `docker compose push` (after updating image tags to `localhost:5000/<image>`)
    4. In `docker-compose.swarm.yaml`, change all `build:` directives to `image: localhost:5000/<image-name>:latest`
  - Notes: `docker stack deploy` does NOT support `build:`. All 9 services with `build:` must reference pre-built images. For production, replace local registry with a proper registry (Harbor, ECR, etc.).

- [ ] **Task 1: Create docker-compose.swarm.yaml base structure**
  - File: `docker-compose.swarm.yaml` (NEW)
  - Action: Copy `docker-compose.yaml` as starting point. Update top-level `name` to `genieai_swarm`. Change `genieai_network` driver from `bridge` to `overlay` with `attachable: true`. Do NOT add `version:` field (obsolete in Compose v2).
  - Notes: `attachable: true` on the overlay network enables `docker run --network` for debugging. This is the foundation — all subsequent tasks modify this file.

- [ ] **Task 2: Remove Swarm-incompatible directives**
  - File: `docker-compose.swarm.yaml`
  - Action: Remove from all services:
    - All 20 `depends_on` blocks (Swarm ignores them)
    - All `container_name` directives (~20 services, Swarm generates its own names)
    - All `ipc: "host"` directives (12 services — replaced by `shm_size` in Task 5)
    - `runtime: nvidia` from `tei` and `tei_reranker` (Swarm uses deploy.resources only)
    - `version:` field if present at top level
    - Remove `kong-config` service entirely (converted to post-deploy script in Task 3)
  - Notes: This is a cleanup pass — removes everything that is incompatible or unnecessary in Swarm.

- [ ] **Task 3: Convert kong-config to post-deploy script**
  - File: `docker-compose.swarm.yaml`, `docs/docker-swarm-setup.md`
  - Action:
    1. Remove `kong-config` service from the compose (it uses `network_mode: "service:kong"` which is incompatible with overlay networks)
    2. In the Swarm setup guide, add a post-deploy step: wait for kong to be healthy, then execute the Kong config restore via `docker exec`:
       ```bash
       # Wait for Kong to be healthy
       until docker service ls | grep "kong.*1/1"; do sleep 5; done
       # Get Kong container ID and restore config
       KONG_CONTAINER=$(docker ps --filter "name=genieai_swarm_kong" -q | head -1)
       docker exec $KONG_CONTAINER /bin/sh -c 'curl -s -X POST http://localhost:8001/config/reload -d "$(cat /etc/kong/kong_config.json)"'
       ```
    3. Verify that `restore-kong-config.sh` logic can be executed this way, or adapt the script
  - Notes: `network_mode: "service:X"` requires co-scheduling which Swarm does not guarantee. Converting to a post-deploy script is the most reliable approach.

- [ ] **Task 4: Add deploy.placement.constraints to all services**
  - File: `docker-compose.swarm.yaml`
  - Action: Add `deploy` section to each service with placement constraints:
    - **API Gateway stack** (`node.role == manager`): `postgres`, `kong-migrations`, `kong`, `nginx`
    - **OPEA/GPU stack** (`node.labels.gpu == true`): `vllm`, `vllm-translation-guardrail`, `tei`, `tei_reranker`, `embedding`, `reranker`, `textgen`, `translation`, `guardrail`, `dataprep-arango-service`, `retriever-arango-service`, `chatqna-xeon-backend-server`, `chatqna-xeon-ui-server`, `chatqna-xeon-nginx-server`
    - **GENIE.AI stack** (no constraint): `frontend`, `backend`, `arango-vector-db`, `redis-cache`, `document-repository`, `clamav`
  - Notes: Services with existing `deploy` sections (GPU services) — extend them. Services without — add new `deploy` section. Single-node Swarm requires `docker node update --label-add gpu=true <node>` for OPEA services to be scheduled.

- [ ] **Task 5: Normalize restart_policy and add shm_size**
  - File: `docker-compose.swarm.yaml`
  - Action:
    1. Add or update `restart_policy` in `deploy` section for every service:
       - One-shot service (`kong-migrations`): `restart_policy.condition: none`
       - GPU-dependent services (vllm, tei, tei_reranker, embedding, reranker, textgen, translation, guardrail, dataprep, retriever, chatqna-backend, chatqna-ui, chatqna-nginx, vllm-translation-guardrail): `condition: on-failure, delay: 10s, max_attempts: 30` (5 min tolerance for GPU model loading)
       - All other services: `condition: on-failure, delay: 5s, max_attempts: 10` (50s tolerance)
    2. Remove top-level `restart:` directives — in Swarm, only `deploy.restart_policy` is used
    3. Add `shm_size: '1g'` to `deploy.resources.limits` for all 12 services that had `ipc: "host"` (replaces shared memory without requiring host IPC namespace)
  - Notes: Convert `unless-stopped` → `condition: any`, `"no"` → `condition: on-failure` with appropriate max_attempts.

- [ ] **Task 6: Add healthchecks to 12 services**
  - File: `docker-compose.swarm.yaml`
  - Action: Add `healthcheck` to each service lacking one. Use TCP checks for services without verified HTTP health endpoints:
    - `document-repository`: `curl -f http://localhost:3001/health` (10s/5s/10/30s start) — verified endpoint exists
    - `clamav`: `timeout 5 bash -c 'echo > /dev/tcp/localhost/3310'` (30s/10s/5/**300s start**) — first run downloads DB (~3 min)
    - `dataprep-arango-service`: `timeout 5 bash -c 'echo > /dev/tcp/localhost/5000'` (15s/10s/10/120s start) — no documented HTTP health endpoint
    - `retriever-arango-service`: `timeout 5 bash -c 'echo > /dev/tcp/localhost/7025'` (15s/10s/10/120s start) — no documented HTTP health endpoint
    - `chatqna-xeon-backend-server`: `timeout 5 bash -c 'echo > /dev/tcp/localhost/8888'` (15s/10s/10/120s start) — port 8888 (not 8088)
    - `chatqna-xeon-nginx-server`: `timeout 5 bash -c 'echo > /dev/tcp/localhost/80'` (10s/5s/5/30s start)
    - `textgen`: `timeout 5 bash -c 'echo > /dev/tcp/localhost/9000'` (15s/10s/10/120s start)
    - `translation`: `timeout 5 bash -c 'echo > /dev/tcp/localhost/9030'` (15s/10s/10/120s start)
    - `guardrail`: `timeout 5 bash -c 'echo > /dev/tcp/localhost/9090'` (15s/10s/10/120s start) — port 9090 (not 8080)
    - `embedding`: `timeout 5 bash -c 'echo > /dev/tcp/localhost/6000'` (15s/10s/10/120s start)
    - `reranker`: `timeout 5 bash -c 'echo > /dev/tcp/localhost/8000'` (15s/10s/10/120s start)
  - Notes: Verify `bash` is available in each container image. If not, use `nc -z localhost <port>` as alternative. For services with known HTTP endpoints, prefer HTTP checks (document-repository). All OPEA services get extended `start_period` (120s) to account for slow GPU-dependent startup.

- [ ] **Task 7: Restrict host port exposure to nginx only**
  - File: `docker-compose.swarm.yaml`
  - Action: Remove host port mappings for `backend` (3000) and `vllm` (8000). Keep only `nginx` (80, 443). Comment out ports that are internal-only with a note: `# Swarm: internal only — access via Kong or docker exec`.
  - Notes: In Swarm, publishing ports with `mode: ingress` makes them available on every node. We want nginx only on the gateway node, so use `mode: host` combined with placement constraint. For debugging internal services: use `docker exec -it <container> bash` or `docker service logs <service>`.

- [ ] **Task 8: Handle bind mounts for Swarm**
  - File: `docker-compose.swarm.yaml`, `docs/docker-swarm-setup.md`
  - Action:
    1. Add a comment header in the compose listing which directories must exist on each target node
    2. In the Swarm setup guide, add a directory creation script per node:
       - Gateway node: `mkdir -p data/logs/kong secrets/ssl`
       - GENIE.AI node: `mkdir -p data/logs/backend data/logs/doc-repo data/database_backups`
       - OPEA/GPU node: `mkdir -p data/huggingface`
    3. Note that relative bind mount paths (`./`) resolve relative to where `docker stack deploy` is run, on the manager node. For multi-node, ensure the same directory structure exists at the same relative path on each node.
  - Notes: Bind mounts in Swarm must exist on the node where the service is scheduled. The setup guide must include directory preparation as a prerequisite step.

- [ ] **Task 9: Update env template with Swarm documentation**
  - File: `env`
  - Action: Add a new section at the end of the file (Section 12: Docker Swarm Multi-Node) with:
    - Comment explaining which variables change in Swarm mode
    - Example values for multi-node deployment
    - Note that `.env` variables are resolved once at deploy time — changes require redeployment
    - Reference to the Swarm setup guide
  - Notes: Keep all existing sections unchanged. Only add comments — no variable changes.

- [ ] **Task 10: Create Swarm setup guide documentation**
  - File: `docs/docker-swarm-setup.md` (NEW)
  - Action: Write a deployment guide covering:
    1. Prerequisites (Docker Engine 23+, NVIDIA Container Toolkit on GPU nodes, same Docker version on all nodes)
    2. Swarm initialization (`docker swarm init --advertise-addr <manager-ip>`, `docker swarm join --token <token> <manager-ip>:2377`)
    3. Local registry setup on manager (`docker run -d -p 5000:5000 registry:2`)
    4. Node labeling (`docker node update --label-add gpu=true <gpu-node>`)
    5. Directory preparation per node (script from Task 8)
    6. Image build + push (`docker compose build && docker compose push`)
    7. Environment configuration (`.env` with multi-node values, note about one-time resolution)
    8. File prerequisites on manager node: `secrets/ssl/server.crt`, `secrets/ssl/server.key`, `configs/prompts/*.txt` (Swarm distributes these as secrets to nodes that need them)
    9. Deployment (`docker stack deploy --env-file .env -c docker-compose.swarm.yaml genieai`)
    10. Post-deploy Kong config restore (from Task 3)
    11. GPU overrides (`--env-file env.t4`)
    12. Verification (`docker service ls`, `docker stack ps genieai`, smoke tests)
    13. Debugging internal services (`docker exec`, `docker service logs`, `docker run --network` with `attachable: true`)
    14. Teardown (`docker stack rm genieai`)
    15. Single-node Swarm mode (init swarm, add gpu label to single node, deploy)
    16. Rollback from failed deployment (`docker stack rm` + named volumes persist; document which volumes to preserve)
  - Notes: Write in English per project language policy. Include DNS resolution timing note (Swarm overlay DNS entries may not be immediately resolvable at startup).

- [ ] **Task 11: Update CLAUDE.md**
  - File: `CLAUDE.md`
  - Action: Add Docker Swarm deployment section in "Common Commands" and "Docker Compose Structure":
    - Swarm deploy command
    - Reference to `docker-compose.swarm.yaml`
    - Reference to `docs/docker-swarm-setup.md`
    - Note about Swarm-specific env variables
  - Notes: Keep existing docker compose sections unchanged. Add Swarm as an additional option.

### Acceptance Criteria

- [ ] **AC 1**: Given a fresh Swarm cluster with 3 nodes (1 manager + 2 workers), when images are pre-built and pushed to the registry and `docker stack deploy` is run with `docker-compose.swarm.yaml`, then all services are deployed and reach a healthy state within 15 minutes, assuming models are pre-cached on the GPU node.
- [ ] **AC 2**: Given a 3-node Swarm with correct labels, when services are deployed, then API Gateway services run only on the manager node, OPEA/GPU services run only on the node labeled `gpu=true`, and GENIE.AI services run on the remaining worker.
- [ ] **AC 3**: Given a single-node Swarm with the `gpu=true` label applied, when services are deployed, then all services run on the single node without errors.
- [ ] **AC 4**: Given `docker-compose.swarm.yaml`, when inspected, then it contains zero `depends_on` declarations, zero `runtime: nvidia` directives, zero `container_name` directives, zero `ipc: "host"` directives, zero `version:` field, and zero `build:` directives.
- [ ] **AC 5**: Given `docker-compose.swarm.yaml`, when inspected, then all services have a `deploy` section with `restart_policy` and (where applicable) `placement.constraints`. All services that had `ipc: "host"` have `shm_size` in `deploy.resources.limits`.
- [ ] **AC 6**: Given `docker-compose.swarm.yaml`, when inspected, then all long-running services have a `healthcheck` defined (excluding one-shot init services).
- [ ] **AC 7**: Given `docker-compose.swarm.yaml`, when inspected, then only nginx ports (80, 443) are published to the host.
- [ ] **AC 8**: Given the `env` template, when read, then it contains a documented section explaining which variables differ for Docker Swarm multi-node deployment.
- [ ] **AC 9**: Given the Swarm setup guide, when followed step-by-step, then a new user can deploy the full stack on a 3-node Swarm cluster without external assistance.
- [ ] **AC 10**: Given `docker-compose.swarm.yaml`, when validated with `docker compose config`, then no errors or warnings are produced.

## Additional Context

### Dependencies

- Docker Engine 23+ on all nodes (Compose v2 support)
- NVIDIA Container Toolkit on GPU nodes
- Docker Swarm initialized on at least one manager node
- All nodes part of the same Swarm cluster
- Node labels applied before deploying the stack (`gpu=true` on GPU node)
- Local Docker registry running on manager (or external registry configured)
- Bind mount directories created on each target node before deployment
- `.env` file present on the manager node (Swarm distributes env vars to services at deploy time)
- SSL certificates (`secrets/ssl/`) and prompt files (`configs/prompts/`) present on the manager node (Swarm distributes these as secrets to nodes that need them)
- Hugging Face cache pre-populated on GPU node for faster model loading
- All images pre-built and pushed to registry

### Testing Strategy

**Manual testing (no automated test framework for infrastructure):**
1. Compose validation: `docker compose -f docker-compose.swarm.yaml config` — no errors
2. Single-node Swarm test: deploy all services on one node with `gpu=true` label, verify health
3. 3-node Swarm test: deploy with labels, verify placement with `docker service ps <service>`
4. Port exposure test: verify only nginx ports are accessible from outside
5. Restart resilience test: stop ArangoDB, verify backend restarts when ArangoDB comes back
6. GPU service restart test: stop vLLM, verify dependent services (embedding, reranker, etc.) restart when vLLM recovers
7. Environment variable test: deploy with multi-node env values, verify cross-node communication
8. Kong config test: verify Kong routes are restored via post-deploy script

**Smoke tests after deployment:**
- `curl https://<gateway>/api/health` — backend reachable through Kong
- `curl https://<gateway>/` — frontend loads
- Chat query through UI — full RAG pipeline works across nodes

### Known Limitations

- **No application-level retry**: backend and OPEA services crash if dependencies are unavailable at startup. Swarm restart policy handles this but first deployment takes longer due to restart cycles.
- **GPU contention**: 5 services request 1 GPU each on the GPU node. VRAM is shared; batch size and model length limits in `env.t4`/`env.rtx6000` manage this. 24GB+ VRAM recommended.
- **No shared volumes**: if a node goes down, its stack goes down. No data migration between nodes.
- **DNS timing**: Swarm overlay DNS entries may not resolve immediately on first container start. Services with healthchecks handle this via restart cycles.
- **Redis healthcheck**: existing bug where `redis-cli ping` does not pass `TRANSLATION_CACHE_PASSWORD`. Not Swarm-specific, not in scope.
- **kong-config as post-deploy script**: Kong routes are not available until the post-deploy script runs. Services calling Kong during this window will get 404s. This is a brief gap (~10-30 seconds after Kong starts).

### Notes

- The 3-node architecture: (1) API Gateway node — Kong + NGINX + PostgreSQL, (2) OPEA/GPU node — vLLM, TEI embedding, TEI reranking, Retriever, Dataprep, ChatQnA, (3) GENIE.AI node — Frontend, Backend, ArangoDB, Redis, Document Repository, ClamAV
- Single-node deployment: requires `docker node update --label-add gpu=true <node>` even on a single node
- `chatqna-xeon-ui-server` and `chatqna-xeon-nginx-server` — set `replicas: 0` by default. Open question whether to keep in production.
- First deployment may take 5-15 minutes for all services to stabilize (GPU model loading + restart cycles)
- The `components/docker-compose.yaml` references `chatqna_default` as external network while root compose creates `genieai_network` — this discrepancy exists in the current codebase and is not in scope for this spec.
- Swarm secret paths: nginx secrets are mounted at `/run/secrets/<name>` in Swarm. Verify nginx config references these paths.
