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
  spec should see. Three narrow exceptions: cleanup code (the default is a
  failing cleanup that reports exactly what it could not remove; warn-and-continue
  is permitted only for a leftover state the next test's seed provably makes
  impossible, and the warning must name the leftover state); the
  browser-target-closed teardown race in route handlers — tolerated ONLY by
  `helpers/route.js` (`runRouteHandler`/`runPostOnlyRouteHandler`), which
  requires BOTH the target being gone AND the error being Playwright's
  target-closed error, and rethrows everything else; and the transport-level
  edge-reset retry in `helpers/auth.js` `request()` (#1847) — the first
  entry of the retry inventory below. Route mocks use the wrapper; they do
  not hand-roll their own catch. `expect.soft` is a swallow too: it records
  the failure and lets the test keep running against a premise that already
  failed, so later steps pass or fail for the wrong reason. One expected
  fact, one hard `expect()`.
- **The sanctioned retry inventory (#1878).** A retry is a determinism
  hazard: it exists only where it is sanctioned HERE, with its contract
  spelled out. Every entry keys on a condition, is bounded, and fails loud
  on its last observed outcome — never a silent give-up. One clause binds
  every entry: **a retry may never cover an assertion path.** A retry may
  only cover a transport/setup path that is OUTSIDE any spec's subject —
  and the criterion that decides is WHAT the attempt produced, not who
  judges it: a path whose failure produced no product verdict about the
  surface the spec asserts (the transport dropped it, or the edge returned
  its own reset artifact — a transport artifact, not a product verdict). It
  may never re-run or re-decide an assertion the spec itself makes: once
  an attempt PRODUCED a product verdict about what the spec asserts, a
  second answer is no evidence where the first was the truth. Two
  neighbours are not retries: a WAIT for a convergent condition (it
  re-reads a STATE that is still MOVING until it holds — the earlier read
  was never a verdict; see *Wait for conditions, not durations* below),
  and a cleanup protocol that re-issues the same request after a STATE
  CHANGE (the sweep's re-DELETE: `helpers/documents.js`
  `sweepDeleteOneFile`). The inventory:
  1. `helpers/auth.js`'s `request()` — the edge's own upstream-reset failure
     re-issued on the idempotent methods (#1847 — operator-sanctioned as the
     deterministic answer to a genuine transient): the k8s venue's Envoy
     answers a keep-alive race with a plain-text 503 carrying its reset
     text, or kills the connection outright (in practice the race arrives
     pre-headers — Node cannot distinguish a mid-body reset, which an
     idempotent re-issue also survives) — about once per suite load; that
     is a transport artifact outside any spec's subject, not a product
     verdict. Bounded (three attempts), sleeps never, keys on the edge's
     stable reply signature (and on the reset error code), returns or
     rethrows the LAST observed outcome verbatim.
  2. `helpers/chatbot.js`'s `loginViaUI()` — one retry of the whole
     Keycloak redirect flow (budgets 30 s then 15 s), the operator's
     sanctioned slow-IdP tolerance (2026-11-14): a slow identity provider
     under load must not fail a test that has nothing to do with
     authentication. Keys on the flow's own failure; the thrown error
     names both attempts.
  3. `helpers/keycloak-admin.js`'s `ensureUser()` — the whole user
     convergence (create, password, roles) retried while Keycloak answers
     transiently (#1878): typed transient only (408/425/429, 5xx, transport
     timeout), a 30 s deadline, a growing pause between attempts capped at
     the deadline, a permanent error thrown at once, expiry loud with the
     last observed error. Provisioning infra, not an assertion path — the
     retry never covers a spec's own verdict.

  **The boundary, worked out — the refused FR-translation probe (#1984 —
  operator ruling, 2026-11-17, coordination board #1216, note 127389).** A
  proposed fourth entry would have made `helpers/venue-profile.js`'s
  `translatesTo()` take a SECOND SAMPLE whenever a 200 answer carried no
  translation — it echoed its English source, or carried none at all — and
  the probe's verdict would have come from that second answer: a first
  answer that echoed its source became INVISIBLE (a chain that echoed only
  that once would have carried the run green; a chain that never
  translated had its French surface skipped — a coverage loss, not a red).
  The operator REFUSED it: an untranslated answer is a BUG in the
  translation chain, not a transient, so the probe stays at ONE sample and
  an echoed answer turns the GROUP RED. A setup premise does not exempt a
  RETRY of it — the clause forbids that too, for the probe's answer IS a
  product verdict about the very capability the group asserts: a second
  sample would have re-asked a question whose answer was already the
  truth.

  This list is exhaustive. A new retry surface needs an operator ruling
  recorded here first; no spec adds a retry loop, and Playwright's
  `retries: 0` stays untouched.
- **No conditional skip on runtime state.** A `test.skip()` or an early
  `return` decided by what the run itself produced (a page rendered or not,
  a request answered or not, a value computed in the body) is a fallback
  branch wearing a skip: the expected state is fixed, and not reaching it
  is a FAIL carrying the observed state. The one sanctioned skip is the
  venue capability check — `helpers/venue-profile.js` reads what the venue
  exposes before the test's own state exists, and skips with that reason.
- **Wait for conditions, not durations.** No `waitForTimeout`, no fixed `sleep`:
  a fixed sleep is slow on a fast machine and flaky on a slow one. Wait on the
  observable condition (`waitForSelector`, `expect.poll`, `waitForURL`,
  `waitForResponse`) with a hard `timeout`; a wait that expires is a failure,
  never followed by "continue anyway". If no observable condition exists, the
  test (or the app under test) needs one — a sleep is not the fix.
- **No wall-clock expectations.** An expected value derived from `Date.now()`
  or `new Date()` is not known — the machine's clock and timezone decide it,
  so the assertion is true here and false somewhere else. Expected values
  come from injected or fixed inputs (fixed seed strings, `page.clock`);
  when the app renders a time, assert a timezone-pinned rendering or a
  relationship the spec controls — never the wall clock's own output.
  Seeding unique names and deadline bookkeeping for bounded waits read the
  clock and assert nothing; they stay legitimate.
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

### The handle naming contract

A new handle is **kebab-case, page-scoped**: `<page>-<thing>` —
`document-name`, `upload-file-input`, `quick-help-grid`. The prefix names
the surface that renders the element, not the test that reads it. A
shared DS primitive that declares its own handle uses the `ds-` prefix
(`ds-status-tag`) — but prefer the page-scoped handle on the page's own
element (a wrapping cell, a container) over adding one inside a shared
component: the page keeps ownership, the component stays unannotated.

The **attribute spelling follows the component**: the chat surfaces carry
`data-testid`, the admin and OKF surfaces carry `data-test-id` (the two
spellings predate the contract; a spec uses the spelling of the component
it addresses — see `.claude/rules/E2E-TESTING.md`). A handle that exists
already is never renamed — a rename breaks every spec reading it and
needs its own migration issue.

### What else is accepted, and what is not

| Class | Form | Verdict |
|---|---|---|
| **Handle** | `[data-test-id="..."]` / `[data-testid="..."]` | the rule |
| **Role** | `getByRole('button', { name })` | accepted fallback — survives any redesign, but its name is copy: allowed with eyes open, and a copy change is a visible test failure |
| **Text discriminator** | `.filter({ hasText })` / `locator(sel, { hasText })` | accepted when it narrows a set a handle already resolved — the text should be the test's own seed data, not design copy |
| **Handle-rooted structure** | `row.locator('td')`, `dialog.getByRole(...)` | accepted — a structural tail rooted at a declared handle |
| **Structural** | class selectors anywhere | **forbidden** — gate-enforced (see below) |
| **Text selection** | `getByText` / `getByLabel` / `getByPlaceholder`, `text=`, `:has-text()` in a selector string | **forbidden** in scanned files — breaks on any copy change |

### The gate

The handle-locator gate
(`tests/config-validator/__tests__/e2e-handle-locators.test.js`) is
**default-on**: every `.js` file under `tests/e2e/` is scanned for class
selectors and text-selection APIs, and a file is exempt only while it is
listed in `GRANDFATHERED_FILES` — each entry carrying its reason and the
derived issue that owns its migration. A NEW spec lands inside the gate
automatically; a file leaves the list in the MR that converts it. The
locator classification of every spec — and the exempt inventory with its
reasons — lives in the [locator map](../../docs/e2e-tests/locator-map.md).

**Third-party surfaces are exempt by nature**: the Keycloak login page
renders the upstream theme's own IDs (`#username`, `#password`,
`#kc-login`), and the Swagger UI page is a third-party bundle that
declares no handles at all — no handle contract can reach either. Their
specs stay as they are; the map records them.

To convert a grandfathered file: add the missing handles to the frontend,
move the file's locators onto them, drop the file from
`GRANDFATHERED_FILES`, and mutation-prove the migration — rename one
handle in the component, watch the spec fail, restore it, watch it pass.
A conversion without the red is a claim, not a proof.

## Execution order and phase conventions

The three execution-order conventions — Test Step Format, Variable Naming, URL
Convention — and the Phase Execution Order are defined once in
[`docs/e2e-tests/README.md`](../../docs/e2e-tests/README.md). Follow them by
reference; do not duplicate or restate them here or in specs.

## Suite layout

ONE organizational axis: every spec lives in the directory of the feature
area it drives. The placement rule, the phase traceability and the
per-spec detail — area, acceptance phase/story, deployment profile,
helpers — are owned by ONE place: the suite map,
[`docs/e2e-tests/suite-map.md`](../../docs/e2e-tests/suite-map.md). Where
a new spec goes: the map's one-spec-one-place-one-axis rule.

| Path | Contents |
|------|----------|
| `auth/` | Login, session lifecycle, token and realm auth specs (the `docs/e2e-tests/` acceptance phases) |
| `chatbot/` | Chat surface specs |
| `documents/` | Document upload/search specs |
| `admin/` | Admin dashboard specs |
| `okf/` | OKF pillar specs |
| `theme/` | Frontend shell & visual-layer specs |
| `helpers/` | Shared auth/login, chat, documents, locale, Keycloak admin, cache-header and welcome helpers (helper unit specs live here too — e.g. `helpers/auth.spec.js`) |
| `helpers/venue-profile.js` | What the venue actually exposes (OKF pillar, realms, identity providers) — the source of every runtime skip's reason |
| `run/` | The local run: the runner script, the venue-name mapping and the failure path (their unit spec lives here too) |
| `capture-admin.js` | Admin-dashboard screenshot capture script (not a spec) |
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
npm ci && node tests/e2e/run/install-browsers.js
BASE_URL=https://localhost npx playwright test tests/e2e/<area>/ --project=chromium
```

`install-browsers.js` reconciles the checkout and the browser tree with the
`@playwright/test` the lockfile pins — a tree carrying another revision fails
every spec at launch. `npm install` alone leaves the checkout free to drift
from the lockfile; `npm ci` does not. The contract is in
[`docs/e2e-tests/local-run.md`](../../docs/e2e-tests/local-run.md)
(§ The browser tree).

`BASE_URL` points at the stack's edge; it defaults to `https://localhost`.
The specs log in through the browser (`loginViaUI`) — the realm refuses
direct access grants, so a minted token gives an API call a token, not a
page a session.

**One spelling of the edge — in the JS tree.** The published address
lives in ONE module (`helpers/base-url.js`), and the venue-origin gate
(`tests/config-validator/`) fails any file in the tree but that one that
carries a local origin or reads the environment. The gate reads the JS
tree; the run SCRIPT (`run/run-local-e2e.sh`) names its own default venue
(`DEFAULT_VENUE`) — it is the shell that starts the run, so it must say
which venue it starts against — and that name is outside the gate's
reach. The claim is therefore about the JS tree, not about every file
under `tests/e2e/`.

## The executed set

The suite has **no CI door** (operator decision, 2026-11-10: this suite gets
no CI resources — it runs locally, regularly). The executed set is what the
**local run** executes:

```bash
BASE_URL=https://<your-venue-host>:4443 tests/e2e/run/run-local-e2e.sh
```

`<your-venue-host>` is the venue's edge hostname, and the `:4443` that
follows is the shared forge's edge port — substitute both when your venue
differs. Its worked example, and the `E2E_VENUE_IP` mapping for a runner
that cannot resolve its venue's name, are in
[`docs/e2e-tests/local-run.md`](../../docs/e2e-tests/local-run.md#venue-address)
(§ Venue address).

It provisions the venue fixtures, runs the **whole `tests/e2e/` tree**,
prints the outcome — every skipped spec with its reason — and the
**context** of every red: the build the venue serves, this checkout's HEAD,
and the handles the failing specs waited for. The issue itself is written
**by hand** — the run files nothing. The contract, the venue
profile and the runtime skips: [`docs/e2e-tests/local-run.md`](../../docs/e2e-tests/local-run.md).

The executed set is pinned by `tests/config-validator/`: the guard derives
the run's invocation from the run script and requires it to cover **every**
spec file in the tree. Narrowing the invocation is what fails the guard.
A NEW spec file under one of the CI's executed globs (`admin/`,
`chatbot/`, `documents/`, `helpers/`, `theme/`) is
not free, though: the derivation's exact pin in
`tests/config-validator/__tests__/config-validation.test.js` lists the
expected set, so such a spec file adds one line there. A spec outside
those globs needs none — the local run executes the whole tree. The
list above MIRRORS the CI invocation (the config-validator derives it
from `.gitlab-ci.yml`): a change to the CI's globs moves both.

A spec that needs a surface the venue does not expose **skips with a
reason** — see `helpers/venue-profile.js`. The reason is read from the
venue, and a probe that cannot read the venue fails loudly: an unreadable
venue is not an absent surface.
The config-validator gates scan this tree as code text, with different
rules per gate: a `require(` whose argument is not a string literal trips
the non-literal-consumption scanner even in prose (a title saying
`require(esm)` will) — spell it without the paren; a BASE_URL read (`process.env.BASE_URL`) and a local
origin trip the venue-origin gate in code text and titles, but a comment
naming them is documentation, not an offender; the origin gate's only
allowance list is `MOCK_ORIGINS`, scoped per file.

The `e2e:playwright` job still sits in `.gitlab-ci.yml` and its rule still
requires a merge train. The file is frozen and the job does not start — it
is not the executed set.

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
does not execute the Playwright stage — and this instance never creates a
merge train, so the stage does not run at all. The suite's CI resources were
withdrawn by the operator's decision of 2026-11-10; the executed set is the
local run's (see *The executed set* above), and that is what
`tests/config-validator/` pins.
