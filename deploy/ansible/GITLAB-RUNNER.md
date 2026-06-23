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
│       ├── privileged = false, devices = ["/dev/kvm"] (Android emulator)
│       └── concurrent = 2, limit = 2, 4g RAM, 2 CPUs
└── CI jobs → socket proxy → Docker Engine
```

### Security layers

> **CHANGE (2026-06)**: `userns-remap` is now **disabled** (`docker_userns_remap: false` in `group_vars/gitlab_runners/vars.yml`). It was incompatible with every container-based BuildKit mode (docker-container driver needs privileged; rootless needs a nested userns), blocking `docker buildx` entirely. Isolation now relies on the **socket proxy** (API filtering) + **dedicated VM**. The `userns-remap` references below are kept for historical context / re-enable guidance. See `docs/adr/0001-gitlab-registry-build-scan-pipeline.md`.

| Layer | Mechanism | Purpose |
|-------|-----------|---------|
| API filtering | docker-socket-proxy | Default-deny; CONTAINERS/IMAGES/NETWORKS/VOLUMES/EXEC/POST/BUILD/AUTH/DISTRIBUTION allowed (AUTH + DISTRIBUTION required for CI registry login/push) |
| UID remapping | userns-remap (`dockremap`) | Container root (uid 0) → unprivileged host uid |
| Container restrictions | config.toml | `privileged=false`, memory/CPU limits, KVM device passthrough |
| Socket proxy isolation | `userns_mode: host` on proxy | Required for proxy to access Docker socket despite userns-remap |
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

# 3. Set runner tokens in the vault (one glrt- per host, keyed by inventory hostname)
# Edit group_vars/gitlab_runners/vault.yml:
#   gitlab_runner_tokens:
#     genieai-runner:     "glrt-<token for 10.0.0.100>"
#     genieai-runner-gpu: "glrt-<token for 10.0.0.110>"

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
│       └── vault.yml                    # Encrypted: gitlab_runner_tokens dict
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
| `gitlab_runner_tokens` | Dict of runner auth tokens keyed by inventory hostname (`glrt-xxx`); one entry per host in `[gitlab_runners]` |

### Security (group_vars/gitlab_runners/vars.yml)

| Variable | Default | Description |
|----------|---------|-------------|
| `docker_userns_remap` | `true` | Enable UID remapping (container root → unprivileged host uid) |
| `gitlab_runner_use_socket_proxy` | `true` | Route Docker access through socket proxy |
| `docker_manage_daemon_json` | `true` | Role owns daemon.json; set `false` on co-managed hosts (e.g. GPU node) |
| `docker_upgrade_enabled` | `true` | Role may upgrade Docker packages; set `false` on co-managed hosts |

### Runner Configuration (roles/gitlab_runner/defaults/main.yml)

Override in `group_vars/gitlab_runners/vars.yml` if needed:

| Variable | Default | Description |
|----------|---------|-------------|
| `gitlab_runner_concurrent` | `2` | Max parallel jobs (global) |
| `gitlab_runner_limit` | `2` | Max jobs for this runner |
| `gitlab_runner_memory_limit` | `8g` | Memory limit per job container |
| `gitlab_runner_cpu_limit` | `2.0` | CPU limit per job container |
| `gitlab_runner_docker_image` | `docker:28` | Default image for jobs without `image:` |
| `gitlab_runner_kvm_device` | `/dev/kvm` | KVM device passthrough (set to `""` to disable) |
| `gitlab_runner_docker_runtime` | `""` | Docker runtime for CI containers (`runc` bypasses a nvidia default-runtime) |

## Shared / Co-managed Host (e.g. GPU node)

The playbook targets a **dedicated** runner host by default. To also run a runner on a host
whose Docker is owned by another playbook (e.g. `deploy-gpu.yml` on the GPU node
`bb-ai-gpu-01`, which runs the vLLM/TEI inference API), set two flags so the docker role
cannot disrupt that host's daemon:

- `docker_manage_daemon_json=false` — skip the daemon.json write/clear tasks (they call
  `notify: Restart Docker`; clobbering the GPU node's `nvidia` runtime + DNS would kill the
  inference API and prevent it restarting).
- `docker_upgrade_enabled=false` — skip the unhold / `state: latest` / hold block (upgrading
  `docker-ce` restarts the daemon via its postinst).

The role's safe tasks (apt packages, repo/pin, `python3-docker`, docker-group membership,
`state: started`) still run for consistency. To isolate CI from the GPU API, also set on
that host:

- `gitlab_runner_docker_runtime="runc"` — CI containers use `runc`, bypassing the daemon's
  `default-runtime: nvidia` so a job can never touch the GPU.
- `gitlab_runner_concurrent` / `gitlab_runner_limit` / `gitlab_runner_memory_limit` /
  `gitlab_runner_cpu_limit` — cap CI load so it never starves vLLM model loads.
- The socket proxy still applies, so a CI job cannot `docker rm` the API containers (the
  proxy's `--remove-orphans` is scoped to its own project and never touches the GPU stack).

See `inventory/gitlab-runner.ini` (`genieai-runner-gpu`) for the worked example.

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

### Why no `cap_drop = ["ALL"]`

`cap_drop = ["ALL"]` is intentionally not set in the runner config. With `userns-remap` already providing container isolation at the host level, dropping all capabilities inside containers breaks CI jobs that need `setuid`/`setgid` for package installation (`apt-get`, `pip`) in their `before_script`. The security model relies on userns-remap + socket proxy filtering instead.

## KVM Passthrough (Android Emulator)

The runner supports KVM device passthrough for Android emulator workloads (e.g. Patrol E2E tests). This is enabled by default when `/dev/kvm` exists on the host.

**How it works:**

- `devices = ["/dev/kvm"]` is added to `config.toml` `[runners.docker]` section
- The `gitlab-runner` user is added to the `kvm` group automatically
- CI jobs needing KVM should use `tags: [kvm]` to target runners with KVM support
- No `privileged = true` required — KVM is a fine-grained device passthrough

**Verify KVM on the host:**

```bash
# Check /dev/kvm exists
ls -la /dev/kvm

# Check KVM is usable
kvm-ok  # or: cat /proc/cpuinfo | grep -c 'vmx\|svm'
```

**To disable KVM passthrough**, add to `group_vars/gitlab_runners/vars.yml`:

```yaml
gitlab_runner_kvm_device: ""
```

**After changes**, re-deploy:

```bash
ansible-playbook -i inventory/gitlab-runner.ini gitlab-runner.yml --tags runner --vault-id gitlab@prompt
```

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
