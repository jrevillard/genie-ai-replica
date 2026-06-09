---
title: 'Remote GPU Node — Dedicated Docker Compose + Ansible Playbook + nginx Proxy'
type: 'feature'
created: '2026-05-29'
baseline_commit: 'f44d6a58b'
status: 'complete'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** GPU model services (vLLM x2, TEI x2) run on the same node as the GENIE.AI app stack, preventing multiple GENIE.AI instances from sharing a single GPU node. There is also no remote docling-serve endpoint for document extraction.

**Approach:** Create a standalone GPU node stack with its own Docker Compose, nginx reverse proxy (TLS + API key auth), Ansible playbook, and a `DOCLING_ENDPOINT` env var in dataprep so the app node can call docling-serve remotely.

## Boundaries & Constraints

**Always:**
- Reuse exact same images/tags as the app node compose (Decision 2 in architecture doc)
- Path-based routing on single HTTPS port 443: `/llm/`, `/translation/`, `/embed/`, `/rerank/`, `/docling/`
- nginx `map` directive reads API keys from external file; one key per GENIE.AI client shared across all 5 services
- `nginx -s reload` for zero-downtime key rotation (no GPU service restart)
- certbot one-shot for Let's Encrypt TLS (same pattern as app node)
- Single-node deployment unchanged when GPU compose is not deployed — all existing env var defaults preserved

**Ask First:**
- Any additional nginx location blocks or headers beyond the proxy pass + API key auth pattern
- GPU memory utilization values for the remote node (may differ from app node)
- docling-serve image tag if `latest` is not desired

**Never:**
- No fallback to in-process docling when `DOCLING_ENDPOINT` is set — it must be configured or empty
- No double proxy (app node services connect directly to GPU node nginx, not through app node Kong/nginx)
- No modifications to the existing `docker-compose.yaml` app node services
- No custom microservice for docling — use official `ghcr.io/institute-of-data-science/docling-serve`
- No modification of existing env var defaults

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| HTTPS request with valid API key | `Authorization: Bearer <valid>` header to `:443` | Proxied to backend, response returned | nginx returns backend error if service down |
| HTTPS request with invalid API key | No header or invalid key to `:443` | nginx returns 401 | Always 401, backend never reached |
| HTTPS request with expired TLS cert | Valid API key, expired cert | TLS handshake fails | certbot must be re-run before expiry |
| `DOCLING_ENDPOINT` empty in dataprep | Env var not set | Docling uses in-process converter (existing behavior) | No change from current code |
| `DOCLING_ENDPOINT` set in dataprep | `https://gpu-host/docling` | Dataprep calls remote docling-serve via HTTP POST (120s total timeout) | Connection error or timeout propagated to caller with clear message |
| `DOCLING_ENDPOINT` unreachable | Valid URL but host down or wrong port | HTTP call fails within 120s timeout | Raise error immediately — no silent failure, no retry |
| Ansible deploy with invalid vault | Wrong vault password | Ansible exits with error | No partial deployment |
| `nginx -s reload` during active request | Active connections | Existing connections complete, new use new config | Graceful shutdown of old workers |

</frozen-after-approval>

## Code Map

- `docker-compose.yaml` (root) — reference for existing GPU service definitions (vllm, vllm-translation-guardrail, tei-embedding, tei-reranker): images, ports, healthchecks, placement constraints
- `docker-compose.gpu.yaml` (root, NEW) — standalone GPU node compose: 5 AI services + nginx + certbot
- `deploy/ansible/deploy.yml` — reference for Ansible structure (tags, plays, verification pattern)
- `deploy/ansible/deploy-gpu.yml` (NEW) — GPU node playbook: inventory, templates, deploy, smoke tests
- `deploy/ansible/templates/env.j2` — reference for Jinja2 template pattern
- `deploy/ansible/templates/gpu-proxy.conf.j2` (NEW) — nginx reverse proxy config with TLS + API key auth
- `deploy/ansible/templates/api_keys.map.j2` (NEW) — API keys map template generated from vault
- `deploy/ansible/templates/docker-compose.gpu.yaml.j2` (NEW) — compose template with Ansible vars
- `deploy/ansible/group_vars/test.yml` — reference for variable structure pattern
- `deploy/ansible/group_vars/gpu.yml` (NEW) — GPU node variables (non-secret)
- `deploy/ansible/group_vars/gpu.vault.example` (NEW) — vault template with `gpu_api_keys`
- `deploy/ansible/inventory/gpu.ini.example` (NEW) — inventory template for `[gpu_nodes]`
- `genie-ai-overlay/dataprep/genieai_dataprep_utils.py` — add `DOCLING_ENDPOINT` support alongside existing in-process docling (`load_with_docling` function)
- `env` (root) — add Section 14 "Remote GPU Node" with `DOCLING_ENDPOINT` and GPU host URL vars

## Tasks & Acceptance

**Execution:**
- [x] `docker-compose.gpu.yaml` -- Create GPU node compose with 5 services (vLLM x2, TEI x2, docling-serve) + nginx + certbot
- [x] `deploy/ansible/templates/gpu-proxy.conf.j2` -- Create nginx template: TLS termination, path-based routing on port 443 (`/llm/`, `/translation/`, `/embed/`, `/rerank/`, `/docling/`), `map` directive for `Authorization: Bearer` auth from external file
- [x] `deploy/ansible/templates/api_keys.map.j2` -- Create API keys template iterating over `gpu_api_keys` vault variable
- [x] `deploy/ansible/templates/docker-compose.gpu.yaml.j2` -- Create compose template parametrizing host-specific values (domain, GPU vars, API keys)
- [x] `deploy/ansible/deploy-gpu.yml` -- Create playbook: GPU node labeling, project sync, template rendering, compose deploy, certbot, nginx reload, smoke tests (health on all 5 ports + 401 rejection)
- [x] `deploy/ansible/group_vars/gpu.yml` -- Create GPU node variables (domain, ports, GPU env file, model IDs)
- [x] `deploy/ansible/group_vars/gpu.vault.example` -- Create vault template with `gpu_api_keys` structure
- [x] `deploy/ansible/inventory/gpu.ini.example` -- Create inventory template with `[gpu_nodes]` group
- [x] `genie-ai-overlay/dataprep/genieai_dataprep_utils.py` -- Add `DOCLING_ENDPOINT` env var: when set, call remote docling-serve via HTTP POST instead of in-process `docling_converter.convert()`
- [x] `env` -- Add Section 14 "Remote GPU Node" with `DOCLING_ENDPOINT`, `DOCLING_ENDPOINT_TIMEOUT` (default 120), and GPU host URL vars

**Acceptance Criteria:**
- Given a GPU node with Docker installed, when `ansible-playbook -i gpu.ini deploy-gpu.yml --vault-id gpu@prompt` runs, then all 5 services are healthy and accessible via HTTPS on port 443 (path-based routing)
- Given a request to GPU node port 443 with valid `Authorization: Bearer` header, when the request reaches nginx, then it is proxied to the backend and the response is returned
- Given a request to GPU node port 443 without `Authorization` header, when the request reaches nginx, then nginx returns 401
- Given `DOCLING_ENDPOINT` is set to a valid GPU node URL, when dataprep processes a document, then it calls the remote docling-serve endpoint instead of the in-process converter
- Given `DOCLING_ENDPOINT` is empty, when dataprep processes a document, then it uses the existing in-process docling converter (unchanged behavior)
- Given `docker compose -f docker-compose.gpu.yaml config`, when run, then it validates without errors
- Given `DOCLING_ENDPOINT` set to an unreachable host, when dataprep processes a document, then it raises a clear error within 120s (no silent failure)

## Spec Change Log

### Review round 1 (2026-05-29)
**Findings:** 3 reviewers (blind hunter, edge case hunter, acceptance auditor). All ACs passed.
**Patches applied:**
1. nginx `proxy_set_header` moved from http-level to inside each `location /` block (was invalid scope)
2. Python file handle leak fixed — read bytes before entering async context
3. nginx HTTP redirect removed erroneous `:$server_port`
4. Ansible compose validation added `failed_when`
5. `aiohttp` added to dataprep Dockerfile dependencies
6. SSL cert paths changed from Let's Encrypt to self-signed (`/etc/nginx/ssl/server.crt`)
7. certbot-gpu given proper entrypoint script and `gpu_ssl:/secrets/ssl` volume mount
8. `proxy_http_version 1.1` added to all location blocks

**Defer:** client_body_timeout for docling, better error context in remote docling failures

## Design Notes

**nginx API key auth pattern:**
```nginx
map $http_x_api_key $api_key_valid {
    default 0;
    "secret-key-1" 1;
}
server {
    listen 443 ssl;
    # ...
    map $http_authorization $api_key_valid { ... }
    if ($api_key_valid = 0) { return 401; }
    location /llm/ { proxy_pass http://vllm-llm:8000/; }
}
```

**DOCLING_ENDPOINT integration (genieai_dataprep_utils.py):**
When `DOCLING_ENDPOINT` env var is set, replace the in-process `docling_converter.convert(doc_path)` call with an HTTP POST to the remote endpoint. The existing in-process path remains the default when the var is empty — no fallback logic, just an if/else on the env var. Use `aiohttp.ClientTimeout(total=int(os.getenv("DOCLING_ENDPOINT_TIMEOUT", 120)))` — configurable via env var, default 120s for document processing. On connection error or timeout, raise immediately — no silent failure, no retry.

**nginx log security:**
nginx access log must NOT include the `Authorization` header value. Use `log_format` that omits `$http_authorization` or masks it. Default nginx combined format is safe (does not include custom headers).

**Docker Compose GPU uses `env.t4`/`env.rtx6000`** for GPU memory config — same files as app node, loaded via `--env-file` override.

## Verification

**Commands:**
- `docker compose -f docker-compose.gpu.yaml config` -- expected: valid compose output, no errors
- `ansible-playbook -i inventory/gpu.ini deploy-gpu.yml --vault-id gpu@prompt --syntax-check` -- expected: playbook syntax valid
- `python3 -c "from genieai_dataprep_utils import *"` from `genie-ai-overlay/` -- expected: import succeeds (no syntax errors)

**Manual checks:**
- `nginx -t` on GPU node must validate config before reload
- Smoke tests in Ansible must pass: health on all 5 ports + 401 rejection without key
