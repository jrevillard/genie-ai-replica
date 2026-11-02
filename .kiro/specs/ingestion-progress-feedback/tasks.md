# Implementation Plan: Ingestion Progress Feedback

## Overview

This plan implements real-time ingestion progress tracking across three system layers: the Document Repository backend (Node.js/ArangoDB), the Dataprep Pipeline (Python), and the Admin Frontend (Vue.js). Tasks are ordered to build the data layer first, then the API, then the pipeline reporter, and finally the frontend UI — wiring everything together at the end.

## Tasks

- [x] 1. Backend data layer and service
  - [x] 1.1 Create `ingestionProgressService.js` in `components/document-repository/src/services/`
    - Implement the `IngestionProgressService` class with methods: `createOrReset(fileId)`, `getByFileId(fileId)`, `updateStageTransition(fileId, newStage, stagesCompleted)`, `updateProgress(fileId, stageProgressPercent, message)`, `markCompleted(fileId)`, `markError(fileId)`
    - Use the `ingestion_progress` ArangoDB collection with `file_id` as the document `_key`
    - Implement percentage clamping: values < 0 stored as 0, values > 100 stored as 100, non-integers floored
    - `createOrReset` must overwrite any existing record with fresh initial values (Extraction, 0%, 0 stages_completed, status "in_progress", started_at = now, finished_at = null)
    - `markCompleted` sets current_stage="Completed", stages_completed=total_stages, stage_progress_percent=100, status="completed", finished_at=now
    - `markError` preserves current_stage, sets status="error", finished_at=now
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7_

  - [x] 1.2 Write property tests for `ingestionProgressService.js`
    - **Property 1: Stage transition state machine** — Generate random stage sequences, apply transitions via `updateStageTransition`, verify stages_completed increments by 1, stage_progress_percent resets to 0, current_stage matches new stage
    - **Validates: Requirements 1.2, 6.1**
    - **Property 4: Re-trigger resets state** — Generate random existing Ingestion_Progress states, call `createOrReset`, verify output has Extraction/0/0/"in_progress"/null
    - **Validates: Requirements 1.7**
    - **Property 5: Error state preserves failure stage** — Generate random current_stage values, call `markError`, verify current_stage unchanged, status="error", finished_at non-null
    - **Validates: Requirements 1.5, 5.6**
    - **Property 10: Progress percentage clamping** — Generate random integers including out-of-range values, call `updateProgress`, verify stored value clamped to [0, 100] as floored integer
    - **Validates: Requirements 1.3**
    - Use `fast-check` library, minimum 100 iterations per property
    - Tag format: `Feature: ingestion-progress-feedback, Property {N}: {title}`

  - [x] 1.3 Write unit tests for `ingestionProgressService.js`
    - Test `createOrReset` produces correct initial record shape
    - Test `updateStageTransition` increments stages_completed and resets progress
    - Test `markCompleted` and `markError` set terminal fields correctly
    - Test invalid inputs (missing fileId, non-numeric percent) are rejected
    - Mock ArangoDB collection calls
    - _Requirements: 1.1, 1.2, 1.4, 1.5_

- [x] 2. Backend API routes and controller
  - [x] 2.1 Create `ingestionProgressController.js` in `components/document-repository/src/controllers/`
    - Implement GET handler: validate fileId param, call `getByFileId`, return 200 with `{ success: true, data: {...} }` or 404 if file/record not found
    - Implement PATCH handler: validate request body (current_stage, stage_progress_percent, stages_completed, status, message), delegate to appropriate service method, return 200 on success or 400 for invalid body
    - Handle database errors with 500 response and logging
    - _Requirements: 2.1, 2.2, 2.3, 2.5, 2.6_

  - [x] 2.2 Add routes to `components/document-repository/src/routes/fileRoutes.js`
    - Add `GET /api/files/:fileId/ingestion-progress` route with auth middleware (Admin/Manager/AI Engineer roles)
    - Add `PATCH /api/files/:fileId/ingestion-progress` route with auth middleware (Admin/Manager/AI Engineer roles)
    - Wire routes to the ingestionProgressController handlers
    - _Requirements: 2.1, 2.5, 2.6_

  - [x] 2.3 Update ingestion trigger to create progress record
    - In the existing file ingestion trigger logic (in `fileRoutes.js` or `fileService.js`), call `ingestionProgressService.createOrReset(fileId)` when ingestion is dispatched
    - Ensure re-triggering overwrites existing progress record
    - _Requirements: 1.1, 1.7_

  - [x] 2.4 Write property test for GET endpoint round-trip
    - **Property 9: GET endpoint round-trip** — Generate random valid Ingestion_Progress records, store them via the service, then GET via the API, verify all fields match exactly
    - **Validates: Requirements 2.1**
    - Use `fast-check` with supertest for HTTP-level testing
    - Tag format: `Feature: ingestion-progress-feedback, Property 9: GET endpoint round-trip`

  - [x] 2.5 Write unit tests for controller and routes
    - Test GET returns 200 with correct record shape
    - Test GET returns 404 for missing file and missing progress record
    - Test PATCH returns 200 for valid body
    - Test PATCH returns 400 for invalid body
    - Test 401 for unauthenticated requests
    - Test 403 for unauthorized roles
    - Use supertest with mocked service layer
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

- [x] 3. Checkpoint - Backend API complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Dataprep Pipeline progress reporter
  - [x] 4.1 Create `progress_reporter.py` in `genie-ai-overlay/dataprep/`
    - Implement `ProgressReporter` class with: `__init__(file_id, doc_repo_url, auth_token_getter)`, `report_stage_transition(stage, stages_completed)`, `report_progress(stage_progress_percent, message)`, `report_completion()`, `report_error()`
    - Send HTTP PATCH to `/api/files/{fileId}/ingestion-progress` with 5-second timeout
    - Implement minimum interval throttling (30 seconds between sub-step updates)
    - Fire-and-forget: log warnings on failure (network, timeout, non-2xx), never raise exceptions or retry
    - _Requirements: 6.1, 6.4, 6.5_

  - [x] 4.2 Integrate progress reporter into pipeline stages in `genieai_dataprep_microservice.py`
    - Instantiate `ProgressReporter` at start of `ingest_file_with_guardrail` (or equivalent entry point)
    - Extraction stage: report 0% at start, calculate `(pages_processed / total_pages) * 100` during Docling callbacks, report 100% at completion with element count
    - Chunking stage: report transition, then 100% on completion
    - Guardrail stage: report transition, then 100% on completion
    - Labeling stage: report transition, report `(chunks_labeled / total_chunks) * 100` at ≤30s intervals
    - Graph stage: report transition, report `(batches_completed / total_batches) * 100` at ≤30s intervals
    - On successful completion: call `report_completion()`
    - On exception in any stage: call `report_error()` before propagating
    - Handle heartbeat fallback when Docling lacks page-level progress
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 6.1, 6.2, 6.3, 6.5, 6.6_

  - [x] 4.3 Write Python tests for `progress_reporter.py`
    - Test fire-and-forget: mock HTTP to return errors/timeouts, verify no exceptions raised
    - Test throttling: multiple rapid calls within 30s only send one HTTP request
    - Test progress calculation: (pages_processed / total_pages) produces correct percentage
    - Test stage transition sends correct PATCH body
    - Use pytest with httpx mock or responses library
    - _Requirements: 6.4, 6.5_

- [x] 5. Checkpoint - Pipeline integration complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Frontend progress indicator component
  - [x] 6.1 Create `IngestionProgressIndicator.vue` in `components/gov-chat-frontend/src/components/`
    - Accept props: `progress` (Ingestion_Progress record object), `fileStatus` (current file dataprep status)
    - Compute `overallPercent`: `((stages_completed * 100) + stage_progress_percent) / total_stages`
    - Compute `elapsedTime`: live HH:MM:SS since `started_at`, updated every second via interval
    - Compute `stageStates`: array of { name, state: 'completed' | 'active' | 'pending' | 'error' } based on stages_completed and status
    - Display: overall progress bar, current stage name, elapsed time, 5 stage icons in pipeline order (checkmark for completed, spinner for active, circle for pending, error icon for failed)
    - On completion: show 100%, all checkmarks, total elapsed = finished_at - started_at
    - On error: show error icon on failed stage, progress bar stopped at failure point, label with failed stage name
    - Hide entirely when file status is not "Ingesting" and no terminal progress record exists
    - Clean up elapsed time interval on component unmount
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_

  - [x] 6.2 Write property test for stage icon assignment
    - **Property 6: Stage icon assignment** — Generate random stages_completed in [0,5] and status values, verify: stages at index < stages_completed show "completed", stage at index = stages_completed (if in_progress) shows "active", stages at index > stages_completed show "pending", error status shows "error" on active stage
    - **Validates: Requirements 5.4**
    - Use `fast-check` with Vue Test Utils
    - Tag format: `Feature: ingestion-progress-feedback, Property 6: Stage icon assignment`

  - [x] 6.3 Write property tests for progress calculations
    - **Property 2: Progress percentage calculation** — Generate random (completed, total) pairs where completed <= total and total > 0, verify `Math.floor((completed / total) * 100)` is in [0, 100]
    - **Validates: Requirements 3.3, 6.2, 6.3**
    - **Property 3: Overall progress formula** — Generate random stages_completed in [0,5] and stage_progress_percent in [0,100], verify overall formula produces value in [0, 100] and is monotonically non-decreasing
    - **Validates: Requirements 5.1**
    - Use `fast-check` library
    - Tag format: `Feature: ingestion-progress-feedback, Property {N}: {title}`

- [x] 7. Frontend auto-refresh and polling integration
  - [x] 7.1 Add `getIngestionProgress(fileId)` method to `components/gov-chat-frontend/src/services/documentFileService.js`
    - Call `GET /files/{fileId}/ingestion-progress` via httpService
    - Return the progress data object on success, handle 404 (return null)
    - _Requirements: 2.1_

  - [x] 7.2 Implement auto-refresh polling logic in `FileDetailsDialog.vue`
    - Add data properties: `isIngestionAutoRefreshEnabled`, `ingestionRefreshInterval` (default 5, min 1), `ingestionRefreshTimer`, `lastIngestionRefreshAt`, `ingestionProgress`
    - Start polling when Ingestion Log tab is opened and file status is "Ingesting"
    - Poll `getIngestionProgress(fileId)` and ingestion logs at the configured interval
    - Stop polling when file reaches terminal state ("Ingested", "Ingested with Warnings", "Ingestion Error", "Killed") within one poll interval
    - Stop polling on tab change or dialog close; clear timer handle
    - On network error: show error toast, retain current display, continue polling
    - On 401/403: stop polling, show re-login message
    - On 404: hide progress indicator (no record)
    - Add auto-refresh checkbox toggle and interval input matching existing crawl dashboard pattern
    - Display "Auto-refresh enabled" indicator and last refresh timestamp
    - Append new log entries without clearing existing ones; preserve scroll position
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8_

  - [x] 7.3 Integrate `IngestionProgressIndicator` into `FileDetailsDialog.vue`
    - Import and register `IngestionProgressIndicator` component
    - Render it on the Ingestion Log tab, above the log table
    - Pass `ingestionProgress` data and `fileStatus` as props
    - Show/hide based on file status and progress record existence
    - _Requirements: 5.2, 5.3, 5.7_

  - [x] 7.4 Write property test for auto-refresh interval validation
    - **Property 7: Auto-refresh interval validation** — Generate random numeric inputs, verify effective interval is `max(input, 1)` for positive numbers, defaults to 5 for undefined/null/NaN/<=0
    - **Validates: Requirements 4.2**
    - Use `fast-check` library
    - Tag format: `Feature: ingestion-progress-feedback, Property 7: Auto-refresh interval validation`

  - [x] 7.5 Write property test for log entry append
    - **Property 8: Log entry append preserves existing entries** — Generate random arrays of existing and new log entries, verify append produces correct length and preserves order
    - **Validates: Requirements 4.3**
    - Use `fast-check` library
    - Tag format: `Feature: ingestion-progress-feedback, Property 8: Log entry append preserves existing entries`

  - [x] 7.6 Write unit tests for auto-refresh lifecycle
    - Test polling starts when Ingestion Log tab opens with "Ingesting" status
    - Test polling stops on terminal status
    - Test polling stops on tab change / dialog close
    - Test interval respects minimum of 1 second
    - Test error handling (network error retains display, 401 stops polling)
    - Use Vue Test Utils with mocked timers and service calls
    - _Requirements: 4.1, 4.4, 4.7, 4.8_

- [x] 8. Final checkpoint - End-to-end integration
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The backend (tasks 1-2) must be completed before the pipeline (task 4) and frontend (tasks 6-7) can be fully tested end-to-end
- Frontend tasks 6 and 7 can be developed in parallel with pipeline task 4 since they only depend on the backend API being available

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "2.1"] },
    { "id": 2, "tasks": ["2.2", "2.3"] },
    { "id": 3, "tasks": ["2.4", "2.5"] },
    { "id": 4, "tasks": ["4.1", "6.1", "7.1"] },
    { "id": 5, "tasks": ["4.2", "4.3", "6.2", "6.3", "7.2"] },
    { "id": 6, "tasks": ["7.3", "7.4", "7.5"] },
    { "id": 7, "tasks": ["7.6"] }
  ]
}
```
