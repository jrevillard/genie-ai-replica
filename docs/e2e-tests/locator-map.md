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

The gate scans **every** `.js` file under `tests/e2e/` — every helper, the
`run/` modules, the infra scripts, the capture scripts — not only the
specs tabulated here. The tables below cover the **app-driving specs**
(the surface this map classifies); a helper or run module is held to the
same gate even without a row. The unit specs of `helpers/` and `run/`
(the suite testing its own modules) select no app elements and are not
classified.

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
| `conversation-history.spec.js` | handle (via helper) | — (`#chatTitle` migrated onto `chat-title`, #1830) |

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
| `g1-swagger-authorize.spec.js` | structural (`button.btn.authorize`, `.auth-container`) | grandfathered (third-party DOM) — DECIDED #1831: exemption stands |
| `h1-jwks-force-refresh.spec.js` | none (API-level) | — |
| `i1-multi-realm.spec.js` | none (API-level) | — |
| `j1-opea-continuity.spec.js` | none (API-level) | — |
| `k1-auth-error-display.spec.js` | none (API-level) | — |
| `l1-frontend-logout-redirect.spec.js` | structural (`#kc-login`) + handle (`nav-icon-btn-logout`, #1832) | ID exempt by nature |
| `l2-localstorage-cleanup.spec.js` | same as `l1` | same |
| `l3-vuex-state-cleared.spec.js` | same as `l1` | same |

`helpers/chatbot.js` (`loginViaUI`) carries the same `#kc-login` click —
the login walk happens on the Keycloak page, so the helper inherits the
same exemption. The logout control's copy coupling is gone: the three
logout specs read the navbar's own `nav-icon-btn-logout` handle (#1832),
and the role locator remains the documented fallback for surfaces
without handles.

### `okf/` — fully handle-based (converted by #1828/#1829)

| Spec | Classes used | Residual |
|---|---|---|
| `artifacts-view.spec.js` | handle | — (the delete-button count collapsed onto the role form, #1829) |
| `concept-ceiling.spec.js` | handle (the ceiling pill declares `data-state=warning`, #1829) | — |
| `ragas-guide-errors.spec.js` | handle (`okf-studio-card-*`, `ragas-guide-toggle`, `[role="dialog"]`, `ds-tab-*`, `ragas-guide-pane`) | — (converted #1828) |
| `ragas-judge-selector.spec.js` | handle (`okf-studio-card-*`, `ragas-panel`, `okf-models-url-cell`) | — (converted #1828; the `select`/`option` tails are rooted at `ragas-panel`) |
| `ragas-rescore-tracking.spec.js` | handle (`ragas-run-history`, `data-state` status pills, `ragas-run-key`, `ragas-run-progress`, `[role="dialog"]`) | — (converted #1828) |

The ragas family WAS the heaviest structural coupling in the suite (~30
class-selector hits across three specs); #1828 converted it onto
page-scoped handles — the Studio dashboard cards, the RAGAS panes, the
run-history rows, and a `data-state` variant attribute on the DsTabs
primitive (the shape #1829 establishes for state variants).

### `theme/` — handle-based

| Spec | Classes used | Residual |
|---|---|---|
| `living-intelligence.spec.js` | none (cache-header level) | — |
| `theme-runtime-config.spec.js` | none (cache-header level) | — |
| `resizable-sidebars.spec.js` | handle | — |
| `responsive-layout.spec.js` | handle | — |
| `welcome-banner.spec.js` | handle (via `helpers/welcome.js`) | — |

### Capture scripts

| Script | Classes used | Residual |
|---|---|---|
| `capture-dashboard.js` | handle | — |
| `capture-admin.js` | handle (`admin-page`, `admin-page-title`, `ds-spinner`, `ds-tab-…[data-state=active]`, `okf-studio-wizard-step`, `okf-editor-shell`, `okf-lab-tabs`, `okf-lab-pane-head`) | — (converted #1828; the `genie-living-intelligence` reads stay class reads — the class IS the audited contract) |

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
  own IDs authoritative — DECIDED #1833: the exemption stands
  permanently; revisit only if an upstream release renames a login ID.
- **The Swagger UI page** (`g1-swagger-authorize.spec.js`) is a
  third-party bundle that declares no test handles; `.auth-container` and
  `button.btn.authorize` are its own DOM. DECIDED #1831: the exemption
  stands permanently — the DOM assertions ARE the G.1 acceptance, and
  this repo cannot add handles to the bundle.

## Migration list — ordered by breakage risk

Risk = the probability a design-side change breaks the spec, weighted by
the coupling surface.

All seven entries are done, shipped by the #1822 migration wave:

1. **okf-ragas family** (#1828) — converted onto page-scoped handles;
   the gate scans the three specs.
2. **capture-admin.js** (#1828) — converted with the family (the
   living-intelligence gate-class reads stay class reads: the class IS
   the audited contract).
3. **okf leftovers** (#1829) — the ceiling pill declares
   `data-state=warning`; the delete count collapsed onto the role form.
4. **chatbot leftovers** (#1830) — `chat-title` declared on the save-chat
   input; spec + helper read it.
5. **auth-swagger** (#1831) — DECIDED: the exemption stands permanently.
6. **auth-logout role locators** (#1832) — `nav-icon-btn-logout` was
   already declared; the three specs read the handle.
7. **auth-keycloak IDs** (#1833) — DECIDED: the exemption stands
   permanently.

## Keeping the map true

The gate (`tests/config-validator/__tests__/e2e-handle-locators.test.js`)
carries the enforcement; this map carries the classification. When you
convert a file: drop it from `GRANDFATHERED_FILES`, update its row here,
close or update its derived issue, and mutation-prove the conversion
(rename a handle → spec red → restore → green). A new spec starts inside
the gate — its row is added here when it lands.
