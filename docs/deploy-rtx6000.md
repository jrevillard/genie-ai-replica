# Deploying Agrivisory on rtx6000 — the canonical runbook

Audience: whoever deploys or redeploys the rtx6000 box (fresh box, redeploy after
code change, or disaster recovery). Every command and value below is real — this
is the box's actual configuration, verified 09-28 (SSH end-to-end, GPU live).
This doc replaces the three former VM deploy docs; it covers setup through
deploy + verify. Post-deploy product validation (auth end-to-end, real-model
chat, re-ingestion) is Epic D's checklist — see the Related footer.

Conventions: commands run on your **control machine** (the WSL/Linux laptop)
unless prefixed with `ssh rtx6000` (the SSH alias from section 3). Deployment
input lives in exactly two committed places —
`deploy/ansible/inventory/rtx6000.ini` and
`deploy/ansible/group_vars/agrivisory_rtx6000/vars.yml` (+ your uncommitted
`vault.yml`) — two env-specific files, plus shared defaults in the committed
`group_vars/all.yml` (models, images, browser-facing URLs — all computed from
the domain). The full
variable reference is [`deploy/ansible/README.md`](../deploy/ansible/README.md);
this doc only narrates the rtx6000 instance of it.

## 1. The short version

```
 control machine                    jl-vm-511428  (151.185.34.95)
 (WSL/Linux laptop)                 RTX PRO 6000 Blackwell 96 GB, whole GPU
 ───────────────────                ─────────────────────────────────────
 ssh deploy-key        ──────────▶  ubuntu@jl-vm-511428
 ansible-playbook
   ├─ --tags install   ──────────▶  Docker CE (pinned) + NVIDIA toolkit
   │                                 + swarm init + labels
   ├─ full run          ──────────▶  rsync repo → /opt/agrivisory-app
   │                                 → .env (0600) → compose up --build
   │                                 → wait for health
   └─ verify            ◀──────────  https://agriconnect.site  (Let's Encrypt)
```

1. Control machine ready: WSL + ansible + repo (section 2) — once.
2. SSH key authorized for `ubuntu@151.185.34.95` (section 3) — once.
3. Driver present: `nvidia-smi` lists the card (section 5) — once.
4. Vault filled: every required secret real, no placeholders (section 6).
5. `--tags install`, then the full run with `confirm=yes` (section 7).
6. Verify through the public door (section 8), then Epic D's checklist.

## 2. Control machine: WSL + ansible + repo (once)

Ansible does not run on Windows natively — a Windows laptop runs it from WSL
Ubuntu. On a Linux laptop, skip the WSL step and start at the packages.

Elevated PowerShell: `wsl --install` → reboot → the Ubuntu window asks for a
Linux user/password (local only). Reopen "Ubuntu" from the Start menu to enter.

Packages + ansible (in WSL or native Linux):

```bash
sudo apt update && sudo apt install -y pipx git
pipx ensurepath && exec bash          # restarts shell so ~/.local/bin is on PATH
pipx install ansible
```

Repo — clone from Azure DevOps, or seed from an existing Windows checkout via
`/mnt/c` (no PAT needed for the seed; work on the Linux copy, not across the
mount):

```bash
git clone -b feature/2.0-upgrade \
  https://dev.azure.com/ITUINT/AI-ITU-BDT-Infra/_git/genie-ai-replica-itu \
  ~/genie-ai-replica-itu
# or: git clone /mnt/c/Users/<you>/coding/genie-ai-replica-itu ~/genie-ai-replica-itu
#     git remote set-url origin https://dev.azure.com/ITUINT/AI-ITU-BDT-Infra/_git/genie-ai-replica-itu

cd ~/genie-ai-replica-itu/deploy/ansible
ansible-galaxy collection install -r requirements.yml   # community.docker, ansible.posix
```

The `/mnt/c` warning: files under a Windows mount look 0777 to Linux, and SSH
refuses such files. Keys and vault files live in the Linux home, never on
`/mnt/c` (gotcha 3).

## 3. SSH access: deploy-key → the box

Plain SSH with a dedicated key — no cloud CLI, no VPN ceremony. The 09-28
reality: the key for this repo was generated on `adem@archlinux`, authorized
from the machine that already had access, and verified with
`ssh … hostname` → `ok from jl-vm-511428`.

```bash
ssh-keygen -t ed25519 -f ~/.ssh/deploy-key -N ""
# authorize it once — password auth:
ssh-copy-id -i ~/.ssh/deploy-key.pub ubuntu@151.185.34.95
# (no password auth? paste the pubkey into ~/.ssh/authorized_keys from
#  any machine that already has access — that is how this deployment did it)
```

`~/.ssh/config` on the control machine:

```
Host rtx6000
    HostName 151.185.34.95
    User ubuntu
    IdentityFile ~/.ssh/deploy-key
    StrictHostKeyChecking accept-new
```

Test — this must print `jl-vm-511428` before anything else in this doc:

```bash
ssh rtx6000 "hostname && nvidia-smi --query-gpu=name,driver_version --format=csv"
```

The committed inventory (`deploy/ansible/inventory/rtx6000.ini`) mirrors the
same facts: `ansible_host=151.185.34.95`, `ansible_user=ubuntu`,
`ansible_ssh_private_key_file=~/.ssh/deploy-key`.

## 4. What you deploy (rtx6000 facts)

| Fact | Value |
|---|---|
| Host | `jl-vm-511428` — `151.185.34.95`, SSH user `ubuntu` |
| GPU | RTX PRO 6000 Blackwell, 96 GB — **whole GPU** (not a vGPU partition) |
| Driver | 595.58.03 (live 09-28); Blackwell `sm_120` needs 570+ and CUDA 12.8+ images — the `all.yml` pins qualify |
| Public door | `https://agriconnect.site` (+ `www.`, same cert — DEC-14); A record → 151.185.34.95, ports 80/443 open from the internet |
| Certs | `cert_mode: letsencrypt` (DEC-1) — certbot container issues + renews |
| Deploy dir | `/opt/agrivisory-app` (already set in vars — nothing to add) |
| Mode | `deploy_mode: local` — images build on the box, no registry (DEC-9) |
| Models | chat `ibm-granite/granite-4.1-8b` (default, DEC-9), translation `facebook/nllb-200-3.3B` on the `nllb-translate` sidecar (DEC-25), embedding `BAAI/bge-m3`, reranker `BAAI/bge-reranker-v2-m3` — all named once in `group_vars/all.yml` |
| GPU share | `vllm_gpu_utilization: "0.80"` (DEC-25) — granite's vLLM cap is ~76 GB; the NLLB sidecar allocates its ~8-9 GB OUTSIDE any vLLM fraction (transformers, as-needed) with ~3.7 GB margin; TEI ×2 rides the same non-vLLM budget |

## 5. Driver + tag anatomy

### The driver — the part the playbook does NOT do

Install the vendor driver BEFORE the playbook; then verify. What the right
driver is depends on the GPU shape — check first with `lspci | grep -i nvidia`.

| GPU shape | Driver | Notes |
|---|---|---|
| **Whole GPU** — T4, L4, A100, **RTX PRO 6000 Blackwell (this box)** | distro packages are fine: `sudo ubuntu-drivers install --gpgpu` (Ubuntu) or the NVIDIA CUDA/apt repo | Blackwell needs 570+; this box runs 595.58.03. Anything 570+ works. |
| **vGPU partition** — Azure NVads A10 v5 = PCI `10de:2236`, or any "profile" GPU (A10-2Q) | distro drivers DO NOT work — probe fails with "not supported by this driver release". You need the GRID vGPU guest driver: NVIDIA's vGPU portal, or on Azure the `NvidiaGpuDriverLinux` extension / the `-grid` runfile MS links per VM series | Match the major branch to the cloud's host (Azure NVads A10 = v18.x / 570.x). General reference — does not apply to this box. |
| Runfile installs (any shape) | `build-essential` + `linux-headers-$(uname -r)` required | answer **No** to nvidia-xconfig on headless boxes. |

Verify before anything else: `ssh rtx6000 nvidia-smi` lists the card.

Docker: do NOT install by hand — the playbook's `install` tag handles Docker CE
(version-pinned + held) + nvidia-container-toolkit + runtime config. A
hand-installed Docker diverges from the pin and can conflict on `install` runs.

### What the playbook's tags do

`deploy/ansible/deploy.yml` is idempotent and tag-scoped:

| Tag | Does |
|---|---|
| `install` | Docker CE (pinned + held), NVIDIA container toolkit, Swarm init, node labels (`gpu=true`, `gateway=true`, `genieai=true`) |
| `prepare` | Deploy dir, repo sync, certs per `cert_mode` (letsencrypt = Ansible stages a bootstrap self-signed cert with a loud warning; certbot replaces it after first issuance) |
| `build` | Registry login (swarm mode only; `local` mode skips) |
| `deploy` | Render `.env` (mode 0600), validate compose, `compose up --build` (local) or `stack deploy` (swarm), wait for health |

GPU services live behind the `gpu-models` compose profile; the observability
stack behind `enable_observability`.

## 6. Vars + vault (the actual configuration)

Both committed files are already rtx6000-true — a redeploy normally touches
neither (one deliberate exception: `certbot_email` is a placeholder-by-choice —
DEC-1, Adem will swap it; zero-cost, the cert binds to the domain not the email):

- `deploy/ansible/inventory/rtx6000.ini` — host/IP/user/key (section 3), host
  in `[agrivisory_rtx6000]` + `[swarm_managers]` + `[gpu_nodes]` (single node).
- `deploy/ansible/group_vars/agrivisory_rtx6000/vars.yml` — the decisions:
  `nginx_public_domain: agriconnect.site`, `deploy_dir: /opt/agrivisory-app`,
  `cert_mode: letsencrypt` + `certbot_email` + `certbot_replicas: "1"` (DEC-1),
  `email_from: noreply@agriconnect.site` (DEC-16-R via DreamHost domain mail —
  From must match the mailbox; vault holds smtp.dreamhost.com:587 STARTTLS +
  mailbox creds; SPF `include:dreamhost.com` on the domain)
  (**required on every deploy** — an
  empty sender makes Keycloak reject the realm import with HTTP 400; the
  preflight enforces it), and the commented Llama override — GPU sizing is NOT
  set here: `vllm_gpu_utilization` lives once in `group_vars/all.yml` (the B3
  SSOT), currently `"0.80"` per DEC-25, and preflight pins both of its renders:

  ```yaml
  # vllm_llm_model_id: meta-llama/Meta-Llama-3.1-8B-Instruct   # uncomment for Llama (default: granite-4.1-8b in all.yml)
  ```

Secrets live in `group_vars/agrivisory_rtx6000/vault.yml` (Ansible Vault —
create with `ansible-vault create`, edit with `ansible-vault edit`, both with
`--vault-id rtx6000@prompt`). The authoritative required-when list is the
README's **Required Vault Secrets** table (arango, translation-cache, kong/keycloak
DB passwords, keycloak/proxy/dataprep client secrets, admin account + email,
`hugging_face_hub_token`, grafana secret). Rules that bite:

- Every value **fresh** — never reuse anything ever committed (DEC-10
  rotation-at-install). Generate:
  `openssl rand -base64 24 | tr -d '/+=' | head -c 24`.
- `hugging_face_hub_token` — a real token. Whether a model needs it depends on
  the repo (gated repos 401 mid-deploy on anonymous pulls; the granite default
  is not gated, but set a real token anyway — rate limits).
- Preflight (B2) fails the run on any `CHANGE_ME`/`FILL-IN`/empty required var
  — the failure names the var, its `group_vars` file and the offending value.
  Filling real values is still on you; the sweep just refuses silent
  placeholders.

## 7. Run it

```bash
cd ~/genie-ai-replica-itu/deploy/ansible
# pass 1: Docker + NVIDIA toolkit + swarm init + labels (~10 min)
ansible-playbook -i inventory/rtx6000.ini deploy.yml --tags install --vault-id rtx6000@prompt --extra-vars "confirm=yes"
# pass 2: everything — repo sync → .env (0600) → validate → up --build
ansible-playbook -i inventory/rtx6000.ini deploy.yml --vault-id rtx6000@prompt --extra-vars "confirm=yes"
```

- **`-K` is conditional — check, don't assume:**
  `ssh rtx6000 'sudo -n true'` exits 0 → sudo is passwordless, no `-K`
  anywhere. It fails → append `-K` to every playbook command. Either state is
  fine; the check is one command.
- **Preflight runs first, every time** (including tagged re-runs), read-only:
  placeholder sweep, `deploy_mode`/`enable_observability` enums, cert rules,
  a printed deployment plan (mode, domain, cert mode, models, profiles, GPU
  host, deploy dir) — then the **confirm gate**: with
  `nginx_public_domain ≠ localhost` the run aborts before any mutation unless
  you pass `--extra-vars "confirm=yes"` — on **every** invocation, tagged runs
  included (preflight is `tags: [always]`). Both commands above carry it.
- **Two passes because** pass 1 mutates the engine/toolkit once; pass 2 then
  does the whole stack. Tagged re-runs later: `--tags deploy` after a code
  change — same `--extra-vars "confirm=yes"` (see the README's
  git-credentials note for skipping the `vars_prompt`).
- **First full run ≈ 1 h** — image builds + model downloads (tens of GB across
  granite + gemma + bge-m3 + reranker). Subsequent runs are minutes.

## 8. Verify

```bash
ssh rtx6000 nvidia-smi                                            # host GPU
ssh rtx6000 "docker exec \$(docker ps -qf name=vllm) nvidia-smi"   # GPU inside container
curl https://agriconnect.site/api/health                          # 200 via nginx→kong→backend
curl -sI https://www.agriconnect.site/ | head -1                  # cert covers both names (DEC-14)
# browser: https://agriconnect.site/ → AdminAdem (genie_admin_username) + the NEW rotated vault password
```

The `deploy` tag already polls backend + frontend health and fails on
unhealthy replicas — a green playbook run IS the smoke test. One-shot init
jobs (`kong-migrations`, `kong-config`, `db-migrations`, `keycloak-config`)
stay **Exited** in `docker compose ps` — that is correct, not a failure.

Smoke target for D3 is `https://agriconnect.site` (plus the www name above).
The remaining post-deploy product checks — auth end-to-end on the real domain
(D3), real-model chat round-trip (D4/S2b), corpus re-ingestion (D5) — are
Epic D's checklist (Related footer), not part of this doc.

### 8.1 Translation model — NLLB sidecar (DEC-25, F6)

Sesotho translation runs on a dedicated GPU sidecar, NOT vLLM (vLLM 0.30 hangs
on this box for every translation model tried, and its OpenAI API can't express
NLLB's `src_lang`/`forced_bos_token_id` anyway). One-time deploy, Adem's
terminal, inside the normal deploy window (first boot downloads ~6.6 GB):

```bash
# 1. Build + start (with the rest of the stack, or standalone):
cd ~/genie-ai-replica-itu
docker compose --profile opea --profile gpu-models up -d --build nllb-translate
docker compose --profile opea --profile gpu-models up -d backend chatqna-xeon-backend-server   # pick up NLLB_TRANSLATE_URL env

# 2. Watch the model load (health answers 503 until the load thread finishes;
#    cold start = download + load, warm start = load only):
docker compose logs -f nllb-translate        # "Model ready" is the line you want

# 3. Probes (from the box; the service is internal-only):
docker compose exec nllb-translate python -c \
  "import urllib.request; print(urllib.request.urlopen('http://localhost:9201/health', timeout=5).read())"
docker compose exec nllb-translate python -c "
import json, urllib.request
req = urllib.request.Request('http://localhost:9201/translate',
    data=json.dumps({'texts': ['How can I control aphids on my maize?'],
                     'source': 'eng_Latn', 'target': 'sot_Latn'}).encode(),
    headers={'Content-Type': 'application/json'})
print(json.load(urllib.request.urlopen(req, timeout=60)))"
# expect {"translations": ["<Sesotho text>"]} — round-trip proves FLORES codes + GPU generate

# 4. Live chat probe: browser as adem1, language Sesotho (st) → ask a question;
#    the answer bubble must arrive in Sesotho (translated_answer), and the
#    persisted history (Arango) must hold the Sesotho text. English chats are
#    byte-identical to before (zero sidecar calls).
```

Sidecar down? Chats still work: streaming shows the English answer + the
"translation unavailable" notice (F4 contract); backend `/api/translate` in
`auto` mode falls back to CPU Xenova. Rollback = `git revert` of the F6 commit
+ `docker compose --profile opea --profile gpu-models up -d` (the sidecar
disappears, the old guardrail stanza returns with the revert).

## 9. Gotchas learned the hard way

1. **Fresh Keycloak has no itu-users/F5 IdP broker** in the realm file —
   local-admin login only until the broker is added (matters only behind ITU
   SSO; D3 is the end-to-end auth pass).
2. **Knowledge base starts empty** — corpus upload + bge-m3 re-ingestion is
   owed on every fresh deploy (D5); chat works, retrieval has nothing to
   retrieve until then.
3. **`/mnt/c` files look 0777 → SSH refuses them.** Keys, `~/.ssh/config`, and
   vault files live in the Linux/WSL home, never on the Windows mount.

Historical notes from the retired runbooks that still hold: rotation
discipline (anything ever committed is burned — DEC-10) and gotchas 1 and 2
above; everything a10/vGPU/spot-era in them died with this doc
(the A10 environment itself was deleted 09-28, C1/S-4).

## 10. Troubleshooting quick table

| Symptom | Cause | Fix |
|---|---|---|
| GPU probe fails: "not supported by this driver release" | vGPU-partition box with distro drivers (NOT this box — whole GPU here); or leftover distro modules fighting a runfile | vGPU: GRID guest driver matching the host branch; leftovers: `sudo apt remove 'linux-modules-nvidia-*' && sudo depmod -a` |
| `nvidia-smi` works on host, not in containers | NVIDIA toolkit/runtime not configured | rerun `--tags install` |
| 401 during model download | HF token missing/placeholder | real `hugging_face_hub_token` in vault, re-run |
| `compose config` fails on `.env` | CSP values with `'self'` must be quoted | Ansible's template quotes them — never hand-edit `.env`; fix the var and re-render |
| Service never healthy | varied | `docker logs --tail 50 <c>`; one-shot jobs Exited = normal (section 8) |
| Browser still warns / cert not issued | certbot hasn't succeeded yet — the bootstrap self-signed cert is in place until first issuance | `docker logs --tail 50 certbot`; port 80 must be reachable from the internet; staging flag off after testing |
| `curl https://agriconnect.site/…` fails FROM the box but works from outside | hairpin NAT — looping back through its own public IP | smoke from an external machine; a local-only failure is the network path, not the stack |
| Box rebooted / came back up | nothing — recovery is automatic IF docker is enabled and services use `restart: unless-stopped` (both true after a normal install-tag run) | expect ~10 min to healthy; check `systemctl is-enabled docker` (if disabled: `sudo systemctl enable docker`); one-shot jobs Exited = normal (section 8) |
| No space left | images + models are heavy | `docker system prune -a` then re-run; state stays in volumes |
| Chat returns an empty bubble | chatqna requesting a model id vLLM isn't serving (the D4 live bug: the wrapper's stale code default) — vLLM 404s, the SSE stream closes with zero content | check chatqna's `LLM_MODEL` matches vLLM's `--served-model-name` — the D4 fix wires chatqna's `LLM_MODEL` from `VLLM_LLM_MODEL_ID` in compose |
| **Login page ignores a shipped theme edit** (old CSS persists; `/auth/resources/<hash>/…` hash frozen; `docker restart` does NOT fix it) | KC 26.7.2 prod mode serves theme CSS to browsers from a **gzip disk cache** with no freshness check: `/opt/keycloak/data/tmp/kc-gzip-cache/<hash>/login/<theme>/…css.gz` (container writable layer — survives restart; the URL hash is KC's DB migration ID, never content-derived; browsers then cache 30 days). Source-verified 10-08 | `docker exec agrivisory-app-keycloak-1 rm -rf /opt/keycloak/data/tmp/kc-gzip-cache` — zero downtime, live on the next request; then verify in a **private window** (normal browser cache lies). Restart ONLY if `theme.properties` (styles/parent) changed — that one is an in-memory boot cache. `curl` also lies (no gzip → always fresh bytes). Dev-mode previews never show this (start-dev disables the caches) |

---

Related: [`deploy/ansible/README.md`](../deploy/ansible/README.md) (full
variable/vault/preflight reference), [`docs/users.md`](users.md) (user
lifecycle on the deployed stack), [`sprint/decisions.md`](../sprint/decisions.md)
(DEC-1 cert/domain, DEC-9 granite + local mode, DEC-10 rotation),
[`deploy/ansible/inventory/rtx6000.ini`](../deploy/ansible/inventory/rtx6000.ini)
and
[`deploy/ansible/group_vars/agrivisory_rtx6000/vars.yml`](../deploy/ansible/group_vars/agrivisory_rtx6000/vars.yml)
(the actual config),
[`deploy/ansible/teardown.yml`](../deploy/ansible/teardown.yml) (removal),
[`sprint/epics/epic-d-rtx6000-install.md`](../sprint/epics/epic-d-rtx6000-install.md)
(post-deploy D checklist).
