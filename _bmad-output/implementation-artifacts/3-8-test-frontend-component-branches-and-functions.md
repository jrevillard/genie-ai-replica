# Story 3-8: Test Frontend Component Branches and Functions

Status: backlog

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
- [ ] Task 2: Extend `src/__tests__/components/UserProfileComponent.test.js` (AC2)
- [ ] Task 3: Extend `src/__tests__/components/ChatBotComponent.test.js` (AC3)
- [ ] Task 4: Extend `src/__tests__/components/FileDetailsDialog.test.js` (AC4)
- [ ] Task 5: Create `src/__tests__/components/LogSearchDialog.test.js` (AC5)
- [ ] Task 6: Extend `src/__tests__/services/chatbotService.test.js` (AC6)
- [ ] Task 7: Extend `src/__tests__/services/chatHistoryService.test.js` (AC6)
- [ ] Task 8: Extend `src/__tests__/services/documentFileService.test.js` (AC6)
- [ ] Task 9: Run coverage report to verify ≥55% branches/functions
- [ ] Task 10: Run full regression suite and lint

## Dev Notes

### Branch Testing Strategy

Most uncovered branches are `v-if` / `v-show` conditionals and ternary expressions in Vue templates. Test strategy:

1. **Find uncovered branches**: Run `npx jest --coverage --coverageReporters=text` and look for low branch % in specific files
2. **Identify conditions**: Read the template to find `v-if`, `v-else`, `v-else-if` chains
3. **Test each path**: Mount component with props/data that trigger each conditional branch

```javascript
// Example: testing AdminDashboard conditional rendering
it('shows loading spinner when data is loading', () => {
  const wrapper = mount(AdminDashboard, {
    data() { return { loading: true } }
  });
  expect(wrapper.findComponent({ name: 'DsSpinner' }).exists()).toBe(true);
});

it('shows error state when health check fails', () => {
  const wrapper = mount(AdminDashboard, {
    data() { return { error: 'Service unavailable', loading: false } }
  });
  expect(wrapper.text()).toContain('Service unavailable');
});
```

### Function Coverage

Untested functions are typically:
- Event handlers (`@click`, `@submit`, `@input`)
- Watchers
- Computed properties with complex logic
- Lifecycle hooks (`mounted`, `beforeUnmount`)

Test by triggering the corresponding user action and verifying side effects.

### Coverage Impact

Current: branches 33.6%, functions 34.6%
After: estimated branches ~55%, functions ~55%

## Change Log
