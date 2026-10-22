# GENIE.AI "HealthBOT" — AWS Dev Deployment: Status Summary

**As of:** 2026-08-09 · **Env:** dev/demo · **Region:** us-east-1 · **Domain:** https://asante.innov8ai.com
**Related docs:** [plan](aws-dev-deployment-plan.md) · [orchestration decision](aws-orchestration-decision.md) · [options](deployment-options.md) · [Terraform usage](../deploy/terraform/README.md) · [CI/CD plan](ci-cd-plan.md)

---

## Current state (2026-08-09)

Everything from "TL;DR" downwards is the **pre-apply record from 2026-07-06**
and is kept for history. It is superseded by this section: the environment has
been applied and running since 2026-07-11 on instance `i-07ae6c8b490f41d07`
(`g6e.2xlarge`, us-east-1a).

**Application: healthy.** The ALB target is healthy, `/` and `/api/health` both
return 200 with a valid certificate, and every service is at 1/1 apart from the
one-shot jobs that legitimately finish at 0/1 (`db-migrations`, `kong-config`,
`kong-migrations`, `postgres-init`, `keycloak-config`). `dataprep` and
`reranker`, previously down, are fixed; the voice tier (`lid`, `tts-piper`,
`asr-whisper`, `voice-bridge`, `whatsapp-service`, `http-service`) was fixed on
2026-08-09 — see [CI/CD plan §6.6](ci-cd-plan.md).

**🔴 The site does not resolve by name for many users — this is the live
incident.** `asante.innov8ai.com` returns NXDOMAIN from a large share of
resolvers while the application behind it is perfectly healthy. The A-alias
record is correct; the *delegation* is not. `innov8ai.com` is delegated at the
registrar to a **mix of two different hosted zones**: three nameservers from
`Z062587699IDKD0LDB4N` (the Terraform-managed zone, the only one containing
`asante`) plus `ns-1617.awsdns-10.co.uk` from a second zone, while Z0625…'s own
`ns-701.awsdns-23.net` is missing. A resolver that picks the odd one out caches
the second zone's apex NS set and then serves NXDOMAIN persistently.

Both zones carry live company records (apex → CloudFront, `titan.email` MX,
SPF/DKIM, `www`), so this is **not** a "point it at our zone" fix. It also
cannot be fixed from this account: the domain is not registered here
(`GetDomainDetail` → "not found in account") and the second zone is not here
either. Required, registrar-side: pick the canonical zone, set the delegation to
exactly its four nameservers, add the missing `20 mx2.titan.email` to Z0625…
first if choosing it, then delete the losing zone.

Until it is fixed, reach the environment by resolving the ALB directly (its IPs
rotate, so look them up rather than hard-coding):

```bash
ALB_IP=$(dig +short healthbot-dev-alb-1532164434.us-east-1.elb.amazonaws.com | head -1)
curl --resolve "asante.innov8ai.com:443:${ALB_IP}" https://asante.innov8ai.com/api/health
```

The certificate validates normally over that path — TLS is not affected.

**CI deploys.** `deploy-app.yml` ran for the first time on 2026-08-09; all six
attempts failed, every one *after* the stack had already updated and converged.
Causes and fixes are in [CI/CD plan §6.1 and §6.6](ci-cd-plan.md) — a health
gate that could never pass, a post-deploy image assertion comparing against the
wrong SHA, and missing voice-tier model assets.

**Two config values that must not regress:**

- `vllm_max_model_len` must be **16384**. At 4096 the ~3073-token system prompt
  plus 1024 output tokens overflows by one and every chat request fails, while
  `/api/health` still returns 200. This broke the demo twice — on 2026-07-15,
  and again on 2026-08-09 when a CI redeploy regenerated the compose file from
  the old Terraform default.
- `data_volume_gb` must be **600**. Anything smaller risks running out of space
  for models, caches, and the knowledge base.
- The GPU instance carries `lifecycle { ignore_changes = [ami] }`. Without it a
  new Deep Learning AMI publication makes any `terraform apply` — even a disk
  resize — replace the running box. Upgrading the AMI now requires an explicit
  `-replace`; setting `var.gpu_ami_id` alone is silently a no-op.

---

## TL;DR (pre-apply, 2026-07-06)
Terraform + first-boot bootstrap are **code-complete and validated** for the **embedded (all-in-one)** path; the **external (managed RDS/ElastiCache)** path is code-ready behind a flag. Admin access, the S3 state bucket (`innov8ai-asante-state`), and the HF token (Secrets Manager) are all in place, and **`terraform plan` succeeds against the live account (59 resources, 0 change, 0 destroy).** **Blocked only on the GPU quota** (increase to 16 requested; AWS case still open). Multiple review passes fixed every known blocker, including two critical bugs that would have passed dry checks and then failed/destroyed the demo.

## Locked decisions
- **Orchestration:** Option 1 — **single-node Docker Swarm** now (Phases 0–2); **Option 2 (Hybrid ECS Fargate + GPU EC2) = deployment Phase 3** (drop Swarm). Approved by Andy 2026-07-04 and confirmed by Hank 2026-07-06.
- **Deployment phases:** **P0** prerequisites → **P1** all-in-one (embedded) → **P2** externalize data (managed RDS + ElastiCache) → **P3** drop Swarm → ECS Fargate + GPU EC2. Full process in [plan §2](aws-dev-deployment-plan.md).
- **Data backend flag:** start **`embedded`** (bundled postgres/redis containers, P1) → switch to **`external`** (RDS + ElastiCache, P2) later.
- **Model/instance:** Qwen2.5-3B on `g6e.2xlarge` (B1); one-var bump to Llama-3.1-8B on `g6e.4xlarge` (B2).
- **Edge:** ALB + ACM + Route 53. **State:** S3 (`innov8ai-asante-state`). **Secrets:** HF token in **Secrets Manager** (`innov8ai/asante/hf-token`, read by the instance at runtime — never in TF state); the rest TF-generated → SSM. **Code delivery:** S3 zip built from the working tree (no git on the box). **Provisioning:** Terraform → `user_data` → existing Ansible playbook. **Auto-stop:** configurable.

## What's built (`deploy/terraform/`)
- **Modules:** `network`, `secrets` (→ SSM), `data` (RDS + ElastiCache, flag-gated), `dns_tls` (ACM + Route 53), `alb`, `compute` (GPU EC2 + data EBS + IAM + `user_data`), `scheduler` (optional stop/start), plus **`artifact.tf`** (zips the working tree → S3 for the instance to pull).
- **App deploy-plumbing edits (backward-compatible — inert in embedded/on-prem):** `env.j2` (managed-DB + Redis-TLS vars), `docker-compose.yaml` (`postgres-init` `PGHOST`), `translation-service.js` (env-gated Redis TLS); Ansible `deploy.yml` (git clone/pull gated on `skip_git_sync` for S3 delivery).
- **Quality gates:** `terraform validate` + `fmt` pass; `user_data` rendered and asserted in both modes; JS syntax checked.

## Live-account checks (done via `healthbot-dev` profile)
| Check | Result |
|---|---|
| Route 53 `innov8ai.com` zone | Exists + correctly delegated → ACM will validate; no `asante` conflict — **no longer true as of 2026-08-09: the delegation is now split across two zones, see [Current state](#current-state-2026-08-09)** |
| RDS PG 15.8 / Redis 7.1 | Both available in us-east-1 |
| g6e.2xlarge/4xlarge | Available in us-east-1a (the instance AZ) + AMI filter matches a real DLAMI |
| GPU quota (G/VT) | **0** — increase to 16 requested; AWS case still open ⏳ |
| `vitaly-dev` permissions | **AdministratorAccess** granted 2026-07-06 ✓ |
| S3 state bucket `innov8ai-asante-state` | exists · us-east-1 · versioned ✓ (backend configured) |
| HF token `innov8ai/asante/hf-token` | Secrets Manager, JSON key `HF_TOKEN` ✓ |

## Blockers & bugs fixed across the review passes
1. **RDS `force_ssl=1` vs Kong/Keycloak** (external) → custom parameter group `rds.force_ssl=0`.
2. **Redis empty-password crash** under `NODE_ENV=production` (external) → ElastiCache AUTH+TLS default + non-empty password + env-gated ioredis `tls`.
3. **nginx-behind-ALB redirect loop** → ALB **HTTPS re-encrypt to nginx:443** (no app change; Keycloak already `KC_PROXY_HEADERS=xforwarded` + `KC_HOSTNAME=https://<domain>/auth`).
4. **Fragile data-volume mount** → filesystem **LABEL** + fstab-by-label + mount-if-formatted.
5. **SSM agent maybe absent** (no SSH on the box) → install/enable **first** in `user_data`.
6. **CRITICAL — mount could grab ephemeral instance store** (g6e has 450–600 GB local NVMe, wiped on stop/start) → EBS-only selection by disk model. *Would have destroyed the KB + model cache on the first auto-stop.*
7. **CRITICAL — `swarm init --advertise-addr localhost` fails** (no `ansible_host` in the generated inventory) → `user_data` now sets `ansible_host=<private IP>` via IMDS. *Would have failed the deploy at swarm init.*

> Starting in **embedded** mode sidesteps #1 and #2 entirely (they only exist in external).

## Verified vs NOT verified
- **Verified:** **`terraform plan` succeeds against the live account — 59 to add, 0 change, 0 destroy** (Phase 1 / embedded); HCL `validate`/`fmt`; `user_data` rendering (embedded + external); JS syntax; all live-account facts above.
- **NOT verified (no credentials / no `apply` yet):** an actual `terraform apply`, and the **first-boot Ansible run on the DLAMI** — the least-tested part.

## First-boot risks to watch (via SSM shell: `sudo tail -f /var/log/genieai-bootstrap.log`)
- **Ansible `install` play pins Docker 28.5 + NVIDIA toolkit** while the DLAMI already ships Docker + driver → possible conflict. Mitigation: watch and adjust, or pre-bake an AMI (Packer) so `install` is a no-op.
- **First boot is slow (~20–40 min):** apt, 13 image builds (async 300s each), ~30 GB model downloads.
- **Gemma-3 translation model is HuggingFace-gated** → the HF token must have Gemma access accepted, else translation degrades (chat via ungated Qwen is unaffected).

## To deploy — by phase (full process in [plan §2](aws-dev-deployment-plan.md))
- **Phase 0 — prerequisites:** ✅ AdministratorAccess granted · ✅ S3 state bucket (`innov8ai-asante-state`) + backend configured · ✅ HF token in Secrets Manager. ⏳ Remaining: **GPU quota** (case open) and the **admin email** (Andy).
- **Phase 1 — embedded demo (once quota clears):** set `allowed_ingress_cidrs` (and `genie_admin_email` once Andy provides it) in `terraform.tfvars`; keep `data_backend="embedded"` → `terraform init && terraform apply` → watch the bootstrap via SSM → validate `https://asante.innov8ai.com`. *(HF token read from Secrets Manager; code shipped as an S3 zip — no git token.)*
- **Phase 2 — managed data:** set `data_backend="external"` → `terraform apply` → `terraform apply -replace="module.compute.aws_instance.this"` (data EBS persists) → validate RDS/ElastiCache (check the ElastiCache TLS handshake).
- **Later — orchestration:** Option 2 (Hybrid ECS) re-platform — see the [decision doc](aws-orchestration-decision.md).
