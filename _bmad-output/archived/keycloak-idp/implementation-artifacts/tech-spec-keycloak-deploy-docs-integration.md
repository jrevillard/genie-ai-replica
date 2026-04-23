---
title: 'Integrate Keycloak into deployment tooling and documentation'
slug: 'keycloak-deploy-docs-integration'
created: '2026-04-12'
status: 'implementation-complete'
stepsCompleted: [1, 2, 3, 4]
tech_stack: ['Ansible 2.15+', 'Jinja2', 'Docker Compose', 'Docker Swarm', 'Keycloak 26.5.6', 'Playwright']
files_to_modify:
  - 'docker-compose.yaml'
  - 'deploy/ansible/deploy.yml'
  - 'deploy/ansible/README.md'
  - 'deploy/ansible/templates/env.j2'
  - 'deploy/ansible/group_vars/itu_rtx_test/vault.yml'
  - 'docs/e2e-tests/00-clean-start.md'
  - 'docs/e2e-tests/README.md'
  - 'docs/docker-compose-setup.md'
code_patterns:
  - 'Flat Ansible playbook (no roles) — all tasks in deploy.yml'
  - 'Vault AES256 for secrets, group_vars per environment'
  - 'Jinja2 env.j2 template with numbered sections'
  - 'Tag-based deployment: install, prepare, build, deploy'
  - 'Git SHA-based image labels for build optimization'
  - 'Docker Compose dual-mode: depends_on (compose) + deploy (Swarm)'
test_patterns:
  - 'E2E: Playwright, setup/teardown in 00-clean-start.md'
  - 'No CI pipeline exists'
---

# Tech-Spec: Integrate Keycloak into deployment tooling and documentation

**Created:** 2026-04-12

## Overview

### Problem Statement

The Keycloak IdP integration (Epics 1-3) has been rebased onto deployment-stabilization, which introduced dual-mode docker compose/swarm support, certbot, and Ansible restructuring. However, Keycloak is not yet integrated into:
- **Docker Compose** — Keycloak services lack `build:` directives, preventing `docker compose up` from building them locally (only `image:` with registry URL)
- **Ansible deployment** — no variables, vault entries, vault validation, or playbook updates for Keycloak services
- **E2E test setup** — still references Docker Swarm, should use `docker compose` for local simplicity
- **Documentation** — `docker-compose-setup.md` lacks Keycloak entirely; `docker-swarm-setup.md` already has full Keycloak coverage

### Solution

Add `build:` directives to Keycloak services in docker-compose.yaml so `docker compose up` works without a local registry. Migrate E2E test infrastructure from Docker Swarm to `docker compose up`. Integrate Keycloak configuration into Ansible (variables, vault, templates, playbook, validation, health checks). Add Keycloak section to `docker-compose-setup.md`.

### Scope

**In Scope:**
- Docker Compose: add `build:` directives to postgres-init, keycloak, keycloak-config services
- E2E tests: migrate setup from Docker Swarm to `docker compose` for local testing
- Ansible: add Keycloak variables to group_vars + vault, update vault validation, health check exclusion, playbook builds, and README
- Documentation: add Keycloak to `docker-compose-setup.md` (Step 3 env vars + new section), verify `docker-swarm-setup.md` post-rebase

**Out of Scope:**
- Application code changes (backend, frontend)
- New Keycloak features
- Certbot / Let's Encrypt for Keycloak (behind NGINX)
- Ansible support for `docker compose` mode (Swarm only)
- CI pipeline changes (no CI exists)

## Context for Development

### Codebase Patterns

- **Flat Ansible playbook**: No roles directory — all tasks in `deploy.yml`. Tags: `install`, `prepare`, `build`, `deploy`.
- **Vault-based secrets**: AES256 encrypted vault per environment (`group_vars/<env>/vault.yml`). Non-secrets in `vars.yml`.
- **Jinja2 env template**: `templates/env.j2` with 16 sections (its own independent numbering, not matching `env` file). Uses `{% if %}` conditionals. Generates `.env` on target host.
- **Build system**: 10 current image builds in deploy.yml. Git SHA-based labels. Push to local registry (`localhost:5000`).
- **Dual-mode compose**: `docker-compose.yaml` supports `docker compose up` (uses `build:` directives) and `docker stack deploy` (uses `image:` from registry). Most services have both `build:` and `image:` — Keycloak services only have `image:`.
- **PostgreSQL shared instance**: `postgres` service (was `kong-database`). Superuser `genieai` + dedicated users `kong`/`keycloak` created by `postgres-init` one-shot.
- **Keycloak behind NGINX**: NGINX proxies `/auth/*` to Keycloak HTTP (port 8080). No direct TLS — NGINX handles termination.
- **Env template sections**: `env` has Section 9 (Keycloak), Section 9B (External IdPs), GPU moved to Section 10. `KONG_DB_PASSWORD` separated from `POSTGRES_PASSWORD`.
- **Ansible vault validation**: `deploy.yml` lines 607-622 assert required vault vars exist. Currently only checks 7 secrets — must be extended for Keycloak.
- **Ansible health check exclusion**: `deploy.yml` lines 766-772 exclude `kong-config` and `kong-migrations` from replica checks. One-shot Keycloak services (`postgres-init`, `keycloak-config`) must be added.

### Files to Reference

| File | Purpose | Lines |
| ---- | ------- | ----- |
| `docker-compose.yaml` | Keycloak service definitions (missing `build:`) | ~1100 |
| `deploy/ansible/deploy.yml` | Main playbook — 10 builds, 4 tags | 828 |
| `deploy/ansible/templates/env.j2` | Env template — 16 sections, no Keycloak | 221 |
| `deploy/ansible/README.md` | Ansible docs — no Keycloak section | 487 |
| `deploy/ansible/group_vars/all.yml` | Shared config (paths, versions) | 65 |
| `deploy/ansible/group_vars/itu_rtx_test/vars.yml` | Test env non-secrets | 39 |
| `deploy/ansible/group_vars/itu_rtx_test/vault.yml` | Test env secrets (vault encrypted) | 55 |
| `docs/e2e-tests/README.md` | E2E test guide — references Swarm | ~65 |
| `docs/e2e-tests/00-clean-start.md` | Clean start — uses `docker stack` + registry | ~370 |
| `docs/docker-compose-setup.md` | Compose guide — no Keycloak | ~322 |
| `docs/docker-swarm-setup.md` | Swarm guide — Keycloak complete | ~618 |
| `env` | Template with all Keycloak vars (Section 9, 9B) | ~400 |
| `config/postgres/Dockerfile` | postgres-init Dockerfile | — |
| `config/keycloak/Dockerfile` | Keycloak Dockerfile | — |
| `config/keycloak/Dockerfile.config-cli` | Keycloak config-cli Dockerfile | — |

### Technical Decisions

- E2E tests use `docker compose` only (no Swarm, no registry) — simpler for local dev, no CI for now
- Keycloak services get `build:` directives aligned with existing services (frontend, backend, etc.) — enables `docker compose up` without registry
- Keycloak variables follow existing Ansible pattern: non-secrets in group_vars, secrets in vault
- Documentation kept as two separate files (compose vs swarm) per existing convention
- Task order: Compose build directives → Ansible → E2E tests → Documentation
- `docker-swarm-setup.md` already has full Keycloak coverage — verification only after rebase
- `docker-compose-setup.md` is the real doc gap — Keycloak absent from single-node guide
- Ansible vault needs 6 new secrets: `KONG_DB_PASSWORD`, `KEYCLOAK_CLIENT_SECRET`, `KEYCLOAK_PROXY_CLIENT_SECRET`, `KEYCLOAK_DB_PASSWORD`, `KEYCLOAK_ADMIN_PASSWORD`, `SERVICE_AUTH_TOKEN`
- 3 new Ansible builds: `postgres-init`, `keycloak`, `keycloak-config`
- env.j2 uses its own section numbering (independent from `env` file) — insert Keycloak as env.j2 Section 9, renumber existing 9→18

## Implementation Plan

### Task 1: Add build directives to Keycloak services in docker-compose.yaml

- File: `docker-compose.yaml`
- Action: Add `build:` directives to the 3 Keycloak services, aligned with existing dual-mode pattern. For each service, add the `build:` line immediately before the `image:` line:
  1. **postgres-init** (line ~1078): `build: config/postgres/`
  2. **keycloak** (line ~1101): `build: config/keycloak/`
  3. **keycloak-config** (line ~1133): `build: config/keycloak/`, `dockerfile: Dockerfile.config-cli`
- Notes: Follow the exact same pattern as existing services (e.g., backend at line 338 has `build:` then `image:`). The `image:` line with `SWARM_REGISTRY_URL` stays — it's used by Swarm mode. `build:` is used by compose mode. Do NOT modify any other service definitions.

### Task 2: Extend Ansible env.j2 template with Keycloak variables

- File: `deploy/ansible/templates/env.j2`
- Action:
  1. Add `KONG_DB_PASSWORD={{ kong_db_password }}` to Section 1 (Secrets & Database) — separate from `POSTGRES_PASSWORD`, with comment explaining dedicated Kong user
  2. Add `SERVICE_AUTH_TOKEN={{ service_auth_token }}` to Section 1 with comment about OPEA ↔ Backend auth
  3. Insert new **Section 9: KEYCLOAK IDENTITY PROVIDER (REQUIRED)** — use env.j2's own independent section numbering (not matching `env` file). Variables to include:
     - `KEYCLOAK_URL=https://{{ nginx_public_domain }}/auth`
     - `KEYCLOAK_REALM={{ keycloak_realm | default('genie') }}`
     - `KEYCLOAK_CLIENT_ID={{ keycloak_client_id | default('genie-app') }}`
     - `KEYCLOAK_CLIENT_SECRET={{ keycloak_client_secret }}`
     - `KEYCLOAK_ADDITIONAL_REALMS={{ keycloak_additional_realms | default('') }}` (commented out with `{% if keycloak_additional_realms %}`)
     - `KEYCLOAK_ADMIN_PASSWORD={{ keycloak_admin_password }}`
     - `KEYCLOAK_DB_PASSWORD={{ keycloak_db_password }}`
     - `KEYCLOAK_VALID_REDIRECT_URIS={{ keycloak_valid_redirect_uris | default('http://' + nginx_public_domain + ':' + frontend_port + '/*') }}`
     - `KEYCLOAK_WEB_ORIGINS={{ keycloak_web_origins | default('http://' + nginx_public_domain + ':' + frontend_port) }}`
     - `KEYCLOAK_PROXY_CLIENT_SECRET={{ keycloak_proxy_client_secret }}`
  4. Include optional External IdP variables (commented out) for Google, Microsoft, etc. — same pattern as `env` Section 9B
  5. Renumber env.j2's subsequent sections: current Section 9 (Translation) → 10, Section 10 → 11, etc. through to Section 16 → 18
- Notes: env.j2 has its own section numbering (16 sections) independent from the `env` file. Keycloak becomes env.j2 Section 9. `deploy.yml` does not reference env.j2 section numbers — it generates `.env` via Jinja2 template, so renumbering is safe. Keycloak is NOT conditional (always required), unlike OPEA sections.

### Task 3: Add Keycloak secrets to Ansible vault

- File: `deploy/ansible/group_vars/itu_rtx_test/vault.yml`
- Action: Add 6 new vault entries. Existing vault entries remain unchanged. New entries:
  - `kong_db_password:` — dedicated Kong PostgreSQL user password (MUST differ from `postgres_password`)
  - `keycloak_client_secret:` — OIDC client secret for genie-app
  - `keycloak_proxy_client_secret:` — service account secret for admin API proxy
  - `keycloak_db_password:` — dedicated Keycloak PostgreSQL user password
  - `keycloak_admin_password:` — Keycloak admin console password
  - `service_auth_token:` — OPEA ↔ Backend shared secret
- Notes: Generate strong random passwords (e.g., `python3 -c "import secrets; print(secrets.token_urlsafe(32))"`). `kong_db_password` must differ from `postgres_password`. Add comments in vault documenting which service uses each secret.

### Task 4: Update Ansible deploy.yml — vault validation + health checks + builds

- File: `deploy/ansible/deploy.yml`
- Action:
  1. **Vault validation** (lines 607-622): Add 5 assertions for new required vault variables: `kong_db_password`, `keycloak_admin_password`, `keycloak_db_password`, `keycloak_client_secret`, `keycloak_proxy_client_secret`. Update `fail_msg` to list the new variables. Note: `service_auth_token` is less critical for Keycloak startup — add it but with a softer fail or separate assertion.
  2. **Health check exclusion** (lines 766-772): Add `postgres-init` and `keycloak-config` to the `reject('search', ...)` filters. These are one-shot services that show `0/0` replicas after completion. Without exclusion, the deployment health check will fail.
  3. **Image builds** (build tag section, after existing non-OPEA builds): Add 3 new Docker image build tasks following existing pattern (register changed, conditional build, tag, push):
     - **postgres-init** — Dockerfile: `config/postgres/Dockerfile`, context: `config/postgres/`, image: `genie-ai-postgres-init:latest`
     - **keycloak** — Dockerfile: `config/keycloak/Dockerfile`, context: `config/keycloak/`, image: `genie-ai-keycloak:latest`
     - **keycloak-config** — Dockerfile: `config/keycloak/Dockerfile.config-cli`, context: `config/keycloak/`, image: `genie-ai-keycloak-config:latest`
- Notes: 3 changes in one file but logically distinct. Each follows existing patterns exactly. Verify `genieai_images` list (lines 487-547) if it's used for validation.

### Task 5: Update Ansible README with Keycloak documentation

- File: `deploy/ansible/README.md`
- Action:
  1. Update any image/service references to include the 3 new Keycloak images (total: 13 images)
  2. Add Keycloak variables to the Configuration Variables section — document each variable from env.j2 Section 9 with description, default, and which service uses it
  3. Update the post-deploy verification section to mention Keycloak health check and admin console URL (`https://{{ NGINX_PUBLIC_DOMAIN }}/auth/admin/`)
- Notes: Follow existing README documentation style. Reference `docs/keycloak-admin-guide.md` where relevant.

### Task 6: Migrate E2E test setup from Swarm to Compose

- File: `docs/e2e-tests/00-clean-start.md`
- Action: Replace the entire Swarm-based setup/teardown workflow with a Compose-based workflow. Complete list of replacements:
  - **Step 0.1 (line 10)**: `docker stack rm genieai` → `docker compose down -v`
  - **Step 0.1 (line 13)**: `while docker service ls...` wait loop → `docker compose ps` wait loop (or remove — compose up waits for dependencies)
  - **Step 0.2 (lines 19-29)**: Remove registry cleanup entirely — `docker compose up -d` builds images automatically via `build:` directives (added in Task 1). Remove Step 0.2 completely or replace with `docker compose down -v` if not already done.
  - **Step 0.4 (lines 70-112)**: Remove registry start, tag, push steps entirely — replaced by automatic build in `docker compose up -d`. Remove Step 0.4 completely.
  - **Step 0.5 (line 118)**: `docker stack deploy -c docker-compose.yaml genieai` → `docker compose up -d` (or `docker compose --profile opea up -d` with OPEA)
  - **Step 0.6 (line 135)**: `docker service ls` → `docker compose ps`
  - **Step 0.6 (line 140)**: `docker service ls --filter name=genieai_${svc} --format '{{.Replicas}}'` → `docker compose ps --services --filter "name=genieai_${svc}" --format "{{.Replicas}}"`
  - **Step 0.7b (line 249)**: `docker service update --force genieai_backend` → `docker compose restart backend`
  - **Prerequisites (line 347)**: "GENIE.AI Docker Swarm stack deployed" → "GENIE.AI Docker Compose stack deployed"
  - Any other Swarm-specific `docker service` references throughout the file
- Notes: The E2E test scripts themselves (Playwright) do NOT change — they connect to `localhost`. With Task 1 adding `build:` directives, `docker compose up -d` handles everything. The entire Steps 0.2 and 0.4 (registry) become unnecessary and should be removed, not replaced.

### Task 7: Update E2E test README prerequisites

- File: `docs/e2e-tests/README.md`
- Action: Replace "Docker Swarm stack deployed and healthy" prerequisite with "Docker Compose stack deployed and healthy". Update any other Swarm-specific references in the document.
- Notes: Minimal change — prerequisite line and any Swarm mentions.

### Task 8: Add Keycloak section to docker-compose-setup.md

- File: `docs/docker-compose-setup.md`
- Action:
  1. **Step 3 (Configure Environment)**: Add Keycloak and PostgreSQL required secrets to the existing secrets list: `KONG_DB_PASSWORD`, `KEYCLOAK_ADMIN_PASSWORD`, `KEYCLOAK_DB_PASSWORD`, `KEYCLOAK_CLIENT_SECRET`, `KEYCLOAK_PROXY_CLIENT_SECRET`, `SERVICE_AUTH_TOKEN`
  2. **New section between Step 6 (Deploy) and Step 7 (Kong Config)**: Add "Keycloak Identity Provider" subsection covering:
     - Required `.env` variables from Section 9 of `env` template (mandatory ones with defaults)
     - How to verify Keycloak is healthy: `docker compose ps keycloak` or access `https://localhost/auth/admin/`
     - Keycloak admin console: URL, default credentials (`admin` / `KEYCLOAK_ADMIN_PASSWORD`)
     - Note that realm configuration is applied automatically by `keycloak-config` service
     - Reference `docs/keycloak-admin-guide.md` and `docs/external-idp-integration-guide.md`
- Notes: Step 3 update is critical — without Keycloak vars in `.env`, the deploy will fail. The new Keycloak section documents post-deploy verification. Keep both concise.

### Task 9: Verify docker-swarm-setup.md Keycloak coverage post-rebase

- File: `docs/docker-swarm-setup.md`
- Action: Read and verify that Keycloak sections are intact after rebase. Check:
  - Build commands include postgres-init, keycloak, keycloak-config (lines ~200-210)
  - Tag/push commands include the 3 new images
  - Environment variables section includes Keycloak vars (lines ~305-307)
  - Post-deploy section mentions Keycloak admin console (lines ~453-485)
  - External IdP section is present (lines ~637-645)
  - Teardown references `genieai_postgres_data` volume (not `kong_data`)
- Notes: Read-only verification. Fix only if rebase broke something.

## Acceptance Criteria

- [ ] AC 1: Given `docker-compose.yaml`, when `docker compose up -d` is run, then postgres-init, keycloak, and keycloak-config images are built locally (no registry needed)
- [ ] AC 2: Given the Ansible env.j2 template, when rendered with vault variables, then the output `.env` file contains all Keycloak variables (Section 9) with correct values from vault and sensible defaults for non-secrets
- [ ] AC 3: Given the Ansible vault, when decrypted, then it contains 6 new entries: `kong_db_password`, `keycloak_client_secret`, `keycloak_proxy_client_secret`, `keycloak_db_password`, `keycloak_admin_password`, `service_auth_token`, and all existing entries remain unchanged
- [ ] AC 4: Given `ansible-playbook deploy.yml --tags deploy`, when vault is missing Keycloak secrets, then the playbook fails immediately with a clear error message listing the missing variables
- [ ] AC 5: Given `ansible-playbook deploy.yml --tags deploy`, when all vault vars are set, then the health check passes (postgres-init and keycloak-config excluded from replica checks)
- [ ] AC 6: Given `ansible-playbook deploy.yml --tags build`, when executed against a target host, then 13 images are built and pushed (10 existing + postgres-init + keycloak + keycloak-config)
- [ ] AC 7: Given `docs/e2e-tests/00-clean-start.md`, when followed by a developer, then the stack starts with `docker compose up -d` (no Swarm commands, no registry steps)
- [ ] AC 8: Given `docs/e2e-tests/README.md`, when read, then prerequisites reference Docker Compose (not Swarm)
- [ ] AC 9: Given `docs/docker-compose-setup.md`, when read, then Step 3 lists Keycloak required secrets AND a Keycloak section exists with health verification steps
- [ ] AC 10: Given `docs/docker-swarm-setup.md`, when read post-rebase, then all Keycloak sections are intact (builds, env vars, admin console, external IdP, teardown volume name)
- [ ] AC 11: Given the Ansible README, when read, then the Keycloak variables are documented with descriptions, defaults, and service mappings

## Additional Context

### Dependencies

- Rebase onto deployment-stabilization completed (commit `a1ef4c1`)
- `docker-compose.yaml` already contains all Keycloak service definitions — but missing `build:` directives (Task 1)
- `config/postgres/Dockerfile`, `config/keycloak/Dockerfile`, `config/keycloak/Dockerfile.config-cli` already exist
- `env` template already has Section 9 (Keycloak) and 9B (External IdPs) — env.j2 must include these variables

### Testing Strategy

- **Manual verification**: `docker compose up -d` starts all services including Keycloak (no registry)
- **Manual verification**: `ansible-playbook deploy.yml --tags build --check` to validate playbook syntax
- **Manual verification**: Render env.j2 locally and compare with `env` template for consistency
- **Manual verification**: Follow `00-clean-start.md` updated instructions to verify compose stack starts correctly
- **Manual verification**: Read `docker-compose-setup.md` to confirm Keycloak section is present and Step 3 includes Keycloak secrets

### Notes

- Keycloak is proxied by NGINX at `/auth/*` — no certbot integration needed
- `KONG_DB_PASSWORD` must differ from `POSTGRES_PASSWORD` — they protect different PostgreSQL users
- env.j2 section renumbering affects Let's Encrypt (old 15→16) and Multi-node (old 16→17) sections — deploy.yml does not reference section numbers
- The `env.j2` template uses `{% if deploy_opea | bool %}` conditionals for OPEA sections — Keycloak is NOT conditional (always required)
- Removing registry steps (Steps 0.2, 0.4) from `00-clean-start.md` simplifies the workflow significantly — `docker compose up -d` replaces 4 steps with 1
