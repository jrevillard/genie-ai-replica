# Living Intelligence Visual Layer — Design Spec

- **Date**: 2026-10-20
- **Status**: Draft (post-brainstorming + code review, pre-implementation)
- **Path**: architectural (new config contract + a load-time failure mode)
- **Scope**: `main` only. `release/el-salvador` convergence is a separate workstream (see *Out of scope*).
- **Input**: designer package `genie-ai-living-intelligence-v2` (additive graphical kit — 5 assets, 1 scoped stylesheet, Light/Dark reference mockups)
- **Prerequisite**: the runtime theme config refactor (`#998`, MR !558). This spec extends the contract it introduced.
- **Reviewed**: `d23dfa4eb..142698d9e`; review findings folded in, see *Review findings resolved* at the end.

## Problem

The default (base) theme renders correctly but reads as a generic dashboard. A
designer prepared a "Living Intelligence" visual layer that makes the welcome
screen the product's front door: a globe hero illustration, ambient dot mesh,
bottom waves, a corner network motif, and frosted-glass quick-help cards with a
per-category tint.

Neither the visual layer nor the concept of a *per-deployment* visual identity
exists on `main`. The only per-deployment theming is `theme.brandColor` and
friends, which cannot express "this deployment has its own hero illustration".

## Goal

1. The base theme adopts the Living Intelligence welcome screen, matching the
   reference mockups.
2. Every visual asset is **operator-customisable per deployment** by editing
   files in the runtime config directory — no image rebuild, no code change.
3. No design-system rule is bypassed. Token-driven and scoped; no hardcoded
   colours, no `!important` except one documented carve-out.
4. Deployments that want none of it can turn it off from JSON alone.
5. The config `$schema`, which is currently declared but **never enforced**,
   becomes a real contract that fails loudly on a broken file.

## Non-goals

- Converting the El Salvador / AgroGenio palette (separate workstream).
- Backporting `config_bootstrap` to `release/el-salvador` (separate agent).
- Recolouring or regenerating the quick-help icons — already at the target
  colours (see *Findings*).
- A user-facing theme picker (explicit non-goal of `#998`).
- Keycloak login/admin theming — out of the kit's scope.

---

## Visual fidelity gate

**Fidelity to the reference mockups is the acceptance criterion.** Not "the layer
is present and token-driven" — the render must match `docs/reference-light.png`
and `docs/reference-dark.png`.

An iterating loop, not a single check at the end:

```
implement → code review → fix → screenshot → compare against reference
          → fix the delta → code review → … until the delta is nil
```

Do not declare the work done on a passing unit suite. A green Jest run and a
faithful render are independent facts, and only the second is the goal.

### Procedure

1. Bring the frontend up locally with the base config, at the viewport the
   mockups were captured at.
2. Capture the dashboard welcome screen in **both** light and dark.
3. Put each capture next to its reference and diff them region by region: hero
   placement and scale, mesh opacity, wave height and position, corner network,
   card grid geometry, card tint per category, heading scale, navbar treatment.
4. Every difference is either **fixed** or **recorded with a reason**. Silent
   divergence does not close the loop.
5. Repeat from step 1 after each fix round.

### Screenshot discipline

A screenshot alone is not evidence — reading a PNG back yields a URL, never a
claim about how it looks. Every capture ships with a **DOM audit** asserting
what a picture cannot prove:

- `naturalWidth` / `naturalHeight` of each decoration asset (a `0` means it
  failed to load and the "comparison" was of an empty box)
- `getComputedStyle` on `.quick-help-overlay`, `.quick-help-item`, `.nav-bar` —
  background, border, radius, `backdrop-filter`
- presence and count of `[data-visual]`, `.quick-help-item`, and the
  `::before` pseudo-element's content box
- resolved values of `--visual-hero`, `--qh-accent`, `--accent`, `--brand`

If the DOM audit disagrees with what the screenshot appears to show, the audit
wins.

### Deterministic fixture

A faithful comparison needs a populated screen. A fresh local database renders
an empty knowledge tree and a failing weather panel, which would make the
comparison meaningless and round 3 incomparable to round 1. Seed, once, as a
repeatable script:

- the knowledge-area / service-category nodes visible in the mockup
- at least one document in the right-hand "Info & Resources" panel
- quick-help buttons come from the base config (already present)
- the weather panel response (stubbed — its live data is not the subject)

### Existing harness

`tests/e2e/theme-runtime-config.spec.js` already exercises the runtime config
path this work extends. Extend it rather than standing up a second Playwright
project; `playwright.config.js` takes `BASE_URL` from the environment.

---

## Findings — most of the mockup already exists

### Free today, zero code change

| Mockup feature | Mechanism |
|---|---|
| Blue→violet navbar gradient | `theme.navbar.background` accepts a `linear-gradient()` string (`config-loader.js:49` → `--navbar-bg` → `theme-components.css:36`) |
| Brand / accent palette | `theme.brandColor` → `--brand`, everything else derived in OKLch (`theme-variables.css:125-147`) |
| Background, foreground | `theme.bg` → `--config-bg`, `theme.fg` → `--config-fg` |
| Semantic colours | `theme.colors.{success,warning,danger,info}` |
| Typography family + scale | `theme.typography.{fontFamily,fontScale}` |
| Weather widget | `WeatherPanel.vue`, rendered by `SideBarComponent.vue:83` |
| Knowledge-area tree | `ServiceTreePanelComponent.vue`, rendered by `SideBarComponent.vue:31` |
| Info & Resources sidebar | `RightSideBarComponent.vue` — `.sidebar` `:340`, `.sidebar-header` `:355`, `.sidebar-section` `:384`, `.document-item` `:410` |

> Caveat: these are *capabilities*, not shipped settings. No config file in the
> repo currently sets `theme.navbar.background`. Setting it is config editing,
> not development.

### Icons: no work required

The nine quick-help SVGs in `public/config/quickhelp/` are already authored in
saturated, distinct colours — the ones in the mockups. Note the values are
`stroke`, not `fill`: every SVG is `fill="none" stroke="#…"` (`just-chat.svg`).

| SVG | stroke | mockup card |
|---|---|---|
| `just-chat` | `#4e97d1` | Just Chat (blue) |
| `identity-civil` | `#10b981` | Apply for ID (green) |
| `taxes-revenue` | `#f59e0b` | Pay Taxes (orange) |
| `business-trade` | `#6366f1` | Start Business (indigo) |
| `healthcare-social` | `#ef4444` | Healthcare (red) |
| `education-learning` | `#3b82f6` | Education (blue) |
| `transportation-mobility` | `#8b5cf6` | Transport (violet) |
| `housing-urban` | `#06b6d4` | Housing (cyan) |
| `employment-labor` | `#ec4899` | Find Jobs (pink) |

Runtime icon tinting was considered and **rejected**: the icons are `<img src>`
of operator-owned files, and a deployment swaps them the same way it swaps its
splash. No `filter`, no `data-category`, no SVG rewriting.

### Per-button styling already exists in config — and is dead

Each quick-help button already declares a `styles` object in the `$schema`,
marked **`required`**, with `backgroundColor` / `hoverColor` / `outlineColor`.
Six of the seven config files populate all three on all nine buttons;
`genie-ai-config-huduma.json` carries **eight distinct** `outlineColor` values —
exactly the per-category concept this work wants.

**Nothing in the frontend reads it.** It is declared, populated, required, and
dead. This work revives it rather than introducing a competing field.

### The actual gap

1. A `styles` block on the base config (the six flavours already have one).
2. CSS that consumes it.
3. The four decoration assets, with configurable paths.
4. The decorative stylesheet itself.

---

## Architecture

Follows the `#998` contract exactly: **assets in the bind-mounted config
directory, styling in a scoped stylesheet, deployment choices in JSON.** No new
build step, no new mount.

```
                    ┌──────────────────────────────────────────────┐
  host              │ {{ config_dir }}/frontend/                   │
  (operator-editable│   ├── theme-variables.css                     │
   via rsync        │   ├── genie-ai-config.json      ← validated   │
   --ignore-        │   ├── quickhelp/*.svg           ← icons       │
   existing)        │   └── genie-visual/assets/*     ← NEW          │
                    └───────────────┬──────────────────────────────┘
                                    │ read-only bind mount
                                    ▼
                    ┌──────────────────────────────────────────────┐
                    │ /app/dist/config/  (in the frontend image)    │
                    │   nginx `location ^~ /config/` → no-cache     │
                    └───────────────┬──────────────────────────────┘
                                    │ fetch + validate
                                    ▼
        config-loader.js ──► documentElement
          --brand                    (existing pattern)
          --visual-hero       url("…")
          --visual-waves      url("…")
          --visual-mesh       url("…")
          --visual-corner     url("…")
          data-visual         "on" | "off"
                                    │
                                    ▼
        genie-visual-effects.css
          scoped by .genie-living-intelligence  (DashboardView root)
          gated by html[data-visual='on']
```

### Config contract

```jsonc
{
  "theme": {
    "brandColor": "#4071cb",

    // NEW — the decorative layer
    "visual": {
      "enabled": true,
      "assets": {
        "hero":   "/config/genie-visual/assets/genie-hero-transparent.png",
        "waves":  "/config/genie-visual/assets/genie-bottom-waves.svg",
        "mesh":   "/config/genie-visual/assets/genie-dot-mesh.svg",
        "corner": "/config/genie-visual/assets/genie-corner-network.svg"
      }
    }
  },
  "features": {
    "chat": {
      "quickHelp": {
        "buttons": [
          {
            "id": "identity-civil",
            "icon": { "type": "file", "value": "/config/quickhelp/identity-civil.svg" },
            "styles": {
              "backgroundColor": "#d1f5ea",
              "hoverColor":      "#a7e8d4",
              "outlineColor":    "#10b981"
            }
          }
        ]
      }
    }
  }
}
```

`theme.visual` is new and must be declared in the `$schema`. `styles` is already
declared — declaring `theme.visual` alongside it is all that is needed.

### Runtime wiring

`src/config-loader.js`, following the `--brand` pattern exactly:

```js
const VISUAL_ASSET_KEYS = ['hero', 'waves', 'mesh', 'corner'];

if (theme.visual) {
  root.dataset.visual = theme.visual.enabled === false ? 'off' : 'on';
  for (const key of VISUAL_ASSET_KEYS) {
    const value = theme.visual.assets?.[key];
    if (value) root.style.setProperty(`--visual-${key}`, `url("${value}")`);
  }
}
```

The explicit key list is deliberate: `Object.entries()` would turn a typo
(`heor`) into an inert `--visual-heor` with no signal anywhere.

Two independent gates:

- `.genie-living-intelligence` on the `DashboardView` root scopes the layer to
  the dashboard route.
- `html[data-visual='on']` carries the deployment's choice.

**Every rule in the stylesheet is gated**, e.g.
`html[data-visual='on'] .genie-living-intelligence .quick-help-item { … }`.
The designer's kit has no `data-visual` selector at all, so this prefix is a
required transformation of the kit, not an optional extra — without it,
`enabled: false` does nothing.

`theme.visual` is deliberately **not** added to the loader's `defaults`. The
merge at `config-loader.js:34` is shallow, so `data.theme` would replace
`defaults.theme` wholesale and discard it on every successful fetch anyway; and
its presence breaks the existing fetch-failure assertion at
`config-loader.test.js:116`.

---

## Config validation at load time

### Current state: no enforcement, and drift

`config-loader.js` fetches, parses, and merges. There is no schema validation,
no validator dependency in `package.json`, and the `$schema` key is consumed
only by IDEs and tooling.

The drift this allowed, measured by validating each file against its own
embedded schema (each config *is* its schema — it carries `properties` at top
level alongside its own data):

| File | Errors |
|---|---|
| `genie-ai-config.json` (base) | **36** |
| the 6 flavour configs | **2 each**, all the same |

The 36 collapse to four root causes:

| Root cause | Count | Fix |
|---|---|---|
| `title`, `welcomeMessage` declared `string`, actually locale dictionaries | 10 | a `LocalizedText` definition: `oneOf: [{type: string}, {type: object}]` |
| `action.visibleText`, `action.hiddenPrompt` likewise | 18 | same definition |
| `action` `required`, absent on `just-chat` | 1 | drop from `required` — the un-categorised "Just Chat" legitimately has no prompt |
| `styles` `required`, absent on the base config | 10 | **this work adds it** |

The flavour configs fail on one thing: `theme.required` lists `primaryColor`,
which **nothing reads** — `config-loader` reads `brandColor`.

### Design

1. **Repair the schema first**, in its own commit, so all seven files validate
   cleanly. Verified by re-running a validator: target is **0 errors on all 7**.
2. **Then** add validation to `config-loader.js`, failing hard.

```js
const validate = new Ajv({ allErrors: true }).compile(config.$schema);

let data = null;
try {
  const response = await fetch('/config/genie-ai-config.json');
  if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
  data = await response.json();
} catch (error) {
  console.error('Error loading config:', error);
}

if (data) {
  if (!validate(data)) {
    // Outside the catch on purpose: an invalid config is an operator error,
    // not a transient fetch failure. main.js awaits loadConfig() before
    // createApp(), so throwing leaves the app unmounted and the error visible.
    throw new Error(`genie-ai-config.json failed schema validation:\n${ajv.errorsText(validate.errors, { separator: '\n' })}`);
  }
  config = { ...config, ...data };
}
```

Three semantics this preserves deliberately:

- **Fetch failure is not a validation failure.** The existing behaviour and its
  test survive: log, fall back to defaults, app boots on `--brand`.
- **Invalid config is fatal.** The app does not mount. Silently booting on a
  half-understood config is how a deployment ends up serving a broken theme with
  no signal.
- **Validation is not in the try/catch**, so it cannot be swallowed.

### Validator choice

Two defensible options, and the repo already leans one way: `ajv` is a
dependency of `tests/config-validator`, so it is the existing in-repo tool for
JSON Schema and nothing new has to be learned to maintain it. It weighs ~120 KB
minified, which is real money in a frontend bundle.

`@exodus/schemasafe` is zero-dependency, ~10 KB, supports draft-07, and is built
for precisely this job — validating untrusted JSON at runtime in a browser.

**Recommend `ajv`**, on repo consistency and because `allErrors` diagnostics are
better for the operator-facing error message this design depends on; accept the
bundle cost, or evaluate `@exodus/schemasafe` if bundle size becomes a problem.
The choice does not affect anything else in the design.

### Breaking-change risk — must be stated plainly

Turning this on is a **breaking change for any deployment whose host config does
not validate**, including:

- a node whose `genie-ai-config.json` was hand-edited by an operator and drifted
- `release/el-salvador`, whose config is not in this repo's `public/config/` set
  and cannot be validated from here

The failure mode is a frontend that does not boot, not a degraded theme. That is
what "fail on error" means, and it is the right trade — but it is a trade.
Rollback is a one-line removal of the `validate` call; `config:validate`-style
CI checking is deliberately *not* added, because the user chose load-time
enforcement and both halves is neither.

---

## Component changes

### New files

| Path | Purpose |
|---|---|
| `public/config/genie-visual/assets/genie-hero-transparent.png` | Globe hero, 2172×724 RGBA, 1.2 MB |
| `…/genie-bottom-waves.svg` | Bottom wave decoration |
| `…/genie-dot-mesh.svg` | Surface dot motif, 90.7 KB raw / 7.1 KB gzipped |
| `…/genie-corner-network.svg` | Sidebar corner decoration |
| `…/genie-ambient-lines.svg` | Shipped but **not wired** (designer marks it inactive) |
| `src/styles/genie-visual-effects.css` | The scoped layer |

Assets go under `public/config/`, **not** `public/`. `config_bootstrap` already
rsyncs `components/gov-chat-frontend/public/config` → `{{ config_dir }}/frontend`
with `--ignore-existing` (`defaults/main.yml:27`, `tasks/main.yml:107`), so they
are seeded automatically and an operator's replacement survives the next deploy.
That invariant is the single thing a future contributor is most likely to break
by "tidying" the path — hence this line.

### Modified files

| Path | Change |
|---|---|
| `src/config-loader.js` | Schema validation; `theme.visual` wiring; no `defaults` change |
| `src/main.js` | `import './styles/genie-visual-effects.css';` **after** `./theme-components.css` (designer's stated order) |
| `src/views/DashboardView.vue` | Add `genie-living-intelligence` to the existing root class — 1 line |
| `src/components/ds/Card.vue` | **New escape hatch**: `background: var(--ds-card-bg, var(--surface))` |
| `src/components/ChatBotComponent.vue` | Carry `button.styles` through the `quickHelpButtons` projection (`:730-740`) and bind it on the card (`:149-158`). **Plus** the D1 grid fix: drop the 600px `.quick-help-content` cap, base `repeat(4, 1fr)`, descending `max-width` breakpoints 1024→3, 768→2, 480→1, gap `--space-xl` |
| `public/config/genie-ai-config.json` | `theme.visual`; `styles` block on all nine buttons |
| the 6 flavour configs | `theme.visual` only (`styles` already populated) |
| all 7 `$schema` blocks | Declare `theme.visual`; repair the four drift causes |

### Why `Card.vue` changes

`Card.vue:55` sets `background: var(--surface)` inside `<style scoped>`, which
compiles to `.ds-card[data-v-hash]` — specificity **(0,2,0)**. The kit's
`.quick-help-item { background: var(--gli-frost) }` is also **(0,2,0)**. An exact
tie, so source order decides — and order is deterministic: `router.js:16`
lazy-loads `DashboardView`, so `ChatBotComponent.vue` and `Card.vue` styles land
in an **async** chunk injected after `main.js`'s initial CSS. The scoped rule
wins, every card stays opaque, and the layer's signature effect renders wrong
with no console error.

The fix is the one the DS mandates (rule 5, escape-hatch custom properties), and
it resolves the tie at the source rather than escalating specificity:

```css
/* Card.vue */
.ds-card { background: var(--ds-card-bg, var(--surface)); }

/* kit */
html[data-visual='on'] .genie-living-intelligence .quick-help-item {
  --ds-card-bg: var(--gli-frost);
  border-color: color-mix(in srgb, var(--qh-accent, var(--accent)) 17%, var(--border));
}
```

`--ds-card-border-color` already exists at `Card.vue:68`, so this follows an
established precedent in the same file.

### Consuming `styles`

`backgroundColor` → the card's frosted tint, `hoverColor` → the hover tint,
`outlineColor` → the border tint. Lifted onto the element as `--qh-accent`
(style binding on the `DsCard`), consumed by the kit via `color-mix()`, falling
back to `--accent` when a deployment omits `styles`. A missing `styles` block
therefore degrades to today's appearance instead of breaking.

`.chat-window`'s two radial gradients are **dropped**: `ChatBotComponent.vue:1963`
sets `background` as a shorthand, which resets `background-image`, and the
overlay covers that element completely whenever quick help is showing.

### `!important` — one documented carve-out

The kit's `prefers-reduced-motion` block uses `!important`, and it is load-
bearing: `.quick-help-overlay::before` is (0,2,1) and beats the block's own
`.genie-living-intelligence *::before` at (0,1,1), so stripping it silently
breaks reduced motion.

Carve out that block only, with the rationale. Precedent exists on `main` at
`theme-components.css:335` and throughout `charts-apex-overrides.css`. No other
`!important` is permitted.

### Explicitly not changed

- `theme-components.css` — it owns none of the kit's classes, and the
  `:root body` specificity pattern it uses (see its comment at `:328-332`) is
  for the *bundle*'s scoped rules, not for this stylesheet.
- `theme-variables.css` — no new tokens. The kit resolves entirely on
  `--accent`, `--surface`, `--border`, `--font-display`, `--radius-xl`,
  `--shadow-sm`, `--shadow-md`, all of which already exist.
- The quick-help SVGs, `WeatherPanel.vue`, `NavBarComponent.vue`,
  `SideBarComponent.vue`, `RightSideBarComponent.vue`.
- `.just-chat` (`ChatBotComponent.vue:156`) is a dead class binding with no
  rule anywhere. Left alone; flagged so nobody assumes the kit hooks into it.

---

## Known risks

| Risk | Status | Decision |
|---|---|---|
| Glass renders invisible — opaque `DsCard` wins the specificity tie | **Real, confirmed** | Resolved by the `Card.vue` escape hatch above |
| `enabled: false` inert — the kit has no `data-visual` selector | **Real, confirmed** | Every kit selector gets the `html[data-visual='on']` prefix |
| `backdrop-filter` has little to blur — the overlay is opaque `var(--surface)` (`ChatBotComponent.vue:2190`) | **Real, confirmed** | Verify visually first; may need a translucent overlay surface or a raised mesh opacity |
| Hero becomes a flex item in a `justify-content: center` column (`ChatBotComponent.vue:2195`), so it centres vertically instead of sitting at the top | **Real, confirmed** | Decide `justify-content` in the scoped layer; check against the reference |
| The kit adds `overflow: hidden` to the overlay, inside `.chatbot-container { overflow: hidden; height: 100% }` (`ChatBotComponent.vue:1871`). With a 218 px hero, a heading, and a 3-row grid, a 600–700 px window clips the last row with no scroll path | **Real, not in the kit's own QA list** | Verify at short viewport heights; likely needs the overlay to scroll rather than clip |
| `--visual-heor`-style typos from free-form asset keys | Prevented | Explicit key allowlist |
| Hard-fail validation breaks a hand-edited or non-repo config | Accepted | Documented above; rollback is removing the `validate` call |

---

## Decisions taken, with reasoning

**Assets under `public/config/`.** The `config_bootstrap` seeding invariant is
what makes them operator-swappable. `public/` would bake them into the image.

**Asset paths as CSS custom properties.** The designer's stylesheet hardcodes
`/genie-visual/…`. Baking operator-owned paths into bundled CSS would defeat the
purpose of `#998`. `--visual-*` keeps the stylesheet path-agnostic: change the
path in JSON, not in CSS.

**`enabled` default-on in the base config, absent elsewhere.** The base config is
what the framework ships as canonical. An explicit `false` and an absent block
behave identically.

**Revive `styles`, do not add `color`.** It exists, is `required`, and is fully
populated in six of seven configs with the exact per-category intent. Adding a
second field would leave a trap.

**No icon tinting.** Confirmed against the shipped SVGs.

**`ambient-lines.svg` shipped unwired.** An operator can switch it on with one
line of JSON.

**Graceful degradation on missing assets.** A broken `url()` on a
`background-image` paints nothing and shows no broken-image icon; combined with
`@theme_fallback` (`nginx.conf:30`), an unseeded mount degrades rather than
breaks. A missing `styles` block likewise falls back to `--accent`.

### Open decisions

None. D1–D3 are decided below.

### D1 — quick-help grid width — **decided: follow the el-salvador precedent**

Measured on `reference-light.png` (1775×886): left sidebar ends at x=412, right
sidebar starts at x=1442, the quick-help grid spans x=440→1409 — **969 px in a
1030 px centre panel, four cards of ~217 px, gap ~35 px**.

`main` today caps `.quick-help-content` at 600px (`:2201`) while
`@media (min-width: 1024px)` forces `repeat(4, 1fr)` (`:2295-2299`). The column
count is driven by the **viewport** inside a **fixed-width container**, so at a
1024px viewport the centre panel is ~450px and the four columns come out at
~90px each, around a 40px icon. The cards are already crushed today, before
any of this work.

`release/el-salvador` already solved it, and it is in the repo:

| | `main` | `release/el-salvador` |
|---|---|---|
| `.quick-help-content` | `max-width: 600px` | **absent — no cap** |
| columns (base) | `repeat(auto-fill, minmax(250px, 1fr))` | `repeat(4, 1fr)` |
| breakpoints | `min-width` 768→3, 1024→4 | `max-width` 1024→3, 768→2, 480→1 |
| gap | `--space-md` (16px) | `--space-sm` (8px) |

At the mockup's 1775px viewport that yields four cards of ~240px against the
mockup's 217px — the card width matches.

**So: mirror el-salvador, in `ChatBotComponent.vue`.** Drop the 600px cap, make
the base `repeat(4, 1fr)`, switch to descending `max-width` breakpoints
1024→3, 768→2, 480→1, and set the gap to `--space-xl` (32px, the closest DS
token to the mockup's ~35px).

Two consequences worth stating:

- The grid geometry is fixed **once, in the component**, so every deployment
  benefits — including those that never enable the visual layer. The theme
  layer then needs **no geometry override at all**, which means **no
  specificity war** on the grid. The C2 hazard stays confined to `Card.vue`,
  which has an official extension point.
- No upper cap, so at a 2560px viewport the four cards stretch. el-salvador
  accepts this. A cap is to be added **only if the visual fidelity check shows
  it** — which is what the fidelity loop is for.

### D2 — card subtitles — **decided: defer**

The mockup shows a second line per card ("Get answers and explore information").
Adding it means a locale dictionary per button across 14 locales × 7 config
files. That is copy authoring, not theming, and it is the single largest cost in
this spec. Deferred to its own change.

### D3 — hero weight — **decided: ship as-is**

1.2 MB, does not compress (gzip 1.19 MB). Served under `location ^~ /config/`
with `no-cache, must-revalidate` (`nginx.conf:20`), so nginx answers `304` on
repeat loads — the cost is a revalidation round-trip, not a re-download. Moving
the assets out of `/config/` to gain immutable caching would make them
non-swappable, which is the point. Converting to WebP/AVIF would save ~1 MB but
adds an asset pipeline and a toolchain dependency to a repo that has neither.

---

## Testing strategy

### Unit (Jest)

- **`config-loader.test.js`** — extend.
  - an invalid config **throws** and does not merge
  - fetch failure still logs, falls back to defaults, sets only `--brand`
    (protects the existing assertion at `:116`)
  - `theme.visual` absent → no `data-visual`, no `--visual-*`
  - `enabled: false` → `data-visual="off"`
  - an unknown asset key is ignored (allowlist)
  - `theme.visual.assets` missing entirely does not throw
- **`ChatBotComponent.test.js`** — a button with `styles` sets `--qh-accent`;
  a button without falls back and renders as today.
- **`DashboardView`** — new test file; `src/__tests__/views/` does not yet
  exist, so this creates the directory.
- **Card** — `Card.vue` honours `--ds-card-bg`.

### Manual / browser

The designer's QA checklist, adapted: overlay layout after the `::before`
insertion; chat scrolling; quick-help click targets and `:focus-visible`
outline; right-panel titles and toggle at narrow widths; the `max-width: 900px`
and `600px` steps; light / dark / system theme switching; `prefers-reduced-motion`.

The **visual fidelity gate** above is the primary one.

### Contrast

The frosted cards sit on `--surface`; check the tinted border against `--fg` in
both modes for every `outlineColor` across all seven configs — including the
`huduma` set, whose eight values are pale pastels (`#bcdcff`, `#f9a8d4`, …).

### CI safety — verified

`tests/config-validator/` only cross-references environment variables against
`docker-compose.yaml` and the Ansible templates; it never reads
`genie-ai-config.json`, the `$schema`, or assets. `config_bootstrap/tests/test_idempotence.sh`
builds its manifest dynamically (`find . -type f`) and is not wired into
`.gitlab-ci.yml`. New assets and new config keys are CI-safe.

---

## Rollout

Single MR on `main`, single feature branch, in two commits:

1. **Schema repair** — 4 edits, all seven configs validate at 0 errors. No
   behaviour change. Safe to land alone.
2. **Everything else** — validation, the visual layer, the `styles` wiring.

Then the design itself, per `.claude/rules/EL-SALVADOR-WORKFLOW.md`: generic
work on `main` follows **Path 1** (local validation → merge), then is
cherry-picked to `release/el-salvador` by whoever owns that convergence.

`genie-ai-config.json` carries `theme.visual.enabled: true` from day one.

## Rollback

| Lever | Effect |
|---|---|
| `"visual": { "enabled": false }` on the host | Removes the entire visual layer |
| Restore `genie-ai-config.json` on the host | `--ignore-existing` means a deploy never overwrote the operator's file |
| Remove the `validate` call | Disables load-time schema enforcement |
| `git revert` either commit | Nothing else depends on either |

---

## Acceptance criteria

- [ ] All seven config files validate against their `$schema` with **0 errors**.
- [ ] An invalid config prevents the app from mounting and surfaces the failing
      paths; a fetch failure still falls back to defaults and boots.
- [ ] Welcome screen renders the hero, dot mesh, bottom waves and sidebar corner
      decoration, matching the reference mockups in light and dark.
- [ ] Quick-help cards carry their category tint, derived from
      `buttons[].styles` — background, hover and border.
- [ ] The **four** wired assets resolve through `/config/` and each can be
      replaced by an operator on the host without a rebuild.
      (`genie-ambient-lines.svg` ships unreferenced, by design.)
- [ ] `"enabled": false` removes the layer entirely.
- [ ] `Card.vue` honours `--ds-card-bg`, and the frosted cards are visibly
      translucent rather than opaque.
- [ ] No hardcoded colour, radius, spacing or shadow in any new rule, except the
      two `color-mix()` partner hues the kit derives its secondary tints from
      (`#5de9f4`, `#b875f8`); and no `!important` except the documented
      reduced-motion carve-out.
- [ ] `theme-variables.css` gains no new tokens; the DS token list is unchanged.
- [ ] Light / Dark / System all render correctly.
- [ ] `prefers-reduced-motion: reduce` disables animation and transitions.
- [ ] A deployment with no seeded config directory renders a usable welcome
      screen — no broken images, no layout collapse.
- [ ] `npm run lint`, `npm run format:check` and `npm test` pass in
      `components/gov-chat-frontend`.
- [ ] **Visual fidelity gate passed** — see above.

---

## Out of scope — `release/el-salvador`

Owned by a separate workstream. Recorded so the two do not collide.

`release/el-salvador` predates `#998`: no `config_bootstrap` role (only `docker`,
`docker_socket_proxy`, `gitlab_runner`), tokens in `src/theme-variables.css`,
hardcoded hex palette (`--brand: #1e5631`, `--accent-hover: #3f9b43`, bespoke
`--accent-gold`).

- `theme.visual` and `styles` will not take effect there until the runtime-config
  refactor is backported; the config JSON is read either way, but the decoration
  assets will be image-baked, so swapping them needs a rebuild.
- Cherry-picking before that convergence is safe and inert: no `theme.visual`
  block means the layer never activates.
- **Load-time validation is a live risk there.** Its config is not in this
  repo's `public/config/` set and could not be validated from here. It must be
  checked before that branch receives commit 2.
- **Its `styles` blocks are empty.** All nine AgroGenio buttons carry
  `styles: {}` — unlike the six flavour configs on `main`, which populate
  `backgroundColor` / `hoverColor` / `outlineColor` on every button. Its
  per-category values will have to be authored during that convergence, or its
  cards fall back to `--accent`.

Noted for that workstream, not to be backported to `main`: four rules across
three selectors in el-salvador's `theme-components.css` hardcode
`rgba(76, 175, 80, …)` — `.analytics-section:hover` (twice), `.faq-item:hover`,
and `.chat-message.user .message-bubble`. They do not track `--brand`.

---

## Review findings resolved

From the review of `d23dfa4eb..142698d9e`:

| ID | Finding | Resolution |
|---|---|---|
| C1 | `html[data-visual]` gate did not exist in the kit → `enabled: false` inert | Every kit selector now carries the prefix, stated as a required transformation |
| C2 | `DsCard`'s opaque background wins the specificity tie → glass renders wrong, silently | `Card.vue` gains `--ds-card-bg`; resolved at the source |
| I1 | `theme.visual` in `defaults` breaks `config-loader.test.js:116` and is discarded by the shallow merge | Removed from `defaults` |
| I2 | AC forbade `!important`; the kit needs it | One documented carve-out for reduced motion |
| I3 | `styles.outlineColor` already existed, required, populated — spec never mentioned it | Revived instead of adding a competing `color` field |
| I4 | `--qh-accent` had no specified consumer | Explicit rule given, with the `--accent` fallback |
| I5 | The component change was larger than "one line" | Two edits named: the projection and the binding |
| I6 | Overlay clipping risk | Added to the risk table |
| I7 | AC said five assets; one ships unwired | Corrected to four |
| I8 | D1's premise was wrong — the grid is already four columns | Rewritten |
| M1 | Icon colours are `stroke`, not `fill` | Corrected |
| M2 | Overlay background is at `:2190`, not `:2186` | Corrected |
| M3 | Four rules across three selectors in el-salvador | Corrected |
| M4 | Free-form asset keys allow silent typos | Explicit allowlist |
| M5 | `src/__tests__/views/` does not exist | Stated |
| M6 | dot-mesh gzips to 7.1 KB | Corrected |
| M7 | CI safety of new assets and keys | Verified and recorded |
| — | Config `$schema` is declared but never enforced; base config violates it 36×, flavours 2× each | New section: repair, then enforce at load |
