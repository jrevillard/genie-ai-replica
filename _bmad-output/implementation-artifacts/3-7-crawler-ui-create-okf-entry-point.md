---
baseline_commit: 14205ae
---
# Story 3.7: Crawler UI "Create OKF repository" entry point

Status: ready-for-dev

Story key: `3-7-crawler-ui-create-okf-entry-point` | GitLab: #969
Epic: 3 (Admin UI) / **Epic 10** (OKF Studio capstone) | Branch: `feat/okf-server`
FRs: FR-38, FR-30, FR-2 | Spec: [okf-studio-ux-design-2026-08-13](../planning-artifacts/okf-studio-ux-design-2026-08-13.md) §1.3b, §8.1; [7.2 producer](../planning-artifacts/prds/prd-okf-server-2026-07-15/epics.md)

> **The gap:** the crawler UI can crawl N URLs into a free-form `.md` corpus, but there is no path to lift a multi-URL crawl into an OKF REPOSITORY. This story adds the "Create OKF repository" target to the crawl entry points so a multi-URL crawl → `OKF_CRAWL_DUMP_v1` → producer drafts → Studio workspace is ONE visible flow.

## Story

As a **steward**,
I want **to create an OKF repository from a multi-URL crawl**,
So that **I can turn a set of public web sources into a structured, producer-drafted OKF repo without manual assembly**.

## Acceptance Criteria

1. **`AddFromLinkDialog.vue` segmented target**: the existing multi-URL crawl dialog gains a **"Create OKF repository"** segment beside the default crawl-to-corpus (SITE_PRESETS preserved — free-form crawling unchanged); choosing it adds the model-tier picker (the 7.2 `model_tier`) and opens the Studio wizard with the seed list pre-loaded on **Step 2 Crawl**.
2. **`FileDetailsDialog.vue` companion**: a **"Create OKF from crawl"** action on a completed crawl's details (visible when `crawlJob.status === 'Succeeded'`); it opens the wizard with that crawl's file pre-selected → **Produce** → `produce-from-crawl` (7.2).
3. **Post-crawl trigger (7.4b, additive)**: when a crawl created with an OKF target succeeds, `crawlWorker`'s success block reads `crawl_job.config.okf` and fires `produce-from-crawl` — a producer failure NEVER breaks crawl success (the crawl result stands; a reproducer entry is surfaced in the UI).
4. **The dump contract**: the crawl output for OKF targets is the versioned `OKF_CRAWL_DUMP_v1` (header + `## Source:` blocks — the 7.2 documented contract); the wizard's Produce step polls the producer job (`{silent:true}` progress/logs/kill — the crawl_job lifecycle patterns).
5. **Composition + standards**: DS primitives, Options API, Vuex, `httpService`; i18n `okf.crawl.*`; Jest tests (segment switch, Succeeded-only companion gate, post-crawl trigger firing + failure isolation).

## Tasks

- [ ] T1 `AddFromLinkDialog` OKF segment + model tier + wizard preload + tests
- [ ] T2 `FileDetailsDialog` "Create OKF from crawl" (Succeeded gate) + tests
- [ ] T3 Post-crawl trigger (7.4b: `config.okf` read in crawlWorker success block; failure-isolated) + tests
- [ ] T4 i18n + Jest + lint/format; close-out (sprint/#968/push)

## Dev Notes

- **Anchors (verified 2026-08-18):** `AddFromLinkDialog.vue` (SITE_PRESETS + multi-URL seed list) and `FileDetailsDialog.vue` exist; `crawlWorker.js` (the success block at the crawl completion) is the 7.4b hook; `crawl_job` lifecycle (progress/logs/kill) is the producer-job pattern (7.2 mirrors it).
- **Multi-URL is native** (the user's directive): the crawler already crawls N URLs into one dump — this story wires that dump to OKF, not a new crawl mechanism.
- **Failure isolation (R4 discipline):** the post-crawl trigger must never turn a successful crawl into a failure (the 2.9.4 "isolated, never fails the drain" lesson). The producer job lifecycle mirrors `crawl_job` — a reproducer entry, not a crash.
- **Gating:** the dump contract + producer drafts need 7.2/7.4b; the UI entry (segment + companion) lands here regardless — Produce calls 7.2's contract.
- **Existing UI paradigms (memory):** the segmented-dialog + SITE_PRESETS patterns; zero inconsistencies.

## Scope boundary (do NOT build)

The producer-service itself (7.2) · the dump segmentation/AI-adjust (7.2) · model-tier/sovereignty gate (7.1) · free-form crawl changes (untouched).

## References

[Studio UX design §1.3b/§8.1](../planning-artifacts/okf-studio-ux-design-2026-08-13.md) · Story 7.2/7.4b/7.1 (producer) · `crawlWorker.js` (success block) · memory `feedback_existing-ui-paradigms`.
