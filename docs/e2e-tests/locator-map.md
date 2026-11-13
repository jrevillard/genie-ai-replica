# The E2E locator map

The classification of every Playwright spec's element-selection strategy
(`tests/e2e/`): for every spec file — which locator classes it uses, what
residual non-handle selection remains, and where its migration (if any) is
tracked. Raised by the operator's directive that the E2E suite must select
by stable test handles, never by design (#1822). The suite's organizational
map is [`suite-map.md`](suite-map.md); the selection contract itself lives
in [`tests/e2e/CLAUDE.md`](../../tests/e2e/CLAUDE.md) § *Locating
application elements*.

## The four classes

| Class | Form | Coupled to |
|---|---|---|
| **handle** | `[data-test-id="…"]` / `[data-testid="…"]`, a Flutter `Key` | nothing the design controls |
| **role** | `getByRole(…, { name })` | the accessible name — copy, not design |
| **text** | `getByText` / `getByLabel` / `getByPlaceholder`, `text=`, `:has-text()` in a selector, a bare `hasText` discriminator on an unanchored selector | visible copy |
| **structural** | class selectors, component-tag selectors (`DsStatusTag`), un-scoped ID selectors, index paths (`td` nth) | today's DOM |

A handle-anchored locator with a structural tail (`row.locator('td')`) or
a `hasText` discriminator on a handle-resolved set counts as **handle**
(the anchor is the contract; the tail narrows within it).

## The classification

Counts are locator-shaped calls per spec (the unit specs of `helpers/` and
`run/` do not select app elements and are not listed; the two capture
scripts are, because the gate scans them).

### `admin/` — fully handle-based

| Spec | Classes used | Residual |
|---|---|---|
| `authz.spec.js` | handle | — |
| `data-wiring.spec.js` | handle | — |
| `failure-states.spec.js` | handle | — |
| `logs-view.spec.js` | handle | — |

The handles these specs read (`stat-*`, `logs-*`, `admin-documents-*`,
`document-*`) are declared in `AdminDashboard.vue` and the logs components.

### `chatbot/` — handle-based, one ID residual

| Spec | Classes used | Residual |
|---|---|---|
| `chat-composer.spec.js` | handle | — |
| `chat-conversation.spec.js` | handle (+ a `hasText` discriminator on a handle) | — |
| `error-handling.spec.js` | handle (`nav-status`, `answer-error`, `composer-field`) | — |
| `quick-help-scope.spec.js` | handle (+ `hasText` discriminators on handles, declared `data-state` attributes) | — |
| `send-message-and-stream.spec.js` | handle (via `BOT_BUBBLE` in `helpers/chatbot.js`) | — |
| `conversation-history.spec.js` | handle (via helper) | `#chatTitle` ×2 — a Vue ID selector, not a declared handle; `helpers/chatbot.js:337` carries the same ID. Tracked by the chatbot-leftovers derived issue (#1830) |

### `documents/` — fully handle-based (converted in #1822)

| Spec | Classes used | Residual |
|---|---|---|
| `search.spec.js` | handle (via `helpers/documents.js`) | — |
| `upload.spec.js` | handle | — |

`helpers/documents.js` was the last class-locator helper (`table.data-table`,
`.dialog-container`, `.drop-zone input[type=file]`, `.file-list .file-item`,
`tr.document-row`, `td.cell-main`, the `DsStatusTag, .status-tag,
[class*="status"]` fallback chain, `.label-tag`, `input.search-input`);
#1822 converted it together with `upload.spec.js` and declared the handles
in `AdminDashboard.vue` and `UploadFilesDialog.vue`. The
`[class*="status"]` fallback chain was non-deterministic by construction —
three shapes could match, and the test could bind to a different element
than the previous run and still pass.

### `auth/` — third-party surfaces and role fallbacks

| Spec | Classes used | Residual |
|---|---|---|
| `a1-login-redirect.spec.js` | structural (Keycloak IDs: `#username`, `#password`, `#kc-login`) | exempt by nature (see below) |
| `a2-full-login-flow.spec.js` | structural (`#kc-login`, via helper) | exempt by nature |
| `a3-legacy-routes-redirect.spec.js` | none (URL-level) | — |
| `d7a-external-idp-button.spec.js` | structural (`#kc-login`, `#social-external-idp`) | exempt by nature |
| `d7b-external-idp-login-flow.spec.js` | structural (`#social-external-idp`, `#kc-login`) | exempt by nature |
| `g1-swagger-authorize.spec.js` | structural (`button.btn.authorize`, `.auth-container`) | grandfathered (third-party DOM) — #1831 |
| `h1-jwks-force-refresh.spec.js` | none (API-level) | — |
| `i1-multi-realm.spec.js` | none (API-level) | — |
| `j1-opea-continuity.spec.js` | none (API-level) | — |
| `k1-auth-error-display.spec.js` | none (API-level) | — |
| `l1-frontend-logout-redirect.spec.js` | structural (`#kc-login`) + role (`getByRole('button', { name: 'Log out' })`) | role accepted; ID exempt by nature |
| `l2-localstorage-cleanup.spec.js` | same as `l1` | same |
| `l3-vuex-state-cleared.spec.js` | same as `l1` | same |

`helpers/chatbot.js` (`loginViaUI`) carries the same `#kc-login` click —
the login walk happens on the Keycloak page, so the helper inherits the
same exemption. The `Log out` role locator is the accepted fallback, but
its name is copy: it breaks on a logout-button rename or a locale flip.
Bottom of the migration risk order — the auth-logout derived issue (#1832)
owns the navbar handle decision.

### `okf/` — one converted family, one grandfathered family

| Spec | Classes used | Residual |
|---|---|---|
| `artifacts-view.spec.js` | handle | one structural+text residual: `view.locator('button').filter({ hasText: /delete|remove/i })` count assertion — okf leftovers derived issue (#1829) |
| `concept-ceiling.spec.js` | handle | `.ds-pill--warning` ×2 inside the declared `concept-ceiling` handle — grandfathered, okf leftovers derived issue (#1829) |
| `ragas-guide-errors.spec.js` | structural + role (`.okf-dashboard__card-wrap`, `.okf-ragas__help-toggle`, `.ds-modal`, `.ds-tabs__btn`, `.okf-guide__pane:visible table tbody tr`) | grandfathered — okf-ragas derived issue (#1828) |
| `ragas-judge-selector.spec.js` | structural + role (`td.okf-models__cell-url`, bare `select`/`option` paths) | grandfathered — #1828 |
| `ragas-rescore-tracking.spec.js` | structural + role (`.okf-ragas__section table tbody tr`, `.ds-pill`, `.okf-ragas__run-key`, `.okf-ragas__progress`) | grandfathered — #1828 |

The ragas family is the heaviest structural coupling in the suite: ~30
class-selector hits across three specs, all on the OKF Studio dashboard,
the DS modal/tab primitives and the RAGAS panes. Any DS restyle or OKF
panel rename breaks all three.

### `theme/` and the root — handle-based

| Spec | Classes used | Residual |
|---|---|---|
| `living-intelligence.spec.js` | none (cache-header level) | — |
| `resizable-sidebars.spec.js` | handle | — |
| `responsive-layout.spec.js` | handle | — |
| `welcome-banner.spec.js` | handle (via `helpers/welcome.js`) | — |
| `theme-runtime-config.spec.js` | none (cache-header level) | — |

### Capture scripts

| Script | Classes used | Residual |
|---|---|---|
| `capture-dashboard.js` | handle | — |
| `capture-admin.js` | structural (DS state qualifiers, several handle-anchored: `[data-test-id="ds-tab-…"].ds-tabs__btn--active`) | grandfathered — okf-ragas derived issue (#1828) |

### The mobile twin

The Flutter app carries no admin/documents surface (it is a chat client),
so the #1822 documents conversion has no mobile counterpart. The mobile
handle contract is the `Key`/`ValueKey` convention documented in
`.claude/rules/E2E-TESTING.md` and `mobile/genie_ai_mobile/CLAUDE.md`.

## Exempt by nature — why no handle contract can reach them

Two surfaces render DOM this repo does not own:

- **The Keycloak login page** renders the upstream Keycloak theme's own
  markup — `#username`, `#password`, `#kc-login` are the standard IDs the
  login form has carried across upstream releases, and the genie theme
  (`configs/keycloak/themes/genie`) wraps that template without renaming
  them. The login walk (`a1`, `a2`, `d7a`, `d7b`, `l1–l3`, and
  `loginViaUI` in `helpers/chatbot.js`) selects on that page by
  necessity. Renaming upstream IDs into theme-declared handles is
  possible in the FTL template but buys nothing while upstream keeps its
  own IDs authoritative — tracked, not scheduled (the auth-keycloak
  derived issue #1833 owns that decision).
- **The Swagger UI page** (`g1-swagger-authorize.spec.js`) is a
  third-party bundle that declares no test handles; `.auth-container` and
  `button.btn.authorize` are its own DOM. Grandfathered in the gate with
  that reason (#1831).

## Migration list — ordered by breakage risk

Risk = the probability a design-side change breaks the spec, weighted by
the coupling surface.

1. **okf-ragas family** (#1828) — ~30 structural hits across 3 specs, all
   on DS primitives (`ds-modal`, `ds-tabs`, `ds-pill`) and OKF panels that
   restyle often. Highest risk, largest scope.
2. **capture-admin.js** (#1828) — DS state qualifiers on a capture
   script; breaks the screenshot evidence flow, not a spec.
3. **okf leftovers** (#1829) — `concept-ceiling`'s two `.ds-pill--warning`
   lookups and `artifacts-view`'s delete-button count assertion.
4. **chatbot leftovers** (#1830) — `#chatTitle` (spec + helper copy): a
   Vue ID, greppable, but not a declared handle.
5. **auth-swagger** (#1831) — third-party DOM; the migration question is
   whether the exemption stands permanently (recommended) or the spec
   probes Swagger's config API instead of its DOM.
6. **auth-logout role locators** (#1832) — `getByRole('Log out')` ×3:
   accepted today, coupled to accessible copy; a navbar handle removes
   the copy coupling.
7. **auth-keycloak IDs** (#1833) — upstream IDs on a surface we theme but
   do not own; migrate only if the upstream contract ever changes.

## Keeping the map true

The gate (`tests/config-validator/__tests__/e2e-handle-locators.test.js`)
carries the enforcement; this map carries the classification. When you
convert a file: drop it from `GRANDFATHERED_FILES`, update its row here,
close or update its derived issue, and mutation-prove the conversion
(rename a handle → spec red → restore → green). A new spec starts inside
the gate — its row is added here when it lands.
