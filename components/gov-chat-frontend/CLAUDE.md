# CLAUDE.md — gov-chat-frontend

## Common Commands

```bash
npm run dev           # Dev server (http://localhost:5173)
npm test              # Jest unit tests
npm run test:contract # Controller/middleware tests only
npm run lint          # ESLint check
npm run lint:fix      # ESLint auto-fix
npm run format        # Prettier format
npm run format:check  # Prettier check (no changes)
npm run build         # Production build
```

## Architecture

Vue 3 web app with Vuex state management and vue-i18n internationalization.

| Directory | Purpose |
|-----------|---------|
| `src/components/` | Vue components — use DS primitives (DsButton, DsModal, etc.) |
| `src/stores/` | Vuex store modules (auth, chat, categories, folders, settings) |
| `src/services/` | API clients (axios) with 401 retry logic |
| `src/router/` | Vue Router with auth guards |
| `src/views/` | Page-level components |
| `src/i18n/` | vue-i18n locale messages |
| `src/__tests__/` | Jest tests (components, stores, services, utils) |

- **Component style**: Options API (existing codebase convention)
- **Testing**: Jest + `@vue/test-utils`. Tests in `src/__tests__/` mirroring `src/` structure.
- **State**: Vuex stores in `src/stores/` — actions for async, mutations for sync state changes

## See Also

- Root `CLAUDE.md` — GENIE.AI architecture, deployment, full tech stack
- `.claude/rules/TESTING.md` — Test commands and patterns for all components
- `../../tests/e2e/` — the Playwright suite that verifies this component's rendered result

## Design System

This frontend is governed by the **GENIE.AI Design System (DS)**. The DS is the single source of truth for all component styling.

### Architecture

```
public/config/
├── theme-variables.css    # Token definitions (OKLch CSS custom properties)
│                         # served at runtime from /config/, not bundled by webpack
src/
├── theme-components.css   # Global component selectors using DS tokens
└── components/
    └── ds/                # DS primitive components (the building blocks)
        ├── Button.vue
        ├── Card.vue
        ├── Modal.vue
        ├── Pill.vue
        ├── Spinner.vue
        └── StatusTag.vue
```

### Rules

1. **Always use DS primitives** — If a DS component exists for a pattern (button, card, modal, pill, spinner, status tag), use it. Do not create ad-hoc implementations.
2. **Always use DS tokens** — All colors, spacing, radii, shadows, and typography must reference CSS custom properties (`var(--fg)`, `var(--surface)`, `var(--accent)`, etc.). Never hardcode values.
3. **No `!important`** — Indicates the wrong component is being used or a missing DS extension point. Use CSS custom properties on the parent element instead (e.g., `--ds-card-border-color`). Exception: ApexCharts tooltip overrides and genuine parent-child scoped style conflicts.
4. **Remove legacy CSS after migration** — When a component is migrated to a DS primitive, delete the old CSS rules. No orphaned styles.
5. **Options API** — All components use Vue 3 Options API. Follow existing conventions.

### Creating a New DS Component

Before creating a new DS component:

1. **Search for existing patterns** — Grep across all `.vue` files. If the pattern exists in 3+ components, extraction is warranted.
2. **Check `theme-components.css`** — Global token-based styles may already cover the visual layer. A DS component adds structure (props, slots, behavior), not just styling.
3. **Design the API** — Props with validators, named slots, emitted events. Keep it minimal — YAGNI.
4. **Use DS tokens exclusively** — No hardcoded colors, spacing, or typography in DS components.
5. **Add CSS custom property escape hatches** — For consumers that need to override a specific visual aspect (e.g., `--ds-card-border-color`), expose a CSS custom property with a sensible default.

### DS Token Reference

| Category | Tokens |
|----------|--------|
| Colors | `--brand`, `--fg`, `--surface`, `--bg`, `--accent`, `--accent-hover`, `--accent-muted`, `--accent-fg`, `--accent-secondary`, `--navbar-bg`, `navbar-fg`, `--muted`, `muted-soft`, `--border`, `--border-light`, `--overlay-bg`, `--danger`, `--success`, `--warning`, `--info`, `--danger-bg`, `--success-bg`, `--warning-bg`, `--info-bg`, `--btn-secondary-bg`, `--btn-secondary-hover`, `--btn-secondary-fg` |
| Spacing | `--space-xs`, `--space-sm`, `--space-md`, `--space-lg`, `--space-xl`, `--space-2xl` |
| Typography | `--text-xs`, `--text-sm`, `--text-base`, `--text-md`, `--text-lg`, `--text-xl`, `--text-2xl`, `--text-3xl`, `--font-scale`, `--font-body`, `--font-display`, `--font-mono` |
| Radii | `--radius-sm`, `--radius-md`, `--radius-lg`, `--radius-xl` |
| Shadows | `--shadow-sm`, `--shadow-md`, `--shadow-lg` |

### DS Component Inventory

| Component | Variants | Usage | Props |
|-----------|----------|-------|-------|
| **DsButton** | primary, secondary, ghost, danger | All buttons, links (`tag="a"`) | `variant`, `small`, `disabled`, `tag` |
| **DsCard** | default, flat, elevated, outline | Panels, metric cards, list items | `variant`, `padding`, `radius`, `hoverable` |
| **DsFormGroup** | default | Label + input grouping, works with DsInput | `label`, `inputId` |
| **DsInput** | sm, md, lg + textarea | All text inputs, search, textareas | `modelValue`, `type`, `placeholder`, `disabled`, `readonly`, `inputId`, `size`, `rows` |
| **DsModal** | sm, md, lg, xl | Dialogs, confirmations | `visible`, `title`, `size`, `scrollable` |
| **DsSelect** | sm, md, lg | All select dropdowns | `modelValue`, `placeholder`, `disabled`, `inputId`, `size` |
| **DsCombobox** | sm, md, lg | Searchable dropdowns, country picker, filtered selects | `modelValue`, `options`, `optionLabel`, `optionValue`, `placeholder`, `searchPlaceholder`, `noResultsText`, `disabled`, `size` |
| **DsPill** | accent, success, warning, danger, info | Status indicators, labels | `variant` |
| **DsSpinner** | sm, md, lg + overlay mode | Loading states | `size`, `overlay` |
| **DsStatusTag** | success, error, warning, info, pending | Document/crawl status | `variant` |
| **DsTabs** | default, fill | Tab navigation, flex-fill layouts | `tabs`, `modelValue`, `fill` |

### Extension Points (CSS Custom Properties)

DsCard flat variant supports `--ds-card-border-color` for border color overrides without `!important`.
DsButton ghost variant supports `--ds-btn-ghost-color`, `--ds-btn-ghost-hover-color`, `--ds-btn-ghost-hover-bg`.
DsSelect supports `--ds-select-bg`, `--ds-select-color`, `--ds-select-border-color`.
DsCombobox supports `--ds-combobox-bg`, `--ds-combobox-color`, `--ds-combobox-border-color`, `--ds-combobox-list-max-height`.
DsTabs supports `--ds-tabs-active-color`, `--ds-tabs-active-border-color`.

### Patterns That Do NOT Need DS Components

- **Specialized interactive widgets** (thumb buttons, skin tone selectors) — Use native `<button>` with scoped CSS
- **Raw HTML strings** (print views, new-window content) — Cannot use Vue components
- **ECharts/ApexCharts tooltips** — Library-specific, use `!important` overrides
- **Layout panels** (sidebar, navbar) — Too tightly coupled to app layout
- **AdminDashboard specialized sections** — Too domain-specific
- **Large complex dialogs** (FileDetailsDialog, UserProfileComponent) — Hand-rolled modal structure is too intertwined with domain logic to safely refactor to DsModal delegation

### i18n

Use `this.$t('key')` or the component's `translate()` helper. All user-facing strings must go through i18n. DS components do not handle translation internally — consumers pass translated text via props or slots.

## Visual Fidelity

How to work on this component's **visible** behaviour. The rules are not "be careful" — each one names a defect that
shipped once because the rule was missing.

### The layer and the app are two systems

`src/styles/genie-visual-effects.css` is an **additive** layer, gated on `html[data-visual='on']` and
`.genie-living-intelligence`. The app must lay out and behave **identically with the layer switched off** — that is
how the layout defects fixed in 2026-10 were found, and how they must stay detectable.

**The layer must never dictate the app's layout, and app code must never learn the layer's selector shape.** They
have already fought over one property: the layer anchors its corner artwork on `.sidebar` with `position: relative`,
and a component rule at lower specificity simply did not apply — no error, the policy just did not happen. The fix
belongs in the layer (bound the rule to the range where the panel is really in flow). **If a component rule seems to
need to out-specify the layer, that is the signal to fix the layer instead.**

### Traps in this codebase

| Trap | What happens | What to do |
|---|---|---|
| `var()` inside an `@container` condition | Chromium **silently drops the whole rule**. Every `@container` with `var()` in its condition never matches, and the base fallback wins. | Keep the token out of the condition: `auto-fit` + `minmax(var(--x), 1fr)` with a `max-width` cap, or a literal. Verified on Chromium 147. |
| The overlay's `::before` full-bleed | `width: calc(100% + 2 * var(--space-lg))` **needs** matching negative margins, or it overflows its panel by that much on the right. | The extra width and the negative margins are a pair — copy the pattern whole. |
| A gradient `mask-image` with `transparent` | `mask-mode`'s `match-source` default resolves `transparent` (luminance 0) to a fully-off mask, and the artwork bleeds through. | Force `mask-mode: alpha` when the gradient's stops carry alpha. |
| `overflow: visible` children | A child sticking out reports **no** scrollable overflow, so `scrollWidth > clientWidth` finds nothing. | Compare the child's `getBoundingClientRect()` against the container's content box. |
| A flex `gap` between panels | A gap sits between the *items*, so it also separates a collapsed panel from the content. | Put the spacing on the panels, where it can be dropped conditionally — or drop it, the panels have borders. |
| `elementFromPoint` on a page with a splash overlay | The splash sits on top, so probes hit the splash and the page is never measured. | Wait for `.splash-screen` to detach before probing. |
| Reading a build's freshness by timestamp | A build from the working tree before the commit is legitimate and content-identical. | Check the **built content** (`grep <token> /app/dist/css/app.*.css`). |

### Measuring

- **The capture script**: `../../tests/e2e/capture-dashboard.js` captures the welcome screen and the DOM facts a
  screenshot cannot prove, and writes a `.audit.json` beside each PNG. `BASE_URL=<origin> node
  tests/e2e/capture-dashboard.js` from the repository root, where `playwright` resolves.
- **A capture named after a state it never reached is worse than no capture.** The script aborts when a sidebar state
  it claims to capture did not actually collapse, and when the panel did not widen. Keep that behaviour.
- A screenshot read back yields a URL. **Pair every image with the audit; where the two disagree, the audit wins.**
- **Direct access grants are disabled on the realm.** The browser login is the only path:
  `tests/e2e/helpers/chatbot.js` → `loginViaUI(page)`. A spec that walks a page unauthenticated is bounced to the
  login by the router guard, and that navigation destroys the execution context its assertions read from — the spec
  then fails on a race, not on what it meant to check.

### Writing the spec

- **Assert the invariant, not a table.** A hardcoded expectation per viewport is a table written before the layout
  existed, and it will steer the layout. Derive it: `columns = clamp(1, floor((P + G) / (M + G)), 4)` from the measured
  panel width `P`, the gap token `G` and the card minimum `M` — so a deployment that overrides the token is checked
  too.
- **Mutation-test every assertion.** Break the code, watch it go red, revert. The spec's value is the red; an
  assertion that stays green under a deliberate break is decorative.
- **Drive the real interaction** — `page.mouse`, `page.keyboard`. `dispatchEvent` bypasses the browser's
  hit-testing, and a gesture the user cannot perform is a gesture nobody tests.
- **Add a viewport that exercises the cap.** The four-column cap is not exercised at 1920; it needs 2400.
- **A layout assertion that can pass for the wrong reason is a defect.** If the geometry is right but the mechanism is
  not, the next change breaks it silently.

### The serving stack for a visual check

A visual check needs six things from whatever stack it runs on, whichever orchestrator that is:

1. **An origin of its own** — a URL the browser and Playwright can reach, serving the app and proxying the API.
2. **An image of its own** — the code under test, on a tag nobody else runs.
3. **The stack behind it** — shared when it is already up, brought up first when it is not.
4. **A rebuild→serve step measured in seconds.**
5. **A way to prove the running instance has the new code.**
6. **A login path** — a browser login, since direct access grants are disabled on the realm.

**The shape is the same in both orchestrators: one extra frontend instance per worker, on top of a shared
stack.** Only the frontend is duplicated. The backend, the identity provider and the data tier are not — and
for a change that lives above the frontend, nothing below it changed, so duplicating it is pure cost.

**Never rebuild the shared stack's own frontend while someone is looking at it, and never `down -v` the shared
project** — the volumes carry the data.

#### Docker Compose — the current dev loop

The shared project (`living-intelligence`) holds Kong, the backend, Keycloak, ArangoDB, Postgres and Redis —
one instance of each. A worker adds **two containers** and nothing else: the frontend on **its own image
tag**, and an nginx in front of it publishing **its own port**, proxying `/api` to the shared Kong.

```bash
# the shared stack, once
docker compose -p living-intelligence up -d

# one worker
docker build -t genie-ai-frontend:lot-a components/gov-chat-frontend/
docker run -d --name li-a-frontend --network living-intelligence_genieai_network \
  -e VUE_APP_API_URL=/api \
  -v "$PWD/components/gov-chat-frontend/public/config:/app/dist/config:ro" \
  genie-ai-frontend:lot-a
docker run -d --name li-a-nginx --network living-intelligence_genieai_network \
  -p 9444:443 -e NGINX_PUBLIC_DOMAIN=localhost -e NGINX_HTTPS_PORT=9444 \
  -e NGINX_FRONTEND_HOST=li-a-frontend -e NGINX_FRONTEND_PORT=8090 \
  -e KONG_PROXY_HOST=living-intelligence-kong-1 \
  registry.opensource.unicc.org/un/itu/genie-ai/genie-ai-nginx:latest
```

Bind-mount `public/config` at `/app/dist/config`: the runtime config is generated at container start, so a config
edit then needs no rebuild — only a container restart.

The shared Keycloak must accept the worker's origin: add its `redirectUris` and `webOrigins` through the admin
API — no restart, no repo change.

Two facts that cost time:

- Keycloak binds its HTTP listener to the **resolved address of `KC_HOSTNAME`**. With `KC_HOSTNAME=localhost` it
  binds `127.0.0.1` inside its own container and every other container gets "Connection refused", while the
  healthcheck still passes because it tests from inside. Override `KC_HOSTNAME_STRICT=false` and `KC_HTTP_HOST=0.0.0.0`.
- The frontend container is the app; the nginx in front of it is the public entry. The app's real root is
  `/app/dist`, **not** `/usr/share/nginx/html`, which is a stock page this image never uses.

#### Kubernetes — the migration target

Same shape: the shared release is the stack, and a worker adds **a frontend instance with its own image tag**
plus a way to reach it. The chart renders one frontend per release, so a worker's instance is a hand-written
Deployment + Service **in the shared namespace** — not a second release, and no second ArangoDB, Keycloak or
backend.

Why that works:

- The chart's NetworkPolicies select by `genieai.io/component: <service>`, so a pod carrying its own labels is
  not governed by them: the worker's instance reaches the shared backend and Keycloak Services.
- The worker's origin serves the SPA **and** proxies `/api` to the shared backend, so the browser stays
  same-origin — no CORS change, no second realm.
- The image is the same one the stack runs: `eval $(minikube docker-env)` + `pullPolicy: Never` for a local
  build, or a registry tag. Then `kubectl set image` + `kubectl rollout status`.

What it costs:

- **The edge owns the API path matrix.** The Envoy route sends `/api/files` and `/api/labels` to the
  document-repository and the rest of `/api` to the backend. A worker's own proxy must reproduce that split, or
  the document paths break for that worker only. The alternative — giving the worker its own host on the edge
  (`ingress.host` + a cert-manager certificate + an HTTPRoute) — costs a host, a certificate and a `/etc/hosts`
  entry, and buys the edge's own routing.
- **The realm must accept the worker's origin** — `redirectUris` and `webOrigins` through the admin API, exactly
  as in compose. And the worker's origin must be a **secure context** for the PKCE login: `localhost` over plain
  HTTP qualifies; a custom hostname over plain HTTP does not.
- **The shared stack must be up.** If it is not, bring it up first (`helm upgrade` the release, or
  `flux reconcile hr genieai -n flux-system`) — a worker instance has nothing to lean on otherwise.

> This mapping is read off the chart, and **no worker instance has been run this way yet** — treat it as the
> shape, not as a verified recipe, and verify each step before relying on it.

### Known gaps

Carried openly rather than discovered later:

- The **dark banner artwork was never shipped by the designer**. Dark mode uses the light artwork, which reads well
  on the dark surface but is not the reference's own illustration.
- The **Manx locale** needs a native reviewer for the new strings.

