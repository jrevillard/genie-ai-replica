# Story 3-8: Test Frontend Component Branches and Functions

Status: ready-for-dev

## Story

As a developer,
I want to extend existing component tests to cover conditional branches and untested functions,
So that branches/functions coverage reaches professional levels (~55%).

## Acceptance Criteria

1. **AC1: AdminDashboard** — test all tabs (system-health, user-stats, security, logs, diagnostics), loading/error states, conditional rendering, admin-only sections
2. **AC2: UserProfileComponent** — test form validation rules, submission flows, file upload, error paths, protected field handling
3. **AC3: ChatBotComponent** — test streaming response handling, error recovery, message type rendering (text/code/markdown), abort handling
4. **AC4: FileDetailsDialog** — test file metadata editing, permission checks, conditional sections, download/preview actions
5. **AC5: LogSearchDialog** — test search filters, date range selection, result pagination, term highlighting
6. **AC6: Remaining services** — extend chatbotService (40%→80%), chatHistoryService (80%→95%), documentFileService (68%→90%)
7. **AC7: Coverage target** — branches ≥55%, functions ≥55%
8. **AC8: Regression safety** — all existing tests pass, zero lint errors

## Tasks / Subtasks

- [ ] Task 1: Extend `src/__tests__/components/AdminDashboard.test.js` (AC1)
  - [ ] 1a: Tab switching — test `setActiveTab()` for each tab, verify content renders
  - [ ] 1b: Dirty state protection — test `isFormDirty` computed prevents tab switch
  - [ ] 1c: Loading/error states — test `DsStateDisplay` conditions per tab
  - [ ] 1d: Multi-column sorting — test `sortBy()` with toggle and `sortOrders`
  - [ ] 1e: `showIngestButton` computed — test conditional logic
  - [ ] 1f: Confirm dialog — test `showConfirmDialog()` / `resetConfirmDialog()`
- [ ] Task 2: Extend `src/__tests__/components/UserProfileComponent.test.js` (AC2)
  - [ ] 2a: Form validation — test `validateForm()` per tab, `isTabComplete()` per tab type
  - [ ] 2b: Country dropdown handlers — test `onNationalityChange`, `onCountryChange`, `updateNationalityName`
  - [ ] 2c: Profile icon management — test `selectPresetIcon`, `handleFileUpload`, `useInitials`, `getInitials`
  - [ ] 2d: Tab switch with `restoreCountryState()` via `activeTab` watcher
  - [ ] 2e: Submission flow — test `isSubmitting` state, success/error paths
- [ ] Task 3: Extend `src/__tests__/components/ChatBotComponent.test.js` (AC3)
  - [ ] 3a: SSE streaming — test `isStreaming` state, `streamController` abort
  - [ ] 3b: `sendMessage()` error recovery — test network failure, retry
  - [ ] 3c: Markdown rendering — test `renderMarkdown()` for text, code blocks, links
  - [ ] 3d: Quick help — test `selectQuickHelpOption()` with `hiddenPromptForNextMessage`
  - [ ] 3e: Dialog management — feedback, save chat, export
  - [ ] 3f: `hasUnsavedChanges()` computed
- [ ] Task 4: Create `src/__tests__/components/FileDetailsDialog.test.js` (AC4)
  - [ ] 4a: Setup mock infrastructure (`fileId` prop, `documentFileService`, `serviceTreeService`), Teleport stub, `jest.useFakeTimers()`
  - [ ] 4b: Tab visibility — test `visibleTabs` computed for different file states
  - [ ] 4c: Label management — test `areAllLabelsSelected` getter/setter, `mapEnglishToLocale`
  - [ ] 4d: File operations — test `handleSave`, `handleIngest`, `handleRetract`, `handleDelete`
  - [ ] 4e: `mainAction` computed — test dynamic button per file status
  - [ ] 4f: `canViewInternalFile`, `isMetadataEditable` computed properties
  - [ ] 4g: Dashboard timer — test `startDashboardTimer` with fake timers, auto-refresh toggle, `afterEach` cleanup
  - [ ] 4h: Emit events — test `close`, `file-updated`, `action-triggered` emissions
- [ ] Task 5: Create `src/__tests__/components/LogSearchDialog.test.js` (AC5)
  - [ ] 5a: Setup mock infrastructure (NO props, `adminDashboardService` mock)
  - [ ] 5b: `performSearch()` — test with preset date range vs custom date range
  - [ ] 5c: `resetSearch()` — verify form reset to defaults
  - [ ] 5d: `exportLogs()` — test CSV generation, field escaping
  - [ ] 5e: Conditional rendering — custom date fields, loading state, export button
  - [ ] 5f: Emit events — test `close`, `search-completed` emissions
- [ ] Task 6: Extend `src/__tests__/services/chatbotService.test.js` (AC6)
  - [ ] 6a: `submitQueryStream()` — test onChunk, onMetadata, onTranslation, onDone, onError callbacks
  - [ ] 6b: `updateQueryResponseTime()` — test response time tracking
  - [ ] 6c: `markQueryAsAnswered()` — test query state update
  - [ ] 6d: `submitFeedback()` — test feedback submission
- [ ] Task 7: Extend `src/__tests__/services/chatHistoryService.test.js` (AC6)
  - [ ] 7a: Folder management — `createFolder`, `updateFolder`, `deleteFolder`, `reorderFolders`
  - [ ] 7b: Folder-conversation — `addConversationToFolder`, `moveConversation`, `removeConversationFromFolder`
  - [ ] 7c: Search — `searchConversations`, `searchFolders`
  - [ ] 7d: `getUserConversationStats`, `getRecentConversations`
- [ ] Task 8: Extend `src/__tests__/services/documentFileService.test.js` (AC6)
  - [ ] 8a: Crawl operations — `scheduleSiteCrawl`, `getCrawlJob`, `getCrawlMetrics`, `getCrawlLogs`, `killCrawl`
  - [ ] 8b: Batch operations — `ingestMultipleFiles`, `retractMultipleFiles`
  - [ ] 8c: `killIngestion`, `getIngestionLogs`
  - [ ] 8d: `uploadLink` — test URL-based upload
- [ ] Task 9: Run coverage report to verify ≥55% branches/functions
- [ ] Task 10: Run full regression suite and lint

## Dev Notes

### Current Coverage Baseline (verified 2026-05-26)

| Category | Statements | Branches | Functions |
|----------|-----------|----------|-----------|
| **Overall** | 79.32% | 45.96% | 46.45% |
| Components | 70.57% | 19.65% | 11.22% |
| Services | 82.35% | 76.05% | 90.85% |
| Store | 94.06% | 79.72% | 100% |
| Utils | 93.47% | 95% | 86.66% |

**758 tests across 42 test suites passing.**

The gap is almost entirely in **component branches and functions** (19.65% / 11.22%). Services are already strong.

### Per-File Status

| File | Lines | Tests | Stmt% | Action |
|------|-------|-------|-------|--------|
| AdminDashboard.test.js | 477 | 22 | 77% | EXTEND — add tabs, sorting, dialogs |
| UserProfileComponent.test.js | 435 | 24 | 48% | EXTEND — add validation, icons, country dropdowns |
| ChatBotComponent.test.js | 359 | 14 | 70% | EXTEND — add streaming, markdown, dialogs |
| FileDetailsDialog.test.js | — | — | — | CREATE — 1888-line component, zero tests |
| LogSearchDialog.test.js | — | — | — | CREATE — 750-line component, zero tests |
| chatbotService.test.js | 172 | 12 | 40% | EXTEND — add streaming, feedback, response time |
| chatHistoryService.test.js | 495 | 44 | 80% | EXTEND — add folder CRUD, search, stats |
| documentFileService.test.js | 280 | 20 | 68% | EXTEND — add crawl, batch, kill operations |

### Component Internal Structure

#### AdminDashboard.vue — Key Untested Areas

Data: `activeTab`, `tabs` (5 tabs), `isLoading`, `healthServices`, `resourceUsage`, `errorLogsSummary`, `warningLogsSummary`, `knowledgeHierarchy`, `documents`, `sortKey`, `sortOrders`, `confirmDialogState`, `hierarchyForm`

Computed:
- `adminTabs` — translated tab labels via `translate()`
- `isFormDirty` — unsaved changes detection (blocks tab switch)
- `displayedUsers` — user list filtering
- `filteredDocuments` / `sortedAndFilteredDocuments` — combined filter+sort
- `showIngestButton` — conditional ingest button logic

Methods:
- `setActiveTab(tab)` — with dirty state protection
- `loadDataForTab(tab)` — lazy data loading per tab
- `sortBy(key)` — multi-column sort with toggle
- `showConfirmDialog()` / `resetConfirmDialog()` — dialog management
- `getUsageLevel(value, thresholds)` — resource classification
- `handleDocumentPagination(direction)` — pagination
- `showNotification(type, message)` — event bus emit

Conditional rendering: `v-if` per tab content, `DsStateDisplay` for loading/error/empty, dynamic tables per tab.

#### UserProfileComponent.vue — Key Untested Areas

Data: 8 tabs, complex `formData` with 8 sections, `educationOptions`, `degreeOptions`, icon management (`showIconSelector`, `iconTab`, `presetIcons`, `uploadedImage`, `initialsColor`, `colorOptions`)

Methods:
- `validateForm()` — form validation with tab completion checking
- `isTabComplete(tabIndex)` — tab-specific validation rules
- `onNationalityChange()` / `onCountryChange()` — country dropdown handlers
- `updateNationalityName()` / `updateCountryName()` — name updates with localStorage
- `refreshCountryDropdowns()` — dropdown refresh
- `restoreCountryState()` — tab switch state restoration
- `getInitials(firstName, lastName)` — initials computation
- `selectPresetIcon(icon)` / `handleFileUpload(event)` / `useInitials()` — profile icon methods
- `loadUserProfileData()` — profile data loading

Watchers: country dropdown changes, `$i18n.locale`, `activeTab`

#### ChatBotComponent.vue — Key Untested Areas

Data: `chatMessages`, `isStreaming`, `streamController`, `streamingQueryId`, `feedbackDialog`, `saveChatDialog`, `exportDialog`, `showQuickHelp`, `systemStatus`, `relatedDocuments`, `hiddenPromptForNextMessage`

Methods:
- `renderMarkdown(text)` — uses `marked.parse()` + `DOMPurify.sanitize()` — both already mocked in existing test
- `sendMessage()` — core chat with SSE streaming support
- `selectQuickHelpOption(option)` — quick help with dual-prompt mechanism
- `openFeedbackDialog()` / `handleFeedbackSubmit()` — feedback system
- `saveChatToHistory()` / `handleSaveChat()` — chat persistence
- `loadExistingConversation()` — conversation loading with related documents
- `hasUnsavedChanges()` — dirty state detection
- `exportChatToPDF()` — PDF generation
- `handleTreeNodeSelected()` / `removeContextItem()` — context management

#### FileDetailsDialog.vue — 1888 lines, ZERO tests (CREATE)

Data: `crawlStats` (dashboard metrics), `editableFile` (with labels), `knowledgeHierarchy`, `englishKnowledgeHierarchy`, `isAutoRefreshEnabled`, `dashboardRefreshInterval`, `crawlLogs`, `file`, `crawlJob`, `ingestionLogs`, `confirmDialog`, `isDownloading`, `downloadProgress`

Computed:
- `visibleTabs` — dynamic tab list based on file state
- `areAllLabelsSelected` — complex getter/setter for select-all
- `dashboardProgressPercent` — progress calculation
- `isSaveDisabled`, `isMetadataEditable` — conditional logic
- `displayStatus` — human-readable status
- `canViewInternalFile` — permission check
- `mainAction` — dynamic button per file status (Ingest/Retract/Download)

Methods:
- `handleSave()` — metadata save with validation
- `handleViewInternalFile()` — smart file routing
- `handleIngest()` / `handleRetract()` / `handleDelete()` — file operations
- `mapEnglishToLocale()` / `getEnglishLabelNames()` — label translation
- `startDashboardTimer()` / `refreshDashboardData()` — dashboard timer
- `fetchCrawlLogs()` / `fetchIngestionLogs()` — log fetching

Props: `fileId` (String, **required**). Note: NO `visible` prop — the component is always rendered; parent controls display.

Emits: `close`, `file-updated`, `action-triggered`

Uses **`<Teleport to="body">`** — tests MUST stub Teleport or use `attachTo: document.body`.

Uses **`setInterval`** for dashboard auto-refresh (default 5s) — tests MUST use `jest.useFakeTimers()` and clear timers in `afterEach` to prevent leaks.

**Mock requirements:** `documentFileService`, `serviceTreeService`, `adminDashboardService` for crawl logs.

#### LogSearchDialog.vue — 750 lines, ZERO tests (CREATE)

Data: `searchParams` (level, searchTerm, startDate, endDate, dateRange, source), `hasSearched`, `isSearching`, `searchResults`, `tableKey`

Methods:
- `performSearch()` — search with date range handling (preset vs custom)
- `resetSearch()` — form reset
- `exportLogs()` — CSV export with proper field escaping
- `ensureMessageColumnExists()` — DOM manipulation for table column fix

Props: **empty** (`props: {}`) — no props required. Parent controls display, not the component.

Emits: `close`, `search-completed`

Does NOT use Teleport — uses CSS fixed positioning.

**Mock requirements:** `adminDashboardService` for log search/export.

### Service Internal Structure

#### chatbotService.js — Untested Functions

- `submitQueryStream(query, conversationId, callbacks)` — SSE streaming with `onChunk`, `onMetadata`, `onTranslation`, `onDone`, `onError` callbacks. Uses native `fetch()` (NOT axios).
- `updateQueryResponseTime(conversationId, queryId, responseTime)` — PATCH request
- `markQueryAsAnswered(conversationId, queryId)` — PATCH request
- `submitFeedback(data)` — POST request

**Mock pattern:** Mock `httpService` at module level. For `submitQueryStream`, mock global `fetch()`.

#### chatHistoryService.js — Untested Functions

Folder management (all use httpService):
- `getUserFolders()`, `getFolder(id)`, `createFolder(data)`, `updateFolder(id, data)`, `deleteFolder(id)`
- `getFolderPath(id)`, `searchFolders(query)`, `reorderFolders(folderIds)`

Folder-conversation operations:
- `addConversationToFolder(folderId, conversationId)`, `getConversationFolder(conversationId)`
- `moveConversation(conversationId, folderId)`, `removeConversationFromFolder(conversationId)`

Search & stats:
- `searchConversations(query)`, `getRecentConversations(limit)`, `getUserConversationStats()`

**Mock pattern:** Existing test already mocks `httpService`. Extend with folder/search method tests.

#### documentFileService.js — Untested Functions

Crawl operations:
- `scheduleSiteCrawl(data)`, `getCrawlJob(id)`, `getCrawlMetrics(id)`, `getCrawlLogs(id, params)`, `killCrawl(id)`

Batch operations:
- `ingestMultipleFiles(fileIds)`, `retractMultipleFiles(fileIds)`

Other:
- `killIngestion(taskId)`, `getIngestionLogs(fileId, params)`, `uploadLink(data)`

**Mock pattern:** Existing test already mocks `httpService`. Extend with crawl/batch method tests.

### Testing Patterns to Follow

#### Component Branch Testing

```javascript
// Pattern: test each v-if/v-else path by controlling component data
it('shows loading state when isLoading is true', () => {
  const wrapper = mount(Component, {
    data() { return { isLoading: true } },
    ...mountOptions
  });
  expect(wrapper.findComponent({ name: 'DsSpinner' }).exists()).toBe(true);
});

it('shows content when data loaded', () => {
  const wrapper = mount(Component, {
    data() { return { isLoading: false, data: mockData } },
    ...mountOptions
  });
  expect(wrapper.find('.content').exists()).toBe(true);
});
```

#### Dialog Component Testing

```javascript
// FileDetailsDialog — requires fileId prop (String, required), NOT visible
// Uses Teleport to body — stub it in tests
jest.useFakeTimers(); // Required for dashboard timer (setInterval)

const wrapper = mount(FileDetailsDialog, {
  props: { fileId: 'file-123' },
  global: { plugins: [store, i18n], stubs: { teleport: true } }
});

afterEach(() => {
  wrapper.unmount();
  jest.useRealTimers();
});

// Test emit events
it('emits close when close button clicked', async () => {
  await wrapper.find('.close-btn').trigger('click');
  expect(wrapper.emitted('close')).toHaveLength(1);
});

// LogSearchDialog — NO props, NO Teleport
const wrapper = mount(LogSearchDialog, {
  global: { plugins: [store, i18n] }
});
```

#### Service Stream Testing (chatbotService)

```javascript
// submitQueryStream uses native fetch(), not axios/httpService
global.fetch = jest.fn();

it('calls onChunk for each streamed line', async () => {
  const onChunk = jest.fn();
  const onDone = jest.fn();
  global.fetch.mockResolvedValue({
    ok: true,
    body: createMockReadableStream(['data: {"chunk": "hello"}', 'data: [DONE]'])
  });
  await chatbotService.submitQueryStream('query', 'conv-1', { onChunk, onDone });
  expect(onChunk).toHaveBeenCalled();
  expect(onDone).toHaveBeenCalled();
});
```

### Key Mock Infrastructure

All existing mocks are in `src/__tests__/mocks/`:
- `axios.js` — centralized axios mock (created in story 3-1)
- `keycloakAuthService.js` — centralized auth mock (created in story 3-1)

All existing fixtures are in `src/__tests__/fixtures/`:
- `store-state.js` — `createAuthenticatedState(overrides)`, `createUnauthenticatedState()`
- `api-responses.js` — mocked API response data

**For FileDetailsDialog/LogSearchDialog:** Add component-specific mock data inline or extend `api-responses.js` with file/crawl/log fixtures.

### Previous Story Learnings (3-7)

- DS components use CSS custom properties — do NOT assert CSS values in JSDOM, assert CSS classes instead
- Teleport components (DsModal) require `document.body` queries, not `wrapper.find()`
- DsModal `visible` watcher is not immediate — mount with `visible: false` then set to `true`
- DsCombobox uses DsInput internally — test through the combobox API, not child component
- DsSelect `.value` property empty in JSDOM without matching `<option>` — use attribute assertion
- Always add `afterEach` cleanup for Teleport DOM elements (`document.body.innerHTML = ''`)

### FileDetailsDialog-Specific Notes

- Uses `<Teleport to="body">` — stub with `{ teleport: true }` in mount options
- Dashboard timer uses `setInterval` (5s default) — MUST use `jest.useFakeTimers()` and restore in `afterEach`
- Emits `close`, `file-updated`, `action-triggered` — test all three
- Prop is `fileId` (String, required), NOT `visible` — the component loads file data internally via `documentFileService`
- Does NOT import `marked` or `DOMPurify`

### LogSearchDialog-Specific Notes

- NO props — `props: {}` — mount without any prop data
- NO Teleport — uses CSS fixed positioning
- Emits `close`, `search-completed` — test both

### Options API Constraint

ALL component tests MUST use Options API mount patterns:
```javascript
import { mount } from '@vue/test-utils';
// NOT shallowMount for branch coverage — need real rendering for v-if/v-else paths
```

Use `mount()` (not `shallowMount`) for branch coverage since `v-if`/`v-else` chains need real DOM to evaluate. Stub only heavy child components (DsModal, charts).

### i18n in Tests

Components use `translate('key.path', 'default text')` — NOT `$t()`. Ensure `i18n` plugin is provided in mount options with the `translate` function.

### Coverage Verification

```bash
cd components/gov-chat-frontend
npx jest --coverage --coverageReporters=text
# Verify: branches ≥55%, functions ≥55%
# Focus on src/components/ and src/services/ coverage
```

### Regression Verification

```bash
cd components/gov-chat-frontend
npm test              # All 758+ tests must pass
npm run lint          # Zero errors
```

### References

- [Source: _bmad-output/planning-artifacts/architecture.md#Mock-&-Fixture-Patterns] — closure-based mock refs
- [Source: _bmad-output/planning-artifacts/architecture.md#Test-Naming-Patterns] — describe/it should patterns
- [Source: _bmad-output/project-context.md#Frontend-Testing-Architecture] — component landscape, mock strategy
- [Source: _bmad-output/project-context.md#Anti-Patterns-to-Avoid] — NEVER use Composition API, $t(), or shallowMount for branches
- [Source: _bmad-output/implementation-artifacts/3-7-test-frontend-design-system-components.md] — DS component patterns, Teleport handling

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List

## Change Log

- 2026-05-26: Story created with comprehensive developer context — baseline coverage verified, component structures analyzed, per-file action plan defined.
