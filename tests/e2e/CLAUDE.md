# E2E Suite Conventions

Agent-facing conventions for the Playwright suite in `tests/e2e/`. Read this before
writing or changing any spec, helper, or capture script in this directory.

**Operator directive (2026-11-03, issue #1377): E2E tests must be deterministic.**
Rule below is that directive, expanded.

## Determinism

No fallback paths, no catch-and-continue, no retry loops that mask a real failure,
no best-effort degradation. We know what the test must do — assert EXACTLY that.
Any deviation from the expected behaviour is a FAIL, with the actual observed value
in the error (never silently tolerated).

- **Assert exactly.** Every step of the expected behaviour has an assertion. If the
  test may proceed without asserting, the missing assertion is a bug in the test.
  Every failure message carries the observed value (`expect(locator).toHaveText(...)`
  over `toBeVisible()` where the exact text matters).
- **No fallback branches.** No "if the element is there do X, otherwise do Y" —
  the expected state is fixed; branch on it and you have two tests pretending to be one.
  Soft guards (`if (await locator.isVisible().catch(() => false)) ...`) are forbidden.
- **No swallowing.** No `.catch(() => {})`, no bare `catch` that continues, no
  try/except that degrades to a fallback path. Helpers must not absorb a failure a
  spec should see. Two narrow exceptions: cleanup code (the default is a
  failing cleanup that reports exactly what it could not remove; warn-and-continue
  is permitted only for a leftover state the next test's seed provably makes
  impossible, and the warning must name the leftover state), and the
  browser-target-closed teardown race in route handlers — tolerated ONLY by
  `helpers/route.js` (`runRouteHandler`/`runPostOnlyRouteHandler`), which
  requires BOTH the target being gone AND the error being Playwright's
  target-closed error, and rethrows everything else. Route mocks use the
  wrapper; they do not hand-roll their own catch.
- **Wait for conditions, not durations.** No `waitForTimeout`, no fixed `sleep`:
  a fixed sleep is slow on a fast machine and flaky on a slow one. Wait on the
  observable condition (`waitForSelector`, `expect.poll`, `waitForURL`,
  `waitForResponse`) with a hard `timeout`; a wait that expires is a failure,
  never followed by "continue anyway". If no observable condition exists, the
  test (or the app under test) needs one — a sleep is not the fix.
- **Fixed, isolated seed data.** Each test creates the state it needs with known
  values and unique keys (usernames, file names, conversation titles), and removes
  it deterministically. No reliance on order of execution, on data left by a
  previous run, or on shared mutable state (see `docs/e2e-tests/README.md` for
  the test-user conventions of the shell phases).

Applies to Playwright specs, `tests/e2e/helpers/*`, `capture-dashboard.js`, and the
provisioning/readiness shell in `docs/e2e-tests/` alike.

The existing suite predates this rule and violates it (fixed sleeps, swallowed
waits, best-effort cleanup). The known violations are tracked in issues #1383–#1387
and are fixed there, not by mass-rewriting unrelated specs in a feature MR. Any
code you touch or add must comply; do not copy a violating pattern from a
neighbouring file.

## Locating application elements

A test locates an application element only through a test handle the
application declares — a `data-test-id` attribute in the Vue app. Never
through a CSS class, a DOM structure or an i18n label.

The rule, its rationale and the Flutter counterpart (`Key` in the patrol
suite): `.claude/rules/E2E-TESTING.md`.

```js
// yes
page.locator('[data-test-id="stat-system-uptime"]')
// no
page.locator('.stat-card .stat-value')
```

If the element you need carries no handle, add one to the component that
renders it (`data-test-id="..."`) — an inert attribute, no behaviour change.

## Execution order and phase conventions

The three execution-order conventions — Test Step Format, Variable Naming, URL
Convention — and the Phase Execution Order are defined once in
[`docs/e2e-tests/README.md`](../../docs/e2e-tests/README.md). Follow them by
reference; do not duplicate or restate them here or in specs.

## Suite layout

| Path | Contents |
|------|----------|
| `*.spec.js`, `chatbot/`, `documents/`, `admin/`, `okf/` | Feature specs (Playwright) |
| `epic1/`, `epic2/`, `epic3/` | Auth/session lifecycle specs (mirror the `docs/e2e-tests/` phases) |
| `helpers/` | Shared auth/login, chat, documents, locale, Keycloak admin, cache-header and welcome helpers (helper unit specs live here too — e.g. `helpers/auth.spec.js`) |
| `helpers/e2e-fixtures.js` | The venue fixture definitions (username, email, password, realm roles) |
| `provision-e2e-fixtures.js` | Provisions those fixtures for a venue (CI e2e job and Phase 0 both run it) |
| `fixtures/` | Fixed seed files for upload tests |
| `capture-dashboard.js` | Dashboard screenshot capture script (not a spec) |

Config: `playwright.config.js` at repo root. `retries: 0` and `workers: 1` are
deliberate — determinism is enforced there; do not add retries or parallelism to
paper over a flake, fix the test. Current timeouts and base URL: read the config.

## Running

```bash
# from the repository root (playwright resolves from the root node_modules)
npm install && npx playwright install chromium
BASE_URL=https://localhost npx playwright test tests/e2e/<area>/ --project=chromium
```

`BASE_URL` points at the stack's edge; it defaults to `https://localhost`.
The specs log in through the browser (`loginViaUI`) — the realm refuses
direct access grants, so a minted token gives an API call a token, not a
page a session.

## Fixtures

The venue fixtures (testuser, testadmin, testplain) are defined once, in
`tests/e2e/helpers/e2e-fixtures.js`, and provisioned by
`tests/e2e/provision-e2e-fixtures.js` — the CI e2e job and the Phase 0
procedure (`docs/e2e-tests/00-clean-start.md`) both run it, so a credential
is written in one place. The specs read their login credentials from the
same module (`credentialsOf` in `helpers/e2e-fixtures.js`; `helpers/chatbot.js`
re-exports them beside the login helpers). The import-path convention: a spec
that needs only credentials requires them from `helpers/e2e-fixtures.js`
directly; a spec that also logs in takes them from the same
`helpers/chatbot.js` require as `loginViaUI` — do not mix both paths in one
file. The provisioning script (`provision-e2e-fixtures.js`) converges
an existing account (password reset, role assignment, and the
admin-granting role removed from every fixture that does not declare it);
it fails loudly on
an account the realm left in a broken login state (disabled, unverified,
carrying a required action), and on an account that still holds the
admin role after a strip attempt (granted through the realm
default-roles composite or a group) — and names the cause.

## CI

`e2e:playwright` runs on **merge trains** and scheduled pipelines only
(`CI_MERGE_REQUEST_EVENT_TYPE == "merge_train"`), so a plain MR pipeline
does not execute the Playwright stage. The executed set is pinned by
`tests/config-validator/` — adding a spec directory to the invocation
means adding it there too.
