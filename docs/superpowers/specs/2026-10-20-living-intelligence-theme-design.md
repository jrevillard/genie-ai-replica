# Living Intelligence Visual Layer — Design Spec

- **Date**: 2026-10-20
- **Status**: Draft (post-brainstorming, pre-implementation)
- **Path**: architectural (new config contract consumed by every deployment)
- **Scope**: `main` only. `release/el-salvador` convergence is a separate workstream (see *Out of scope*).
- **Input**: designer package `genie-ai-living-intelligence-v2` (additive graphical kit, 5 assets + 1 scoped stylesheet + Light/Dark reference mockups)
- **Prerequisite**: the runtime theme config refactor (`#998`, MR !558) — this spec extends the contract it introduced, it does not replace it.

## Problem

The default (base) theme renders correctly but reads as a generic dashboard. A
designer prepared a "Living Intelligence" visual layer that makes the welcome
screen the product's front door: a globe hero illustration, ambient dot mesh,
bottom waves, a corner network motif, and frosted-glass quick-help cards with a
per-category tint.

Neither the visual layer nor the concept of a *per-deployment* visual identity
exists on `main`. Today the only per-deployment theming is `theme.brandColor`
and friends, which cannot express "this deployment has its own hero illustration".

## Goal

Ship the designer kit on `main` so that:

1. The base theme adopts the Living Intelligence welcome screen, matching the
   Light/Dark reference mockups.
2. Every visual asset is **operator-customisable per deployment** by editing
   files in the runtime config directory — no image rebuild, no code change.
3. No design-system rule is bypassed. All new styling is token-driven and
   scoped; no hardcoded colours, no `!important`, no per-component forks.
4. Deployments that want none of it can turn it off from JSON alone.

## Non-goals

- Converting the El Salvador / AgroGenio palette (separate workstream).
- Backporting `config_bootstrap` to `release/el-salvador` (separate agent).
- Recolouring or regenerating the quick-help icons — **they are already at the
  exact colours the mockups show** (see *Findings*).
- A user-facing theme picker (explicit non-goal of `#998`, still valid).
- Keycloak login/admin theming — out of the kit's scope.

---

## Findings — most of the mockup already exists

A delta analysis against the mockups is what shaped this design. Roughly 85% of
what the mockups show is either already free or already implemented.

### Free today, zero code change

| Mockup feature | Already possible via |
|---|---|
| Blue→violet navbar gradient | `theme.navbar.background` accepts a `linear-gradient()` string; `config-loader.js` writes it to `--navbar-bg` and `.nav-bar` consumes it (`theme-components.css:35`) |
| Brand / accent palette | `theme.brandColor` → `--brand`, everything else derived in OKLch |
| Background, foreground | `theme.bg` → `--config-bg`, `theme.fg` → `--config-fg` |
| Semantic colours | `theme.colors.{success,warning,danger,info}` |
| Typography family + scale | `theme.typography.{fontFamily,fontScale}` |
| Weather widget | `WeatherPanel.vue`, already rendered by `SideBarComponent.vue:83` |
| Knowledge-area tree | `ServiceTreePanelComponent.vue`, rendered by `SideBarComponent.vue:31` |
| Info & Resources sidebar | `RightSideBarComponent.vue` with `.sidebar`, `.sidebar-section`, `.document-item` |

### Icons: no work required

The nine quick-help SVGs in `public/config/quickhelp/` are **already authored in
saturated, distinct colours** — exactly the ones in the mockups:

| SVG | fill | mockup card |
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

This was confirmed during brainstorming and **deliberately rejected** as a work
item: tinting icons at runtime. The icons are `<img src>` of operator-owned
files; a deployment swaps them the same way it swaps its splash. No `filter`, no
`data-category`, no SVG rewriting.

### The actual gap

Three things, and only three:

1. A per-button accent colour, to tint each quick-help card.
2. The four decoration assets, with configurable paths.
3. The decorative CSS layer itself (glassmorphism, hero, mesh, waves, corner).

---

## Architecture

The layer follows the `#998` contract exactly: **assets in the bind-mounted
config directory, colours in the JSON, paths exposed as CSS custom properties,
styling in a scoped stylesheet.** No new build step, no new mount.

```
                    ┌──────────────────────────────────────────────┐
  host              │ {{ config_dir }}/frontend/                   │
  (operator-editable│   ├── theme-variables.css                     │
   via rsync        │   ├── genie-ai-config.json      ← colours     │
   --ignore-        │   ├── quickhelp/*.svg           ← icons       │
   existing)        │   └── genie-visual/assets/*     ← NEW assets  │
                    └───────────────┬──────────────────────────────┘
                                    │ read-only bind mount
                                    ▼
                    ┌──────────────────────────────────────────────┐
                    │ /app/dist/config/  (in the frontend image)    │
                    │   nginx `location ^~ /config/` → no-cache     │
                    └───────────────┬──────────────────────────────┘
                                    │ fetch
                                    ▼
        config-loader.js ──► documentElement
          --brand                    (existing pattern)
          --visual-hero       url("…")   NEW
          --visual-waves      url("…")   NEW
          --visual-mesh       url("…")   NEW
          --visual-corner     url("…")   NEW
          data-visual         "on"|"off" NEW
                                    │
                                    ▼
        genie-visual-effects.css  ── scoped by .genie-living-intelligence
          (DashboardView root)       ── gated by html[data-visual='on']
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
          { "id": "identity-civil", "color": "#10b981", "icon": { … }, … }
        ]
      }
    }
  }
}
```

`additionalProperties` is undefined throughout the config `$schema`, so draft-07
permits both additions without a schema change. Both fields will still be
**declared** in the schema — purely documentary, so an operator editing the JSON
on the host can discover them.

### Runtime wiring

`src/config-loader.js`, following the `--brand` pattern exactly:

```js
if (theme.visual) {
  root.dataset.visual = theme.visual.enabled === false ? 'off' : 'on';
  Object.entries(theme.visual.assets || {}).forEach(([key, value]) => {
    if (value) root.style.setProperty(`--visual-${key}`, `url("${value}")`);
  });
}
```

Two gates, deliberately independent:

- `.genie-living-intelligence` on the `DashboardView` root scopes the layer to
  the dashboard route (designer's requirement, prevents leakage into admin,
  settings, analytics).
- `html[data-visual]` carries the deployment's choice.

`enabled: false` therefore renders **nothing**, with no code change and no
redeploy of the frontend image.

---

## Component changes

### New files

| Path | Purpose |
|---|---|
| `components/gov-chat-frontend/public/config/genie-visual/assets/genie-hero-transparent.png` | Globe hero, 2172×724 RGBA |
| `…/genie-bottom-waves.svg` | Bottom wave decoration |
| `…/genie-dot-mesh.svg` | Surface dot motif (90 KB, gzips to 7.5 KB) |
| `…/genie-corner-network.svg` | Sidebar corner decoration |
| `…/genie-ambient-lines.svg` | Optional extra overlay, **shipped but not referenced** (designer marks it inactive) |
| `components/gov-chat-frontend/src/styles/genie-visual-effects.css` | The scoped layer |

Assets go under `public/config/`, **not** `public/`. `config_bootstrap` already
rsyncs `components/gov-chat-frontend/public/config` → `{{ config_dir }}/frontend`
with `--ignore-existing`, so they are seeded automatically and an operator's
replacement survives the next deploy.

`genie-dot-mesh.svg` is shipped as-is. `genie-ambient-lines.svg` is copied but
not wired into `theme.visual.assets` — an unused asset in the config dir is
inert, and the designer explicitly marks it as not activated by default.

### Modified files

| Path | Change |
|---|---|
| `src/main.js` | `import './styles/genie-visual-effects.css';` **after** `./theme-components.css` (designer's stated order) |
| `src/config-loader.js` | The 6 lines above, plus `theme.visual` in `defaults` |
| `src/views/DashboardView.vue` | Add `genie-living-intelligence` to the existing root class — 1 line |
| `src/components/ChatBotComponent.vue` | Read `button.color` → set `--qh-accent` on the item. Nothing else |
| `public/config/genie-ai-config.json` + 6 flavour files | `theme.visual` block; `color` on each button |
| `public/config/genie-ai-config*.json` `$schema` | Declare `theme.visual` and `button.color` |

`ChatBotComponent.vue` is the only component whose template changes, and only to
forward a value the DS already has an extension point for. The current
`.quick-help-item:hover { --ds-card-border-color: var(--accent-hover) }`
(`ChatBotComponent.vue:2224`) shows the intended pattern.

The stylesheet replaces the designer's four hardcoded `url('/genie-visual/…')`
with `var(--visual-hero)` etc. Everything else in the kit is kept: the
`color-mix()` derivations from `--accent`, the `--gli-*` local variables, the
`prefers-reduced-motion` block, the `max-width: 900px` / `600px` responsive
steps, and the three scoped opt-out classes (`gli-no-hero`, `gli-no-corner`,
`gli-no-waves`).

### Explicitly not changed

- `theme-components.css` — the kit targets component classes the DS does not
  globally own yet, but all its rules live in the new scoped stylesheet. No
  global rules added, so no `:root body` specificity override is needed.
- The quick-help SVGs, `WeatherPanel.vue`, `NavBarComponent.vue`,
  `RightSideBarComponent.vue`, `SideBarComponent.vue`.
- `theme-variables.css` — no new tokens. The layer derives everything from
  `--accent` / `--surface` / `--border` via `color-mix()`.

---

## Decisions taken, with reasoning

**Asset paths as CSS custom properties, not config-in-CSS.** The designer's
stylesheet hardcodes `/genie-visual/…`. Baking operator-owned asset paths into
bundled CSS would defeat the purpose of `#998`. Exposing them as `--visual-*`
keeps the CSS swappable-agnostic: change the path in JSON, not in a stylesheet.

**`enabled` default-on in `genie-ai-config.json`, absent elsewhere.** The base
config is the one the framework ships as canonical, so it gets the new look.
Flavour configs that do not opt in behave exactly as today. An explicit
`"enabled": false` and an absent `visual` block are treated identically.

**Per-button `color` as a flat string, not a token per button.** A token per
category was considered and rejected: nine categories × light/dark = eighteen
tokens in the base palette for what is per-deployment data. `color` sits next to
the existing `icon` field, and the component lifts it to `--qh-accent` so the
`DsCard` consumes it through its documented extension point.

**No icon tinting.** Confirmed against the shipped SVGs during brainstorming —
they already carry the target colours.

**`ambient-lines.svg` shipped unreferenced.** Keeping the asset lets an operator
switch it on by adding one line to their JSON. The alternative — deleting it —
loses that option for no gain.

**Graceful degradation on missing assets.** A broken `url()` on a
`background-image` paints nothing and shows no broken-image icon. A deployment
whose config directory was never seeded renders the welcome screen with its
gradients and no illustration. Combined with the existing `@theme_fallback`
mechanism in `nginx.conf:30`, an unseeded mount degrades rather than breaks.

---

## Open decisions

Three points where the mockups go beyond "add a decorative layer", and where
the answer changes the amount of work. **Recommendation in bold; none of these
block the core layer.**

### D1 — Quick-help grid width

Current: `.quick-help-content { max-width: 600px }` over
`grid-template-columns: repeat(auto-fill, minmax(250px, 1fr))` → two columns.
The mockup shows four columns across roughly 1040px.

- **(a) Keep 600px.** Zero layout change. The mockup's card arrangement is not
  matched, but every card and colour is.
- (b) Widen `.quick-help-content` to ~1040px in the scoped layer. Matches the
  mockup. Changes a layout dimension on the welcome screen, which is a product
  decision rather than a theming one.

**Recommend (a)** for this MR, (b) as a follow-up once the layer is validated.
The width is not a theme concern and the narrower grid is more readable at
small viewports.

### D2 — Quick-help card subtitle

The mockup shows a second line per card ("Get answers and explore information").
The current markup has a title only. Adding it means:

- a new `description` field on each button, as a 14-locale dictionary
  (10 buttons × 14 locales = 140 strings per config file, × 7 config files), and
- one extra element in the quick-help card.

**Recommend deferring.** It is copy authoring in 14 locales, not theming, and it
is the single largest cost in this spec. Better done once, deliberately, than
machine-generated.

### D3 — Hero image weight

`genie-hero-transparent.png` is **1.2 MB and does not compress** (gzip 1.19 MB).
It renders at up to 860×218 CSS px, so 2172px wide is reasonable for a
high-DPR display, but it is a large first-load payload on the dashboard.

It is served under `location ^~ /config/` with
`Cache-Control: no-cache, must-revalidate` (`nginx.conf:20`), so nginx answers
`304` on repeat loads — the transfer cost is a revalidation round-trip, not a
re-download. Moving the assets out of `/config/` to get immutable caching would
make them non-operator-swappable, which is the whole point.

- **(a) Ship the PNG as-is.**
- (b) Convert to WebP/AVIF at build time. Smaller, but adds an asset pipeline
  and a toolchain dependency to a repo that currently has none, and needs a
  fallback for older browsers.

**Recommend (a).** One cached asset on the entry screen is a fair price for
fidelity and for a zero-toolchain deployment story.

---

## Testing strategy

**Unit (Jest, existing suites):**
- `src/__tests__/config-loader.test.js` — extend. `theme.visual` absent →
  `data-visual` unset; `enabled: false` → `"off"`; assets written as
  `url("…")`; a malformed `assets` object must not throw (the loader already
  swallows its own errors, but assert the loop is guarded).
- `ChatBotComponent.test.js` — a button with `color` sets `--qh-accent`; a
  button without it falls back to `--accent` and renders identically to today.
- `DashboardView` — the root carries `genie-living-intelligence`.

**Contract (manual, browser):** the designer's own QA checklist, adapted —
overlay layout after the `::before` flex-item insertion; chat scrolling; quick-
help click targets and `:focus-visible` outline; right-panel titles and toggle
at narrow widths; the `@media (max-width: 900px)` and `600px` steps; system
theme switching.

Two of these are genuine risks, not boilerplate:

- **`backdrop-filter` has little to blur.** `.quick-help-overlay` is
  `background: var(--surface)` — opaque (`ChatBotComponent.vue:2186`). The only
  texture behind the frosted cards is the dot mesh and the waves. The glass
  effect will read as much weaker than the mockup unless the mesh opacity is
  raised or the overlay is given a translucent surface. Verify visually before
  accepting the layer as-is; `DsCard` may also need its own background forced
  transparent for the blur to be visible at all.
- **The hero changes the overlay's flex layout.** `::before` becomes a flex item
  in a `justify-content: center` column, so the hero-plus-content stack centres
  vertically, whereas the mockup places the hero near the top. This needs an
  explicit `justify-content` decision in the scoped layer.

**Themes:** Light, Dark, and System (browser setting), per the designer.

**Reduced motion:** `prefers-reduced-motion: reduce` must disable the
`gli-enter` animation and all transitions.

**Deployments:** verify with `huduma` / `naat` flavours that nothing changed
(they will not set `theme.visual`).

**Contrast:** the frosted cards sit on `--surface`; check the tinted border
against `--fg` in both modes for every category colour.

---

## Rollout

Single MR on `main`, single feature branch. After merge, deployments pick it up
on their next image pull; `genie-ai-config.json` carries `theme.visual.enabled:
true` from day one.

Per `.claude/rules/EL-SALVADOR-WORKFLOW.md`, el-salvador-specific work never
lands on `main`. This work is generic, so it follows **Path 1** (local
`docker compose` validation → merge to `main`), then is cherry-picked to
`release/el-salvador` by whoever owns that convergence.

## Rollback

Three independent levers, no code change required for any of them:

1. `"visual": { "enabled": false }` in the deployment's `genie-ai-config.json` —
   removes the entire layer.
2. Restore `genie-ai-config.json` on the host — `--ignore-existing` means the
   operator's file was never overwritten by a deploy in the first place.
3. `git revert` the MR — nothing else depends on it.

## Acceptance criteria

- [ ] Welcome screen renders the hero, dot mesh, bottom waves and sidebar
      corner decoration, matching the reference mockups in light and dark.
- [ ] Quick-help cards carry their category tint, from `buttons[].color`.
- [ ] Every one of the five assets resolves through `/config/` and can be
      replaced by an operator on the host without a rebuild.
- [ ] `"enabled": false` removes the layer entirely.
- [ ] No hardcoded colour, radius, spacing or shadow value in any new rule; no
      `!important`; every colour resolves to a DS token or a `color-mix()` of one.
- [ ] `theme-variables.css` gains no new tokens; the DS token list is unchanged.
- [ ] Light / Dark / System all render correctly.
- [ ] `prefers-reduced-motion: reduce` disables animation and transitions.
- [ ] A deployment with no seeded config directory renders a usable welcome
      screen (no broken images, no layout collapse).
- [ ] `npm run lint`, `npm run format:check` and `npm test` pass in
      `components/gov-chat-frontend`.

---

## Out of scope — `release/el-salvador`

Owned by a separate workstream. Recorded here so the two do not collide.

`release/el-salvador` predates `#998`: the `config_bootstrap` role is absent and
its tokens live in `src/theme-variables.css`, bundled into the image. Its
palette is hardcoded hex (`--brand: #1e5631`, `--accent-hover: #3f9b43`, plus
bespoke `--accent-gold`), not OKLch-derived.

Consequences for this spec:

- `theme.visual` and `buttons[].color` will **not** take effect there until the
  runtime-config refactor is backported — the config JSON is read either way,
  but the decoration assets will be image-baked, so swapping them needs a
  rebuild.
- Cherry-picking this MR to `release/el-salvador` before that convergence is safe
  and inert: no `theme.visual` block in the el-salvador config means the layer
  never activates there.

Also noted for that workstream, not this one: three rules in el-salvador's
`theme-components.css` hardcode `rgba(76, 175, 80, …)` (`.faq-item:hover`,
`.analytics-section:hover`, `.chat-message.user .message-bubble`). They do not
track `--brand`, so they will not follow a brand change. They must not be
backported to `main`.
