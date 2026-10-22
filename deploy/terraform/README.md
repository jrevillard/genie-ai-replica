# GENIE.AI "HealthBOT" — AWS Dev Terraform

Terraform for the **dev / stakeholder-demo** environment (Option 1: single-node
Docker Swarm on one GPU EC2). Full context: [`docs/aws-dev-deployment-plan.md`](../../docs/aws-dev-deployment-plan.md)
and the signed-off [`docs/aws-orchestration-decision.md`](../../docs/aws-orchestration-decision.md).

## What it provisions

VPC (2 public + 2 private subnets) · ALB + ACM TLS + Route 53 record · one GPU EC2
(`g6e.2xlarge`) with a persistent data EBS volume · RDS PostgreSQL · ElastiCache
Redis · secrets in SSM Parameter Store · SSM Session Manager access (no SSH) ·
optional EventBridge auto stop/start.

Application code ships as an **S3 zip** (not a git clone): Terraform packages this
working tree via `archive_file` (see `artifact.tf`), uploads it to a private S3
bucket, and the EC2 `user_data` downloads + extracts it. The instance then mounts
the data volume at `/var/lib/docker`, pulls secrets from SSM, wires the stack to
RDS/ElastiCache, and runs the **existing Ansible playbook** (`deploy/ansible/`,
with `skip_git_sync`) to build and deploy. No git repo/token on the box, and the
exact local code (including uncommitted changes) is what deploys.

## Module layout

```
modules/network    VPC, subnets, IGW, routes, security groups
modules/secrets    random_password × 11 → SSM SecureString (+ HF & git tokens)
modules/data       RDS PostgreSQL + ElastiCache Redis
modules/dns_tls    ACM cert (DNS-validated) + Route 53 zone/records
modules/alb        ALB, target group, HTTPS(443)+HTTP(80→443) listeners, alias
modules/compute    IAM, GPU EC2, data EBS, user_data bootstrap → Ansible
modules/scheduler  optional EventBridge stop/start (var.enable_scheduler)
```

## Before you apply — checklist

1. **AWS account** — ✅ done. Use the **`healthbot-dev`** profile (= account `310997740503`);
   `vitaly-dev` has AdministratorAccess. `backend.tf` and the provider default are pinned to it.
2. **GPU quota** — ⏳ requested (16 vCPU, us-east-1; AWS case open). `apply` will fail at the
   instance launch until it clears — everything else applies fine.
3. **HuggingFace token** — ✅ in Secrets Manager (`innov8ai/asante/hf-token`, key `HF_TOKEN`);
   the instance reads it at runtime. Nothing to set (override `hf_secret_id` only if it moves).
4. **App code** — nothing to configure. `terraform apply` zips this working tree and uploads
   it to S3; the instance pulls it. Run `apply` from a checkout with the code you want deployed.
5. **Route 53 zone** — ✅ `innov8ai.com` exists + delegated; the defaults are correct.
6. **State backend** — ✅ `innov8ai-asante-state` exists and `backend.tf` is configured
   (`terraform init` already run).

## Data backend: `embedded` (start here) vs `external`

`var.data_backend` controls where PostgreSQL and Redis run:

- **`embedded`** (default) — the stack's bundled `postgres` + `redis-cache` containers
  run on the instance (all-in-one). No RDS/ElastiCache is created. Simplest, and it
  avoids the managed-DB SSL/AUTH work — **use this for the first demo.**
- **`external`** — managed **RDS PostgreSQL** + **ElastiCache Redis** are provisioned and
  the stack is pointed at them. Before switching, apply the fixes in
  `docs/aws-dev-deployment-plan.md §8`: RDS `rds.force_ssl` handling (Kong/Keycloak),
  and the Redis AUTH/TLS contract (`NODE_ENV=production` requires a non-empty
  `TRANSLATION_CACHE_PASSWORD`). Switching is `data_backend = "external"` + `apply`.

## Route 53 zone (the one external dependency)

- **`create_route53_zone = false`** (default) — use an existing hosted zone named
  `route53_zone_name` (`innov8ai.com`) already in this account. Records are added
  directly. Use this if `innov8ai.com` is in Route 53 here.
- **`create_route53_zone = true`** — create a zone for `asante.innov8ai.com`. After
  apply, read the `route53_name_servers` output and add those **NS records at the
  parent registrar** to delegate the subdomain. ACM validation completes once
  delegation propagates.

## Usage

```bash
cd deploy/terraform
cp terraform.tfvars.example terraform.tfvars   # then edit
terraform init
terraform plan
terraform apply
```

After apply:

```bash
# Watch the first boot (~20–40 min: apt, image builds, model download)
aws ssm start-session --region us-east-1 --target "$(terraform output -raw instance_id)"
sudo tail -f /var/log/genieai-bootstrap.log
# then: docker service ls
```

Open the app at the `app_url` output once the ALB target is healthy.

### State backend (already configured)

The S3 state bucket **`innov8ai-asante-state`** (us-east-1, versioned) was created by the
project owner and is wired into `backend.tf` (pinned to the `healthbot-dev` profile);
`terraform init` has been run. Nothing to bootstrap. *(For a fresh account you'd create the
bucket — note us-east-1 must omit `--create-bucket-configuration` — then `terraform init`.)*

## Known integration points (verify on first boot)

These are called out in `docs/aws-dev-deployment-plan.md §8`. The infra is done;
these app-side items should be confirmed against the running stack:

- **nginx behind the ALB** — nginx must serve HTTP on port 80 without forcing its
  own HTTPS redirect (the ALB terminates TLS). If you hit a redirect loop, this is
  why — adjust the nginx config to honor `X-Forwarded-Proto`.
- **Keycloak proxy headers** — set `KC_PROXY_HEADERS=xforwarded` /
  `KC_HOSTNAME=asante.innov8ai.com` so OIDC login builds correct `https://` URLs.
- **RDS init** — `postgres-init` creates the kong/keycloak DB users against RDS;
  confirm it succeeds (RDS master isn't a true superuser).
- **DLAMI vs Ansible** — the Deep Learning AMI already has Docker + NVIDIA; the
  playbook's `install` play may need `--skip-tags install` if it conflicts.

## The GPU instance is pinned to its AMI

`aws_instance.this` carries `lifecycle { ignore_changes = [ami] }`.

`data.aws_ami.gpu` uses `most_recent = true`, so the AMI it resolves to changes
whenever AWS publishes a new Deep Learning AMI. Without the pin, *any*
`terraform apply` after such a publication — including one that only resizes a
disk — plans `# forces replacement` and destroys the running GPU instance. That
is not hypothetical: it was caught in a volume-resize plan on 2026-08-09.

Two consequences worth knowing before you plan:

- **Setting `var.gpu_ami_id` does not upgrade a running instance.**
  `ignore_changes` suppresses config-vs-state differences on `ami` no matter
  where the new value came from, so a pinned variable alone plans "No changes"
  and leaves the box on its old AMI. A toggle variable is not an alternative —
  `lifecycle` requires a static list.
- **To actually move the instance to a new AMI**, force the replacement:

  ```bash
  terraform apply -replace=module.compute.aws_instance.this
  ```

  `ignore_changes` does not apply to a create, so the replacement boots whatever
  the config resolves to — `var.gpu_ami_id` if set, otherwise the data source's
  latest match. Pin it first if you care which. Then accept the GPU capacity
  risk on relaunch: g6e capacity is scarce, and a stop/start once left this
  environment down for ~2 hours waiting for it.

## Teardown

```bash
terraform destroy
```

RDS and ElastiCache are created with `skip_final_snapshot` / no deletion
protection (dev). The data EBS volume is deleted with the instance — snapshot it
first if you need to keep the knowledge base.

## Phase 2

When production resilience/scale is needed, migrate to **Option 2 (Hybrid ECS
Fargate + GPU EC2)** per the decision doc. The `network`, `data`, `dns_tls`,
`alb`, `secrets`, and `scheduler` modules are reused as-is; only `compute` (the
single Swarm node) is replaced by ECS services + a GPU capacity provider.
