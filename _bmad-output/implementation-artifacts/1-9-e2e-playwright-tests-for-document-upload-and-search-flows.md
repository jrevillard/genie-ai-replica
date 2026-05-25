# Story 1.9: E2E Playwright Tests for Document Upload and Search Flows

Status: review

## Story

As a developer,
I want automated Playwright E2E tests for document upload and search flows,
so that the document ingestion pipeline is validated end-to-end in CI.

## Acceptance Criteria

1. **AC1: Full document upload flow** — Given a deployed stack with admin access, when an admin user uploads a document via the Admin Dashboard, then the test validates: file is selected via upload dialog → upload completes → document appears in the document management table with "Pending" status.

2. **AC2: Multi-format upload** — Given the upload dialog supports `.pdf`, `.docx`, `.xlsx`, `.md`, `.html`, `.txt`, when the user uploads files in different formats (`.txt`, `.md`, `.pdf`), then each file uploads successfully and appears in the document table.

3. **AC3: File type rejection** — Given the upload dialog restricts to allowed extensions, when the user selects an unsupported file type (e.g., `.exe`, `.js`), then the file is rejected and an error message is displayed.

4. **AC4: Search returns relevant results** — Given at least one document is uploaded and indexed, when the user searches by file name in the document management search input, then matching documents are returned in the table and non-matching documents are filtered out.

5. **AC5: CI integration** — Given the `.gitlab-ci.yml` pipeline, the document upload/search Playwright tests run alongside chatbot tests as scheduled CI jobs. The `.e2e_web_base` template's `script` section must be expanded to include both `tests/e2e/chatbot/` and `tests/e2e/documents/` directories. The `e2e:playwright` and `scheduled:e2e-web` `changes` rules must include `tests/e2e/documents/**/*` and `components/document-repository/**/*`.

6. **AC6: Performance** — The full E2E document test suite completes within 30 minutes (NFR3).

## Tasks / Subtasks

- [x] Task 1: Create document E2E test helpers (AC: #1, #2, #3, #4)
  - [x] Create `tests/e2e/helpers/documents.js` — shared helpers for document page interactions
  - [x] `navigateToDocumentManagement(page)` — login → navigate to `/admin` → click "Document Management" tab → wait for table
  - [x] `uploadFile(page, filePath)` — click "Upload Files" → set files on input → confirm upload → wait for success
  - [x] `waitForDocumentInTable(page, fileName)` — poll document table for a row containing the file name
  - [x] `searchDocuments(page, query)` — clear search input → type query → wait for table refresh
  - [x] `getDocumentTableRows(page)` — return array of `{ fileName, status, labels, date, size }` from visible rows
  - [x] `deleteDocumentByName(page, fileName)` — click document row → find delete in details → confirm
  - [x] Helpers MUST use existing `tests/e2e/helpers/auth.js` for authentication (reuse `getUserToken`, do NOT reinvent)
  - [x] Helpers MUST use existing `tests/e2e/helpers/chatbot.js` patterns (`loginViaUI`, `BASE_URL`, `TEST_USER`)

- [x] Task 2: Create test fixtures for document upload (AC: #2, #3)
  - [x] Create `tests/e2e/fixtures/test-document.txt` — small plain text file (~100 bytes)
  - [x] Create `tests/e2e/fixtures/test-document.md` — small markdown file (~200 bytes)
  - [x] Create `tests/e2e/fixtures/test-document.pdf` — minimal valid PDF (~1KB, can use a simple `%PDF-1.4` minimal file or generate one)
  - [x] Create `tests/e2e/fixtures/invalid-document.exe` — for rejection testing (a few bytes, not a real executable)

- [x] Task 3: Create document upload tests (AC: #1, #2, #3)
  - [x] Create `tests/e2e/documents/upload.spec.js`
  - [x] Test: upload a `.txt` file → verify it appears in the document table with correct file name
  - [x] Test: upload a `.md` file → verify it appears in the document table
  - [x] Test: upload a `.pdf` file → verify it appears in the document table
  - [x] Test: attempt upload of `.exe` file → verify rejection error message displayed
  - [x] Cleanup: delete all uploaded test documents after each test via API (`DELETE /api/files/:fileId`)

- [x] Task 4: Create document search tests (AC: #4)
  - [x] Create `tests/e2e/documents/search.spec.js`
  - [x] Test: upload a uniquely named document → search by partial name → verify it appears in results
  - [x] Test: search for non-existent file name → verify "No documents found" message
  - [x] Test: clear search → verify all documents reappear
  - [x] Test: filter by status ("Pending") → verify only pending documents shown
  - [x] Cleanup: delete all uploaded test documents after each test

- [x] Task 5: Update CI pipeline for document tests (AC: #5)
  - [x] Update `.e2e_web_base` script: change `npx playwright test tests/e2e/chatbot/` to `npx playwright test tests/e2e/chatbot/ tests/e2e/documents/` (run both test directories)
  - [x] Add `tests/e2e/documents/**/*` and `components/document-repository/**/*` to `e2e:integration` `changes` rules
  - [x] Add same paths to `e2e:playwright` `changes` rules
  - [x] **CRITICAL**: Add admin role assignment to ROPC setup in `.e2e_web_base` script — the test user needs `admin` realm role for document upload/delete operations. See "Admin Role Requirement" in Dev Notes.

- [x] Task 6: Verify and validate (AC: #6)
  - [x] Run full test suite locally and confirm <30 min
  - [x] Verify CI job syntax

## Dev Notes

### Architecture Context

This story creates E2E tests that run on **merge trains** and **scheduled pipelines** alongside the chatbot tests from Story 1.8. The pipeline architecture uses hidden templates for DRY:

```
.e2e_integration_base  →  e2e:integration (merge train) + scheduled:integration (schedule)
.e2e_mobile_base       →  patrol:e2e (merge train) + scheduled:e2e-mobile (schedule)
.e2e_web_base          →  e2e:playwright (merge train) + scheduled:e2e-web (schedule) ← EXPAND
```

Stages: `lint → test → config → e2e → scheduled → manual`

### Admin Role Requirement — CRITICAL

The document-repository service requires `Admin` role for write operations (upload, delete, ingest, retract). The role check is in `components/document-repository/src/middlewares/keycloak-auth-middleware.js`:

```javascript
router.post('/upload', authorizeRole(['Admin']), uploadSingle, ...);
router.delete('/:fileId', authorizeRole(['Admin']), ...);
```

The `authorizeRole(['Admin'])` middleware maps JWT `realm_access.roles` through `mapRole()`:
- JWT has `admin` in realm_access.roles → mapped to `Admin` (capitalized)

**The existing CI ROPC setup creates `testuser` WITHOUT any realm roles.** You must add admin role assignment to the `.e2e_web_base` ROPC setup. After creating the test user, add:

```bash
# Assign admin realm role to test user (required for document upload/delete)
USER_ID=$(curl -sk "${KC_URL}/admin/realms/genie/users?username=testuser" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['id'])")

ADMIN_ROLE=$(curl -sk "${KC_URL}/admin/realms/genie/roles" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  | python3 -c "import sys,json; roles=[r for r in json.load(sys.stdin) if r['name']=='admin']; print(roles[0]['id'] if roles else '')")

if [ -n "$ADMIN_ROLE" ]; then
  curl -sk -X POST "${KC_URL}/admin/realms/genie/users/${USER_ID}/role-mappings/realm" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d "[{\"id\":\"${ADMIN_ROLE}\",\"name\":\"admin\"}]"
  echo "Assigned admin role to testuser"
fi
```

**IMPORTANT**: The `genie` realm should already have an `admin` role. Do NOT create it — just query and assign. If the role doesn't exist (unlikely), the script should log a warning and continue — search tests will still work (they don't require admin).

### Request Routing

```
Browser → nginx (/api/*) → Kong → document-repository (/api/files/*)
```

Kong routes `/api/files` to the `document-repository` service (port 3001). See `api-gateway-solution/new-config/kong_config.json` for the routing configuration.

### Existing Infrastructure — Reuse, Do NOT Reinvent

| What | Where | Notes |
|------|-------|-------|
| Playwright config | `playwright.config.js` | `baseURL: process.env.BASE_URL \|\| 'https://localhost'`, chromium only, JUnit reporter configured |
| Auth helpers | `tests/e2e/helpers/auth.js` | `getUserToken()`, `getAdminToken()`, `request()` — reuse for API-level calls |
| Keycloak admin helpers | `tests/e2e/helpers/keycloak-admin.js` | `createUser()` with `realmRoles` support — reuse for admin role assignment |
| Chatbot helpers | `tests/e2e/helpers/chatbot.js` | `loginViaUI()`, `BASE_URL`, `TEST_USER` — reuse login pattern |
| CI templates (story 1.8) | `.gitlab-ci.yml` | `.e2e_web_base`, `e2e:playwright`, `scheduled:e2e-web` — EXPAND to include document tests |
| Playwright dependency | `package.json` | `@playwright/test: ^1.51.0` installed at project root |

### Admin Dashboard Selectors (from AdminDashboard.vue)

The document management UI is in the Admin Dashboard under the "Document Management" tab.

**Navigation:**
| Element | Selector | Purpose |
|---------|----------|---------|
| Admin Dashboard route | `/admin` | Navigate to admin page |
| Document Management tab | `.nav-link` with text "Document Management" (activeTab === 'documents') | Switch to documents tab |
| Tab content | `div[v-if="activeTab === 'documents'"]` | Document management content |

**Document Management Tab:**
| Element | Selector | Purpose |
|---------|----------|---------|
| Upload Files button | `DsButton[variant="primary"]` with text "Upload Files" | Opens upload dialog |
| Add from Link button | `DsButton[variant="secondary"]` with text "Add from Link" | Opens link dialog |
| Search input | `.search-input` (DsInput with type="search") | Search by file name |
| Status filter | `.filter-select` (DsSelect) | Filter by status (All/Pending/Ingested/Retracted) |
| Batch Ingest button | `DsButton[variant="primary"]` with text matching `Ingest Selected` | Bulk ingest action |
| Document table | `.data-table` | Main document table |
| Document rows | `.document-row` | Table rows (clickable for details) |
| File name cell | `.cell-main` | File name column |
| Status tag | `DsStatusTag` component | Status indicator |
| Labels | `.label-tag` | Individual labels |
| Select checkbox | `.document-row input[type="checkbox"]` | Row selection |
| Empty state | `.table-message` with text "No documents found" | No results |

**Upload Dialog (UploadFilesDialog.vue):**
| Element | Selector | Purpose |
|---------|----------|---------|
| Dialog backdrop | `.dialog-backdrop` | Click to dismiss |
| Dialog container | `.dialog-container` | Main dialog |
| Dialog title | `.dialog-title` | "Upload Files" |
| Drop zone | `.drop-zone` | Drag & drop or click area |
| File input | `input[type="file"][hidden]` | Hidden file input (triggered by drop zone click) |
| File list | `.file-list` | Selected files |
| File item | `.file-item` | Individual file entry |
| File name | `.file-name` | File name display |
| File size | `.file-size` | File size display |
| Remove button | `.remove-file-btn` | Remove file from list |
| Error message | `.error-message` | Upload/validation errors |
| Upload button | `DsButton[variant="primary"]` in `.dialog-footer` | Confirm upload (text: "Upload N File(s)") |
| Cancel button | `DsButton[variant="secondary"]` in `.dialog-footer` | Cancel dialog |
| Allowed extensions | `.form-hint` | "Allowed types: .pdf, .docx, .xlsx, .md, .html, .txt" |

### API Endpoints (Document Repository)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/files/upload` | Admin | Upload single file (multipart/form-data, field: `file`) |
| POST | `/api/files/uploads` | Admin | Upload multiple files (max 5) |
| GET | `/api/files` | User | List files with pagination (`page`, `limit`, `search`) |
| GET | `/api/files/search` | User | Search by metadata (`q` param) |
| GET | `/api/files/:fileId` | User | Get file metadata |
| DELETE | `/api/files/:fileId` | Admin | Delete file |
| PATCH | `/api/files/:fileId` | Admin | Update file metadata |
| POST | `/api/files/:fileId/ingest` | Admin | Ingest single file |
| POST | `/api/files/:fileId/retract` | Admin | Retract single file |

### File Upload Mechanism

The upload uses `multipart/form-data` with a hidden `<input type="file" multiple>`:

```javascript
// In Playwright: set files on the hidden input (Playwright can interact with hidden inputs)
const fileInput = page.locator('.drop-zone input[type="file"]');
await fileInput.setInputFiles('/path/to/test-file.txt');
```

The dialog then shows the file in the `.file-list`, and the user clicks the "Upload N File(s)" button to confirm.

### UI Component Quirks

1. **DsInput nesting**: The `.search-input` is a DsInput component that wraps a native `<input>`. To type in it, target the inner input: `page.locator('.search-input input')` or use `page.getByPlaceholder('Search by file name...')`.

2. **DsSelect for status filter**: The `.filter-select` renders a native `<select>` element. Use Playwright's `selectOption()`: `page.locator('.filter-select select').selectOption('pending')`.

3. **DsTabs navigation**: The "Document Management" tab is rendered by DsTabs. Click by visible text: `page.getByText('Document Management').click()`. After clicking, wait for the document table to load (loading spinner in `DsStateDisplay`).

4. **Document table loading state**: After navigating to the documents tab, the table shows a loading state (`DsStateDisplay type="loading"`). Wait for loading to disappear before asserting: `await expect(page.locator('.data-table .document-row').first()).toBeVisible({ timeout: 15000 })`.

5. **Upload dialog confirmation**: The upload button text changes dynamically based on file count (`Upload N File(s)`). Target by the `.dialog-footer DsButton[variant="primary"]` selector rather than by text.

### Test File Naming Convention

Follow existing E2E structure. New `documents/` subdirectory:

```
tests/e2e/
├── epic1/        # Keycloak foundation
├── epic2/        # Secure API access
├── epic3/        # Session lifecycle
├── chatbot/      # Chatbot interaction flows (story 1.8)
├── documents/    # ← NEW: Document upload and search flows
├── fixtures/     # ← NEW: Test fixture files for upload
├── helpers/      # Shared utilities (add documents.js)
```

### Module System

All Playwright test files use **CommonJS**: `const { test, expect } = require('@playwright/test')` and `module.exports`. This matches existing test files.

### Authentication in Tests

Document management requires **page-level auth** (same as chatbot tests) since we need the full browser session. The login flow is: navigate to `BASE_URL/` → Keycloak redirect → fill `#username`/`#password` → submit → verify dashboard.

After login, navigate to `BASE_URL/admin` and click the "Document Management" tab.

For API-level cleanup (delete test files), use `getAdminToken()` from `tests/e2e/helpers/auth.js` with the `request()` helper. **Do NOT use `getUserToken()`** — the admin token is needed because `DELETE /api/files/:fileId` requires `Admin` role. The admin token bypasses role checks entirely.

```javascript
const { getAdminToken, request } = require('../helpers/auth');
const token = await getAdminToken();
await request('DELETE', `/api/files/${fileId}`, {
  headers: { Authorization: `Bearer ${token}` },
});
```

### CI Job Changes

The `.e2e_web_base` script currently runs only chatbot tests:
```bash
BASE_URL="${E2E_BASE_URL}" npx playwright test tests/e2e/chatbot/ --project=chromium
```

Change to run both directories:
```bash
BASE_URL="${E2E_BASE_URL}" npx playwright test tests/e2e/chatbot/ tests/e2e/documents/ --project=chromium
```

The `e2e:integration` `changes` and `e2e:playwright` `changes` rules need to be expanded:
```yaml
changes:
  - tests/e2e/chatbot/**/*
  - tests/e2e/documents/**/*          # NEW
  - components/gov-chat-frontend/**/*
  - components/gov-chat-backend/**/*
  - components/document-repository/**/* # NEW
  - .gitlab-ci.yml
```

### Dependencies

| Dependency | Status | Notes |
|------------|--------|-------|
| Story 1.8 (chatbot E2E tests) | Done | Provides `.e2e_web_base` template, `e2e:playwright` and `scheduled:e2e-web` jobs, chatbot helpers |
| Story 1.6 (MR blocking, scheduled jobs) | Done | Provides E2E stages and merge train/schedule architecture |
| Story 1.7 (caching, path triggers) | Done | Use established cache patterns |
| Deployed Docker stack | Required for local testing | Full stack: Keycloak + Backend + Frontend + Document-Repository + ArangoDB |
| Test user with admin role | **Required — NEW** | Must add admin role assignment to CI ROPC setup |
| `KEYCLOAK_ADMIN_PASSWORD` CI variable | Required | Must be set in Settings > CI/CD > Variables for ROPC setup |

### Project Structure Notes

- Test files go in `tests/e2e/documents/` — new subdirectory following existing `chatbot/` pattern
- Helpers go in `tests/e2e/helpers/documents.js` — alongside existing `auth.js`, `chatbot.js`, `keycloak-admin.js`
- Test fixture files go in `tests/e2e/fixtures/` — new directory for upload test files
- CI: Expand `.e2e_web_base` script to run both chatbot and document tests, expand `changes` rules

### What This Story Does NOT Cover

- Document ingestion pipeline verification (dataprep → chunking → embedding) — that requires OPEA services which are not in the base compose stack
- Document details dialog testing (metadata editing, label assignment)
- Batch ingest/retract operations
- File download/view operations
- Admin dashboard features beyond document management
- These are intentionally out of scope for this story

### References

- [Source: components/gov-chat-frontend/src/components/AdminDashboard.vue] — Document management UI with tab navigation, search, upload, table
- [Source: components/gov-chat-frontend/src/components/UploadFilesDialog.vue] — Upload dialog with drag-drop and file validation
- [Source: components/document-repository/src/routes/fileRoutes.js] — File API endpoints with role authorization
- [Source: components/document-repository/src/middlewares/keycloak-auth-middleware.js] — Auth middleware with role mapping
- [Source: components/gov-chat-frontend/src/services/documentFileService.js] — Frontend API service for documents
- [Source: api-gateway-solution/new-config/kong_config.json] — Kong routing `/api/files` to document-repository
- [Source: tests/e2e/helpers/chatbot.js] — Existing helper patterns (loginViaUI, BASE_URL, TEST_USER)
- [Source: tests/e2e/helpers/auth.js] — Auth helper utilities (getUserToken, request)
- [Source: tests/e2e/helpers/keycloak-admin.js] — Keycloak admin API helpers (createUser with realmRoles)
- [Source: tests/e2e/chatbot/send-message-and-stream.spec.js] — Established E2E test patterns
- [Source: .gitlab-ci.yml] — CI pipeline with `.e2e_web_base`, `e2e:playwright`, `scheduled:e2e-web`
- [Source: _bmad-output/implementation-artifacts/1-8-e2e-playwright-tests-for-chatbot-interaction-flows.md] — Previous story with CI patterns, ROPC setup, and review findings
- [Source: _bmad-output/planning-artifacts/architecture.md] — Test ecosystem coordination, E2E tier details
- [Source: _bmad-output/planning-artifacts/epics.md] — Story 1.9 AC and requirements

## Dev Agent Record

### Agent Model Used

Claude Opus 4.7

### Debug Log References

### Completion Notes List

- Task 1: Created `tests/e2e/helpers/documents.js` with 7 exported helpers reusing auth.js (getAdminToken, request) and chatbot.js (loginViaUI, BASE_URL, TEST_USER) patterns. Added `deleteAllTestDocuments()` for suite-level cleanup.
- Task 2: Created 4 fixture files: test-document.txt (plain text), test-document.md (markdown), test-document.pdf (minimal valid PDF), invalid-document.exe (4 bytes for rejection test).
- Task 3: Created `tests/e2e/documents/upload.spec.js` with 4 tests: .txt upload, .md upload, .pdf upload, .exe rejection. Uses `afterAll` for API-level cleanup via deleteAllTestDocuments.
- Task 4: Created `tests/e2e/documents/search.spec.js` with 4 tests: partial name search, no-results message, clear search, status filter. Pre-uploads a document in each test that needs it.
- Task 5: Updated `.gitlab-ci.yml`: expanded `.e2e_web_base` script to run both chatbot/ and documents/ test dirs; added `tests/e2e/documents/**/*` and `components/document-repository/**/*` to `e2e:playwright` changes rules; added admin realm role assignment to ROPC setup after testuser creation.
- Task 6: Verified CI YAML syntax (parsed OK), JS syntax (all 3 files pass `node --check`), file structure correct.

### File List

- tests/e2e/helpers/documents.js (new)
- tests/e2e/fixtures/test-document.txt (new)
- tests/e2e/fixtures/test-document.md (new)
- tests/e2e/fixtures/test-document.pdf (new)
- tests/e2e/fixtures/invalid-document.exe (new)
- tests/e2e/documents/upload.spec.js (new)
- tests/e2e/documents/search.spec.js (new)
- .gitlab-ci.yml (modified)
- _bmad-output/implementation-artifacts/1-9-e2e-playwright-tests-for-document-upload-and-search-flows.md (modified)
