# Deferred Work

Items deferred during code reviews. Revisit when the related component is next modified.

## Deferred from: code review of 2-1-refactor-backend-indexjs-to-export-createapp (2026-05-13)

- swaggerSpec/swaggerUi silent failure at module-level — if `swaggerJsdoc()` throws, the spec stays undefined and `/api-docs` silently unavailable. Pre-existing behavior, not introduced by the refactor.
- registerRoutes() without external try-catch — the function has internal per-route try-catch blocks but the call site itself is unwrapped. Pre-existing pattern.
- Route loading error handling inconsistency — failed routes are logged and skipped silently. Pre-existing design choice.
- Routes without service (auth-routes) not mounted when `services={}` — calling `createApp({ services: {} })` skips all route registration including routes that don't need services. This matches the AC spec ("routes mounted when services object is provided").

## Deferred from: code review of 2-3-test-backend-auth-route-handlers (2026-05-15)

- Unexpected error path in controller not tested — The controller's try/catch covers session errors but if `res.json()` or `JSON.stringify()` in the audit log throws, the behavior is untested. Pre-existing controller design.
- Sessions returned without _key property — If `getUserSessions` returns sessions missing `_key`, `endSession(undefined)` would be called. Depends on session-service contract guarantee. Pre-existing service contract assumption.
