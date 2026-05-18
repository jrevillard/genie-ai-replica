# GENIE.AI - GitLab Runner Deployment

Ansible playbook to install and configure a GitLab Runner with Docker executor for CI/CD jobs, including testcontainers support.

## Architecture

```
10.0.0.100 (dedicated runner host)
├── Docker Engine (userns-remap enabled)
│   └── daemon.json: {"userns-remap": "default"}
├── docker-socket-proxy (tecnativa/docker-socket-proxy)
│   ├── Listens on 127.0.0.1:2375
│   ├── Mounts /var/run/docker.sock:ro
│   └── Filters Docker API (default-deny)
├── gitlab-runner (binary, systemd service)
│   └── config.toml
│       ├── executor = "docker"
│       ├── DOCKER_HOST=tcp://127.0.0.1:2375
│       ├── privileged = false, cap_drop = ALL
│       └── concurrent = 2, limit = 2, 4g RAM, 2 CPUs
└── CI jobs → socket proxy → Docker Engine
```

### Security layers

| Layer | Mechanism | Purpose |
|-------|-----------|---------|
| API filtering | docker-socket-proxy | Default-deny, only CONTAINERS/IMAGES/NETWORKS/VOLUMES/EXEC/POST allowed |
| UID remapping | userns-remap (`dockremap`) | Container root (uid 0) → unprivileged host uid |
| Container restrictions | config.toml | `privileged=false`, `cap_drop=ALL`, memory/CPU limits |
| Network isolation | 127.0.0.1 binding | Proxy only accessible from localhost |

**Registration:** The runner is created manually in GitLab UI (Settings > CI/CD > Runners > New project runner). GitLab generates an authentication token (`glrt-xxx`) which is stored in the Ansible vault and deployed to `config.toml` (mode `0600`, owned by `gitlab-runner`).

## Prerequisites

### Control machine (where you run ansible-playbook)

```bash
ansible-galaxy collection install -r requirements.yml
```

### Target host

- Ubuntu 22.04+ (tested)
- SSH access with sudo privileges
- No Docker pre-installed (the playbook handles it)
- **Dedicated host recommended** (userns-remap affects all containers)

### GitLab

The runner must be created in GitLab **before** deploying:

1. Navigate to **Project > Settings > CI/CD > Runners**
2. Click **New project runner**
3. Set tags (e.g. `docker`, `genie-ai`), choose **Run untagged jobs** or not
4. Click **Create runner**
5. Copy the authentication token (starts with `glrt-`)

This token goes into the Ansible vault (see Quick Start below).

## Quick Start

```bash
cd deploy/ansible

# 1. Install Ansible collections
ansible-galaxy collection install -r requirements.yml

# 2. Create inventory (or use existing gitlab-runner.ini)
# Edit inventory/gitlab-runner.ini with your host IP

# 3. Set the runner token in vault
# Edit group_vars/gitlab_runners/vault.yml
# Replace CHANGE_ME with the glrt-xxx token from GitLab UI

# 4. Encrypt the vault
ansible-vault encrypt group_vars/gitlab_runners/vault.yml --vault-id gitlab@prompt

# 5. Deploy
ansible-playbook -i inventory/gitlab-runner.ini gitlab-runner.yml --vault-id gitlab@prompt
```

## File Structure

```
deploy/ansible/
├── gitlab-runner.yml                    # Runner playbook
├── inventory/gitlab-runner.ini          # Runner target host
├── group_vars/
│   ├── all.yml                          # Shared: gitlab_url
│   └── gitlab_runners/
│       ├── vars.yml                     # docker_userns_remap + runner overrides
│       └── vault.yml                    # Encrypted: gitlab_runner_token
└── roles/
    ├── docker/                          # Shared: Docker installation (reused by deploy.yml)
    │   ├── defaults/main.yml            # docker_userns_remap: false (opt-in)
    │   ├── tasks/main.yml               # Install + optional userns-remap config
    │   └── handlers/main.yml            # Restart Docker
    ├── docker_socket_proxy/             # Socket proxy deployment
    │   ├── defaults/main.yml            # API permissions
    │   ├── tasks/main.yml               # Deploy via docker compose
    │   └── templates/docker-compose-socket-proxy.yml.j2
    └── gitlab_runner/
        ├── tasks/main.yml               # Install binary + deploy config
        ├── defaults/main.yml            # Default runner settings
        ├── templates/config.toml.j2     # Runner configuration template
        └── handlers/main.yml            # Restart gitlab-runner
```

## Variables

### Shared (group_vars/all.yml)

| Variable | Default | Description |
|----------|---------|-------------|
| `gitlab_url` | `https://opensource.unicc.org` | GitLab instance URL |

### Secrets (group_vars/gitlab_runners/vault.yml)

| Variable | Description |
|----------|-------------|
| `gitlab_runner_token` | Runner authentication token from GitLab UI (`glrt-xxx`) |

### Security (group_vars/gitlab_runners/vars.yml)

| Variable | Default | Description |
|----------|---------|-------------|
| `docker_userns_remap` | `true` | Enable UID remapping (container root → unprivileged host uid) |
| `gitlab_runner_use_socket_proxy` | `true` | Route Docker access through socket proxy |

### Runner Configuration (roles/gitlab_runner/defaults/main.yml)

Override in `group_vars/gitlab_runners/vars.yml` if needed:

| Variable | Default | Description |
|----------|---------|-------------|
| `gitlab_runner_concurrent` | `2` | Max parallel jobs (global) |
| `gitlab_runner_limit` | `2` | Max jobs for this runner |
| `gitlab_runner_memory_limit` | `4g` | Memory limit per job container |
| `gitlab_runner_cpu_limit` | `2.0` | CPU limit per job container |
| `gitlab_runner_docker_image` | `docker:28` | Default image for jobs without `image:` |

## Playbook Tags

| Tag | Description |
|-----|-------------|
| `docker` | Install Docker only |
| `proxy` | Deploy Docker socket proxy only |
| `runner` | Install and configure GitLab Runner only |

```bash
# Re-run only runner configuration (skip Docker + proxy)
ansible-playbook -i inventory/gitlab-runner.ini gitlab-runner.yml --tags runner --vault-id gitlab@prompt

# Dry run
ansible-playbook -i inventory/gitlab-runner.ini gitlab-runner.yml --check --diff --vault-id gitlab@prompt
```

## Verification

After deployment, verify the runner is working:

```bash
ssh govstack@10.0.0.100

# Check runner service
sudo gitlab-runner status

# Verify socket proxy
curl -sf http://127.0.0.1:2375/_ping  # Should print: OK

# Verify userns-remap
docker run --rm alpine cat /proc/self/uid_map
# Should show remapped range (not 0 0 4294967295)

# Verify runner connection
sudo gitlab-runner verify
```

In GitLab: navigate to **Settings > CI/CD > Runners** — the runner should appear with a green status indicator.

### Test CI job

Create a `.gitlab-ci.yml` in your project:

```yaml
test:
  stage: test
  image: docker:28
  tags:
    - docker
    - genie-ai
  variables:
    DOCKER_HOST: tcp://127.0.0.1:2375
  script:
    - docker info
    - docker run --rm alpine echo "testcontainers works"
```

## Idempotency

The playbook is idempotent — re-running it:

- **Docker role**: Skips if packages are already installed and pinned
- **Socket proxy**: Re-deploys compose file, `docker compose up -d` is idempotent
- **gitlab-runner binary**: Skips if already installed via apt
- **config.toml**: Only triggers a restart if the template content changes

## Disabling Security Features

To disable the socket proxy (mount docker.sock directly), add to `group_vars/gitlab_runners/vars.yml`:

```yaml
gitlab_runner_use_socket_proxy: false
```

To disable userns-remap:

```yaml
docker_userns_remap: false
```

Then re-deploy and manually remove `/etc/docker/daemon.json` + restart Docker.

## Rotating the Runner Token

If the runner token is compromised or expired:

1. In GitLab UI: **Settings > CI/CD > Runners** > select the runner > **Reset authentication token**
2. Copy the new `glrt-xxx` token
3. Update the vault: `ansible-vault edit group_vars/gitlab_runners/vault.yml --vault-id gitlab@prompt`
4. Re-deploy: `ansible-playbook -i inventory/gitlab-runner.ini gitlab-runner.yml --tags runner --vault-id gitlab@prompt`

## Network Requirements (MTU/MSS Clamping)

The runner host uses an overlay network with a reduced MTU (e.g. 1342 on OpenStack/Hetzner Cloud). Docker containers default to MTU 1500, which causes large TCP transfers (Flutter SDK downloads, `pub get`) to fail with `Connection reset by peer` after a few minutes. Small requests (HEAD, small GETs) work fine — only sustained large transfers break.

**Fix:** MSS clamping via iptables ensures TCP negotiates the correct segment size through the overlay.

Create `/etc/network/if-pre-up.d/mss-clamp` (mode 0755):

```bash
#!/bin/bash
iptables -t mangle -C POSTROUTING -o ens3 -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu 2>/dev/null || iptables -t mangle -A POSTROUTING -o ens3 -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu
```

This rule:
- Persists across reboots (if-pre-up.d hook)
- Is idempotent (`-C` checks before `-A` adds)
- Adjusts `ens3` to match your VM's primary interface name

**Symptoms without it:**
- `curl: (56) Recv failure: Connection reset by peer` after ~3min on large HTTPS downloads from CI containers
- `flutter pub get` hanging for 1 hour then timing out
- Small HTTP/HTTPS requests work fine, only large sustained transfers fail

> **Note:** This must be applied on every runner VM with a non-standard MTU. Check with `ip link show ens3 | grep mtu`.

## Troubleshooting

### Runner shows offline in GitLab

```bash
ssh govstack@10.0.0.100
sudo gitlab-runner verify
sudo gitlab-runner restart
sudo journalctl -u gitlab-runner -n 50
```

### "Forbidden" or authentication errors

The runner token is invalid or expired. Reset it in GitLab UI and update the vault (see Rotating the Runner Token).

### Socket proxy issues

```bash
# Check proxy container
docker ps --filter name=docker-socket-proxy
docker compose -f /opt/docker-socket-proxy/docker-compose.yml logs

# Test proxy directly
curl -sf http://127.0.0.1:2375/_ping
curl -sf http://127.0.0.1:2375/v1.24/containers/json | python3 -m json.tool
```

### userns-remap issues

```bash
# Verify remap is active
cat /etc/docker/daemon.json
grep dockremap /etc/subuid /etc/subgid

# Check UID mapping in a container
docker run --rm alpine cat /proc/self/uid_map
```

### Config.toml changes not applied

The handler restarts `gitlab-runner` when `config.toml` changes. If changes are not picked up:

```bash
sudo gitlab-runner restart
```
