---
title: "Security triage (CVE playbook)"
weight: 7
description: "Triple-source verification, classification buckets, dismissal reasons, and the monthly loop."
mode: how-to
persona: contributor
owner: docs-stewards
last_reviewed: 2026-09-18
---

## Goal

Triage a CVE finding (container scanning, dependency scanning, or SAST) and
**decide fix vs. dismiss** with cited evidence.

## Triple-source verification

For every distinct CVE, verify with **three independent sources** before any
decision — a scanner or a single web page is not proof.

1. **Installed == latest candidate.** Run `apt-cache policy <pkg>` inside
   the same base image. If the installed version equals the repo candidate,
   no package bump helps.
2. **Trivy `fix[]` empty?** Extract from the promote-stage
   `gl-container-scanning-report.json` artifact.
3. **Debian Security Tracker** (`security-tracker.debian.org/tracker/<CVE>`):
   `vulnerable` / `postponed` vs `fixed in <version>` per suite (bookworm
   vs trixie differ).

## Classification buckets

| Bucket | Meaning | GitLab reason | Action |
|---|---|---|---|
| **`affected-no-fix`** | We ARE affected; no upstream patch exists | `ACCEPTABLE_RISK` | Dismiss with a comment that says so plainly |
| **`not_affected`** | Package present but unreachable at runtime (e.g. `linux-libc-dev` kernel headers — the container uses the host kernel) | `NOT_APPLICABLE` | Dismiss |
| **`false_positive`** | Scanner misattribution / test-only data | `FALSE_POSITIVE` | Dismiss |
| **`fixable`** | A fix exists in the distro repo or an upstream release we can pull | — | **Fix, do not dismiss** (base-image bump, `apt-get upgrade` layer, dependency bump) |

## Dismissal comment semantics

> *"awaiting upstream"* is not an honest label — we are affected.

Use `[affected-no-fix]`:

> *We are affected by X in Y (present in the latest scan of \<image\>). No
> upstream fix exists (triple-source verified \<date\>). Risk accepted until
> a fix ships — the monthly rebuild surfaces it automatically when Debian
> publishes.*

Every dismissal comment references the triage doc.

## RESOLVED vs DISMISSED

- **RESOLVED** — the vulnerability is gone (package eliminated from the
  image, proven by absence from the latest scan artifact).
- **DISMISSED** — still present but consciously accepted.

Never conflate the two.

## Bulk execution pattern

1. **Build the decision set offline** (dry-run). Classify every finding,
   save the mapping, print per-image/per-bucket counts, ASSERT the exact
   expected totals per bucket before touching the API.
2. **Spot-check N random decisions** against the source artifacts.
3. **Execute via GraphQL** with 0.15–0.2 s spacing, logging every HTTP
   result. Make the script **resumable** (append `OK <uuid>` lines and skip
   those on re-run). Raw logs are never committed.
4. **Reconcile** afterwards: re-count states via GraphQL and match the
   executed totals.

## Reducing container CVEs (build-side playbook)

- **Audit the runtime tool inventory before slimming an image.** Three
  blind spots CI cannot see: entrypoint scripts, compose healthchecks,
  runtime subprocess use.
- **Drop the build toolchain from runtime stages.** `node:22` ships
  build-essential/python3/make — switch the runtime stage to
  `node:22-slim`. For Python images with compiled wheels, use a
  multi-stage build.
- **`apt-get upgrade -y` layers** in every runtime image to pull current
  Debian security updates at build time.
- **Runtime smoke tests on the PROMOTED images** after each hardening MR:
  pull the tag, verify every tool the entrypoint/healthcheck needs, run
  the heavy-import set, check baked-in model files.

## Monthly loop

- **Pipeline schedule** (cron `0 4 1 * *` Europe/Paris) sets
  `FORCE_IMAGE_REBUILD=true`: rebuilds all 16 images, rescans, promotes,
  then the E2E suite validates the fresh images.
- **Manual trigger**:
  ```bash
  GITLAB_HOST=opensource.unicc.org glab ci run -b main \
    --variables 'FORCE_IMAGE_REBUILD:true'
  ```
- **After each monthly rebuild**: re-triage. Any finding with a fix that
  now applies = `fixable`. New findings = triple-source triage. Stale
  detected findings whose CVEs are absent from the new scans = resolve.
  Update the wave table in the triage doc.

## Instance facts (GitLab 18.2.8-ee)

- REST dismiss/resolve endpoints are unreliable for findings without a
  Vulnerability entity.
- **GraphQL is the only reliable path** —
  `mutation { securityFindingDismiss(input: {uuid, comment,
  dismissalReason}) { ... } }`. For old findings whose raw record has
  aged out, use `mutation { vulnerabilityDismiss(input: {id:
  "gid://gitlab/Vulnerability/<n>", comment, dismissalReason}) { ... } }`.
- Dismissal reason enum:
  `ACCEPTABLE_RISK | FALSE_POSITIVE | MITIGATING_CONTROL | USED_IN_TESTS
  | NOT_APPLICABLE`.
- No auto-resolve: since GitLab 17.0, findings no longer seen by the
  latest default-branch scan stay `detected` forever until manually
  transitioned.

## Related

- [How to open a MR](/docs/contribute/how-to-mr/)
- [Internal → CVE-REMEDIATION.md](https://opensource.unicc.org/un/itu/genie-ai/-/blob/main/.claude/rules/CVE-REMEDIATION.md)
- [Internal → security triage doc](https://opensource.unicc.org/un/itu/genie-ai/-/blob/main/docs/security/cve-triage-2026q3.md)