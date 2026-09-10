---
baseline_commit: 14205ae
---
# Story 3.6: Document-management "Create OKF repository" entry point

Status: ready-for-dev

Story key: `3-6-document-mgmt-create-okf-entry-point` | GitLab: #968
Epic: 3 (Admin UI) / **Epic 10** (OKF Studio capstone) | Branch: `feat/okf-server`
FRs: FR-38, FR-26 | Spec: [okf-studio-ux-design-2026-08-13](../planning-artifacts/okf-studio-ux-design-2026-08-13.md) §1.3a, §5.2

> **The gap:** the Admin Dashboard's document-management table can ingest selected documents into the FREE-FORM corpus but has no path to build an OKF REPOSITORY from them. This story adds the sibling batch action that funnels the selection into the OKF Studio wizard (Documents workflow), so existing uploaded documents become OKF repo concepts.

## Story

As an **operator**,
I want **to create an OKF repository from my selected uploaded documents**,
So that **I can lift an existing document batch into a structured, validated OKF repo without re-uploading**.

## Acceptance Criteria

1. **Batch action in the document table** (`AdminDashboard.vue` — a **sibling** of the existing "Ingest Selected" batch action, never an alias/replacement of free-form ingest): "Create OKF repository" opens the OKF Studio wizard with the selection pre-loaded on **Step 2 Documents**.
   - **Gate (`showCreateOkfButton`)**: enabled iff the selection is non-empty AND none of the selected docs are already in an OKF repo (the `okf_repo_id` stamp — Decision §5.2) AND none are `dataprep.status == 'ingested'` (an ingested free-form doc is a separate corpus; reuse requires the re-ingest path, out of scope).
   - The gate is **live, not cosmetic**: a disabled button shows the reason (tooltip i18n).
2. **Documents workflow wiring**: the wizard's Documents variant picks `documentFileService.getFiles()` filtered to the gate's not-yet-OKF'd set + the existing dropzone (ClamAV + text-extract); **Produce** calls the produce-from-documents path (7.7) → drafts at `review` (server-enforced `unverified`).
3. **Additive `okf_repo_id` stamp**: at produce time, 7.7 writes `okf_repo_id` (the target repo) onto each selected source doc's `files` metadata (additive field — no new collection, no regression to free-form docs which carry no `okf_repo_id`).
4. **Composition + standards**: reuses `AddFromLinkDialog`-adjacent patterns only where they exist; DS primitives, Options API, Vuex, `httpService`; i18n `okf.docs.*`; Jest tests (gate logic incl. the three disable conditions, wizard open with pre-loaded selection, stamp-on-produce).

## Tasks

- [ ] T1 Batch action + `showCreateOkfButton` gate (3 conditions, tooltip reasons) + tests
- [ ] T2 Wizard Documents-variant preload (selection → Step 2) + produce wiring to 7.7
- [ ] T3 `okf_repo_id` stamp at produce (additive metadataService field) + tests
- [ ] T4 i18n + Jest + lint/format; close-out (sprint/#968/push)

## Dev Notes

- **Anchors (verified 2026-08-18):** `AdminDashboard.vue` document table — the checkbox selection (`selectedDocuments`) + `handleBatchAction('ingest')` are the existing patterns; `documentFileService.js` (`getFiles`) exists; the free-form "Ingest Selected" is untouched (R5 — additive sibling only).
- **The gate is the FR-38 discipline:** a document already in an OKF repo (has `okf_repo_id`) or already free-form-ingested must NOT be double-OKF'd silently — the reason is surfaced, never a silent skip.
- **`okf_repo_id` additive (R5):** `metadataService.extractMetadata` gains the field (default undefined); free-form docs are unaffected (no field). This is the SAME additive pattern as `bundle_version` (2.9.7).
- **Dependency:** 7.7 (produce-from-documents) must exist for Produce; the gate + wizard preload land here regardless (the produce call is 7.7's contract).
- **Existing UI paradigms (memory):** the batch-action bar + confirmation dialog patterns in AdminDashboard; zero inconsistencies.

## Scope boundary (do NOT build)

The produce-from-documents SERVICE (7.7) · free-form ingest changes · re-ingesting an already-ingested doc (out of scope — the gate excludes it) · the Documents Step-2 renderer internals beyond the preload/produce wiring.

## References

[Studio UX design §1.3a/§5.2](../planning-artifacts/okf-studio-ux-design-2026-08-13.md) · PRD FR-38 · Story 7.7 (produce-from-documents) · memory `feedback_existing-ui-paradigms` + `feedback_additive-first-core-changes`.
