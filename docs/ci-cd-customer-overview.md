# GENIE.AI "HealthBOT" — Deployment Pipeline (CI/CD) Overview

**Audience:** Customer / stakeholder briefing
**Environment:** Development / stakeholder demo — https://asante.innov8ai.com
**Cloud:** AWS (us-east-1) · **Automation:** GitHub Actions + AWS Systems Manager
**Date:** 12 August 2026

**Related docs:** [deployment report](aws-dev-deployment-customer-report.md) ·
[environment status](aws-dev-deployment-status.md) ·
[CI/CD design & decision record](ci-cd-plan.md) ·
[Terraform usage](../deploy/terraform/README.md)

---

## 1. What the pipeline does

Application updates reach the demo environment through an **automated, auditable
deployment pipeline**. Previously this was a manual operation on the server; it
is now a single controlled action that anyone authorised can trigger from GitHub,
with the same result every time.

Three principles shaped the design:

1. **The pipeline updates the application, never the machine.** Updates are
   applied *in place* on the existing GPU server. Rebuilding that server takes
   20–40 minutes and would destroy whatever demo content is loaded on it, so the
   pipeline is built so that it **cannot** create, stop or replace a machine —
   see §3.
2. **No stored cloud credentials, and no remote access to the server.** There are
   no AWS access keys held in GitHub, and no SSH key, bastion host or open
   administrative port anywhere in the process — see §3.
3. **A deploy must prove it actually shipped.** A "healthy" environment is not
   proof of a successful update: the previous version stays healthy too. The
   pipeline therefore verifies the running software matches the version that was
   requested — see §4.

### 1.1 Checks on every code change

Separately from deployment, every change pushed to any branch is automatically
checked: dependency install integrity, code linting, formatting, unit tests and
a production build of the web application. These checks run in isolation and
never touch AWS. A small number of pre-existing issues in older components are
reported as visible **advisory** warnings rather than blocking the team's work,
and are being cleared component by component.

---

## 2. How a release reaches the environment

There are two ways to start a deploy, and both run **exactly the same
mechanism** — the trigger is the only difference:

| Trigger | Use |
|---|---|
| **Merge to the release branch** | Routine, hands-off delivery of approved changes |
| **Deploy button** (manual, any branch) | Demo preparation, hotfixes, validating a branch before merge |

Documentation-only changes deliberately do **not** trigger a deploy, so editing a
README never causes a GPU rebuild.

```
   Merge to release branch ──┐
                             ├──► Deployment workflow (GitHub Actions)
   Deploy button ────────────┘
                             │
   1. Obtain a short-lived AWS credential (expires in 1 hour)
   2. Confirm it is the correct AWS account — stop immediately if not
   3. Package the application and publish it to secure storage (S3):
         · a version-stamped copy, kept for traceability and rollback
         · a "current release" copy, used if the server is ever rebuilt
   4. Pre-flight: confirm the target server is running and reachable
   5. Instruct the server to update itself (see §3)
   6. Wait for completion, capture the full deployment log
   7. Verify service health, verify the correct version is running,
      and confirm the public site responds over HTTPS
   8. Publish a summary: who, which branch, which commit, which server
```

Typical duration is a few minutes for a small change. A change affecting the AI
services can take considerably longer because those components are large; the
pipeline allows up to two hours before declaring a timeout.

---

## 3. Security model

### No credentials are stored

GitHub holds **no AWS keys**. At the start of each deploy it presents a
cryptographically signed, single-use identity token, and AWS exchanges it for a
credential valid for one hour. Trust is restricted to this specific repository
and this specific environment, by immutable internal identifiers — a renamed or
impersonating repository cannot obtain access.

### Nothing connects *to* the server

The server is not logged into. It maintains an outbound connection to the AWS
management service and collects instructions from it:

```
GitHub Actions                AWS                        GPU server
──────────────                ───                        ──────────
identity token ─────► short-lived credential
send instruction ───► AWS Systems Manager
                          (instruction queued)
                                 ▲
                                 │ outbound HTTPS only
                                 │ (server polls for work — nothing inbound)
                                 └──────────── management agent
check status ◄────────────                          applies the update
```

Consequences: **SSH is closed, there is no bastion host, no inbound
administrative port, and no deployment key to be lost or leaked.** Every
instruction is recorded by AWS with an identifier, status and output.

### The deploy credential is minimally capable

The credential can do four things and nothing else: publish the application
package to one specific storage bucket; instruct one specifically tagged server
to run one specific standard command type; read status; and read the server
inventory.

It has **no permission to create, terminate, start, stop or re-tag a server, and
no permission to change infrastructure at all.** Infrastructure changes use a
separate credential. This is a structural guarantee, not a policy: a software
defect, an incorrect merge or a compromised workflow **cannot** destroy the GPU
environment. Full permission set in [Appendix B](#appendix-b--deploy-permissions).

### Secrets never travel through the pipeline

Passwords, API tokens and certificates are not part of the application package.
They are read on the server at deployment time from AWS Secrets Manager and
Parameter Store. The packaging step additionally re-inspects the package it has
just built and **aborts if any secret material is present**, so the exclusion
rules cannot fail silently.

---

## 4. Safeguards and verification

### During deployment

- **Deploys are serialised.** Two deploys can never overlap on the same
  environment. An in-flight deploy is also never cancelled part-way — an
  abandoned half-applied update is worse than a slow one.
- **Only what changed is rebuilt.** The environment is composed of 19
  purpose-built service images. Each is rebuilt only when *its own* source code
  changed, so a small web-interface change updates the web interface alone.
  Unchanged services keep running untouched. Before this refinement, any change
  restarted the entire stack, including a full reload of the AI language model —
  roughly 40 minutes of interruption for a one-line change.
- **A repeat deploy of unchanged code is effectively free** and causes no service
  interruption.

### After deployment — three independent checks

| Check | What it proves |
|---|---|
| **Service health** | Every service in the stack (~36 services) reached its expected running state. Short-lived setup jobs that legitimately finish are explicitly exempted, and the exemption list is documented rather than implicit. |
| **Version verification** | Each service is running the exact build produced by this deploy. This is the check that distinguishes "deployed successfully" from "deployed nothing" — the previous version would pass a health check just as well. The check also refuses to report success if it was unable to verify anything at all. |
| **Public availability** | The live HTTPS address returns a healthy response to an external request, i.e. the change is visible to real users. |

If any check fails, the deploy is reported as failed and the full server-side log
is attached to the run.

### What every deploy leaves behind

A version-stamped application package in secure storage; a recorded management
instruction with status and output; a complete deployment log on the server; and
a run summary linking branch → commit → package → server → instruction. Any
previous version can be redeployed from its retained package.

---

## 5. Current status

| Item | Status |
|---|---|
| Automated deployment to the demo environment | 🟢 Implemented and exercised against the live environment |
| Credential-free AWS access (identity-token based) | 🟢 In place |
| Least-privilege deploy permissions | 🟢 In place, verified incapable of provisioning |
| Selective rebuild / minimal-downtime updates | 🟢 In place |
| Post-deploy health, version and availability checks | 🟢 In place |
| Automated code checks on every change | 🟢 In place (some legacy items advisory — §1.1) |
| Hands-off deployment on merge to the release branch | 🟡 Activates when the pipeline branch is merged; deploys are run with the **Deploy button** in the meantime |

The pipeline was first exercised against the live environment on 9 August 2026.
The application updates themselves succeeded; the **verification** stage reported
failures on an environment that had in fact updated correctly. Three causes were
identified and corrected, and the corrections were validated directly on the
server:

- a health check that could never pass, because it policed services that had
  never been able to start;
- a version check that compared against the wrong reference, so unchanged
  services appeared stale;
- speech and language-identification model files that no step had ever
  downloaded (the underlying cause of the two items above).

Those fixes are the reason the voice and language services are now running — see
the [deployment report addendum](aws-dev-deployment-customer-report.md).

---

## 6. Open items and next phase

| Item | Note |
|---|---|
| 🟡 **Infrastructure pipeline** | Infrastructure is fully defined in Terraform and version-controlled, but applying it is still a manual, locally-run step. An automated review-and-approve pipeline (validate → preview → approved apply) is designed and not yet built. |
| 🟡 **Automated end-to-end testing after deploy** | A browser-driven test suite exists and is run on demand. Wiring it to run automatically against the live address after each deploy is planned. |
| 🟡 **One-click rollback** | Every previous version is retained and can be redeployed, but rollback is currently an operator action rather than a single button. |
| 🟡 **Deployment log length in GitHub** | The GitHub run shows the tail of the server-side deployment log; the complete log is always available on the server. Streaming the full log into GitHub requires one additional permission on the server's own role. |
| 🟡 **Single environment** | The pipeline targets the dev/demo environment. A production design with separate staging and production promotion is part of the next deployment phase. |

None of these affect the reliability of the current deployment path; they are
convenience and production-readiness items.

---

## Appendix A — Where the implementation lives

| Component | Location | Responsibility |
|---|---|---|
| Deployment workflow | `.github/workflows/deploy-app.yml` | Triggers, packaging, publishing, instructing the server, verification |
| Code checks | `.github/workflows/ci.yml` | Per-component install, lint, format, test, build |
| Server-side update script | `deploy/scripts/redeploy.sh` | Fetch, extract, render config, rebuild, redeploy, verify versions |
| Configuration rendering | `deploy/scripts/render-config.sh` | Used by *both* first boot and every redeploy, so the two cannot diverge |
| Build & deploy automation | `deploy/ansible/deploy.yml` | Selective image builds, stack deployment, health verification |
| Deploy access role | `deploy/terraform/github-oidc/` | Identity-token trust and least-privilege permissions, as its own stack |
| Design & decision record | `docs/ci-cd-plan.md` | Options considered, decisions taken, and the reasoning |

## Appendix B — Deploy permissions

Granted:

| Permission | Restriction |
|---|---|
| Write/read application packages | One named storage bucket only |
| Send a run-command instruction | Only to a server carrying the expected environment tag, **and** only the standard shell-command document |
| Read instruction status | Read-only |
| Read server inventory and reachability | Read-only |

Explicitly **not** granted: launching, terminating, starting, stopping or
re-tagging servers; any infrastructure modification; any access to other
accounts, buckets or environments. Credential lifetime: 1 hour.
