# GENIE.AI - Ansible Deployment

Automated Docker Swarm deployment for GENIE.AI using Ansible with per-environment secrets.

## Prerequisites

- **Ansible 2.15+** / ansible-core 2.15+ (control machine)
- **community.docker 4.x** collection
- **SSH access** to the target node
- **Ansible Vault password** per environment
- **Git deploy key** on the target node (for `git clone`)

## Quick Start

```bash
cd deploy/ansible

# 1. Install Ansible collections
ansible-galaxy collection install -r requirements.yml

# 2. Create inventory for your environment
cp inventory/inventory.example inventory/my-env.ini
# Edit inventory/my-env.ini with your host IP and environment group

# 3. Create environment config directory
mkdir -p group_vars/my-env

# 4. Set non-secret config
cp group_vars/itu_rtx_test/vars.yml group_vars/my-env/vars.yml
# Edit: set domains, ports, email, OPEA settings, etc.

# 5. Create encrypted secrets
ansible-vault create group_vars/my-env/vault.yml
# Fill in all required secrets (see "Required Vault Secrets" below)

# 6. Place SSL certificates (or set self_signed_certs: true)
mkdir -p files/certificates/my-env
cp server.crt server.key files/certificates/my-env/

# 7. Deploy
ansible-playbook -i inventory/my-env.ini deploy.yml --vault-id my-env@prompt
```

## Multi-Environment Setup

Each environment uses a **directory** under `group_vars/` containing:

| File | Purpose |
|------|---------|
| `group_vars/<env>/vars.yml` | Non-secret config (domains, ports, email, OPEA) |
| `group_vars/<env>/vault.yml` | Encrypted secrets (Ansible Vault) |

Plus shared config from `group_vars/all.yml` (always loaded).

Other per-environment files:
- **Inventory** (`inventory/<env>.ini`)
- **SSL certificates** (`files/certificates/<env>/`)

### Environment group naming

Use **underscores** in group names (e.g. `itu_rtx_test`, not `itu-rtx-test`). Hyphens in group names cause Ansible warnings.

### Creating a new environment

```bash
# 1. Create inventory
cp inventory/inventory.example inventory/staging.ini
# Edit: set [staging] group, update host IP

# 2. Create environment config directory
mkdir -p group_vars/staging
cp group_vars/itu_rtx_test/vars.yml group_vars/staging/vars.yml
# Edit: set staging-specific values (domains, ports, email, etc.)

# 3. Create encrypted secrets
ansible-vault create group_vars/staging/vault.yml
# Fill in all required secrets (see below)

# 4. Place SSL certificates
mkdir -p files/certificates/staging
cp server.crt server.key files/certificates/staging/

# 5. Deploy to staging
ansible-playbook -i inventory/staging.ini deploy.yml --vault-id staging@prompt
```

### Vault passwords

Each environment uses its own vault password. Two methods:

**Interactive (prompts per environment):**
```bash
ansible-playbook -i inventory/itu_rtx_test.ini deploy.yml --vault-id itu_rtx_test@prompt
```

**Password files (for CI/CD or automation):**
```bash
# Store passwords (gitignored)
echo "test-vault-password" > .vault-pass-itu_rtx_test

# Use them
ansible-playbook -i inventory/itu_rtx_test.ini deploy.yml --vault-id itu_rtx_test@.vault-pass-itu_rtx_test
```

**Legacy `--ask-vault-pass` (single password for all environments):**
```bash
ansible-playbook -i inventory/itu_rtx_test.ini deploy.yml --ask-vault-pass
```

## Inventory Setup

Each inventory file puts the host in an environment group. Ansible automatically loads all files from `group_vars/<group>/`.

```ini
# inventory/itu_rtx_test.ini
[itu_rtx_test]
genieai-test ansible_host=10.0.0.110

[swarm_managers]
genieai-test

[gpu_nodes]
genieai-test

[all:vars]
ansible_user=jerome
```

## Required Vault Secrets

Set in `group_vars/<env>/vault.yml`:

| Variable | Description |
|----------|-------------|
| `arango_password` | ArangoDB root password |
| `jwt_secret` | JWT token signing secret |
| `session_secret` | Session encryption secret |
| `translation_cache_password` | Redis cache password |
| `postgres_password` | Kong PostgreSQL password |
| `auth_service_username` | Internal microservice auth username |
| `auth_service_password` | Internal microservice auth password |
| `email_password` | SMTP password |
| `hugging_face_hub_token` | Hugging Face Hub token |

## Environment Variables (Non-Secret)

Set in `group_vars/<env>/vars.yml`:

| Variable | Default | Description |
|----------|---------|-------------|
| `deploy_opea` | `1` | Deploy OPEA/AI services (GPU) |
| `gpu_env_file` | `env.t4` | GPU defaults file (empty = none). Loaded first; Ansible `.env` takes precedence. |
| `nginx_public_domain` | `localhost` | Public domain/IP |
| `nginx_http_port` | `80` | HTTP port (only set if non-default) |
| `nginx_https_port` | `443` | HTTPS port (only set if non-default) |
| `registry_port` | `5000` | Local Docker registry port |
| `vue_app_api_url` | `""` | Frontend API URL |
| `vue_app_csp_connect_src` | `""` | Frontend CSP connect sources |
| `csp_connect_src` | `""` | Backend CSP connect sources |
| `cors_allowed_origins` | `""` | CORS allowed origins |
| `email_host` | `""` | SMTP server |
| `email_port` | `587` | SMTP port |
| `email_secure` | `false` | SMTP TLS (true/false) |
| `email_user` | `""` | SMTP username |
| `email_from` | `""` | Sender email address |

Shared variables in `group_vars/all.yml`:

| Variable | Default | Description |
|----------|---------|-------------|
| `deploy_dir` | `/opt/genieai` | Deploy path |
| `data_dir` | `./data` | Data directory (relative to deploy_dir) |
| `repo_url` | — | Git repository URL |
| `repo_branch` | `main` | Git branch |
| `stack_name` | `genieai` | Docker Swarm stack name |
| `compose_file` | `docker-compose.yaml` | Compose file name |
| `self_signed_certs` | `true` | Auto-generate self-signed certs |
| `deploy_stabilization_timeout` | `900` | Max seconds to wait for services |
| `docker_version_pin` | `5:28.5.*` | Docker package version pin |
| `nvidia_version_pin` | `1.18.*` | NVIDIA toolkit version pin |

## Playbook Tags

| Tag | Description |
|-----|-------------|
| `install` | Docker, NVIDIA toolkit, Swarm init, registry |
| `prepare` | Git clone, directories, SSL certs |
| `build` | Build and push images to local registry |
| `deploy` | Generate .env, validate, deploy stack, verify |

```bash
# Full deployment
ansible-playbook -i inventory/itu_rtx_test.ini deploy.yml --vault-id itu_rtx_test@prompt

# Rebuild and redeploy (no install/prepare)
ansible-playbook -i inventory/itu_rtx_test.ini deploy.yml --tags build,deploy --vault-id itu_rtx_test@prompt

# Redeploy only (existing images and .env)
ansible-playbook -i inventory/itu_rtx_test.ini deploy.yml --tags deploy --vault-id itu_rtx_test@prompt
```

### Git credentials with `--tags deploy`

The `prepare` play prompts for git credentials via `vars_prompt`. When using `--tags deploy` only, these prompts still appear (Ansible evaluates `vars_prompt` before tag filtering). To avoid the prompts, pass credentials as extra vars:

```bash
ansible-playbook -i inventory/itu_rtx_test.ini deploy.yml --tags deploy --vault-id itu_rtx_test@prompt \
  --extra-vars "git_username=YOUR_USER git_token=YOUR_TOKEN"
```

## GPU Configuration

To deploy without GPU/OPEA services, set in `group_vars/<env>/vars.yml`:
```yaml
deploy_opea: "0"
gpu_env_file: ""
```

GPU env file options (provide GPU-specific defaults in `docker-compose.yaml`):
- `env.t4` — NVIDIA T4 (16GB VRAM)
- `env.rtx6000` — RTX 6000 ADA (24GB VRAM)

The GPU env file is loaded first, then the Ansible-generated `.env` is loaded on top.
**Ansible `.env` values take precedence** over GPU env file values for any duplicate variables.
This allows per-environment tuning via Ansible while keeping GPU defaults in the committed files.

## Port Configuration

If ports 80/443 are occupied (e.g. by another stack), override them in your environment config:

```yaml
# group_vars/<env>/vars.yml
nginx_http_port: "1080"
nginx_https_port: "1443"
registry_port: "5001"
```

The playbook generates `.env` with these values, and `docker-compose.yaml` uses them as published ports. Only set non-default values — defaults (80, 443, 5000) are omitted from `.env` automatically.

## Docker and NVIDIA Version Pinning

Docker and NVIDIA Container Toolkit packages are **version-pinned** and **held** via `dpkg --set-selections` to prevent accidental upgrades breaking the deployment.

| Package group | Pin | Config |
|---------------|-----|--------|
| Docker | `5:28.5.*` | `docker_version_pin` in `all.yml` |
| NVIDIA toolkit | `1.18.*` | `nvidia_version_pin` in `all.yml` |

To upgrade: change the pin value in `all.yml`, then run with `--tags install`. The playbook will unhold, upgrade, and re-hold the packages.

## Post-Deploy Verification

The `deploy` tag automatically verifies:

1. **Service stabilization** — waits for all services to appear in Swarm
2. **Replica health** — checks all running services have at least 1 replica (excludes one-shot init services and disabled 0/0 services)
3. **Backend health** — polls `/api/health` via HTTPS
4. **Frontend** — polls `/` via HTTPS

If any running service has 0 replicas, the playbook fails. One-shot services (`kong-config`, `kong-migrations`) and intentionally disabled services (0/0 replicas) are excluded.

## Teardown

```bash
# Remove stack (preserve volumes)
ansible-playbook -i inventory/itu_rtx_test.ini teardown.yml --vault-id itu_rtx_test@prompt

# Remove stack + volumes
ansible-playbook -i inventory/itu_rtx_test.ini teardown.yml --vault-id itu_rtx_test@prompt \
  -e "teardown_remove_volumes=true"

# Remove stack + volumes + local registry
ansible-playbook -i inventory/itu_rtx_test.ini teardown.yml --vault-id itu_rtx_test@prompt \
  -e "teardown_remove_volumes=true" \
  -e "teardown_remove_registry=true"
```

## Troubleshooting

### "Missing required vault variable"
```bash
ansible-vault edit --vault-id itu_rtx_test@prompt group_vars/itu_rtx_test/vault.yml
# Ensure all secrets are set
```

### Docker build fails
```bash
ssh node "cd /opt/genieai && docker build -f components/gov-chat-frontend/Dockerfile -t test:latest components/gov-chat-frontend/"
```

### Services keep restarting
```bash
ssh node "docker service ps genieai_<service> --no-trunc"
ssh node "docker service logs genieai_<service> --tail 50"
```

### GPU not detected
```bash
ssh node "docker run --rm --gpus all nvidia/cuda:12.0-base nvidia-smi"
```

### No space left on device
```bash
ssh node "docker system prune -a"
# Then redeploy with --tags build,deploy
```

### Verify deployment
```bash
ssh node "docker service ls"
ssh node "curl -sk https://localhost/api/health"
```
