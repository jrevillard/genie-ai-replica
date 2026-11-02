# Requirements Document

## Introduction

This feature adds a GPU VM status panel to the GenieAI application, enabling all authenticated users to see whether the GPU VM is online or offline and to request that an administrator start the GPU VM when it is down. Administrators receive these requests as notifications in the Admin Dashboard (following the same pattern as pending user approvals) and optionally via email. The goal is to optimize GPU VM uptime costs by keeping the GPU VM turned off when not needed while ensuring users can easily request its activation when GPU-powered features (LLM inference, embeddings, reranking) are required.

## Glossary

- **GPU_Status_Service**: The backend service component responsible for checking GPU tier health and managing GPU start requests
- **GPU_Status_Indicator**: The frontend UI component visible to all authenticated users that displays the current GPU VM operational status
- **GPU_Start_Request**: A user-submitted request asking an administrator to start the GPU VM
- **Admin_Notification_Panel**: The section within the Admin Dashboard that displays pending GPU start requests alongside other admin notifications
- **Health_Monitor**: The existing component (from infrastructure-split spec) that polls GPU tier health endpoints (vLLM:8000/health, TEI:7000/health, TEI_Reranker:7100/health)
- **Backend**: The Express.js backend application handling API requests
- **Frontend**: The Vue.js frontend application
- **Admin_Dashboard**: The existing system administration interface (AdminDashboard.vue) accessible to admin users
- **Authenticated_User**: Any user who has successfully logged in to the system regardless of role
- **Admin_User**: A user with the Admin role who can manage the system

## Requirements

### Requirement 1: GPU Tier Health Status Endpoint

**User Story:** As an authenticated user, I want the backend to expose the GPU VM health status, so that the frontend can display whether GPU services are available.

#### Acceptance Criteria

1. THE Backend SHALL expose a GET endpoint at /api/gpu-status that returns HTTP 200 with a JSON response containing a "status" field set to "online", "degraded", or "offline", and a "timestamp" field indicating when the status was last evaluated
2. THE GPU_Status_Service SHALL determine the GPU tier status by querying the Health_Monitor data for vLLM (port 8000/health), TEI (port 7000/health), and TEI_Reranker (port 7100/health), applying a per-endpoint timeout of 5 seconds after which a non-responding endpoint is treated as not returning HTTP 200
3. WHEN all three GPU tier health endpoints return HTTP 200 within the timeout period, THE GPU_Status_Service SHALL report the GPU tier status as "online"
4. WHEN at least one but not all GPU tier health endpoints return HTTP 200 within the timeout period, THE GPU_Status_Service SHALL report the GPU tier status as "degraded"
5. WHEN no GPU tier health endpoints return HTTP 200 within the timeout period, THE GPU_Status_Service SHALL report the GPU tier status as "offline"
6. THE Backend SHALL require authentication (valid JWT token) for the /api/gpu-status endpoint but SHALL NOT require the Admin role
7. THE GPU_Status_Service SHALL cache the health status result for a configurable duration defaulting to 30 seconds to avoid excessive polling of the GPU tier
8. IF the GPU_Status_Service cannot reach any health endpoint due to network failure or the Health_Monitor being unavailable and no cached result exists, THEN THE Backend SHALL return HTTP 200 with the status field set to "offline" and an additional "error" field indicating the health check is unreachable

### Requirement 2: GPU Status Indicator for All Users

**User Story:** As an authenticated user, I want to see the GPU VM status displayed on the main interface, so that I know whether GPU-powered features (chat AI, document processing) are currently available.

#### Acceptance Criteria

1. THE GPU_Status_Indicator SHALL be visible on the main chat interface header area to all Authenticated_Users without requiring navigation to the Admin_Dashboard
2. WHEN the GPU tier status is "online", THE GPU_Status_Indicator SHALL display a green indicator with the label "GPU Online"
3. WHEN the GPU tier status is "degraded", THE GPU_Status_Indicator SHALL display an amber indicator with the label "GPU Degraded"
4. WHEN the GPU tier status is "offline", THE GPU_Status_Indicator SHALL display a red indicator with the label "GPU Offline"
5. THE Frontend SHALL poll the /api/gpu-status endpoint at a configurable interval defaulting to 60 seconds (minimum 10 seconds, maximum 300 seconds) to update the GPU_Status_Indicator
6. WHEN the GPU tier status is "offline", THE GPU_Status_Indicator SHALL display a "Request GPU Start" button allowing the user to submit a GPU_Start_Request
7. IF the /api/gpu-status endpoint returns an error (network failure or HTTP 5xx), THEN THE GPU_Status_Indicator SHALL display a grey indicator with the label "Status Unknown" and resume normal polling on the next interval
8. WHEN the user clicks the "Request GPU Start" button, THE GPU_Status_Indicator SHALL disable the button, display a loading state, and upon receiving a successful response from the backend, show a confirmation message indicating the start request was submitted
9. IF the GPU_Start_Request fails (network error or non-2xx response), THEN THE GPU_Status_Indicator SHALL re-enable the "Request GPU Start" button and display an error message indicating the request could not be submitted
10. WHILE the Frontend has not yet received a response from the first /api/gpu-status poll, THE GPU_Status_Indicator SHALL display a grey indicator with the label "Checking GPU Status"

### Requirement 3: GPU Start Request Submission

**User Story:** As an authenticated user, I want to submit a request to start the GPU VM, so that an administrator is notified and can activate GPU services when I need them.

#### Acceptance Criteria

1. WHEN an Authenticated_User clicks the "Request GPU Start" button, THE Frontend SHALL send a POST request to /api/gpu-start-requests with an optional message field limited to a maximum of 500 characters
2. THE Backend SHALL expose a POST endpoint at /api/gpu-start-requests that creates a new GPU_Start_Request record and returns HTTP 201 with the created request identifier and timestamp
3. THE Backend SHALL require authentication for the /api/gpu-start-requests POST endpoint but SHALL NOT require the Admin role
4. WHEN a GPU_Start_Request is created, THE GPU_Status_Service SHALL store the request with the requesting user identifier, timestamp, optional message, and a status of "pending"
5. IF an Authenticated_User already has a pending GPU_Start_Request (status "pending"), THEN THE Backend SHALL reject additional requests from the same user with HTTP 409 and a message indicating that a pending request already exists
6. WHEN a GPU_Start_Request is successfully created, THE Frontend SHALL display a confirmation notification to the user indicating that the request has been submitted
7. THE GPU_Status_Service SHALL store GPU_Start_Requests in the ArangoDB database in a collection named "gpu_start_requests"
8. IF the POST request to /api/gpu-start-requests fails with a non-409 error (network failure or HTTP 5xx), THEN THE Frontend SHALL display an error notification to the user indicating that the request could not be submitted and allow the user to retry
9. IF the message field exceeds 500 characters, THEN THE Backend SHALL reject the request with HTTP 400 and a message indicating the maximum allowed length

### Requirement 4: Admin Notification for GPU Start Requests

**User Story:** As an administrator, I want to see pending GPU start requests in the Admin Dashboard, so that I can decide whether to start the GPU VM.

#### Acceptance Criteria

1. THE Admin_Dashboard SHALL display a "GPU Requests" section showing pending GPU_Start_Requests, following the same layout pattern as the existing pending users approval list (list of cards with user info and action buttons)
2. THE Backend SHALL expose a GET endpoint at /admin/gpu-start-requests that returns all GPU_Start_Requests with status "pending" ordered by submission timestamp descending, limited to a maximum of 100 records, protected by authentication and Admin role middleware
3. THE Backend SHALL expose a GET endpoint at /admin/gpu-start-requests/count that returns the count of pending GPU_Start_Requests as a numeric value, protected by authentication and Admin role middleware
4. THE Admin_Dashboard SHALL display a badge count on the "GPU Requests" navigation item showing the number of pending requests, displaying "99+" when the count exceeds 99, and SHALL poll the /admin/gpu-start-requests/count endpoint at the same interval as the main GPU status polling (defaulting to 60 seconds)
5. WHEN an Admin_User views the GPU Requests section, THE Admin_Dashboard SHALL display each pending request with the requester full name, email address, submission timestamp in ISO 8601 format localized to the browser timezone, and optional message truncated to 500 characters with a "show more" expansion if longer
6. THE Admin_Dashboard SHALL provide "Acknowledge" and "Dismiss" action buttons for each pending GPU_Start_Request, where "Dismiss" SHALL present an optional text input for a reason limited to 500 characters
7. WHEN an Admin_User clicks "Acknowledge" on a GPU_Start_Request, THE Backend SHALL expose a PATCH endpoint at /admin/gpu-start-requests/{requestId}/acknowledge, protected by authentication and Admin role middleware, that updates the request status to "acknowledged" with the admin user identifier and current server timestamp
8. WHEN an Admin_User clicks "Dismiss" on a GPU_Start_Request, THE Backend SHALL expose a PATCH endpoint at /admin/gpu-start-requests/{requestId}/dismiss, protected by authentication and Admin role middleware, that updates the request status to "dismissed" with the admin user identifier, current server timestamp, and optional reason (maximum 500 characters)
9. IF an Admin_User attempts to acknowledge or dismiss a GPU_Start_Request that is no longer in "pending" status, THEN THE Backend SHALL reject the request with HTTP 409 and a message indicating the request has already been processed
10. IF the /admin/gpu-start-requests endpoint returns an error, THEN THE Admin_Dashboard SHALL display an error message indicating that GPU requests could not be loaded and SHALL provide a retry option

### Requirement 5: Email Notification to Administrators

**User Story:** As an administrator, I want to receive an email when a GPU start request is submitted, so that I am alerted even when not actively viewing the Admin Dashboard.

#### Acceptance Criteria

1. WHEN a new GPU_Start_Request is created, THE GPU_Status_Service SHALL send an email notification to all Admin_Users with a non-null and non-empty email address using the existing email-service, without blocking the HTTP response to the requesting user
2. THE email notification SHALL include a subject line containing the application name and an indication that a GPU start request was submitted, and the email body SHALL include the requester name, requester email, submission timestamp in ISO 8601 format, optional message (if provided), and a link to the Admin Dashboard GPU Requests section derived from the FRONTEND_URL environment variable
3. IF the email-service fails to send the notification to one or more Admin_Users, THEN THE GPU_Status_Service SHALL log the failure including the count of successful and failed deliveries and continue processing without affecting the request creation or the HTTP response status
4. WHERE email notifications are disabled via the DISABLE_GPU_REQUEST_EMAILS environment variable set to "true", THE GPU_Status_Service SHALL skip email sending for GPU start requests

### Requirement 6: GPU Status in Admin Dashboard Overview

**User Story:** As an administrator, I want to see the GPU VM status prominently in the Admin Dashboard, so that I have a complete system overview including GPU tier health.

#### Acceptance Criteria

1. THE Admin_Dashboard overview tab SHALL display the GPU tier status as a status card showing the status value ("online", "degraded", or "offline") with the same color indicators used by the GPU_Status_Indicator (green for online, amber for degraded, red for offline), positioned alongside existing system metrics
2. WHILE the GPU tier status is "offline", THE Admin_Dashboard overview SHALL display the count of pending GPU_Start_Requests (retrieved from the /admin/gpu-start-requests/count endpoint) alongside the status card
3. THE Admin_Dashboard SHALL poll the /api/gpu-status endpoint to refresh the GPU tier status at the same configurable polling interval as the main interface GPU_Status_Indicator (defaulting to 60 seconds)
4. WHEN the GPU_Status_Service detects a GPU tier transition from "offline" to "online" (by comparing the current polled status against the previously cached status), THE GPU_Status_Service SHALL update all GPU_Start_Requests with status "pending" to status "resolved" with a resolution note of "GPU tier came online" within one polling cycle (no more than 30 seconds after detecting the transition)
5. IF the /api/gpu-status endpoint returns an error (network failure or HTTP 5xx) when polled by the Admin_Dashboard, THEN THE Admin_Dashboard SHALL display the status card with a grey indicator and the label "Status Unknown" and SHALL retain the last successfully retrieved status value internally until the next successful poll

### Requirement 7: Request History and Cleanup

**User Story:** As an administrator, I want resolved and dismissed GPU start requests to be retained for audit purposes, so that I can review patterns of GPU usage demand.

#### Acceptance Criteria

1. THE Backend SHALL expose a GET endpoint at /admin/gpu-start-requests/history that returns GPU_Start_Requests with status "acknowledged", "dismissed", or "resolved", protected by authentication and Admin role middleware, where each record includes the requester name, requester email, submission timestamp, optional message, current status, acting admin identifier, and action timestamp
2. THE history endpoint SHALL support pagination with limit and offset query parameters, defaulting to a limit of 50 records ordered by timestamp descending, where limit accepts values between 1 and 200 inclusive and offset accepts values of 0 or greater
3. IF the history endpoint receives a limit or offset value that is non-numeric, negative, or exceeds the allowed range, THEN THE Backend SHALL reject the request with HTTP 400 and a message indicating the invalid parameter
4. THE GPU_Status_Service SHALL retain GPU_Start_Request records for a configurable duration controlled by the GPU_REQUEST_RETENTION_DAYS environment variable, defaulting to 90 days before automatic deletion
5. THE GPU_Status_Service SHALL execute a cleanup cycle at a configurable interval defaulting to every 24 hours, deleting only GPU_Start_Request records with status "acknowledged", "dismissed", or "resolved" whose creation timestamp exceeds the retention period
6. WHILE a GPU_Start_Request record has status "pending", THE GPU_Status_Service SHALL NOT delete the record regardless of its age
