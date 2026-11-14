# E2E Testing — Locating Application Elements

**The rule: an E2E test locates an application element ONLY through a test
handle the application declares. Never through a CSS class, a DOM structure,
an i18n label or an index.**

The handle is the platform's own mechanism:

| Client | Handle | Declared as |
|---|---|---|
| Web (`components/gov-chat-frontend/`) | `data-test-id` attribute | `<div data-test-id="admin-dashboard">` |
| Mobile (`mobile/genie_ai_mobile/`) | `Key` / `ValueKey` | `Key('main_chat_bot')` |

The same rule, two spellings. The Flutter app already carries `Key`s for the
same purpose (see `mobile/genie_ai_mobile/patrol_test/CLAUDE.md`).

The web app carries TWO attribute spellings today: the older `data-testid`
(the chat surfaces) and `data-test-id` (the admin surface). Both are
valid handles; **a spec must use the spelling of the component it
addresses** — read the component before writing the locator. New handles
follow the component they are added to, not a global sweep: renaming
82 handles is a separate cleanup, and a spec that guesses the wrong
spelling fails with an empty locator rather than a wrong element.

## Why

A locator built from a class name or a label is a claim about the
application's *presentation*, not about its behaviour:

- a CSS rename (a design-system migration, a restyle) breaks every spec
  that reached for it, and the breakage says nothing about the behaviour
  the spec guards;
- an i18n label changes with the locale the test runs in — the spec then
  fails in one locale and passes in another, or (worse) passes for the
  wrong reason when the fallback text matches;
- a DOM structure (`:nth-child`, a parent/child path) breaks on every
  layout change, and the fix pushes the author to re-anchor by index.

A declared handle is a contract: the application says "this element is
addressable as `admin-dashboard`", and the spec says "I need the admin
dashboard". Both sides are stable, and a refactoring that keeps the
behaviour keeps the spec green.

## How to write a spec

1. **Find or declare the handle.** If the element the spec needs has no
   handle, add one to the component that owns it — an inert attribute, no
   behaviour change:

   ```vue
   <div class="stat-card" data-test-id="stat-system-uptime">
   ```

   The handle belongs to the component that RENDERS the element, not to
   the spec and not to a wrapper.

2. **Locate by handle only.**

   ```js
   // yes
   page.locator('[data-test-id="stat-system-uptime"]')
   page.locator('[data-test-id="logs-warnings-card"] [data-test-id="log-row-wired-keycloak"]')
   // no — presentation, locale, or structure
   page.locator('.stat-card .stat-value')
   page.locator('tbody tr:nth-child(2)')
   ```

   A descendant selector is fine as long as it is rooted at a handle. A
   role locator (`getByRole('button', { name })`) is an **accepted
   fallback** in the Playwright suite (the locator table in
   `tests/e2e/CLAUDE.md`); its name is copy, so prefer the handle.

3. **Assert behaviour, not presentation.** A handle tells you WHERE; the
   assertion still states the behaviour — the rendered value, the visible
   error, the enabled state. Asserting a class (`toHaveClass(/status-good/)`)
   is acceptable only when the class IS the contract (a status colour
   class the backend vocabulary maps onto).

4. **Do not assert on i18n text** unless the text IS the subject. A
   payload-injected service name is a fine assertion subject; a translated
   heading is not.

## Naming

- `data-test-id="<area>-<thing>"`, lowercase, dash-separated:
  `admin-dashboard`, `stat-system-uptime`, `logs-warnings-card`,
  `log-row-<service>`, `usage-<resource>-fill`, `notification-<type>`.
- The Flutter side uses the same shape as its key value:
  `Key('confirm-dialog-confirm-btn')`.
- One handle per element. An element that appears in a list carries the
  discriminator in the handle (`log-row-<service>`), not in the selector
  that reaches it.

## Where the rule is enforced

- The specs in `tests/e2e/` (Playwright) — see `tests/e2e/CLAUDE.md` — and
  `mobile/genie_ai_mobile/patrol_test/` (Patrol).
- `tests/config-validator/` pins the executed-spec set, not the locators —
  a spec that drifts out of the e2e invocation is caught there.
- Existing specs that still locate by class predate this rule; they are
  migrated when they are next touched, not in a sweep. A new or modified
  spec follows the rule from the start.
