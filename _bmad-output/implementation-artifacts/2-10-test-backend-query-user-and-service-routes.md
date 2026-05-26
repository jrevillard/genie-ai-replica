# Story 2-10: Test Backend Routes for Query, User, and Services

Status: backlog

## Story

As a developer,
I want comprehensive test coverage for query, user, service, translation, logger, and admin controller routes,
So that all API endpoints are reliable and backend coverage reaches professional standards.

## Acceptance Criteria

1. **AC1**: Query routes have complete test coverage for all 8 endpoints (GET /:queryId, POST /stream, POST /:queryId/feedback, etc.) via supertest against createApp()
2. **AC2**: User routes have complete test coverage for user context, delete account, and reset data endpoints including GDPR-critical delete path
3. **AC3**: Service routes have complete test coverage for service categories and search endpoints
4. **AC4**: Translation routes have complete test coverage for markdown translation endpoint
5. **AC5**: Logger routes have complete test coverage for log configure and rollover endpoints
6. **AC6**: Admin controller has complete test coverage for business logic
7. **AC7**: All existing tests pass, zero lint errors
8. **AC8**: Backend coverage increases from ~50% to ~65% (statements)

## Tasks / Subtasks

- [ ] Task 1: Create test file `__tests__/routes/query-routes.test.js` (216 lines target)
- [ ] Task 2: Create test file `__tests__/routes/user-routes.test.js` (83 lines target)
- [ ] Task 3: Create test file `__tests__/routes/service-routes.test.js` (45 lines target)
- [ ] Task 4: Create test file `__tests__/routes/translation-routes.test.js` (36 lines target)
- [ ] Task 5: Create test file `__tests__/routes/logger-routes.test.js` (31 lines target)
- [ ] Task 6: Create test file `__tests__/controllers/adminController.test.js` (126 lines target)
- [ ] Task 7: Run coverage report to verify ~65% backend coverage target
- [ ] Task 8: Run full test suite to ensure no regressions
- [ ] Task 9: Run lint and fix any errors

## Dev Notes

Follow stories 2-3 to 2-6 route test pattern:
- Use createApp() from app.js with supertest
- Use existing test fixtures from __tests__/fixtures/
- Mock auth middleware for authenticated routes (use req.user = { ... } pattern)
- Test both success paths (200, 201) and error paths (400, 401, 403, 404, 500)
- Test request validation (missing params, invalid body)
- Test response format and status codes
- For GDPR-critical delete account path: test irreversible deletion, data cleanup, confirmation

## Change Log
