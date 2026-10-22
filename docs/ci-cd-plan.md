# GENIE.AI — GitHub CI/CD Plan

Status: **Draft for review**
Branch: `ci/github-actions-cicd`
Owner: TBD
Repository: `github.com/Innov8AI-dev/ASante` (default branch: `asante/1.0`;
`release/2.0` is being retired)
Related docs: `deploy/terraform/README.md`, `docs/aws-dev-deployment-plan.md`,
`docs/aws-orchestration-decision.md`

---

## 0. Decision log

Decisions taken during review. Each one is reflected in the sections below.

| # | Question | Decision | Sections |
|---|---|---|---|
| 1 | Terraform stops shipping uncommitted local changes | **Accepted.** Code reaches the box only through the built-image path. | §3.1, §7.3 |
| 2 | Bootstrap/redeploy config-rendering drift | **Fix now, do not defer.** Extract the render block into a repo script both paths call. | §6.5, §7.2 |
| 3 | `archive_file` / `aws_s3_object` re-zipping on every plan | **Remove them from Terraform.** CI owns the S3 object; Terraform takes a static key. | §7.3, §6.5 |
| 4 | Are images built in CI? | **No — they stay on the instance for now.** See §3.7 for the analysis and the hybrid path. | §3.7 |
| 5 | Reuse the existing VM, never create a new one | **Hard requirement.** This forces a Terraform change that must land *first* — see §6.5. | §6.5, §9 |
| 6 | Default branch | `asante/1.0` is default; `release/2.0` is being removed. | Header, §8 |
| 7 | Deploy trigger | **Auto-deploy on push to `asante/1.0`, plus a manual button for any branch** — §3.2 option B, replacing the earlier button-only recommendation. Never provisions a machine. | §1, §3.2, §4 |

---

## 1. Goals

1. Every branch gets an automatic **build + test** (CI) on push.
2. Deployment happens **automatically on push to `asante/1.0`**, and **on demand
   from any branch** via a `workflow_dispatch` button. Both use the same in-place
   mechanism (§3.2).
3. A deploy **reuses the existing GPU EC2 instance** — **never** an instance
   replacement, never a new VM. This is a hard constraint, enforced in Terraform
   and in the deploy role's IAM permissions, not a preference.
4. Infrastructure changes go through a separate, approval-gated Terraform flow.
5. No long-lived AWS keys in GitHub — OIDC-based auth.

---

## 2. Current state (verified against the repo)

Every claim below was checked against the working tree; file:line references are
given so reviewers can confirm independently.

| Fact | Evidence |
|---|---|
| `terraform apply` **is** the deployment today | `artifact.tf:45-52` keys the S3 object by `data.archive_file.app.output_md5` |
| Every code change replaces the instance (~20–40 min bootstrap) | `modules/compute/main.tf:121` — `user_data_replace_on_change = true` |
| Images are **built on the instance**, no external registry | `deploy.yml:486-627` (`build` play) pushes to a local registry at `localhost:5000` |
| Code reaches the box as an S3 zip, not a git clone | `user_data.sh.tftpl:100-102`; `skip_git_sync: true` at `user_data.sh.tftpl:153` |
| Remote state uses native S3 locking → **Terraform ≥ 1.10** | `backend.tf:10` (`use_lockfile`) |
| `versions.tf` allows Terraform 1.5, which **cannot** run that backend | `versions.tf:3` — `required_version = ">= 1.5"` |
| `backend.tf` and `providers.tf` pin the `healthbot-dev` profile | `backend.tf:8`, `providers.tf:3` |
| Persistent data EBS survives instance replacement | ArangoDB KB, HF model cache, Docker state under `/mnt/docker-data` |
| Single shared dev environment behind an ALB | `asante.innov8ai.com`, health check `/api/health` |
| No CI exists yet | No `.github/` directory in the repo |

### 2.1 Ansible playbook facts that constrain the design

`deploy/ansible/deploy.yml` has four tags — `install`, `prepare`, `build`,
`deploy` — plus **one untagged play**:

| Lines | Play | Tag |
|---|---|---|
| 22-28 | Detect environment | **(none)** |
| 30-135 | System prep + Docker | `install` |
| 136-255 | NVIDIA Container Toolkit | `install` |
| 256-296 | Swarm init + node labeling | `install` |
| 297-335 | Local Docker registry | `install` |
| 336-458 | Project sync + directories | `prepare` |
| 459-485 | Copy SSL certificates | `prepare` |
| 486-627 | Build and push images | `build` |
| 628-765 | Generate `.env` + deploy stack | `deploy` |
| 766+ | Post-deploy verification | `deploy` |

Three consequences that directly shape the redeploy script — see §6.

---

## 3. Decision areas, options, pros and cons

### 3.1 App deployment mechanism

| Option | Description | Pros | Cons |
|---|---|---|---|
| **A. Keep Terraform-only** (status quo) | Every code deploy = `terraform apply` → new S3 key → instance replacement | No new moving parts; infra and code always consistent; clean-slate instance each deploy | 20–40 min downtime per deploy; GPU instance churn; wasteful for app-only changes; deploy tied to Terraform permissions; violates goal #3 |
| **B. In-place redeploy via SSM RunCommand** ⭐ | CI zips the branch → uploads to S3 → SSM runs a redeploy script on the existing instance (extract + re-run Ansible with install skipped) | No instance replacement (goal #3); minutes not tens of minutes (EBS-cached Docker layers + HF models); works from any branch; no SSH needed (SSM only); rollback = redeploy an older ref | Two code paths (bootstrap vs redeploy) to keep in sync; drift possible if the redeploy script diverges from `user_data`; needs a small Terraform change (stable S3 key + `ignore_changes`); **requires the three playbook fixes in §6** |
| **C. Prebuilt images in GHCR** | Build images in GitHub Actions, push to `ghcr.io`, instance pulls instead of building | Fast deploys; image scanning in CI; reproducible artifacts; foundation for Phase 2 (ECS); removes the on-box `git_sha` rebuild heuristic entirely; shrinks SSM output to a pull log | Largest change: the `build` play must become pull-based; loses the warm Docker layer cache on the persistent EBS; the instance must pull multi-GB images over the network each deploy; models must stay out of images; the CUDA-based image likely exceeds a standard runner's disk (§3.7) |
| **D. SSM + `docker stack deploy` only** | Like B but skip Ansible; script re-runs the stack deploy directly | Fastest possible redeploy | Bypasses playbook logic (`.env` rendering, Keycloak, nginx, registry); high drift risk; fragile |

**Recommendation: Option B now; C later** when moving to ECS (the Terraform
README's Phase 2 already anticipates this).

### 3.2 What triggers what

| Option | Description | Pros | Cons |
|---|---|---|---|
| A. CI on every branch, deploy by button only | `push: branches: ["**"]` runs build/test; deploy is `workflow_dispatch` only | Zero surprise deploys; shared instance protected | Someone must press the button every time; the dev environment drifts behind `asante/1.0` |
| **B. Auto-deploy `asante/1.0`, button from any branch** ⭐ | Push to `asante/1.0` deploys automatically; `workflow_dispatch` deploys any other branch on demand | The dev environment always reflects the mainline; no manual step for normal work; feature branches still reachable on request | A merge redeploys the shared box, so a demo can be interrupted mid-session; two entry points to keep behaving identically |
| C. Auto-deploy every branch push | Full CD | Always fresh | Deploy-queue contention on one instance; a feature branch would clobber mainline constantly |

**Decision: Option B** (chosen over the earlier Option A recommendation).

- **Automatic:** push to `asante/1.0` → deploy.
- **Manual:** `workflow_dispatch` → deploy the selected branch, from any branch.
- **Both paths run the identical in-place redeploy.** There is exactly one deploy
  mechanism; the trigger is the only difference.

**Hard constraint: never request a new machine.** Neither trigger may replace,
recreate, or launch an EC2 instance. Deploys are strictly in-place against the
existing box via SSM (§3.1 option B, §4.1). This is what
`user_data_replace_on_change = false` (§6.5, `modules/compute/main.tf`) enforces on
the Terraform side, and why the deploy workflow is given **no**
`ec2:RunInstances` / `ec2:TerminateInstances` permission (§3.3) — the pipeline
should be structurally incapable of provisioning, not merely disinclined to.

Accepted risk, recorded rather than mitigated away: because `asante/1.0` deploys
automatically onto the single shared GPU box, a merge can interrupt a live demo.
Two things keep that bounded, neither of which prevents it:

- `concurrency: { group: deploy-dev, cancel-in-progress: false }` serializes
  deploys, so two never interleave, and a cancelled workflow cannot abandon a
  half-applied SSM command mid-flight.
- `paths-ignore` for docs-only changes, so prose edits do not trigger a GPU image
  rebuild.

The real fix is a second instance so mainline and demos stop sharing one box
(§8.3). Until then this is a deliberate trade, not an oversight.

### 3.3 AWS authentication from GitHub Actions

| Option | Description | Pros | Cons |
|---|---|---|---|
| **A. GitHub OIDC role** ⭐ | IAM role with a trust policy on the repo's OIDC claims | No stored secrets; short-lived credentials; per-environment scoping via the `environment` claim | One-time IAM setup in account `310997740503` |
| B. IAM user access keys in secrets | Classic `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | Trivial setup | Long-lived credentials; rotation burden; leak risk; discouraged by AWS |

**Recommendation: Option A.** Trust policy keyed to
`repo:Innov8AI-dev/ASante:environment:dev`.

Two corrections to the obvious version of this design:

- The subject string must use the **real** repo name and casing —
  `Innov8AI-dev/ASante`, not `<org>/genie-ai`. OIDC `sub` matching is
  case-sensitive and does not support wildcards in the middle of a segment.
- Scoping to `:environment:dev` is **not by itself a security control**. The
  claim is only meaningful if the GitHub Environment carries protection rules.
  With required reviewers off (§3.4), the effective control is *repo write
  access*. That is an acceptable posture for a shared dev box — but it should
  be stated honestly rather than presented as a gate.

### 3.4 Guarding the deploy button (shared instance safety)

| Option | Description | Pros | Cons |
|---|---|---|---|
| A. Nothing — anyone with write can deploy | | Zero friction | Accidental overwrite of a demo mid-meeting |
| **B. GitHub Environment `dev` + concurrency group** ⭐ | `concurrency: deploy-dev` with `cancel-in-progress: false` serializes deploys; environment gives an audit trail; optional required reviewer | Cheap; prevents parallel deploys; audit trail in the environment log | Does not prevent a deploy from interrupting a demo |
| C. Required reviewers (hard gate) | Every deploy needs a second person | Maximum safety | Incompatible with auto-deploy on `asante/1.0` — it would block every merge |

**Recommendation: Option B**, with required reviewers OFF for `dev` initially
(turn them on for staging/production later).

**A typed `DEPLOY` confirmation is deliberately *not* used.** An earlier draft
proposed one for the manual button. Once push to `asante/1.0` deploys
automatically (§3.2 decision), a confirmation prompt on the manual path guards
nothing — the same box is redeployed without any prompt on every merge. Keeping it
would be friction that buys no safety and would imply protection that does not
exist. The honest control surface is: who can merge to `asante/1.0`, and who has
`workflow_dispatch` (i.e. repo write).

Two implementation details that are easy to get wrong:

- `cancel-in-progress` **must be `false`**. The default cancels the older run,
  and cancelling the workflow does *not* stop the SSM command already executing
  on the instance — you would get a half-applied deploy with nobody watching it.
- Deployment protection rules on **private** repos require GitHub Team or
  Enterprise. Confirm the org's plan before designing around reviewer gates.

### 3.5 Terraform (infra) pipeline

| Option | Description | Pros | Cons |
|---|---|---|---|
| A. Keep Terraform manual (laptop only) | Status quo | Nothing to build | No plan review on PRs; profile pinning stays; "works on my machine" applies |
| **B. Plan on PR, approval-gated apply** ⭐ | PR touching `deploy/terraform/**` → fmt/validate/plan + PR comment; merge → plan → environment approval → apply | Reviewable plans; deterministic clean-checkout applies; state lock respected via `concurrency` | Requires small edits: profile override for CI, gitignore for plan artifacts |
| C. Auto-apply on merge, no approval | | Fast | Infra changes (including instance replacement) with no human gate — dangerous |

**Recommendation: Option B.** `terraform destroy` is **never** automated.

### 3.6 Profile override mechanism for CI

| Option | Description | Pros | Cons |
|---|---|---|---|
| A. `terraform init -backend-config="profile="` | Pass an empty value to blank the pinned profile | No file changes | Relies on the S3 backend treating `""` as unset; undocumented and version-fragile |
| **B. Partial backend config** ⭐ | Remove `profile` from `backend.tf`; keep it in a gitignored `backend.hcl` for laptops; CI runs bare `terraform init` | Standard, explicit, no empty-string trickery; CI picks up OIDC credentials naturally | Local users must pass `-backend-config=backend.hcl` (one README line) |

For the provider (not the backend), `providers.tf` should use
`profile = var.aws_profile != "" ? var.aws_profile : null`, and
`variables.tf:13` needs a `""` default so CI works unattended.

**Recommendation: Option B** for the backend, plus the ternary for the provider.

### 3.7 Where are images built? (answers decision #4)

**No — images are not built in CI in this design. They continue to be built on
the instance by the `build` play.** The reasoning, and the conditions under
which that should change:

The playbook builds **13 images** (`deploy.yml`, `genieai_images`):

| Group | Images | Base | CI-buildable? |
|---|---|---|---|
| App / infra (9) | frontend, backend, document-repository, nginx, kong-config, postgres-init, keycloak, keycloak-config, db-migrations | Node / nginx / Keycloak / Postgres | **Yes**, comfortably |
| OPEA, slim (3) | chatqna-server, retriever-arango, reranker | `python:3.10-slim` / `python:3.11-slim` | Probably — depends on upstream deps |
| OPEA, CUDA (1) | dataprep-arango | `nvidia/cuda:12.1.1-cudnn8-runtime-ubuntu22.04` | **Doubtful** on a standard runner |

Three reasons to keep builds on the box for now:

1. **Disk.** A standard GitHub-hosted Linux runner has roughly 14 GB of free
   SSD. The CUDA runtime base alone is several GB before any Python
   dependencies. `dataprep-arango` is the likely casualty; it would need a
   larger runner or a self-hosted one.
2. **The layer cache is already warm.** Docker state lives on the persistent
   EBS volume that survives instance replacement, so incremental rebuilds on
   the box are fast. Moving to CI trades a warm local cache for a cold remote
   build plus a multi-GB pull on every deploy — for a single box on one
   network, that is likely *slower*, not faster.
3. **Unknown dependency weight.** The four OPEA images clone upstream
   `GenAIComps` at build time and install from there — there are no
   `requirements.txt` files in this repo for them. Their real size cannot be
   determined without building, so sizing a runner is guesswork today.

**Recommended hybrid, when this becomes worth doing:** build the **9 app/infra
images** in CI and push them to GHCR, and leave the **4 OPEA images** on the
box. That captures most of the benefit (the app images are the ones that
actually change per commit) at a fraction of the risk. It also makes the
`git_sha` rebuild heuristic (§6.1) irrelevant for the images that matter.

**Consequence for §8.1:** because builds stay on the instance, the full build
log still streams back through SSM, so the output-truncation mitigation is
required, not optional.

### 3.8 Security scanning (phase-in)

| Check | Tool | When |
|---|---|---|
| Dependency audit | `npm audit --audit-level=high` (per component) | Phase 5 |
| Static analysis | CodeQL (JavaScript **and** Python) | Phase 5 |
| Secret scanning | Gitleaks on PRs | Phase 5 |
| Terraform security | `tfsec` or `checkov` | Phase 5 |
| Image scanning | Trivy | Only with Option C (GHCR) — images currently never leave the box |

Python is not optional here: `genie-ai-overlay/` is the entire AI layer and
CLAUDE.md mandates `ruff`. CodeQL must cover both languages.

---

## 4. Chosen architecture (summary)

```text
Push to ANY branch
  └── ci.yml: per-component npm ci → eslint → prettier check → jest
              → frontend build → ruff check + ruff format --check

Push to asante/1.0            (automatic — §3.2 option B)
  │   paths-ignore: docs/**, **/*.md
  └──┐
     │  same job, same mechanism — the trigger is the only difference
Deploy button (workflow_dispatch, any branch selected in UI)
  └──┴── deploy-app.yml:
        concurrency: deploy-dev, cancel-in-progress: false
        NO ec2:RunInstances — structurally cannot provision a machine
        checkout ref → zip (excludes list moved out of artifact.tf)
        → S3: genie-ai-<sha>.zip + stable genie-ai.zip   [CI owns these objects]
        → SSM RunCommand on the EXISTING instance:
             deploy/scripts/redeploy.sh
               extract → git commit → render-config.sh → registry check
               → ansible-playbook --skip-tags install
        → poll SSM result → smoke test /api/health
        → assert each deployed image matches its own entry in the
          build plan (NOT the CI sha — see §6.1)

PR / merge touching deploy/terraform/**
  └── terraform.yml: fmt → init → validate → plan
        → [merge only] environment approval → apply → smoke test

Post-deploy (separate job, NOT in ci.yml)
  └── e2e.yml: Playwright against https://asante.innov8ai.com
```

Division of responsibility after this change:

| Concern | Owner |
|---|---|
| VPC/ALB/EC2/RDS/DNS/secrets infra | Terraform (`terraform.yml`) |
| Artifact bucket | Terraform |
| Artifact **object** | CI (`deploy-app.yml`) — decision #3 |
| Application code on the instance | Deploy button (`deploy-app.yml`) |
| Ansible config rendering | `deploy/scripts/render-config.sh` in the repo — decision #2 |
| Fresh instance bootstrap | `user_data` reading the **static** S3 key (= last deployed code) |

Container images are built **on the instance**, not in CI — see §3.7.

### 4.1 How the SSM deploy connection works

**Nothing connects *to* the instance.** This is the part that makes the design
work without SSH, a bastion, or an inbound port. The SSM Agent running on the
box makes *outbound* HTTPS long-polls to the regional SSM endpoints and waits
for work. GitHub Actions never touches the instance — it hands a command to the
**SSM service**, and the agent picks it up on its next poll.

```text
GitHub Actions runner                AWS                        EC2 instance
─────────────────────                ───                        ────────────
OIDC token ──────────────► sts:AssumeRoleWithWebIdentity
                                │
aws ssm send-command ───────────┼──► SSM service
  --document AWS-RunShellScript │      (command queued)
  --instance-ids i-xxxx         │            ▲
                                │            │  outbound HTTPS :443
                                │            │  (agent long-poll — NO inbound)
                                │            └────────────── ssm-agent
poll get-command-invocation ◄───┘                                 │
  until Status != InProgress                              runs as root:
                                                    deploy/scripts/redeploy.sh
```

#### Already in place (verified in this repo)

| Requirement | Status | Evidence |
|---|---|---|
| `AmazonSSMManagedInstanceCore` on the instance role | **Present** | `modules/compute/main.tf:21-24` |
| Instance profile attached | **Present** | `modules/compute/main.tf:81` |
| Outbound 443 to SSM endpoints | **Present** | EC2 SG egress `-1` to `0.0.0.0/0`; public subnet + `associate_public_ip_address = true` (`compute/main.tf:84`) |
| SSM Agent on the AMI | Preinstalled on Ubuntu 22.04 DLAMI | The comment at `compute/main.tf:20` ("Session Manager — no SSH / port 22") indicates SSM shell access is already in use |

So the instance side needs **no changes**. This is the single cheapest part of
the whole plan — the team already set it up for SSH-free shell access.

#### What must be added (GitHub OIDC role)

```
ssm:SendCommand              on the instance ARN *and* on
                             arn:aws:ssm:<region>::document/AWS-RunShellScript
ssm:GetCommandInvocation     (poll for completion)
ssm:ListCommandInvocations   (optional, for richer status)
ssm:DescribeInstanceInformation  (pre-flight agent check)
ec2:DescribeInstances        (resolve instance ID, check power state)
s3:PutObject                 on the artifacts bucket only
```

`ssm:SendCommand` is the easy one to get wrong: it authorises against **both**
the instance and the document, so a policy naming only the instance ARN fails.

**Deliberately absent, per the §3.2 hard constraint:** `ec2:RunInstances`,
`ec2:TerminateInstances`, `ec2:CreateTags`, and any Terraform apply rights. The
deploy role must be *structurally* incapable of provisioning or replacing a
machine — a bug, a bad merge, or a compromised workflow then cannot cost a GPU
instance. Terraform applies use a **separate** role (§3.5), so the two
capabilities never sit in the same credential.

#### Gotchas specific to this deployment

1. **The instance must be running.** `enable_scheduler = false` in the current
   dev `terraform.tfvars`, so this is dormant today — but the module's defaults
   stop the box at 19:00 and start it 08:00 Mon–Fri, and the local tfvars carry
   `cron(0 0 ? * * *)` / `cron(0 6 ? * MON-FRI *)`. If the scheduler is ever
   enabled, a deploy in the off-window fails with an unhelpful error. The
   workflow should `DescribeInstances` first and either start-and-wait or fail
   with a clear message.
2. **Running ≠ reachable.** Check `DescribeInstanceInformation` for
   `PingStatus == Online` before sending. A box whose agent is wedged accepts
   nothing and simply times out.
3. **`aws ssm wait command-executed` is unusable here.** Its default waiter is
   about 20 attempts at 5-second intervals — roughly 100 seconds, against a
   build that can run for tens of minutes. Write an explicit polling loop on
   `get-command-invocation` instead.
4. **Two different timeouts, often confused.** `--timeout-seconds` on
   `send-command` is only how long SSM waits for the *agent to pick the command
   up*. How long the script may *run* is the document's `executionTimeout`
   parameter, which defaults to 3600 s. A cold multi-image OPEA build can
   approach that — set it explicitly (max 172800 s).
5. **Minimal root environment.** RunCommand executes as `root` with a sparse
   environment — no `HOME`, a restricted `PATH`, and an arbitrary working
   directory. Ansible fails or misbehaves without `HOME`. `redeploy.sh` must set
   `HOME=/root`, export a known `PATH`, and `cd` to an absolute path rather than
   assuming anything.
6. **Check both status fields.** Treat the run as successful only when
   `Status == Success` *and* `ResponseCode == 0`.
7. **Output truncation** — see §8.1; `GetCommandInvocation` returns only the
   tail of the log, so send full output to S3.

#### Why RunCommand rather than a Session Manager session

RunCommand is asynchronous, non-interactive, and produces a command ID with a
retained status and output — auditable and easy to poll from a workflow. Driving
an interactive `start-session` from CI would need the Session Manager plugin,
pseudo-terminal handling, and manual exit-code scraping.

---

## 5. CI content — what the repo actually supports

The root `package.json` has **no `workspaces` key**, so a root `npm ci` installs
only `@playwright/test`, `archiver`, and `dotenv`. CI must install per component.

| Component | Deployed? | `lint` | `format:check` | `test` | `build` / other |
|---|---|---|---|---|---|
| `components/genie-ai-frontend-v2` | **YES** | **none** | **none** | none | `vite build`, **`type-check` (vue-tsc)** |
| `components/gov-chat-frontend` | **no** | yes | yes | `jest --verbose` (7 files) | `vue-cli-service build` |
| `components/gov-chat-backend` | yes | yes | yes | `jest` (8 files) | — |
| `components/document-repository` | yes | yes | yes | `jest` (8 files) | — |
| `components/shared/lib` | lib | yes | yes | none | — |
| `genie-ai-overlay/` (Python) | yes | `ruff check` | `ruff format --check` | — | — |
| `mobile/genie_ai_mobile` (Dart) | separate | `flutter analyze` | `dart format --check` | — | optional |

**The root lint scripts cover the wrong frontend.** `deploy.yml:495-496` and
`docker-compose.yaml:274` both build **`components/genie-ai-frontend-v2`** — that
is the UI that ships. The root `package.json` lint/format chain targets
`gov-chat-frontend` and never touches `genie-ai-frontend-v2`. So today the
deployed frontend has **no lint gate at all**, while a non-deployed one is fully
linted. CI must at minimum run `type-check` and `build` for
`genie-ai-frontend-v2`; adding an eslint config there is a follow-up.

Notes:

- **Correction:** `genie-ai-frontend-v2` *is* TypeScript and *does* have a
  `type-check` script (`vue-tsc --noEmit`). An earlier draft of this document
  said the repo was plain JavaScript with no typecheck step — that is true of
  the older components but wrong for the one that ships. Include `type-check`.
- There is no root `test` or `build` script; drive them per component.
- **Playwright must not run in `ci.yml`.** `playwright.config.js` sets
  `baseURL: 'https://localhost'` and `docs/e2e-tests/README.md` requires a
  manual Phase 0 against a live full stack. These tests cannot pass on a bare
  runner. Run them post-deploy against the real domain instead.
- Dart/Flutter checks require a Flutter toolchain on the runner; make this job
  conditional on `mobile/**` changes to keep CI fast.

### 5.1 Current test state — `ci.yml` would be red on day one

Measured by running the suites locally (`gov-chat-backend`, the only component
with dependencies installed): **167 tests, 162 pass, 5 fail, 2 suites failing.**

| Failure | Cause | Real in CI? |
|---|---|---|
| `swagger-config.test.js` — suite fails to run, `Cannot find module 'socket.io'` | `socket.io ^4.8.1` is declared in `package.json` but was absent from the **lockfile** — see §5.2 | **Was worse than reported.** An earlier draft said "a clean `npm ci` installs it"; that was wrong — `npm ci` *failed outright*. Fixed by the lockfile resync in §5.2. |
| `authController.test.js` — 5 × `TypeError: authController.logout is not a function` | Not a harness bug. See §5.4 — the test specifies a **different logout implementation** than the one in the code. | **Yes** — fails on any machine, and needs a product decision. |

So a fresh `npm ci` clears one suite; the `authController` logout tests fail
regardless, and cannot be fixed mechanically.

### 5.2 Lockfile drift — `npm ci` could not run at all (fixed)

The largest Phase 1 blocker was not a lint rule. `npm ci` — the correct CI
install command, and the one that refuses to paper over drift — **failed in two
of five components** because `package-lock.json` was out of sync with
`package.json`:

| Component | Symptom |
|---|---|
| `components/gov-chat-backend` | `Invalid: lock file's eslint@8.57.1 does not satisfy eslint@10.8.0` (plus `@eslint/js`, `globals`) — package.json was bumped to ESLint 10, the lockfile never followed |
| `components/document-repository` | `Missing: jsonwebtoken@9.0.3 from lock file` (plus `jws`, `lodash.includes`) |

Resolved with `npm install --package-lock-only` in both, which respects the
existing semver ranges and rewrites only the lockfile. All `resolved` URLs were
verified to point at `registry.npmjs.org` (not a private mirror), and all four
flat `eslint.config.js` files already support ESLint 10, so the 8→10 bump is
safe.

**This was masking real results.** `document-repository` reported *25 failed /
9 passed* before the fix and **117 passed / 117 total** after — every one of
those failures was the broken install, not the code.

Two consequences worth noting:

- `components/gov-chat-frontend` still cannot install: `ERESOLVE`, because the
  lockfile pins `eslint-plugin-vue@9.33.0` while `package.json` wants `^10.8.0`
  (needing `vue-eslint-parser@^10.3.0`). Left unfixed on purpose — this
  component is not deployed and may be legacy (§5). It is excluded from CI with
  a comment rather than silently skipped.
- `gov-chat-backend`'s jest run now **crashes before printing a summary**. This
  is newly *exposed*, not introduced: with `socket.io` missing,
  `swagger-config.test.js` died early; now it runs, boots the real app via
  `index.js` → `startApp`, and throws during teardown. Six suites pass,
  `authController` fails (§5.4), and the crash suppresses the summary line.
  Worth a follow-up — a unit test should not be booting the application.

### 5.3 Measured gate status (basis for the CI ratchet)

| Check | Status | In `ci.yml` |
|---|---|---|
| `genie-ai-frontend-v2` build (`vite build`) | **passes** | blocking |
| `document-repository` lint | **passes** | blocking |
| `document-repository` test (117/117) | **passes** | blocking |
| `shared/lib` lint | **passes** | blocking |
| `gov-chat-backend` install | **passes** (after §5.2) | blocking |
| `gov-chat-backend` lint | 42 errors | advisory |
| `gov-chat-backend` test | §5.4 + teardown crash | advisory |
| `genie-ai-frontend-v2` type-check | fails — `src/stores/chat.ts`, `src/stores/chatHistory.ts` | advisory |
| `ruff check` | **381 errors** across 33 files | advisory |
| `ruff format --check` | 19 of 41 files would change | advisory |
| `format:check` (all JS components) | fails — Prettier drift | advisory |
| `gov-chat-frontend` | cannot install (ERESOLVE) | excluded |

`ci.yml` splits these into a blocking `verify` job and a non-blocking
`advisory` job, each advisory entry carrying its reason inline. The intent is a
ratchet: CI is meaningful on day one rather than uniformly red and ignored, and
checks graduate to blocking as debt clears. Making everything blocking now would
produce a permanently red pipeline that people learn to route around.

### 5.4 `authController.logout` — the test and the code disagree on behaviour

The surface error looks like a harness mistake, but the two describe genuinely
different functions:

| | Current code (`controllers/authController.js:123-139`) | Test expectation (`__tests__/authController.test.js:56-142`) |
|---|---|---|
| User identity | `req.user.userId` | `req.user.iss_sub` (Keycloak OIDC subject) |
| Session cleanup | none — delegates to `authService.logout(userId, token)` | `session-service.getUserSessions(iss_sub, { legacyKey, activeOnly: true })` then `endSession()` per session |
| Audit logging | plain `logger.info` string | structured JSON — `event`, ISO `timestamp`, `userId`, `issuer` |
| Failure semantics | 400 if no userId; 500 on error | **fail-open** — always `{ success: true, message: 'Logged out successfully' }`, `logger.warn` on cleanup failure |
| Missing user | 400 | audit log with `userId: 'unknown'`, still success |

Two facts show the test is not fantasy:

- The session-service API it calls **exists with exactly that signature** —
  `getUserSessions(userId, { legacyKey, activeOnly })` at
  `services/session-service.js:248`, `endSession(sessionId)` at line 174, and
  the module exports a singleton instance (line 442).
- The test's mock `req.user` (`_key`, `iss_sub`, `iss`, `name`, `email`) is
  precisely the shape the **Keycloak** middleware attaches
  (`middleware/keycloak-auth-middleware.js:122`, the ArangoDB user document) —
  not the legacy JWT shape the current code reads.

**Interpretation:** the test documents the Keycloak-era logout; the controller
still holds the legacy-JWT implementation. `/auth/logout` is currently wired to
the *legacy* middleware (`routes/auth-routes.js:185`), so this is an unfinished
seam in the auth migration, not a broken test.

**Possible live bug, worth checking independently of CI:**
`auth-middleware.js:62` derives its id as
`decoded._key || decoded.id || decoded._id || decoded.userId` — treating
`userId` as the *last* fallback — and then sets `req.user = { ...decoded, role,
_key }`. The controller reads `req.user.userId`, which only exists if the JWT
literally carries a `userId` claim. For tokens that identify users by `_key` or
`id`, logout would return **400 "User ID is required"**. This needs runtime
confirmation before being treated as fact.

**Decision required (app-domain, not infra):**

- **(a) Rewrite the tests to match the code** — fastest to green, but discards a
  specification for session cleanup and structured audit logging. For a
  public-sector system, a logout audit record carrying issuer and timestamp is
  plausibly a compliance requirement, so deleting it silently is the wrong
  default.
- **(b) Implement the tested behaviour** — makes the tests meaningful and likely
  fixes the 400 bug, but changes production authentication behaviour and the
  endpoint's response contract (currently returns whatever `authService.logout`
  returns; the test mandates a fixed body). Needs a reviewer who owns auth.

**Recommendation: (b), but as its own reviewed change — not folded into the
CI work.** To keep Phase 1 moving, land `ci.yml` with this one suite explicitly
quarantined by path (with a TODO referencing this section) rather than making
the whole jest step non-blocking. A named quarantine keeps a real gate on the
other 162 tests; a blanket `continue-on-error` would hide future regressions
everywhere.

The other components' suites were not executed — their dependencies are not
installed locally, so their true state is unknown until CI runs them once.

---

## 6. Blocking prerequisites — the redeploy path does not work as-is

These are **not** hypotheticals; each was traced through the playbook. All of
them must be fixed before `deploy-app.yml` can work.

§6.1–6.5 were identified by reading the playbook before the first run. **§6.6
was not** — it only surfaced once the workflow ran for real on 2026-08-09, when
six consecutive deploys failed. Anything below that predicts behaviour is
therefore worth re-checking against an actual run.

### 6.1 The build play skips everything unless HEAD changes (silent no-op)

`deploy.yml:573-602`:

```yaml
- name: Get current git commit SHA
  ansible.builtin.command: git rev-parse HEAD
  register: git_sha
...
- name: Build image (changed only)
  when: >
    item.skipped is not defined
    and (item.rc != 0 or item.stdout | trim != git_sha.stdout)
```

Images carry a `git_sha` label (`deploy.yml:597`) and are rebuilt only when the
label differs from the current HEAD. `user_data.sh.tftpl:106-110` creates that
commit **only** `if [ ! -d .git ]`. On a redeploy `.git` already exists, so HEAD
never moves, no image is rebuilt, and `docker stack deploy` re-resolves the same
digests.

**Why this is the most dangerous item:** the failure is silent in every
direction. The SSM command exits 0, the workflow goes green, and `/api/health`
passes — because the *old* application is still running perfectly.

**Fix:** `redeploy.sh` must create a new commit after extraction:

```bash
git -c user.email=deploy@local -c user.name=deploy add -A
git -c user.email=deploy@local -c user.name=deploy commit -qm "ci ${CI_SHA}" || true
```

**Also required:** a post-deploy assertion, because `/api/health` provably
cannot distinguish "deployed" from "deployed nothing".

> **Superseded — read this before implementing the assertion.** The plan
> originally called for comparing each running container's `git_sha` label to
> the CI sha. That is now wrong and will fail every deploy.
>
> Since `5aaf4dc5c` the build play no longer labels images with a repo-wide
> `git rev-parse HEAD`. Each image is labelled with
> `git log -1 -- <that image's own watch paths>`, so that an unchanged image
> keeps its existing digest and Swarm leaves the service running instead of
> restarting the whole stack for a one-line frontend change. Consequently an
> unchanged image *deliberately* carries an older SHA, and the redeploy commit
> is `--allow-empty`, which touches no path at all — so on a no-op redeploy
> **every** image would look stale under a global comparison.
>
> This was not theoretical: the global assertion shipped in `a4065edc8`, the
> per-image labelling landed two days later, and the two were never reconciled.
>
> **What is implemented instead:** the build play writes
> `{registry_tag: sha}` to `/var/lib/genieai/build-plan.json`, and
> `redeploy.sh` step 7 compares each locally-built image against *its own*
> expected SHA. `redeploy.sh` cannot recompute those SHAs itself without
> duplicating the image/watch-path table from the playbook, which would drift.
> The file is written outside `deploy_dir` because `redeploy.sh` runs
> `git add -A` over that tree.

### 6.2 `--skip-tags install` leaves `swarm_registry_url` undefined (hard failure)

`swarm_registry_url` is set by `set_fact` in only two places:
`deploy.yml:304` (inside the **`install`**-tagged registry play) and
`deploy.yml:659` (inside the `deploy` play). The **`build`** play consumes it at
`deploy.yml:583`, `614`, and `622` — between those two definitions.

`ansible.cfg` sets no `fact_caching`, so facts do not survive across runs. With
`--skip-tags install`, line 304 never executes and the build play fails with
`AnsibleUndefinedVariable`.

**Fix (preferred):** add the default to `deploy/ansible/group_vars/all.yml`
next to the existing `registry_port: "5000"` (line 38), which also removes the
duplicated `set_fact` at 304 and 659:

```yaml
swarm_registry_url: "localhost:{{ registry_port | default('5000') }}"
```

**Fix (workaround):** pass `-e swarm_registry_url=localhost:5000` from
`redeploy.sh`.

Related: skipping `install` also skips the registry container itself
(`deploy.yml:311-335`). It normally survives via `restart_policy:
unless-stopped`, but `redeploy.sh` should verify `http://localhost:5000/v2/_catalog`
responds before building rather than failing halfway through.

### 6.3 `vars_prompt` will hang a non-interactive SSM session

`deploy.yml:339-345` prompts for `git_username` and `git_token`. This block
lives in the **`prepare`** play, so it still executes under
`--skip-tags install`. `user_data.sh.tftpl:197-198` satisfies it with
`-e "git_username=s3 git_token=s3"`.

`redeploy.sh` **must** pass the same extra vars, or the playbook blocks on stdin
until the SSM command times out.

### 6.4 Use `--skip-tags install`, not `--tags prepare,build,deploy`

These are **not** equivalent. The first play, *Detect environment*
(`deploy.yml:22-28`), is untagged. Ansible skips untagged plays when `--tags` is
supplied, so the `--tags` form would silently drop it. Keep `--skip-tags`.

### 6.5 Decisions #2 and #3 will destroy the GPU instance unless a flag flips first

This is the most important sequencing constraint in the plan, and it is created
by the decisions themselves rather than by any pre-existing defect.

`modules/compute/main.tf:121` currently reads:

```hcl
# Re-run the bootstrap when user_data changes (e.g. this fix) — forces instance replacement.
user_data_replace_on_change = true
```

**Any** change to the rendered `user_data` therefore destroys and recreates the
GPU instance. Both agreed decisions change it:

- **Decision #2** (extract the render block) edits `user_data.sh.tftpl`
  directly — the rendered script changes.
- **Decision #3** (CI owns the S3 object) changes `app_s3_key` from the
  md5-keyed name to the static `genie-ai.zip`, and that key is interpolated
  into `user_data` at `user_data.sh.tftpl:100`.

Applied naively, either one replaces the box — the exact outcome decision #5
forbids, and a 20–40 minute rebuild of a machine that may be mid-demo.

**Required order of operations:**

1. Set `user_data_replace_on_change = false` (and rewrite the now-misleading
   comment on line 120).
2. Only then land the `user_data.sh.tftpl` and `app_s3_key` changes.
3. Before applying, **read the plan output** and confirm it says
   `~ update in-place` and not `-/+ must be replaced`. `aws_instance.user_data`
   updates in place; it simply does not take effect until the next boot.

Both changes may go in a single apply — Terraform evaluates the new flag value
in the same plan — but the plan must be inspected, not assumed. This is a good
first exercise for the gated `terraform.yml` flow (§3.5).

**The payoff:** after decisions #2 and #3, `user_data` no longer contains the
artifact key and no longer contains the config-rendering logic. It becomes a
thin, near-static shim — fetch the zip, call `render-config.sh`, run the
playbook. Changing how config is rendered stops requiring a `user_data` change
at all. **Extracting the render block is what makes "never replace the VM"
durable**, rather than a property that holds only until the next edit.

### 6.6 The post-deploy health gate could never pass (found by running it)

All six CI deploys on 2026-08-09 failed — every one of them roughly 15 minutes
*after* `docker stack deploy` had already updated a stack that then converged
healthily. The deploy worked; the verification did not.

`deploy.yml` "Verify all running services are healthy" exempted five one-shot
jobs and then failed on anything reporting `0/`. Three services can never
satisfy that:

| Service | Why it was at 0/1 |
|---|---|
| `tts-piper` | Bind-mounts `${DATA_DIR}/piper-voices`, which no task created. Swarm **rejected** the task outright — it never started a container. |
| `lid` | Loads `/models/lid.bin` from a named volume that nothing ever populated. Neither the image nor the repo ships the model. |
| `http-service` | `AUTH_SERVICE_PASSWORD` was never emitted by `env.j2`, so compose resolved it empty and the container exited on boot. |

So the gate burned its full 30 × 30 s retry budget and failed on a healthy
stack. Because the failure lands *after* the stack deploy, the symptom is the
worst kind: a red pipeline over a deploy that actually worked, inviting an
unnecessary re-run or rollback.

**Fixes, all landed:**

- Exemptions moved out of the inline `reject()` chain into `deploy_health_exempt`
  (`group_vars/all.yml`), documented, and now covering only the one-shot jobs
  plus `http-service`.
- The `prepare` play downloads the Piper voices and the LID model
  (`force: false`, so a redeploy re-checks rather than re-pulling ~1.8 GB).
  **Use `facebook/fasttext-language-identification`, not `lid.176`** — chatqna
  and the backend both parse the label as ISO 639-3, which `lid.176`'s
  two-letter codes never match. It is CC-BY-NC-4.0.
- `env.j2` emits `AUTH_SERVICE_USERNAME`/`AUTH_SERVICE_PASSWORD`. The account is
  **not** self-provisioning: a row must exist in the ArangoDB `users` collection
  with `encPassword = bcrypt(sha256(plaintext))`. That per-environment step is
  why `http-service` stays exempt.
- Replica patterns are anchored on a leading space. `"10/10"` contains the
  substring `"0/1"`, so the original unanchored `select('search', '0/')` would
  have reported any service above 9 replicas as permanently unhealthy.

**The general lesson for this plan:** a gate that fails after the mutation has
already been applied is worse than no gate, because it misreports success as
failure. Verification steps need to be reachable in the environment's real
steady state — including its optional and one-shot services — before they are
allowed to fail a deploy.

---

## 7. Required repo changes

Ordering matters — **item 1 must be applied before items 2 and 3** (see §6.5).

1. **`deploy/terraform/modules/compute/main.tf:120-121`** — set
   `user_data_replace_on_change = false` and rewrite the stale comment. This is
   the guard that makes decision #5 hold; nothing below may land before it.
2. **Config rendering — extract to a repo script** (decision #2). Move the
   `inventory/` + `group_vars/` rendering out of
   `user_data.sh.tftpl:114-186` into a new
   **`deploy/scripts/render-config.sh`**, committed to the repo and called by
   *both* the bootstrap and the redeploy path:
   - Values that are genuinely Terraform-derived (RDS/Redis endpoints, domain,
     model IDs, `data_backend`) must reach the script as **environment
     variables or arguments**, not template interpolation — that is what keeps
     `user_data` static.
   - Secrets keep coming from SSM and Secrets Manager at runtime, exactly as
     today (`user_data.sh.tftpl:131-140`); the script just relocates the same
     logic.
   - Terraform writes those values once to a small file (for example
     `/etc/genieai/deploy.env`) that `render-config.sh` sources, so a redeploy
     re-renders config without needing Terraform at all.
   - **Result:** `skip_git_sync`, `vars.yml`, `vault.yml`, and `inventory/`
     are regenerated deterministically on every deploy, so `redeploy.sh` no
     longer has to rsync around them and the drift risk disappears rather than
     being managed.
3. **`deploy/terraform/artifact.tf`** — **delete** `data.archive_file.app` and
   `resource "aws_s3_object" "app"` entirely (decision #3). Keep the bucket,
   its public-access block, and its encryption config. Then:
   - `main.tf:118` changes from `app_s3_key = aws_s3_object.app.key` to a
     static `app_s3_key = "genie-ai.zip"` (a local or variable).
   - The `archive` provider in `versions.tf:14-17` becomes unused — remove it
     and refresh `.terraform.lock.hcl`.
   - `.artifacts/` is no longer produced.
   - **Do not lose the excludes list.** `artifact.tf:38-42` excludes `.git`,
     `node_modules`, `deploy/terraform`, `mobile`, `_bmad`, `_bmad-output`,
     `docs`, `tests`, `test-results`, `secrets`, `.idea`, `.ruff_cache`, and
     `.env`. Transplant it into the workflow's zip step *before* deleting the
     resource — omitting `secrets` or `.env` would publish credentials into the
     artifact bucket.
   - The header comment at `artifact.tf:1-7` is now entirely false and must be
     replaced with a note that CI owns the object.
   - **Bootstrap ordering caveat:** Terraform no longer creates the artifact,
     so a fresh environment has an empty bucket and
     `user_data.sh.tftpl:100` (`aws s3 cp`) will fail. For any new environment
     the deploy workflow must run **once before the first instance boots**, or
     the first `apply` must be followed immediately by a deploy. `user_data`
     should fail loudly with a clear message in that case rather than
     continuing into a half-configured playbook run.
4. **`deploy/ansible/group_vars/all.yml`** — add `swarm_registry_url` (§6.2).
5. **`deploy/scripts/redeploy.sh`** — S3 fetch, extract, **commit** (§6.1),
   call `render-config.sh` (item 2), registry health check, then
   `ansible-playbook --skip-tags install -e "git_username=s3 git_token=s3"`
   (§6.3, §6.4).
6. **`deploy/terraform/backend.tf` + `providers.tf`** — partial backend config
   and the `!= "" ? : null` ternary (§3.6); give `var.aws_profile` a `""`
   default.
7. **`deploy/terraform/versions.tf`** — raise `required_version` to `>= 1.10`
   so the `use_lockfile` backend requirement is enforced rather than remembered.
8. **`.gitignore` / repo hygiene** — `deploy/terraform/.gitignore` already
   covers `.terraform/`, `.artifacts/`, `*.tfstate*`, and `*.tfvars`. It does
   **not** cover `tfplan` or `plan.log`, and `deploy/terraform/tfplan` (35 KB,
   binary) is **currently committed**. Add the rules and
   `git rm --cached deploy/terraform/tfplan`.
   *Severity note:* that file was extracted and inspected — it embeds a
   `tfstate` snapshot with serial 0 and 10 resources (data sources only) and
   contains **no secret values**. This is hygiene, not an incident; nothing
   needs rotating. The rule still matters because binary plans embed variable
   values in general.
9. **Workflows** — `.github/workflows/ci.yml`, `deploy-app.yml`,
   `terraform.yml`, `e2e.yml`.
10. **`deploy/terraform/github-oidc/`** (new, separate root module + state key) —
    GitHub OIDC provider, the deploy role, and its policy. Kept out of the
    workload stack on purpose: `aws_instance` is not in that state, so applying it
    cannot replace or stop the GPU box, making the §3.2 "never a new machine"
    constraint structural. Applied once, independently; see its README.
    - Trust policy keys on the **`environment:dev` subject**, so the deploy job
      must declare `environment: dev` or it cannot authenticate at all.
    - Grants artifact publish + SSM RunCommand (scoped to the instance's `Name`
      tag, so no cross-state reference) and **nothing else** — no
      `ec2:RunInstances`/`TerminateInstances`, no Terraform apply rights.
    - **No instance-side IAM change is needed** for the deploy itself —
      `AmazonSSMManagedInstanceCore` is already attached
      (`modules/compute/main.tf:21-24`).
11. **`deploy/terraform/README.md`** — document the new split
    (Terraform = infra, button = app deploy), the loss of the "deploys
    uncommitted local changes" behaviour (decision #1), and the new
    bootstrap ordering requirement for fresh environments (item 3).

---

## 8. Open questions / risks

Items resolved during review (decisions #1, #2, #3, #6) have moved into §0, §6.5
and §7. What remains open:

1. **SSM output truncation.** `GetCommandInvocation` returns only the last
   ~24,000 characters. A cold multi-image OPEA rebuild (`async: 1800` per image,
   `deploy.yml:608`) will exceed that and the failure logs will be lost.
   Configure `OutputS3BucketName`, and set `ExecutionTimeout` explicitly instead
   of accepting the 3600 s document default. **Confirmed still required by
   decision #4** — because builds stay on the instance, the full multi-image
   build log streams back through SSM.

   **Requires a workload-stack change, not a deploy-role change.** SSM uploads
   command output using the **instance's** role, not the caller's. The instance
   role currently has only `s3:GetObject` on the artifacts bucket
   (`modules/compute/main.tf` `ReadAppArtifact`), so configuring
   `OutputS3BucketName` without also granting it `s3:PutObject` on the log
   destination silently produces no logs — the deploy still runs, and the output
   you were trying to preserve is simply absent.
2. **Rollback is weaker than it sounds.** As designed the workflow zips from a
   git ref, so rollback means deploying an older ref — the sha-keyed zips do not
   themselves enable it unless an artifact-key input is added. Rollback must
   also produce a *distinct* HEAD sha or §6.1 bites again. And it does **not**
   revert ArangoDB or the Keycloak realm on the persistent EBS, so a code
   rollback after a schema or realm change is not clean.
3. **Shared instance contention.** One dev box; the `concurrency` group
   serializes deploys, but a feature-branch deploy still overwrites whatever a
   demo is using. Mitigation: confirm input + fast redeploy of a known-good ref.
   Note this is the cost of decision #5 — reusing one VM and isolating
   concurrent work are in direct tension until a second instance exists.
4. **GPU quota.** Until the quota case clears, `terraform apply` fails at
   instance launch. Not a pipeline bug, but it will make `terraform.yml` red.
5. **Retiring `release/2.0`.** With `asante/1.0` as default (decision #6),
   confirm CodeQL default setup and Dependabot follow it, and check that no
   workflow, branch protection rule, or `origin/HEAD` symref still points at
   `release/2.0` when it is deleted. Local clones will keep a stale
   `refs/remotes/origin/HEAD` until someone runs
   `git remote set-head origin -a`.
6. **GitHub plan tier.** Environment protection rules on private repos require
   Team/Enterprise (§3.4).

---

## 9. Implementation phases

| Phase | Deliverable | Outcome |
|---|---|---|
| 1 | `ci.yml` (all branches, per-component, incl. ruff) | Every push validated |
| **2a** | **`user_data_replace_on_change = false` — alone, applied and verified** (§6.5, §7.1) | The VM is safe to modify; decision #5 holds |
| 2b | Remove `archive_file`/`aws_s3_object`, static `app_s3_key`, profile + `required_version`, gitignore + `tfplan` removal (§7.3, §7.6-8) | Terraform owns infra only; no re-zip on plan |
| 2c | Extract `render-config.sh` from `user_data.sh.tftpl` (§7.2) | Config rendering versions with the code; `user_data` becomes near-static |
| 3 | **§6.1-6.4 playbook fixes**, then `redeploy.sh`, OIDC role, `deploy-app.yml` | Deploy button from any branch, in-place |
| 3.5 | Manual SSM dry run of `redeploy.sh` against the live box **before** wiring the button | Confirms §6.1-6.3 are actually resolved |
| 4 | `terraform.yml` (plan on PR, gated apply) | Reviewable, auditable infra changes |
| 5 | `e2e.yml` (post-deploy Playwright), `security.yml` (audit, CodeQL JS+Py, gitleaks, tfsec) | Real E2E coverage + security gates |
| 6 (later) | Hybrid GHCR builds for the 9 app images (§3.7), staging env, ECS | Faster deploys, prod-ready |

**Phase 2a is a hard gate.** It is a one-line change, but applying 2b or 2c
before it replaces the GPU instance — the precise outcome decision #5 rules out.
Verify the plan output shows `~ update in-place`, not `-/+ must be replaced`.

**Phase 3.5 is not optional.** Given that §6.1 fails *silently and green*, the
redeploy path must be proven by hand once before a green checkmark is allowed to
stand in for evidence that anything shipped.
