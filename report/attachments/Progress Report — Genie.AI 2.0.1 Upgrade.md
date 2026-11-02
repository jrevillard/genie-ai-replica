# Progress Report — Agrivisory Platform Upgrade to Genie.AI 2.0.1

**Project:** AI Agriculture Advisory System (Agrivisory) — ITU/BDT, Lesotho
**Prepared by:** Adem Mcharek
**Date:** 28 August 2026
**Reference:** delivery plan workstreams — deployment, AI pipeline, security

## 1. Purpose

This report summarizes the progress of the upgrade of the Agrivisory platform — developed by the project team on the ITU Genie.AI open-source framework — to release 2.0.1 of the framework. The work is organized in three workstreams: deployment, the AI pipeline, and security. It is prepared in support of the implementation of the delivery plan.

## 2. Approach

The upgrade was carried out as a selective adoption rather than a wholesale replacement: the relevant parts of the new framework release were adopted (deployment tooling, updated AI services, database platform upgrade), while the team's product code and country-specific adaptations were preserved and re-applied on top of the new release. Every step of the adoption was verified by the framework's own test suite before being kept, and the riskiest operations (database migration and full re-ingestion of the corpus) were deliberately scheduled last, once everything else is stable.

## 3. Workstream 1 — Deployment

**What changed.** The platform previously carried three diverging deployment paths. These were consolidated into a single, reviewable deployment path that supports both a local build and a container registry as the image source, switched by configuration. Broken variant files that carried hardcoded credentials were removed.

**Why.** One deployment path can be reviewed, tested and documented; three drifting ones cannot.

**Status.** The complete platform boots as one integrated system, with all core services reporting healthy and the public entry point verified.

## 4. Workstream 2 — AI pipeline

**What changed.** The new release's document processing and retrieval services were adopted, and the team's weather and translation adaptations were re-applied on top of them. The change of embedding model means the full corpus will be re-ingested exactly once, at the end of the upgrade.

**Why.** The improved AI services are the main reason to upgrade — but the team's modifications must survive it without re-forking the framework.

**Status.** Both pipelines were verified end-to-end. At this stage the AI models themselves were stood in for by a local stand-in server, so that everything else — document processing, storage, retrieval, wiring — ran real. Validation with the live models on the GPU server follows when access is available; the same tests are re-used unchanged.

## 5. Workstream 3 — Security

**What changed.** Adopted framework code crosses a trust boundary, so it was reviewed rather than assumed. An in-depth review with independent re-verification confirmed a number of findings, all of which were fixed and re-checked against the running system: committed credentials and backup dumps were purged from the repository, the platform no longer ships default accounts, security-relevant URLs are configuration-driven, and a deployment defect that would have blocked local-mode installations was caught before it ever ran.

**Why.** Trust in the platform has to be earned on the code we adopt, not inherited from it.

**Remaining.** A further sweep of the remaining adopted components, and rotation of the exposed credentials (list handed over with the delivery plan), are scheduled with the administrator.

## 6. Status and next steps

| Item | Status |
|---|---|
| Framework release 2.0.1 adopted, product adaptations preserved | Done — framework test suite passing |
| Platform operational as one integrated system | Done — core services healthy, entry point verified |
| Document and chat pipelines verified end-to-end | Done — with a local stand-in for the AI models |
| Security review of adopted code, findings fixed and re-verified | Done — rotation of exposed credentials scheduled |
| Validation with live AI models on the GPU server | Pending — requires GPU server access |
| Database migration and full re-ingestion of the corpus | Scheduled last, by design |

**Decisions requested:** access to the GPU server; execution of the credential rotation; and the release go-ahead for pushing the branch.
