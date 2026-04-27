# Deferred Work

## Deferred from: code review of 3-1-applifecycle-token-validation (2026-04-27)

- **Concurrent `validateTokens()` calls not guarded** — No mutex/re-entrancy guard on `validateTokens()`. Multiple `resumed` events can trigger overlapping async refresh flows. Known limitation documented in spec, deferred to Story 3.2 (Network Error Detection) for holistic error handling review.
- **Observer tests (AC5/AC6) use absence-of-exception** — Tests for `addObserver`/`removeObserver` only verify no crash, not that the methods were called. Spec explicitly says "No WidgetsBinding mock needed." Improving these tests would require mocking `WidgetsBinding`, which adds complexity for minimal gain.
- **Idempotence test relies on synchronous mocks** — Test calls `resumed` twice and asserts `refreshCallCount == 1`, but this works because mocks complete synchronously. With real async, both calls could overlap. Related to the concurrent `validateTokens` limitation above.
- **`validateTokens()` can race with `logout()`** — If user logs out while a lifecycle-triggered refresh is in-flight, the refresh may re-save tokens that logout deleted. Pre-existing issue, made more reachable by the lifecycle trigger. Root cause: no coordination flag between logout and validateTokens.
- **`validateTokens()` can race with `authorize()`** — If app resumes while user is mid-authorization flow, lifecycle validation could trigger a redundant refresh competing with the in-flight authorize. Narrow scenario requiring authenticated state AND active re-authorization AND app resume simultaneously.
- **Logging asymmetry in `validateTokens()`** — Success path has explicit logging after refresh; failure path relies on logging inside `refreshToken()`. Style preference, not a bug.
