# ADR okf-041: Document-management → OKF routes through the wizard

- **Status**: Accepted (David Forden, 2026-09-27 — Amendment A decision #5)
- **Date**: 2026-09-27
- **Decision owners**: David Forden, Genie.ai Dev
- **Implemented in**: MR !474 (`AdminDashboard.onCreateOkfRepoFromSelection`, `StudioTab.onCreateFromDocuments`)

## Context

There were TWO documents→repository paths: the Document Management tab's
7.7 `ImportDocumentsDialog` (name + domain + strategy in one dialog,
POSTing convert-from-documents directly) and the wizard's Input/Produce
steps. Both converted the same documents with the same backend service,
but only one had preflight warnings, and only the other had the guided
flow — two surfaces to maintain, two UX stories to explain.

## Decision

The Document Management tab's "Create OKF repository" batch action
**routes into the wizard**:

1. The selection preloads `okf/selection.documents`
   (`{file_id, file_name}` rows).
2. The Studio tab opens and `onCreateFromDocuments` seeds a fresh draft
   (`source='documents'`, `input.document_ids` from the selection).
3. The steward walks Entry (naming) → Choose (Documents preselected) →
   Input (selection editable, classification selectable) → Produce
   (the real conversion).
4. The 7.7 `ImportDocumentsDialog` and its `okf:import-created` event
   are **retired** (component + spec deleted; recoverable from git
   history at `574a4c11d^`).

**Companion rule (event plumbing)**: cross-tab entry events MUST be
dispatched after the receiving view's mount — the Studio tab renders
under `v-if` and registers its `window` listeners in `mounted()`, so a
same-tick dispatch reaches zero receivers (the F2 bug class). Dispatch
after `$nextTick()`, or prefer store state over window events.

## Consequences

- One documents→repository path to test, document and harden.
- The 7.7 dialog's per-file preflight badges (serving free-form RAG /
  already in an OKF repository) must be re-created INSIDE the wizard's
  `OkfSourceDialog` — the server-side guards (DOCUMENT_IN_ANOTHER_REPO,
  DUPLICATE_CONTENT, SOURCES_NOT_RETRACTED) remain the real safety, so
  the pills are UX, not correctness. Tracked as wizard polish.
- Document-management upload capabilities inside the wizard come for
  free via `OkfSourceDialog`'s local-FS section (uploads land in the
  document repository and are selected on arrival).
