# E2E Suite Conventions

Agent-facing conventions for the Playwright suite in `tests/e2e/`. Read this before
writing or changing any spec, helper, or capture script in this directory.

**Operator directive (2026-11-03, issue #1377): E2E tests must be deterministic.**
No fallback paths, no catch-and-continue, no retry loops that mask a real failure,
no best-effort degradation. We know what the test must do — assert EXACTLY that.
Any deviation from the expected behaviour is a FAIL, with the actual observed value
in the error (never silently tolerated).

## Rule 1 — Determinism

- **Assert exactly.** Every step of the expected behaviour has an assertion. If the
  test may proceed without asserting, the missing assertion is a bug in the test.
  Every failure message carries the observed value (`expect(locator).toHaveText(...)`
  over `toBeVisible()` where the exact text matters).
- **No fallback branches.** No "if the element is there do X, otherwise do Y" —
  the expected state is fixed; branch on it and you have two tests pretending to be one.
  Soft guards (`if (await locator.isVisible().catch(() => false)) ...`) are forbidden.
- **No swallowing.** No `.catch(() => {})`, no bare `catch` that continues, no
  try/except that degrades to a fallback path. Helpers must not absorb a failure a
  spec should see. Cleanup code is the only narrow exception: a cleanup step that
  fails may warn-and-continue only if the next test's seed makes the leftover
  state impossible — and the warning must name the leftover state. Prefer failing
  cleanup that reports exactly what it could not remove.
- **Timeouts fail, never hang.** Use explicit bounds. A wait that expires is a
  failure — never followed by "continue anyway".
- **Wait for conditions, not durations.** No `waitForTimeout`, no fixed `sleep`:
  a fixed sleep is slow on a fast machine and flaky on a slow one. Wait on the
  observable condition (`waitForSelector`, `expect.poll`, `waitForURL`,
  `waitForResponse`) with a hard `timeout` that fails on expiry. If no observable
  condition exists, the test (or the app under test) needs one — a sleep is not
  the fix.
- **Fixed, isolated seed data.** Each test creates the state it needs with known
  values and unique keys (usernames, file names, conversation titles), and removes
  it deterministically. No reliance on order of execution, on data left by a
  previous run, or on shared mutable state (see `docs/e2e-tests/README.md` for
  the test-user conventions of the shell phases).

Applies to Playwright specs, `tests/e2e/helpers/*`, `capture-dashboard.js`, and the
provisioning/readiness shell in `docs/e2e-tests/` alike.

## Execution order and phase conventions

The three execution-order conventions — Test Step Format, Variable Naming, URL
Convention — and the Phase Execution Order are defined once in
[`docs/e2e-tests/README.md`](../../docs/e2e-tests/README.md). Follow them by
reference; do not duplicate or restate them here or in specs.

## Suite layout

| Path | Contents |
|------|----------|
| `*.spec.js`, `chatbot/`, `documents/`, `okf/` | Feature specs (Playwright) |
| `epic1/`, `epic2/`, `epic3/` | Auth/session lifecycle specs (mirror the `docs/e2e-tests/` phases) |
| `helpers/` | Shared auth/login, chat, documents, locale, Keycloak admin helpers |
| `fixtures/` | Fixed seed files for upload tests |
| `capture-dashboard.js` | Dashboard screenshot capture script (not a spec) |

Config: `playwright.config.js` at repo root — `baseURL https://localhost`,
`ignoreHTTPSErrors`, `actionTimeout: 15000`.
