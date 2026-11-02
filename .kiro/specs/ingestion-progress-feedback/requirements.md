# Requirements Document

## Introduction

This feature improves the admin dashboard's feedback during document ingestion. Currently, admins must manually refresh to see ingestion log entries, have no visibility into the extraction stage (the longest step, 5-15+ minutes for large PDFs), and lack an overall progress indicator. This feature adds a backend ingestion progress/metrics endpoint, extraction-stage progress reporting from the dataprep pipeline, auto-refresh on the ingestion log tab, and a visual progress/stage indicator in the FileDetailsDialog.

## Glossary

- **Document_Repository**: The Node.js backend service that manages file metadata, ingestion logs, and status updates in ArangoDB.
- **Dataprep_Pipeline**: The Python GPU-accelerated service that extracts content from documents (via Docling), chunks, labels, and inserts into the knowledge graph.
- **FileDetailsDialog**: The Vue.js dialog component that displays file metadata, ingestion logs, and crawl dashboards.
- **Ingestion_Progress**: A structured record of the current ingestion stage, sub-step progress within a stage, and elapsed time for a file being ingested.
- **Extraction_Stage**: The Docling-based content extraction step in the Dataprep_Pipeline, which is the longest single step during ingestion (5-15+ minutes for large PDFs).
- **Ingestion_Metrics_Endpoint**: A new REST API endpoint on the Document_Repository that returns the current ingestion progress for a given file.
- **Admin**: A user with the Admin, Manager, or AI Engineer role who manages documents in the system.
- **Auto_Refresh**: A polling mechanism that periodically fetches updated data without requiring the Admin to manually click a refresh button.

## Requirements

### Requirement 1: Ingestion Progress Data Model

**User Story:** As an Admin, I want the system to track granular ingestion progress data, so that I can see which stage a document is in and how far along it is.

#### Acceptance Criteria

1. WHEN ingestion begins for a file, THE Document_Repository SHALL create an Ingestion_Progress record containing: file_id, current_stage (initialized to "Extraction"), stage_progress_percent (initialized to 0), stages_completed (initialized to 0), total_stages (set to 5), started_at timestamp (set to current UTC time), updated_at timestamp (set to current UTC time), and finished_at (set to null).
2. WHEN the Dataprep_Pipeline completes a stage transition, THE Document_Repository SHALL update the Ingestion_Progress record with the new current_stage, increment stages_completed, reset stage_progress_percent to 0, and update the updated_at timestamp.
3. WHEN the Dataprep_Pipeline reports sub-step progress within a stage, THE Document_Repository SHALL update the stage_progress_percent field (integer 0-100) and the updated_at timestamp in the Ingestion_Progress record.
4. WHEN ingestion completes successfully, THE Document_Repository SHALL mark the Ingestion_Progress record with current_stage set to "Completed", stages_completed set to total_stages, stage_progress_percent set to 100, and finished_at set to the current UTC timestamp.
5. WHEN ingestion fails, THE Document_Repository SHALL mark the Ingestion_Progress record with current_stage preserved as the stage where failure occurred, a status field set to "error", and finished_at set to the current UTC timestamp.
6. THE Ingestion_Progress record SHALL define total_stages as 5, representing: Extraction, Chunking, Guardrail, Labeling, and Graph.
7. WHEN ingestion is re-triggered for a file that already has an Ingestion_Progress record, THE Document_Repository SHALL overwrite the existing record with fresh initial values as specified in criterion 1.

### Requirement 2: Ingestion Metrics Endpoint

**User Story:** As an Admin, I want a dedicated API endpoint to fetch the current ingestion progress of a file, so that the frontend can poll for live progress updates.

#### Acceptance Criteria

1. WHEN an authenticated Admin sends a GET request to /api/files/{fileId}/ingestion-progress, THE Document_Repository SHALL return the current Ingestion_Progress record for the specified file including: file_id, current_stage, stage_progress_percent, stages_completed, total_stages, started_at, updated_at, and finished_at (if terminal).
2. IF no Ingestion_Progress record exists for the specified file, THEN THE Document_Repository SHALL return a 404 response with an error message indicating that no ingestion progress was found for the given file identifier.
3. IF the fileId does not correspond to any existing file in the Document_Repository, THEN THE Document_Repository SHALL return a 404 response with an error message indicating the file was not found.
4. THE Ingestion_Metrics_Endpoint SHALL return a response within 200ms when the database query time is under 50ms.
5. THE Ingestion_Metrics_Endpoint SHALL require authentication and Admin, Manager, or AI Engineer role authorization.
6. IF a request to the Ingestion_Metrics_Endpoint fails authentication, THEN THE Document_Repository SHALL return a 401 response. IF a request fails role authorization, THEN THE Document_Repository SHALL return a 403 response.

### Requirement 3: Extraction Stage Progress Reporting

**User Story:** As an Admin, I want to see progress updates during the extraction stage (the longest step), so that I know the system is still processing and can estimate completion time.

#### Acceptance Criteria

1. WHEN the Dataprep_Pipeline starts the Extraction_Stage, THE Dataprep_Pipeline SHALL report stage_progress_percent as 0 (integer) to the Document_Repository via the ingestion-progress endpoint.
2. WHILE the Extraction_Stage is in progress, THE Dataprep_Pipeline SHALL report progress updates to the Document_Repository at intervals no greater than 30 seconds.
3. WHEN Docling provides page-level progress callbacks, THE Dataprep_Pipeline SHALL calculate stage_progress_percent as an integer in the range 0-100, computed as (pages_processed / total_pages) * 100, and report it to the Document_Repository.
4. IF Docling does not provide page-level progress, THEN THE Dataprep_Pipeline SHALL report heartbeat updates where stage_progress_percent remains at the last reported value and the message includes elapsed_seconds since the Extraction_Stage began.
5. WHEN the Extraction_Stage completes, THE Dataprep_Pipeline SHALL report stage_progress_percent as 100 and include the count of content elements extracted in the progress update message.
6. IF the Extraction_Stage fails with an exception, THEN THE Dataprep_Pipeline SHALL report a final progress update with stage_progress_percent at the last known value and a status field set to "error" before propagating the exception.

### Requirement 4: Auto-Refresh on Ingestion Log Tab

**User Story:** As an Admin, I want the ingestion log tab to automatically refresh while a document is being ingested, so that I can see new log entries appear without manually clicking refresh.

#### Acceptance Criteria

1. WHEN the Admin opens the Ingestion Log tab for a file with status "Ingesting", THE FileDetailsDialog SHALL start Auto_Refresh polling for new ingestion log entries.
2. WHILE Auto_Refresh is active on the Ingestion Log tab, THE FileDetailsDialog SHALL poll for new ingestion logs at a configurable interval with a default of 5 seconds and a minimum of 1 second.
3. WHEN new log entries are received during Auto_Refresh, THE FileDetailsDialog SHALL append the new entries to the displayed log table without clearing existing entries and SHALL preserve the Admin's current scroll position.
4. WHEN the file status changes to a terminal state ("Ingested", "Ingested with Warnings", "Ingestion Error", or "Killed"), THE FileDetailsDialog SHALL stop Auto_Refresh polling within the duration of one polling interval.
5. THE FileDetailsDialog SHALL allow the Admin to enable or disable Auto_Refresh on the Ingestion Log tab via a checkbox toggle control with a configurable interval input, matching the existing crawl dashboard auto-refresh pattern.
6. WHILE Auto_Refresh is active on the Ingestion Log tab, THE FileDetailsDialog SHALL display a visual indicator showing that auto-refresh is enabled and the timestamp of the last successful refresh.
7. WHEN the Admin navigates away from the Ingestion Log tab or closes the FileDetailsDialog, THE FileDetailsDialog SHALL stop Auto_Refresh polling and release the polling timer.
8. IF a polling request fails due to a network or server error, THEN THE FileDetailsDialog SHALL retain the currently displayed log entries, display an error notification, and continue polling on the next interval.

### Requirement 5: Ingestion Progress Indicator

**User Story:** As an Admin, I want to see an overall progress indicator showing the current ingestion stage and completion percentage, so that I can quickly assess how far along the ingestion process is.

#### Acceptance Criteria

1. WHILE a file has status "Ingesting", THE FileDetailsDialog SHALL display a progress indicator showing: current stage name, an overall progress bar representing the percentage calculated as ((stages_completed * 100) + stage_progress_percent) / total_stages, and elapsed time since ingestion started formatted as HH:MM:SS and updated each second.
2. THE FileDetailsDialog SHALL display the progress indicator on the Ingestion Log tab above the log table.
3. WHEN Ingestion_Progress data is refreshed, THE FileDetailsDialog SHALL update the progress indicator with the latest stage, percentage, and elapsed time without a full page reload.
4. THE FileDetailsDialog SHALL display all 5 stage names (Extraction, Chunking, Guardrail, Labeling, Graph) in pipeline order, where completed stages display a checkmark icon, the active stage displays an animated spinner icon, and pending stages display an inactive circle icon.
5. WHEN ingestion completes successfully, THE FileDetailsDialog SHALL display the progress indicator with the progress bar at 100%, all stages showing checkmark icons, and the total elapsed time displayed as the difference between finished_at and started_at.
6. IF ingestion fails, THEN THE FileDetailsDialog SHALL display the progress indicator with the failed stage highlighted using an error icon in place of the spinner, the progress bar stopped at the failure point, and a label identifying the stage name where failure occurred.
7. IF the file status is not "Ingesting" and no terminal Ingestion_Progress record (completed or error) exists for the file, THEN THE FileDetailsDialog SHALL hide the progress indicator on the Ingestion Log tab.

### Requirement 6: Dataprep Pipeline Progress Reporting Integration

**User Story:** As an Admin, I want all pipeline stages to report their progress back to the Document Repository, so that I get continuous feedback throughout the entire ingestion process.

#### Acceptance Criteria

1. WHEN the Dataprep_Pipeline transitions between stages (Extraction → Chunking → Guardrail → Labeling → Graph), THE Dataprep_Pipeline SHALL send a progress update to the Document_Repository with the new stage name, stages_completed count, and stage_progress_percent set to 0.
2. WHILE the Graph stage is processing batches, THE Dataprep_Pipeline SHALL report stage_progress_percent based on batches_completed divided by total_batches, at intervals no greater than 30 seconds.
3. WHILE the Labeling stage is processing chunks, THE Dataprep_Pipeline SHALL report stage_progress_percent based on chunks_labeled divided by total_chunks, at intervals no greater than 30 seconds.
4. THE Dataprep_Pipeline SHALL send progress updates via HTTP PATCH to the /api/files/{fileId}/ingestion-progress endpoint on the Document_Repository with a request timeout of 5 seconds.
5. IF a progress update request to the Document_Repository fails due to network error, timeout, or non-2xx HTTP response, THEN THE Dataprep_Pipeline SHALL log the failure and continue processing without retrying the failed update or interrupting the ingestion pipeline.
6. WHEN the Chunking or Guardrail stage completes, THE Dataprep_Pipeline SHALL report stage_progress_percent as 100 for that stage before transitioning to the next stage.
