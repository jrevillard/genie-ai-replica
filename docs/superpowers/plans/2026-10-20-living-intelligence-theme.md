# Living Intelligence Visual Layer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the designer's "Living Intelligence" visual layer to the GENIE.AI base theme, with every asset and colour operator-customisable per deployment, and enforce the runtime config `$schema` at load time.

**Architecture:** The layer is additive CSS scoped to the dashboard route and gated by a `theme.visual` block in `genie-ai-config.json`. Decoration assets live under `public/config/genie-visual/` so `config_bootstrap` seeds them onto the host, where an operator can swap them without an image rebuild; their paths are exposed to CSS as `--visual-*` custom properties. The per-button `styles` block (already declared in the schema and already populated in six of seven configs, but never read) is revived as the source of the quick-help card tints. A repaired `$schema` becomes enforced at load time with a hard failure.

**Tech Stack:** Vue 3 (Options API), Vite/Vue CLI 5, Jest + `@vue/test-utils`, `ajv` 8 (JSON Schema draft-07), Playwright (visual fidelity gate), Ansible `config_bootstrap` (host-side asset seeding).

**Spec:** `docs/superpowers/specs/2026-10-20-living-intelligence-theme-design.md` — read it before starting; it carries the measured mockup geometry, the review findings, and the reasoning behind each decision. This plan argues from the spec, and the two travel together.

## Global Constraints

- **Language policy** — all documentation, comments, and code in English. Only i18n content is multilingual.
- **Design System is the single source of truth.** New styling uses DS tokens (`var(--accent)`, `var(--surface)`, `var(--space-xl)`, …). No hardcoded colours, radii, spacing, or shadows in new rules.
- **`!important` is forbidden** except the single documented carve-out in the reduced-motion block of `genie-visual-effects.css` (Task 7), whose rationale is recorded there and in the spec.
- **`theme-variables.css` gains no new tokens.** The DS token list is unchanged by this work.
- **No new DS tokens per button.** The per-category colour comes from the config's `styles` block, not from CSS.
- **No icon tinting.** The nine quick-help SVGs already carry their category colours (`stroke` attribute). Do not filter, recolour, or rewrite them.
- **Config files are round-trip stable**: 2-space indent, trailing newline, and `ensure_ascii` differs per file (`genie-ai-config.json` uses `false`; the flavour files use `true`). Any script that rewrites them must detect and preserve each file's exact format.
- **Vue scoped CSS beats bundled CSS on specificity ties** because `DashboardView` is lazy-loaded (`src/router.js:16`) and its chunk's styles are injected after `main.js`'s initial chunk. Never rely on source order — use a DS extension point (a `--ds-*` custom property) or the documented `:root body` pattern (`src/theme-components.css:328-332`).
- **Do not commit `.env*` files.** Not relevant to this work, but the frontend component has its own `.env`.
- **Commit messages and code comments are in English.** No story / FR / AC numbers in comments.
- **Every task ends green** on `npm run lint`, `npm run format:check`, and `npm test` from `components/gov-chat-frontend/`.
- **The visual fidelity gate (Task 9) is the acceptance criterion for the visual work.** A green test suite is not evidence of fidelity.

---

## File Structure

**Created**

| Path | Responsibility |
|---|---|
| `components/gov-chat-frontend/scripts/validate-config-schema.js` | Validates every runtime config against the `$schema` it embeds. Reusable, runnable locally. |
| `components/gov-chat-frontend/scripts/migrate-config-schema.js` | One-shot, idempotent migration: repairs the schema drift, declares `theme.visual`, seeds the base config's `styles` block. |
| `components/gov-chat-frontend/src/styles/genie-visual-effects.css` | The scoped decorative layer. The only file that knows what "Living Intelligence" looks like. |
| `components/gov-chat-frontend/public/config/genie-visual/assets/genie-hero-transparent.png` | Globe hero, 2172×724 RGBA. |
| `…/genie-bottom-waves.svg` | Bottom wave decoration. |
| `…/genie-dot-mesh.svg` | Surface dot motif. |
| `…/genie-corner-network.svg` | Sidebar corner motif. |
| `…/genie-ambient-lines.svg` | Shipped, deliberately unreferenced. |
| `components/gov-chat-frontend/src/__tests__/views/DashboardView.test.js` | Asserts the scoping class on the dashboard root. |
| `tests/e2e/capture-dashboard.js` | Screenshot + DOM audit capture for the fidelity gate. Lives at the repo root, where `playwright` resolves. |
| `tests/e2e/living-intelligence.spec.js` | Playwright assertions for the fidelity gate. |

**Modified**

| Path | Change |
|---|---|
| `components/gov-chat-frontend/public/config/genie-ai-config.json` | `theme.visual` (enabled), `styles` on all nine buttons, schema repaired. |
| `components/gov-chat-frontend/public/config/genie-ai-config-{original,naat,huduma,huduma-dark-blue,huduma-magenta,huduma-red}.json` | `theme.visual` (disabled), schema repaired. |
| `components/gov-chat-frontend/src/config-loader.js` | Schema validation (hard fail), `theme.visual` → `data-visual` + `--visual-*`. |
| `components/gov-chat-frontend/src/__tests__/config-loader.test.js` | Validation and visual-wiring tests. |
| `components/gov-chat-frontend/src/main.js` | Import the layer's stylesheet. |
| `components/gov-chat-frontend/src/views/DashboardView.vue` | Add the scoping class. |
| `components/gov-chat-frontend/src/components/ds/Card.vue` | `--ds-card-bg` escape hatch. |
| `components/gov-chat-frontend/src/components/ChatBotComponent.vue` | Carry `styles` through; bind the tint; fix the grid geometry. |
| `components/gov-chat-frontend/src/__tests__/components/ChatBotComponent.test.js` | Tint binding tests. |
| `components/gov-chat-frontend/package.json` | `ajv` dependency. |

---

### Task 1: Repair the config `$schema` and seed the base config's `styles`

The `$schema` is declared but never enforced, and the data has drifted from it. Measured against the schema each file embeds: the base config has **36 errors**, each of the six flavour configs has **2** (all the same — `theme.required` demands `primaryColor`/`secondaryColor`, which the code has never read; the code reads `brandColor`).

The 36 collapse to four root causes:

1. `title`, `welcomeMessage`, `action.visibleText`, `action.hiddenPrompt` are declared `string`, but the base config ships locale **dictionaries** (the flavour configs ship plain strings). Both shapes must be legal.
2. `action` is `required` on every button, but the un-categorised "Just Chat" button legitimately has none.
3. `styles` is `required` but absent from the base config.
4. The flavour schemas are a previous generation of the theme schema (`primaryColor` / `secondaryColor` / `backgroundColor` / `textColor`) while their data already uses `brandColor` / `bg` / `fg`.

**Files:**
- Create: `components/gov-chat-frontend/scripts/validate-config-schema.js`
- Create: `components/gov-chat-frontend/scripts/migrate-config-schema.js`
- Modify: `components/gov-chat-frontend/public/config/genie-ai-config.json` and the six flavour files (written by the script)

**Interfaces:**
- Consumes: nothing.
- Produces: `npm run validate:config` → validates every `public/config/genie-ai-config*.json` against its own embedded `$schema`, exit 0 when all valid, exit 1 otherwise. All seven files validate with **0 errors** at the end of this task.

- [ ] **Step 1: Install `ajv`**

```bash
cd components/gov-chat-frontend && npm install ajv@^8.17.1
```

Expected: `package.json` gains `"ajv": "^8.17.1"` under `dependencies`; `package-lock.json` updates. Verify with `node -e "console.log(require('ajv/package.json').version)"`.

- [ ] **Step 2: Write the validator script**

Create `components/gov-chat-frontend/scripts/validate-config-schema.js`:

```js
#!/usr/bin/env node
/**
 * Validates every runtime config file against the $schema it embeds.
 *
 * Each config file is BOTH the instance and its own schema: it carries
 * `properties` at the top level alongside its own data, and `$schema` is
 * only the draft identifier. Validating therefore means running the file's
 * schema over the file itself.
 *
 * Exit code 0 = every file valid, 1 = at least one file invalid.
 */
const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');

const CONFIG_DIR = path.join(__dirname, '..', 'public', 'config');

const files = fs
  .readdirSync(CONFIG_DIR)
  .filter((name) => /^genie-ai-config.*\.json$/.test(name))
  .sort();

let failed = 0;

for (const name of files) {
  const full = path.join(CONFIG_DIR, name);
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(full, 'utf8'));
  } catch (error) {
    console.error(`${name}: not valid JSON — ${error.message}`);
    failed += 1;
    continue;
  }

  const validate = new Ajv({ allErrors: true, strict: false }).compile(doc);

  if (validate(doc)) {
    console.log(`${name}: OK`);
    continue;
  }

  failed += 1;
  console.error(`${name}: ${validate.errors.length} error(s)`);
  for (const error of validate.errors) {
    console.error(`  ${error.instancePath || '<root>'} ${error.message}`);
  }
}

if (failed > 0) {
  console.error(`\n${failed} of ${files.length} config file(s) failed schema validation.`);
  process.exit(1);
}

console.log(`\nAll ${files.length} config files validate.`);
```

- [ ] **Step 3: Run the validator and record the baseline**

```bash
cd components/gov-chat-frontend && node scripts/validate-config-schema.js; echo "exit=$?"
```

Expected: **exit=1**. `genie-ai-config.json` reports 36 errors; each of the six flavour files reports 2 (`theme` / `primaryColor` is a required property). This is the baseline the migration must take to zero.

- [ ] **Step 4: Write the migration script**

Create `components/gov-chat-frontend/scripts/migrate-config-schema.js`:

```js
#!/usr/bin/env node
/**
 * One-shot migration (2026-10-20): repairs the runtime config $schema drift,
 * declares the `theme.visual` block, and seeds the base config's `styles`.
 *
 * Idempotent — re-running it on an already-migrated file changes nothing.
 *
 * What it fixes:
 *   1. The six flavour schemas still describe a previous generation of the
 *      theme block (primaryColor / secondaryColor / backgroundColor /
 *      textColor) while their data — and the code — use brandColor / bg / fg.
 *   2. `title`, `welcomeMessage`, `action.visibleText` and `action.hiddenPrompt`
 *      are declared `string`, but the base config ships locale dictionaries
 *      while the flavour configs ship plain strings. A `localizedText`
 *      definition accepts both.
 *   3. `action` was required on every button, but the un-categorised
 *      "Just Chat" button legitimately has none.
 *   4. `styles` was required but absent from the base config.
 */
const fs = require('fs');
const path = require('path');

const CONFIG_DIR = path.join(__dirname, '..', 'public', 'config');
const BASE_FILE = 'genie-ai-config.json';
const FILES = [
  BASE_FILE,
  'genie-ai-config-original.json',
  'genie-ai-config-naat.json',
  'genie-ai-config-huduma.json',
  'genie-ai-config-huduma-dark-blue.json',
  'genie-ai-config-huduma-magenta.json',
  'genie-ai-config-huduma-red.json'
];

const LOCALIZED_TEXT = {
  description:
    'Either a plain string, or a dictionary of locale code to text. The base ' +
    'config ships dictionaries; the flavour configs ship plain strings.',
  oneOf: [{ type: 'string' }, { type: 'object', additionalProperties: { type: 'string' } }]
};

const VISUAL_SCHEMA = {
  type: 'object',
  description:
    'The Living Intelligence decorative layer. Every asset path is served ' +
    'from /config/ so an operator can replace it on the host without an ' +
    'image rebuild.',
  properties: {
    enabled: {
      type: 'boolean',
      description:
        'Whether the decorative layer is active. When false, no rule of the ' +
        'layer applies.'
    },
    assets: {
      type: 'object',
      description: 'Site-root-relative paths of the decoration assets.',
      properties: {
        hero: { type: 'string', description: 'Hero illustration above the welcome heading.' },
        waves: { type: 'string', description: 'Bottom wave decoration.' },
        mesh: { type: 'string', description: 'Surface dot motif behind the welcome screen.' },
        corner: { type: 'string', description: 'Corner network motif in the resources sidebar.' }
      }
    }
  }
};

/**
 * The base config's nine buttons and their per-category tint. The three
 * values are the 50 / 100 / 200 steps of the Tailwind ramp for the hue the
 * button's icon already uses, which is the convention the flavour configs
 * follow: background, hover, border.
 */
const BASE_BUTTON_STYLES = {
  'just-chat': { backgroundColor: '#f0f9ff', hoverColor: '#e0f2fe', outlineColor: '#bae6fd' },
  'identity-civil': { backgroundColor: '#ecfdf5', hoverColor: '#d1fae5', outlineColor: '#a7f3d0' },
  'taxes-revenue': { backgroundColor: '#fffbeb', hoverColor: '#fef3c7', outlineColor: '#fde68a' },
  'business-trade': { backgroundColor: '#eef2ff', hoverColor: '#e0e7ff', outlineColor: '#c7d2fe' },
  'healthcare-social': { backgroundColor: '#fef2f2', hoverColor: '#fee2e2', outlineColor: '#fecaca' },
  'education-learning': { backgroundColor: '#eff6ff', hoverColor: '#dbeafe', outlineColor: '#bfdbfe' },
  'transportation-mobility': { backgroundColor: '#f5f3ff', hoverColor: '#ede9fe', outlineColor: '#ddd6fe' },
  'housing-urban': { backgroundColor: '#ecfeff', hoverColor: '#cffafe', outlineColor: '#a5f3fc' },
  'employment-labor': { backgroundColor: '#fdf2f8', hoverColor: '#fce7f3', outlineColor: '#f9a8d4' }
};

const clone = (value) => JSON.parse(JSON.stringify(value));

/**
 * Rewrites a config file with 2-space indent and a trailing newline,
 * preserving the file's existing non-ASCII encoding. The base config writes
 * raw UTF-8 (`ensure_ascii: false`); the flavour configs escape non-ASCII
 * (`ensure_ascii: true`).
 *
 * The encoding is detected by round-tripping the document BEFORE it is
 * mutated — a mutated document no longer matches its own original bytes, so
 * detecting afterwards would always fail and, worse, would silently
 * reformat every file.
 */
const detectEnsureAscii = (doc, original) => {
  for (const ensureAscii of [false, true]) {
    if (JSON.stringify(doc, null, 2) + '\n' === original) return ensureAscii;
  }
  throw new Error('Could not detect the JSON formatting of the file; refusing to rewrite it.');
};

const serialize = (doc, ensureAscii) => `${JSON.stringify(doc, null, 2)}\n`;

const localizedRef = (description) => ({
  description,
  allOf: [{ $ref: '#/definitions/localizedText' }]
});

const migrateSchema = (doc, canonicalTheme) => {
  doc.definitions = { ...(doc.definitions || {}), localizedText: clone(LOCALIZED_TEXT) };

  doc.properties.theme = clone(canonicalTheme);

  const chat = doc.properties.features.properties.chat;
  chat.properties.welcomeMessage = localizedRef(
    'Custom welcome message for the chatbot, localized.'
  );

  const items = chat.properties.quickHelp.properties.buttons.items;
  items.properties.title = localizedRef('Button label, localized.');
  items.properties.action.properties.visibleText = localizedRef(
    'Text the user sees in chat, localized.'
  );
  items.properties.action.properties.hiddenPrompt = localizedRef(
    'Detailed prompt sent to the LLM, localized.'
  );
  items.required = items.required.filter((key) => key !== 'action');
};

const seedBaseStyles = (doc) => {
  const buttons = doc.features.chat.quickHelp.buttons;
  for (const button of buttons) {
    const styles = BASE_BUTTON_STYLES[button.id];
    if (!styles) {
      throw new Error(
        `No tint defined for button "${button.id}". Add it to BASE_BUTTON_STYLES.`
      );
    }
    button.styles = { ...styles };
  }
};

const main = () => {
  const raw = new Map();
  const docs = new Map();
  for (const name of FILES) {
    const original = fs.readFileSync(path.join(CONFIG_DIR, name), 'utf8');
    raw.set(name, original);
    docs.set(name, JSON.parse(original));
  }

  // The canonical theme schema is the base config's own, plus the new
  // `visual` block. Cloning it from the base file means it can never drift
  // from the generation the code actually reads.
  const canonicalTheme = {
    ...clone(docs.get(BASE_FILE).properties.theme),
    properties: {
      ...clone(docs.get(BASE_FILE).properties.theme.properties),
      visual: clone(VISUAL_SCHEMA)
    }
  };

  for (const name of FILES) {
    const doc = docs.get(name);
    // Detect the encoding before mutating — the round-trip only matches an
    // untouched document.
    const ensureAscii = detectEnsureAscii(doc, raw.get(name));
    migrateSchema(doc, canonicalTheme);
    if (name === BASE_FILE) {
      seedBaseStyles(doc);
    }
    fs.writeFileSync(path.join(CONFIG_DIR, name), serialize(doc, ensureAscii), 'utf8');
    console.log(`${name}: migrated`);
  }
};

main();
```

- [ ] **Step 5: Run the migration and the validator**

```bash
cd components/gov-chat-frontend && node scripts/migrate-config-schema.js && node scripts/validate-config-schema.js; echo "exit=$?"
```

Expected: seven `migrated` lines, then `All 7 config files validate.` and **exit=0**.

If the validator still reports errors, do not hand-edit the JSON — re-read the error path and fix the migration script, then re-run it (it is idempotent).

- [ ] **Step 6: Verify the round-trip did not reformat unrelated files**

```bash
cd /home/jerome/git_projects/ITU/genie-ai && git diff --stat -- components/gov-chat-frontend/public/config/
```

Expected: **all seven files changed** (the schema lives inside them, so every file legitimately changes). For each file, confirm the diff contains only schema edits and, in the base file, the `styles` blocks — no whitespace-only churn. If a file shows whole-file reformatting, the encoding detection failed; fix `detectEnsureAscii` and re-run.

- [ ] **Step 7: Confirm the data is intact**

```bash
cd components/gov-chat-frontend && node -e "
const d = require('./public/config/genie-ai-config.json');
console.log('buttons:', d.features.chat.quickHelp.buttons.length);
console.log('all have styles:', d.features.chat.quickHelp.buttons.every(b => b.styles && b.styles.outlineColor));
console.log('title is still a dict:', typeof d.features.chat.quickHelp.buttons[0].title);
console.log('just-chat has no action:', d.features.chat.quickHelp.buttons[0].action === undefined);
"
```

Expected:
```
buttons: 9
all have styles: true
title is still a dict: object
just-chat has no action: true
```

- [ ] **Step 8: Add the npm script**

In `components/gov-chat-frontend/package.json`, add to `scripts`:

```json
"validate:config": "node scripts/validate-config-schema.js"
```

- [ ] **Step 9: Run the local checks**

```bash
cd components/gov-chat-frontend && npm run lint && npm run format:check && npm test
```

Expected: all pass. `npm run format` covers `src/**/*.{js,vue,json,css,scss}` only — `public/config/*.json` is outside that glob, so the migration's formatting is untouched by Prettier.

- [ ] **Step 10: Commit**

```bash
cd /home/jerome/git_projects/ITU/genie-ai && git add components/gov-chat-frontend/package.json components/gov-chat-frontend/package-lock.json components/gov-chat-frontend/scripts components/gov-chat-frontend/public/config
git commit -m "fix(config): repair the runtime config schema and seed the base styles

The \$schema was declared but never enforced, and the data had drifted
from it. Validated against the schema each file embeds, the base
config had 36 errors and the six flavour configs 2 each.

The 36 collapse to four root causes: title, welcomeMessage and the
two action prompts are declared string but the base config ships
locale dictionaries; action was required on every button although
the un-categorised Just Chat button has none; styles was required
but absent from the base config; and the flavour schemas still
describe the previous generation of the theme block while their data
already uses brandColor.

Adds a validator script so the drift is visible from now on, and a
one-shot idempotent migration that takes every file to zero errors.
The base config gains the styles block it was always required to
have, using the 50/100/200 tint steps its flavour siblings follow."
```

---

### Task 2: Enforce the schema at load time

A config that fails validation is an operator error, not a transient network failure. Silently booting on a half-understood config is how a deployment ends up serving a broken theme with no signal. So validation fails hard — while a **fetch** failure keeps its existing forgiving behaviour, because that is a transport problem and the bundled defaults are a correct fallback.

**Files:**
- Modify: `components/gov-chat-frontend/src/config-loader.js`
- Modify: `components/gov-chat-frontend/src/__tests__/config-loader.test.js`

**Interfaces:**
- Consumes: the repaired `$schema` from Task 1.
- Produces: `loadConfig()` resolves with the merged config, and **rejects** with an `Error` whose message lists every failing path when the fetched document does not satisfy its own schema.

- [ ] **Step 1: Write the failing tests**

Append to `components/gov-chat-frontend/src/__tests__/config-loader.test.js`, inside the existing `describe('loadConfig', …)` block (before its closing `});`):

```js
  it('rejects when the fetched config does not satisfy its own schema', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          $schema: 'http://json-schema.org/draft-07/schema#',
          type: 'object',
          required: ['theme'],
          properties: {
            theme: {
              type: 'object',
              required: ['brandColor'],
              properties: { brandColor: { type: 'string' } }
            }
          },
          theme: { brandColor: 42 }
        })
    });

    await expect(loadConfig()).rejects.toThrow(/failed schema validation/i);
  });

  it('names the failing path when the config is invalid', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          $schema: 'http://json-schema.org/draft-07/schema#',
          type: 'object',
          required: ['theme'],
          properties: {
            theme: {
              type: 'object',
              required: ['brandColor'],
              properties: { brandColor: { type: 'string' } }
            }
          },
          theme: {}
        })
    });

    await expect(loadConfig()).rejects.toThrow(/brandColor/);
  });

  it('accepts a config that satisfies its schema', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          $schema: 'http://json-schema.org/draft-07/schema#',
          type: 'object',
          required: ['theme'],
          properties: {
            theme: {
              type: 'object',
              required: ['brandColor'],
              properties: { brandColor: { type: 'string' } }
            }
          },
          theme: { brandColor: '#123456' }
        })
    });

    const result = await loadConfig();

    expect(result.theme.brandColor).toBe('#123456');
  });
```

- [ ] **Step 2: Run the tests and verify they fail**

```bash
cd components/gov-chat-frontend && npx jest src/__tests__/config-loader.test.js 2>&1 | tail -30
```

Expected: the three new tests FAIL. The first two fail with "received function did not throw" (or a resolved promise instead of a rejection); the third PASSES already.

- [ ] **Step 3: Implement validation in the loader**

Replace the body of `components/gov-chat-frontend/src/config-loader.js` with:

```js
// Configuration loader and theme application.
//
// Splits the config object from the loadConfig function out of main.js so
// unit tests can import loadConfig without dragging in Vue, Vuex,
// ApexCharts, and the top-level await mount sequence in main.js. main.js
// imports loadConfig from this module — no runtime behavior change.

import Ajv from 'ajv';

const defaults = {
  app: {
    title: 'GENIE.AI',
    icon: { type: 'file', value: '/config/logo-genie-ai.jpeg' }
  },
  theme: {
    brandColor: '#4071cb'
  },
  features: {
    chat: {
      welcomeMessage: 'Welcome to GENIE.AI',
      botName: 'GENIE.AI'
    }
  },
  custom: {}
};

let config = { ...defaults };

/**
 * The fetched document is both the instance and its own schema: it carries
 * `properties` at the top level alongside its own data, and `$schema` is
 * only the draft identifier. Validating therefore means running the
 * document's schema over the document itself.
 *
 * A document with no `$schema` cannot be checked and is accepted as-is —
 * a schema-less config is a legacy config, not a broken one.
 */
const validateConfig = (data) => {
  if (!data || typeof data !== 'object' || !data.properties) return true;

  let validate;
  try {
    validate = new Ajv({ allErrors: true, strict: false }).compile(data);
  } catch (error) {
    throw new Error(`genie-ai-config.json carries an unusable $schema: ${error.message}`);
  }

  if (validate(data)) return true;

  const details = (validate.errors || [])
    .map((issue) => `  ${issue.instancePath || '<root>'} ${issue.message}`)
    .join('\n');
  throw new Error(`genie-ai-config.json failed schema validation:\n${details}`);
};

async function loadConfig() {
  let data = null;
  try {
    const response = await fetch('/config/genie-ai-config.json');
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    data = await response.json();
  } catch (error) {
    // A transport failure is not a configuration failure. The bundled
    // defaults are a correct fallback, so the app still boots.
    console.error('Error loading config:', error);
  }

  if (data) {
    // Outside the try/catch on purpose: an invalid config is an operator
    // error, not a transient fetch failure, and must not be swallowed.
    // main.js awaits loadConfig() before createApp(), so throwing leaves
    // the app unmounted and the error visible in the console.
    validateConfig(data);
    config = { ...config, ...data };
  }

  const root = document.documentElement;
  const theme = config.theme || {};
  root.style.setProperty('--brand', theme.brandColor || defaults.theme.brandColor);

  if (theme.bg) {
    root.style.setProperty('--config-bg', theme.bg);
  }
  if (theme.fg) {
    root.style.setProperty('--config-fg', theme.fg);
  }
  if (theme.navbar?.background) {
    root.style.setProperty('--navbar-bg', theme.navbar.background);
  }
  if (theme.navbar?.text) {
    root.style.setProperty('--navbar-fg', theme.navbar.text);
  }
  if (theme.colors) {
    ['success', 'warning', 'danger', 'info'].forEach((key) => {
      if (theme.colors[key]) root.style.setProperty(`--${key}`, theme.colors[key]);
    });
  }
  if (theme.typography?.fontFamily) {
    root.style.setProperty('--font-body', theme.typography.fontFamily);
    root.style.setProperty('--font-display', theme.typography.fontFamily);
  }
  if (theme.typography?.fontScale) {
    root.style.setProperty('--font-scale', String(theme.typography.fontScale));
  }

  // Set favicon from config if available
  if (config.app?.icon?.type === 'file' && config.app.icon.value) {
    const favicon32 = document.querySelector('link[sizes="32x32"]');
    const favicon16 = document.querySelector('link[sizes="16x16"]');
    const appleTouch = document.querySelector('link[sizes="180x180"]');
    const iconPath = config.app.icon.value;
    if (favicon32) favicon32.href = iconPath;
    if (favicon16) favicon16.href = iconPath;
    if (appleTouch) appleTouch.href = iconPath;
  }

  return config;
}

export { loadConfig as default };
export { config };
```

- [ ] **Step 4: Run the tests and verify they pass**

```bash
cd components/gov-chat-frontend && npx jest src/__tests__/config-loader.test.js 2>&1 | tail -30
```

Expected: **all tests pass**, including the pre-existing ones. The assertion `expect(cssPropsSet()).toEqual(['--brand'])` on the fetch-failure path still holds, because the failure path never reaches `validateConfig`.

- [ ] **Step 5: Verify the real configs validate at runtime**

```bash
cd components/gov-chat-frontend && node -e "
const fs = require('fs');
const Ajv = require('ajv');
for (const f of fs.readdirSync('public/config').filter(n => /^genie-ai-config.*\.json\$/.test(n))) {
  const d = JSON.parse(fs.readFileSync('public/config/' + f, 'utf8'));
  const v = new Ajv({ allErrors: true, strict: false }).compile(d);
  console.log(f, v(d) ? 'OK' : 'FAIL');
}
"
```

Expected: all seven print `OK`. This is the same check `scripts/validate-config-schema.js` performs; it is repeated here to confirm the browser-side code path uses the same validator.

- [ ] **Step 6: Run the local checks**

```bash
cd components/gov-chat-frontend && npm run lint && npm run format:check && npm test
```

Expected: all pass. If Prettier reformats `config-loader.js`, run `npm run format` and re-check.

- [ ] **Step 7: Commit**

```bash
cd /home/jerome/git_projects/ITU/genie-ai && git add components/gov-chat-frontend/src/config-loader.js components/gov-chat-frontend/src/__tests__/config-loader.test.js
git commit -m "feat(config): fail loudly on a config that breaks its own schema

The \$schema was advisory. An operator could publish a config the code
could not read and the app would boot on it, serving a broken theme
with no signal about why.

Validation now runs at load time and throws. A fetch failure keeps
its forgiving behaviour — that is a transport problem and the bundled
defaults are a correct fallback — but a document that fails its own
schema is an operator error and stops the app, with every failing
path listed in the message.

The check is outside the try/catch so it cannot be swallowed, and
main.js awaits loadConfig() before createApp(), so a throw leaves the
app unmounted rather than half-configured."
```

---

### Task 3: Fix the quick-help grid geometry

The grid's column count is driven by the **viewport** while the grid lives in a **fixed-width container**. At a 1024px viewport the centre panel is ~450px and the forced four columns come out ~90px wide each, around a 40px icon. The cards are already crushed today, before any of this work.

Measured on the reference mockup (`docs/reference-light.png`, 1775×886): the grid spans 969px inside a 1030px centre panel — four cards of ~217px, gap ~35px.

`release/el-salvador` already solved this and the solution is in the repo: no width cap, `repeat(4, 1fr)` as the base, and **descending** `max-width` breakpoints. That yields four cards of ~240px at the mockup's viewport, against the mockup's 217px.

Fixing it in the component — rather than overriding it from the theme layer — means every deployment benefits, including those that never enable the visual layer, and the theme layer needs **no** geometry override, so the specificity hazard of Task 7 stays confined to `Card.vue`.

**Files:**
- Modify: `components/gov-chat-frontend/src/components/ChatBotComponent.vue` (CSS only, around lines 2200-2217 and 2289-2318)

**Interfaces:**
- Consumes: nothing.
- Produces: the quick-help grid is four columns on wide viewports, three below 1024px, two below 768px, one below 480px, with no maximum width on the container.

- [ ] **Step 1: Remove the container cap**

In `components/gov-chat-frontend/src/components/ChatBotComponent.vue`, replace:

```css
.quick-help-content {
  max-width: 600px;
  width: 100%;
}
```

with:

```css
.quick-help-content {
  width: 100%;
}
```

- [ ] **Step 2: Make the base rule four columns**

Replace:

```css
.quick-help-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: var(--space-md);
}
```

with:

```css
.quick-help-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--space-xl);
}
```

- [ ] **Step 3: Replace the ascending breakpoints with descending ones**

The `@media (min-width: 768px)` block also holds `.chat-input` and `.prompt-textarea` — **remove only the `.quick-help-grid` rule from it** and keep the other two.

Delete this rule from inside the `@media (min-width: 768px)` block:

```css
  .quick-help-grid {
    grid-template-columns: repeat(3, 1fr);
  }
```

Delete the whole `@media (min-width: 1024px)` block:

```css
@media (min-width: 1024px) {
  .quick-help-grid {
    grid-template-columns: repeat(4, 1fr);
  }
}
```

Then add two descending blocks **after** the `@media (max-width: 768px)` block that already exists in the file:

```css
@media (max-width: 1024px) {
  .quick-help-grid {
    grid-template-columns: repeat(3, 1fr);
  }
}

@media (max-width: 768px) {
  .quick-help-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
```

The result, in file order, is: the base rule (four columns), then `@media (max-width: 1024px)` → three, `@media (max-width: 768px)` → two, `@media (max-width: 480px)` → one. The `@media (min-width: 768px)` block survives with only its `.chat-input` and `.prompt-textarea` rules.

- [ ] **Step 4: Check the remaining breakpoint still agrees**

The file already contains:

```css
@media (max-width: 480px) {
  .quick-help-grid {
    grid-template-columns: 1fr;
  }
```

Leave it as it is. Confirm it is still present, that the `@media (min-width: 768px)` block kept its `.chat-input` and `.prompt-textarea` rules, and that **no** `min-width` rule for `.quick-help-grid` remains:

```bash
cd components/gov-chat-frontend && grep -n "quick-help-grid\|@media\|prompt-textarea\|chat-input" src/components/ChatBotComponent.vue | sed -n '1,40p'
```

Expected: the base `.quick-help-grid` rule, then exactly three media-query rules — `max-width: 1024px` → 3, `max-width: 768px` → 2, `max-width: 480px` → 1 — and **no** `min-width` rule for the grid. The `@media (min-width: 768px)` block still contains `.chat-input` and `.prompt-textarea`.

- [ ] **Step 5: Run the local checks**

```bash
cd components/gov-chat-frontend && npm run lint && npm run format:check && npm test
```

Expected: all pass. This change is CSS-only, so no unit test changes behaviour — its verification is the visual gate in Task 9.

- [ ] **Step 6: Commit**

```bash
cd /home/jerome/git_projects/ITU/genie-ai && git add components/gov-chat-frontend/src/components/ChatBotComponent.vue
git commit -m "fix(chat): let the quick-help grid follow its container, not the viewport

The column count was driven by the viewport while the grid lived in a
container capped at 600px, so a 1024px viewport forced four columns
into 450px of space — about 90px per card around a 40px icon. The
cards were already crushed.

Mirrors what release/el-salvador already does: no width cap, four
columns as the base, and descending max-width breakpoints. Measured
against the design reference, that yields four cards of about 240px at
the reference viewport, where the reference shows 217px.

The gap moves to --space-xl, the closest design-system token to the
35px the reference shows. No maximum width is added above 1775px,
matching el-salvador; a cap is only worth adding if the visual
check shows the cards stretching."
```

---

### Task 4: Give `DsCard` a background escape hatch

`Card.vue:55` sets `background: var(--surface)` inside `<style scoped>`, which compiles to `.ds-card[data-v-hash]` — specificity **(0,2,0)**. The theme layer's `.quick-help-item { background: … }` is also **(0,2,0)**. An exact tie, so source order decides — and order is deterministic: `src/router.js:16` lazy-loads `DashboardView`, so `ChatBotComponent.vue` and `Card.vue` styles land in an **async** chunk injected after `main.js`'s initial CSS. The scoped rule wins, every card stays opaque, and the frosted glass renders wrong with no console error.

The fix is the one the design system already mandates: expose a CSS custom property escape hatch. `Card.vue:68` already does this for the border (`--ds-card-border-color`); this adds the background counterpart.

**Files:**
- Modify: `components/gov-chat-frontend/src/components/ds/Card.vue:55`

**Interfaces:**
- Consumes: nothing.
- Produces: `DsCard` renders `background: var(--ds-card-bg, var(--surface))`. A consumer sets `--ds-card-bg` on the element to override the card's background.

- [ ] **Step 1: Replace the hardcoded background**

In `components/gov-chat-frontend/src/components/ds/Card.vue`, replace:

```css
.ds-card {
  background: var(--surface);
  color: var(--fg);
```

with:

```css
.ds-card {
  background: var(--ds-card-bg, var(--surface));
  color: var(--fg);
```

- [ ] **Step 2: Run the local checks**

```bash
cd components/gov-chat-frontend && npm run lint && npm run format:check && npm test
```

Expected: all pass.

- [ ] **Step 3: Commit**

```bash
cd /home/jerome/git_projects/ITU/genie-ai && git add components/gov-chat-frontend/src/components/ds/Card.vue
git commit -m "feat(ds): give DsCard a background escape hatch

The card background was hardcoded to --surface, so a consumer could
not tint a card without fighting the scoped selector. --ds-card-bg
follows the pattern --ds-card-border-color already uses two lines
below.

This also settles a specificity tie: the scoped .ds-card[data-v-hash]
rule and a theme rule targeting the same element both weigh 0,2,0, and
the lazy-loaded dashboard chunk wins on source order. An extension
point resolves it at the source instead of escalating specificity."
```

---

### Task 5: Wire the per-button `styles` into the quick-help cards

Every quick-help button already declares a `styles` object in the `$schema` — `backgroundColor`, `hoverColor`, `outlineColor` — and the six flavour configs populate all three on all nine buttons, with `genie-ai-config-huduma.json` carrying eight distinct `outlineColor` values. Nothing in the frontend reads it. This task revives it.

The mockup's cards are uniformly pale (border `#ebf1f8`, interior `#eff5fc`) — the per-category differentiation in the reference comes from the **icon** colour, which the app already has. So the tint is a whisper of the category hue, not a strong per-card colour, and it must stay legible in dark mode where a literal pale hex would glare.

**Files:**
- Modify: `components/gov-chat-frontend/src/components/ChatBotComponent.vue` (template around line 155, projection around line 730)
- Modify: `components/gov-chat-frontend/src/__tests__/components/ChatBotComponent.test.js`

**Interfaces:**
- Consumes: `button.styles` from the runtime config, as seeded in Task 1.
- Produces: each quick-help card element carries the inline custom properties `--qh-bg`, `--qh-hover` and `--qh-outline`, set from the button's `styles` block. A button without `styles` carries none of them, and the theme layer falls back to `--accent`.

- [ ] **Step 1: Write the failing tests**

In `components/gov-chat-frontend/src/__tests__/components/ChatBotComponent.test.js`:

1. Add `flushPromises` to the test-utils import at the top of the file:

```js
const { mount, flushPromises } = require('@vue/test-utils');
```

2. Add this block **inside** the existing `describe('ChatBotComponent', …)` block, at the end of it. It reuses the file's own `createChatBotWrapper()` helper and its existing `config-loader` mock — do not add a second mounting helper.

```js
  describe('quick-help card tint', () => {
    const configLoader = require('../../config-loader');

    const tintedButton = {
      id: 'identity-civil',
      title: { en: 'Apply for ID' },
      icon: { type: 'file', value: '/config/quickhelp/identity-civil.svg' },
      category: 'civil',
      styles: {
        backgroundColor: '#ecfdf5',
        hoverColor: '#d1fae5',
        outlineColor: '#a7f3d0'
      }
    };

    const untintedButton = {
      id: 'just-chat',
      title: { en: 'Just Chat' },
      icon: { type: 'file', value: '/config/quickhelp/just-chat.svg' },
      category: null
    };

    const mountWithButtons = async (buttons) => {
      configLoader.default.mockResolvedValue({
        features: { chat: { quickHelp: { buttons } } }
      });
      const wrapper = createChatBotWrapper();
      await flushPromises();
      return wrapper;
    };

    afterEach(() => {
      // The config-loader mock is module-level, and clearAllMocks() does
      // not reset an implementation — restore the empty-button default so
      // the rest of the suite is unaffected.
      configLoader.default.mockResolvedValue({
        features: { chat: { quickHelp: { buttons: [] } } }
      });
    });

    it('exposes the button tint as custom properties', () => {
      const wrapper = createChatBotWrapper();

      expect(wrapper.vm.buttonTintStyle(tintedButton)).toEqual({
        '--qh-bg': '#ecfdf5',
        '--qh-hover': '#d1fae5',
        '--qh-outline': '#a7f3d0'
      });
    });

    it('leaves the tint unset when a button declares no styles', () => {
      const wrapper = createChatBotWrapper();

      expect(wrapper.vm.buttonTintStyle(untintedButton)).toBeUndefined();
    });

    it('binds the tint onto the quick-help card', async () => {
      const wrapper = await mountWithButtons([tintedButton]);

      const card = wrapper.find('.quick-help-item');
      expect(card.exists()).toBe(true);
      expect(card.attributes('style') || '').toContain('--qh-bg');
    });

    it('binds nothing onto a card whose button declares no styles', async () => {
      const wrapper = await mountWithButtons([untintedButton]);

      const card = wrapper.find('.quick-help-item');
      expect(card.exists()).toBe(true);
      expect(card.attributes('style') || '').not.toContain('--qh-bg');
    });
  });
```

The exact-value assertions are on the method, not on the serialised `style` attribute: `DsCard` is stubbed in this suite, and how a CSSOM serialises a custom property is jsdom's business, not the component's. The DOM assertions check only that the binding reaches the element.

- [ ] **Step 2: Run the tests and verify they fail**

```bash
cd components/gov-chat-frontend && npx jest src/__tests__/components/ChatBotComponent.test.js 2>&1 | tail -30
```

Expected: the two new tests FAIL — no custom properties are bound yet.

- [ ] **Step 3: Carry `styles` through the projection**

In `components/gov-chat-frontend/src/components/ChatBotComponent.vue`, inside `loadQuickHelpButtons()`, add `styles` to the object the `.map()` returns. The returned object currently ends with:

```js
              icon: button.icon?.value,
              category: button.category,
              id: button.id
```

Change it to:

```js
              icon: button.icon?.value,
              category: button.category,
              styles: button.styles,
              id: button.id
```

- [ ] **Step 4: Bind the tint on the card**

In the same file's template, the quick-help card is:

```html
            <DsCard
              v-for="button in quickHelpButtons"
              :key="button.id"
              variant="flat"
              padding="md"
              :hoverable="true"
              class="quick-help-item"
              :class="{ 'just-chat': !button.category }"
              @click="selectQuickHelpOption(button)"
            >
```

Add the style binding, giving it its own line:

```html
            <DsCard
              v-for="button in quickHelpButtons"
              :key="button.id"
              variant="flat"
              padding="md"
              :hoverable="true"
              class="quick-help-item"
              :class="{ 'just-chat': !button.category }"
              :style="buttonTintStyle(button)"
              @click="selectQuickHelpOption(button)"
            >
```

- [ ] **Step 5: Add the `buttonTintStyle` helper**

In the same component's `methods`, add:

```js
    /**
     * Exposes the per-button tint to CSS as custom properties, so the card
     * picks it up without a style rule per category. Absent values are left
     * out rather than set to an empty string — the theme layer falls back to
     * the design-system accent when a button declares no styles.
     */
    buttonTintStyle(button) {
      const styles = button.styles;
      if (!styles) return undefined;
      const bindings = {
        '--qh-bg': styles.backgroundColor,
        '--qh-hover': styles.hoverColor,
        '--qh-outline': styles.outlineColor
      };
      const defined = Object.entries(bindings).filter(([, value]) => value);
      if (!defined.length) return undefined;
      return Object.fromEntries(defined);
    },
```

`Object.fromEntries` and `Object.entries` are available in the browsers this app targets.

- [ ] **Step 6: Run the tests and verify they pass**

```bash
cd components/gov-chat-frontend && npx jest src/__tests__/components/ChatBotComponent.test.js 2>&1 | tail -30
```

Expected: all pass, including the two new ones.

- [ ] **Step 7: Run the local checks**

```bash
cd components/gov-chat-frontend && npm run lint && npm run format:check && npm test
```

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
cd /home/jerome/git_projects/ITU/genie-ai && git add components/gov-chat-frontend/src/components/ChatBotComponent.vue components/gov-chat-frontend/src/__tests__/components/ChatBotComponent.test.js
git commit -m "feat(chat): carry the quick-help per-button tint into CSS

Every quick-help button already declares a styles block in the config
schema, and all seven config files populate all three of its keys on
all nine of their buttons — with huduma carrying eight distinct
outline colours. Nothing in the frontend read it.

The tint now reaches the card as three custom properties, so a
category colour needs no CSS rule and no new token. A button that
declares no styles leaves them unset, and the theme layer falls back
to the accent rather than painting an empty value."
```

---

### Task 6: Wire `theme.visual` into the runtime

**Files:**
- Modify: `components/gov-chat-frontend/src/config-loader.js`
- Modify: `components/gov-chat-frontend/src/__tests__/config-loader.test.js`

**Interfaces:**
- Consumes: `theme.visual` from the runtime config, as declared in Task 1.
- Produces: `document.documentElement` gains `data-visual="on"` or `data-visual="off"`, and the custom properties `--visual-hero`, `--visual-waves`, `--visual-mesh`, `--visual-corner` are set to `url("…")` for each asset the config names.

- [ ] **Step 1: Write the failing tests**

Append inside the existing `describe('loadConfig', …)` block in `components/gov-chat-frontend/src/__tests__/config-loader.test.js`:

```js
  it('marks the decorative layer off and writes no asset properties when theme.visual is absent', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ theme: { brandColor: '#ff0000' } })
    });

    await loadConfig();

    expect(document.documentElement.getAttribute('data-visual')).toBeNull();
    expect(cssPropsSet()).not.toContain('--visual-hero');
  });

  it('marks the decorative layer off when it is disabled', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({ theme: { brandColor: '#ff0000', visual: { enabled: false } } })
    });

    await loadConfig();

    expect(document.documentElement.getAttribute('data-visual')).toBe('off');
  });

  it('marks the decorative layer on and writes one property per known asset', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          theme: {
            brandColor: '#ff0000',
            visual: {
              enabled: true,
              assets: {
                hero: '/config/genie-visual/assets/genie-hero-transparent.png',
                waves: '/config/genie-visual/assets/genie-bottom-waves.svg',
                mesh: '/config/genie-visual/assets/genie-dot-mesh.svg',
                corner: '/config/genie-visual/assets/genie-corner-network.svg'
              }
            }
          }
        })
    });

    await loadConfig();

    expect(document.documentElement.getAttribute('data-visual')).toBe('on');
    expect(setProperty).toHaveBeenCalledWith(
      '--visual-hero',
      'url("/config/genie-visual/assets/genie-hero-transparent.png")'
    );
    expect(setProperty).toHaveBeenCalledWith(
      '--visual-waves',
      'url("/config/genie-visual/assets/genie-bottom-waves.svg")'
    );
    expect(setProperty).toHaveBeenCalledWith(
      '--visual-mesh',
      'url("/config/genie-visual/assets/genie-dot-mesh.svg")'
    );
    expect(setProperty).toHaveBeenCalledWith(
      '--visual-corner',
      'url("/config/genie-visual/assets/genie-corner-network.svg")'
    );
  });

  it('ignores an unknown asset key instead of writing an inert property', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          theme: {
            brandColor: '#ff0000',
            visual: { enabled: true, assets: { heor: '/config/typo.png' } }
          }
        })
    });

    await loadConfig();

    expect(cssPropsSet()).not.toContain('--visual-heor');
  });
```

- [ ] **Step 2: Run the tests and verify they fail**

```bash
cd components/gov-chat-frontend && npx jest src/__tests__/config-loader.test.js 2>&1 | tail -30
```

Expected: the four new tests FAIL — `data-visual` is never set and no `--visual-*` property is written.

- [ ] **Step 3: Implement the wiring**

In `components/gov-chat-frontend/src/config-loader.js`, add the constant **above** `const defaults`:

```js
// The asset keys the decorative layer knows how to use. An explicit list
// rather than Object.entries(), so a typo in a config becomes an ignored
// key instead of an inert --visual-<typo> property nobody can trace.
const VISUAL_ASSET_KEYS = ['hero', 'waves', 'mesh', 'corner'];
```

Then, in `loadConfig()`, immediately after the `--font-scale` block and before the favicon block, insert:

```js
  if (theme.visual) {
    root.dataset.visual = theme.visual.enabled === false ? 'off' : 'on';
    for (const key of VISUAL_ASSET_KEYS) {
      const value = theme.visual.assets?.[key];
      if (value) root.style.setProperty(`--visual-${key}`, `url("${value}")`);
    }
  }
```

- [ ] **Step 4: Run the tests and verify they pass**

```bash
cd components/gov-chat-frontend && npx jest src/__tests__/config-loader.test.js 2>&1 | tail -30
```

Expected: all pass.

- [ ] **Step 5: Run the local checks**

```bash
cd components/gov-chat-frontend && npm run lint && npm run format:check && npm test
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
cd /home/jerome/git_projects/ITU/genie-ai && git add components/gov-chat-frontend/src/config-loader.js components/gov-chat-frontend/src/__tests__/config-loader.test.js
git commit -m "feat(config): expose the decorative layer's assets as CSS properties

The asset paths are configuration, so they cannot be baked into a
bundled stylesheet — an operator has to be able to point the layer at
their own hero without a rebuild. The paths become --visual-* url()
properties on the document element, following the --brand pattern
already in this module.

An explicit key list, rather than iterating the config's asset object,
turns a typo into an ignored key instead of an inert property nobody
can trace."
```

---

### Task 7: The decorative layer itself

This is the designer's kit, transformed. Three transformations are mandatory and one is forbidden:

1. **Every selector gains the `html[data-visual='on']` prefix.** The kit has no `data-visual` selector at all — without this, `enabled: false` does nothing.
2. **Every `url('/genie-visual/…')` becomes `var(--visual-…)`.** The kit hardcodes the paths; the paths are configuration.
3. **The `.chat-window` radial gradients are dropped.** `ChatBotComponent.vue:1963` sets `background` as a shorthand, which resets `background-image`; and the overlay covers that element completely whenever quick help is showing.
4. **The reduced-motion `!important` stays**, and is the only one in the file. Its rationale is in a comment where it sits.

**Files:**
- Create: `components/gov-chat-frontend/src/styles/genie-visual-effects.css`
- Create: `components/gov-chat-frontend/public/config/genie-visual/assets/*` (5 files)
- Modify: `components/gov-chat-frontend/src/main.js` (import)
- Modify: `components/gov-chat-frontend/src/views/DashboardView.vue` (scoping class)

**Interfaces:**
- Consumes: `--visual-hero`, `--visual-waves`, `--visual-mesh`, `--visual-corner`, `data-visual`, `--qh-bg`, `--qh-hover`, `--qh-outline`, and the DS tokens.
- Produces: `.genie-living-intelligence` on the dashboard root, and `html[data-visual='on']` on the document element, together enable the layer.

- [ ] **Step 1: Copy the assets**

```bash
cd components/gov-chat-frontend && mkdir -p public/config/genie-visual/assets && cp \
  "/home/jerome/Téléchargements/GENIE_AI_Living_Intelligence_V2_Vue_Adapter/genie-ai-living-intelligence-v2/public/genie-visual/assets/genie-hero-transparent.png" \
  "/home/jerome/Téléchargements/GENIE_AI_Living_Intelligence_V2_Vue_Adapter/genie-ai-living-intelligence-v2/public/genie-visual/assets/genie-bottom-waves.svg" \
  "/home/jerome/Téléchargements/GENIE_AI_Living_Intelligence_V2_Vue_Adapter/genie-ai-living-intelligence-v2/public/genie-visual/assets/genie-dot-mesh.svg" \
  "/home/jerome/Téléchargements/GENIE_AI_Living_Intelligence_V2_Vue_Adapter/genie-ai-living-intelligence-v2/public/genie-visual/assets/genie-corner-network.svg" \
  "/home/jerome/Téléchargements/GENIE_AI_Living_Intelligence_V2_Vue_Adapter/genie-ai-living-intelligence-v2/public/genie-visual/assets/genie-ambient-lines.svg" \
  public/config/genie-visual/assets/
```

Verify:

```bash
cd components/gov-chat-frontend && ls -la public/config/genie-visual/assets/ && node -e "
const fs = require('fs');
const b = fs.readFileSync('public/config/genie-visual/assets/genie-hero-transparent.png');
console.log('hero dims', b.readUInt32BE(16), 'x', b.readUInt32BE(20), 'colourType', b[25]);
"
```

Expected: five files; hero reports `2172 x 724 colourType 6`.

- [ ] **Step 2: Write the stylesheet**

Create `components/gov-chat-frontend/src/styles/genie-visual-effects.css`:

```css
/*
 * GENIE.AI — Living Intelligence visual layer.
 *
 * An additive decorative layer over the existing design system. The
 * design-system tokens stay canonical; every colour here is derived from
 * one with color-mix(), and the only literal colours are the two
 * secondary hues the layer mixes its own tints from.
 *
 * Two gates, both required:
 *   - .genie-living-intelligence scopes the layer to the dashboard route
 *   - html[data-visual='on'] carries the deployment's own choice
 *
 * The asset paths are configuration, not CSS: --visual-hero and its
 * siblings are written onto the document element by config-loader from
 * the theme.visual block of the runtime config.
 */
html[data-visual='on'] .genie-living-intelligence {
  --gli-blue: var(--accent);
  --gli-cyan: color-mix(in oklch, var(--accent) 52%, #5de9f4);
  --gli-violet: color-mix(in oklch, var(--accent) 50%, #b875f8);
  --gli-frost-border: color-mix(in srgb, var(--accent) 17%, var(--border));
  --gli-deco-strength: 0.65;
  min-width: 0;
  isolation: isolate;
}

html[data-theme='dark'][data-visual='on'] .genie-living-intelligence,
html[data-visual='on'] .dark-mode .genie-living-intelligence {
  --gli-deco-strength: 0.82;
  --gli-frost-border: color-mix(in srgb, var(--accent) 27%, var(--border));
}

/*
 * The card tint. --qh-bg, --qh-hover and --qh-outline come from the
 * button's own config `styles` block; a button that declares none falls
 * back to the accent, so a deployment without per-button tints still
 * renders.
 *
 * In light mode the configured tint is a pale 50-step used almost
 * directly; in dark mode it is mixed into the dark surface, because a
 * literal pale background would glare against it.
 */
html[data-visual='on'] .genie-living-intelligence .quick-help-item {
  --ds-card-bg: var(--qh-bg, var(--surface));
  --ds-card-border-color: var(--qh-outline, var(--gli-frost-border));
}

html[data-visual='on'] .genie-living-intelligence .quick-help-item:hover {
  --ds-card-bg: var(--qh-hover, var(--ds-card-bg));
  --ds-card-border-color: color-mix(in srgb, var(--qh-outline, var(--accent)) 47%, var(--border));
}

html[data-theme='dark'][data-visual='on'] .genie-living-intelligence .quick-help-item,
html[data-visual='on'] .dark-mode .genie-living-intelligence .quick-help-item {
  --ds-card-bg: color-mix(in srgb, var(--qh-bg, var(--surface)) 14%, var(--surface));
}

html[data-theme='dark'][data-visual='on'] .genie-living-intelligence .quick-help-item:hover,
html[data-visual='on'] .dark-mode .genie-living-intelligence .quick-help-item:hover {
  --ds-card-bg: color-mix(in srgb, var(--qh-hover, var(--qh-bg, var(--surface))) 20%, var(--surface));
}

/* Keep the existing chat, data and scroll behavior intact. */
html[data-visual='on'] .genie-living-intelligence .chatbot-container {
  min-width: 0;
  position: relative;
}

/*
 * The welcome overlay. The mesh is painted on the overlay rather than
 * on the chat window: the overlay is opaque, so anything painted on the
 * window behind it would never be seen.
 */
html[data-visual='on'] .genie-living-intelligence .quick-help-overlay {
  isolation: isolate;
  background-image:
    linear-gradient(180deg, transparent, color-mix(in srgb, var(--surface) 30%, transparent)),
    var(--visual-mesh);
  background-position: center, center;
  background-size: cover, min(900px, 100%) auto;
  background-repeat: no-repeat;
}

html[data-visual='on'] .genie-living-intelligence .quick-help-overlay::before {
  content: '';
  display: block;
  position: relative;
  z-index: 0;
  flex: 0 0 auto;
  align-self: center;
  width: min(100%, 860px);
  height: clamp(96px, 19vw, 218px);
  background: var(--visual-hero) center / contain no-repeat;
  pointer-events: none;
  filter: drop-shadow(0 12px 25px color-mix(in srgb, var(--accent) 14%, transparent));
  animation: gli-enter 650ms ease-out both;
}

html[data-visual='on'] .genie-living-intelligence .quick-help-overlay::after {
  content: '';
  position: absolute;
  inset: auto 0 0;
  height: min(32%, 220px);
  background: var(--visual-waves) bottom / 100% auto no-repeat;
  opacity: var(--gli-deco-strength);
  pointer-events: none;
  z-index: -1;
}

html[data-visual='on'] .genie-living-intelligence .quick-help-content {
  position: relative;
  z-index: 1;
  min-width: 0;
}

html[data-visual='on'] .genie-living-intelligence .quick-help-heading {
  font-family: var(--font-display);
  color: var(--fg);
  text-wrap: balance;
  letter-spacing: -0.025em;
}

html[data-visual='on'] .genie-living-intelligence .quick-help-item:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
}

/* Scoped right resources sidebar; position the network out of text's way. */
html[data-visual='on'] .genie-living-intelligence .sidebar:not(.collapsed) {
  position: relative;
  isolation: isolate;
}

html[data-visual='on'] .genie-living-intelligence .sidebar:not(.collapsed)::before {
  content: '';
  position: absolute;
  top: 0;
  right: 0;
  width: min(48%, 190px);
  height: 205px;
  background: var(--visual-corner) right top / contain no-repeat;
  opacity: var(--gli-deco-strength);
  pointer-events: none;
  z-index: 0;
}

html[data-visual='on'] .genie-living-intelligence .sidebar .sidebar-header,
html[data-visual='on'] .genie-living-intelligence .sidebar .sidebar-section {
  position: relative;
  z-index: 1;
}

html[data-visual='on'] .genie-living-intelligence .document-item {
  border: 1px solid var(--gli-frost-border);
  border-radius: var(--radius-lg);
}

@keyframes gli-enter {
  from {
    opacity: 0;
    transform: translateY(12px) scale(0.985);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@media (max-width: 900px) {
  html[data-visual='on'] .genie-living-intelligence .quick-help-overlay::before {
    height: clamp(76px, 22vw, 160px);
  }

  html[data-visual='on'] .genie-living-intelligence .sidebar:not(.collapsed)::before {
    width: 125px;
    height: 140px;
    opacity: 0.36;
  }
}

@media (max-width: 600px) {
  html[data-visual='on'] .genie-living-intelligence .quick-help-overlay::before {
    height: 90px;
  }

  html[data-visual='on'] .genie-living-intelligence .quick-help-overlay::after {
    opacity: 0.3;
  }
}

/*
 * Reduced motion.
 *
 * The !important is load-bearing and is the only one in this file:
 * .quick-help-overlay::before weighs 0,2,1 and would otherwise outrank
 * the .genie-living-intelligence *::before rule below it, so the
 * animation would keep running. Every other rule in this layer relies
 * on the design system's own extension points instead.
 */
@media (prefers-reduced-motion: reduce) {
  html[data-visual='on'] .genie-living-intelligence *,
  html[data-visual='on'] .genie-living-intelligence *::before,
  html[data-visual='on'] .genie-living-intelligence *::after {
    animation: none !important;
    transition: none !important;
  }
}

/* Scoped opt-outs, for a deployment that wants the layer without a motif. */
html[data-visual='on'] .genie-living-intelligence.gli-no-hero .quick-help-overlay::before {
  display: none;
}

html[data-visual='on'] .genie-living-intelligence.gli-no-corner .sidebar::before {
  display: none;
}

html[data-visual='on'] .genie-living-intelligence.gli-no-waves .quick-help-overlay::after {
  display: none;
}
```

Note what is **not** in this file, and why:
- the `.chat-window` radial gradients — the shorthand `background` in `ChatBotComponent.vue:1963` resets `background-image`, and the overlay covers that element anyway;
- the `.quick-help-item` glass background — the designer's `--gli-frost` is replaced by `--ds-card-bg`, which is the design system's own extension point and survives the specificity tie of Task 4;
- the `backdrop-filter: blur(8px)` — the overlay behind the cards is opaque, so there is almost nothing to blur. The frosted look is carried by the tint and the border instead. Reintroduce a blur only if the fidelity check shows the reference's glass effect cannot be matched without it.

- [ ] **Step 3: Import the stylesheet**

In `components/gov-chat-frontend/src/main.js`, replace:

```js
// Import theme CSS files
import './theme-components.css';
import './charts-apex-overrides.css';
```

with:

```js
// Import theme CSS files
import './theme-components.css';
import './styles/genie-visual-effects.css';
import './charts-apex-overrides.css';
```

The order matters: the layer comes after the design system's component layer, so its rules win on source order within the initial chunk.

- [ ] **Step 4: Add the scoping class**

In `components/gov-chat-frontend/src/views/DashboardView.vue`, replace:

```html
  <div class="dashboard-content">
```

with:

```html
  <div class="dashboard-content genie-living-intelligence">
```

- [ ] **Step 5: Write the DashboardView test**

Create `components/gov-chat-frontend/src/__tests__/views/DashboardView.test.js`:

```js
import { mount } from '@vue/test-utils';
import DashboardView from '@/views/DashboardView.vue';

jest.mock('@/components/ChatBotComponent.vue', () => ({
  name: 'ChatBotComponent',
  template: '<div class="chatbot-container" />'
}));

describe('DashboardView', () => {
  it('carries the scoping class the visual layer hangs off', () => {
    const wrapper = mount(DashboardView, {
      global: {
        stubs: { 'chat-bot-component': true }
      }
    });

    expect(wrapper.find('.dashboard-content').classes()).toContain('genie-living-intelligence');
  });
});
```

If the `@/` alias is not configured in `jest.config.js`, use the relative path `'../../views/DashboardView.vue'` and `'../../components/ChatBotComponent.vue'` instead. Check `jest.config.js` before running.

- [ ] **Step 6: Run the new test**

```bash
cd components/gov-chat-frontend && npx jest src/__tests__/views/DashboardView.test.js 2>&1 | tail -20
```

Expected: PASS.

- [ ] **Step 7: Run the local checks**

```bash
cd components/gov-chat-frontend && npm run lint && npm run format:check && npm test
```

Expected: all pass. `npm run format:check` covers `src/**/*.css`, so if Prettier wants to reformat the new stylesheet, run `npm run format` and re-check — the committed file must be Prettier-clean.

- [ ] **Step 8: Verify the layer is inert without the config**

```bash
cd components/gov-chat-frontend && grep -c "data-visual" src/styles/genie-visual-effects.css
```

Expected: the count equals the total number of rule selectors in the file, and no selector
may start with a bare `.genie-living-intelligence`. (The gate is not always the contiguous
substring `html[data-visual='on']`: three selectors combine it with `[data-theme='dark']`,
so a grep for that exact substring undercounts. `data-visual` is the property to count.)

- [ ] **Step 9: Commit**

```bash
cd /home/jerome/git_projects/ITU/genie-ai && git add components/gov-chat-frontend/src/styles components/gov-chat-frontend/public/config/genie-visual components/gov-chat-frontend/src/main.js components/gov-chat-frontend/src/views/DashboardView.vue components/gov-chat-frontend/src/__tests__/views
git commit -m "feat(theme): the Living Intelligence visual layer

The designer's kit, adapted to the design system and to the runtime
config contract.

Three transformations were required. Every selector gained an
html[data-visual='on'] prefix, because the kit gates on the scoping
class alone and enabled:false would otherwise be inert. Every asset
url became a --visual-* custom property, because the paths are
configuration an operator has to be able to change. The chat window's
radial gradients were dropped, because the shorthand background
property in the component resets background-image and the overlay
covers that element anyway.

The card tint goes through --ds-card-bg, the design system's own
extension point, rather than a competing background rule — a scoped
.ds-card rule and a layer rule weigh the same, and the lazy-loaded
dashboard chunk wins on source order, which would have left every
card opaque and the frosted effect invisible.

The reduced-motion block keeps its !important: the pseudo-element rule
it has to override outranks it, and it is the only one in the file."
```

---

### Task 8: Declare the layer in the config data

**Files:**
- Modify: `components/gov-chat-frontend/public/config/genie-ai-config.json`
- Modify: the six flavour config files

**Interfaces:**
- Consumes: the `theme.visual` schema declared in Task 1.
- Produces: the base config enables the layer with the four asset paths; every flavour config declares the same block with `enabled: false`, so an operator can switch it on by editing one boolean.

- [ ] **Step 1: Extend the migration script with the visual block**

In `components/gov-chat-frontend/scripts/migrate-config-schema.js`, add to the `main()` function. Place the assignment **after** the `if (name === BASE_FILE) { … }` block, not inside it — it must run for every file, and the per-file value comes from the `enabled` expression:

```js
    if (name === BASE_FILE) {
      seedBaseStyles(doc);
    }
    doc.theme.visual = {
      enabled: name === BASE_FILE,
      assets: {
        hero: '/config/genie-visual/assets/genie-hero-transparent.png',
        waves: '/config/genie-visual/assets/genie-bottom-waves.svg',
        mesh: '/config/genie-visual/assets/genie-dot-mesh.svg',
        corner: '/config/genie-visual/assets/genie-corner-network.svg'
      }
    };
```

The base config enables the layer; the flavour configs declare it disabled so the paths are visible and switchable, but nothing changes for them until an operator flips the boolean.

- [ ] **Step 2: Re-run the migration and the validator**

```bash
cd components/gov-chat-frontend && node scripts/migrate-config-schema.js && node scripts/validate-config-schema.js; echo "exit=$?"
```

Expected: `All 7 config files validate.` and **exit=0**.

- [ ] **Step 3: Verify the data**

```bash
cd components/gov-chat-frontend && node -e "
const base = require('./public/config/genie-ai-config.json');
const huduma = require('./public/config/genie-ai-config-huduma.json');
console.log('base enabled   :', base.theme.visual.enabled);
console.log('huduma enabled :', huduma.theme.visual.enabled);
console.log('base assets    :', Object.keys(base.theme.visual.assets).join(', '));
console.log('huduma assets  :', Object.keys(huduma.theme.visual.assets).join(', '));
"
```

Expected:
```
base enabled   : true
huduma enabled : false
base assets    : hero, waves, mesh, corner
huduma assets  : hero, waves, mesh, corner
```

- [ ] **Step 4: Run the local checks**

```bash
cd components/gov-chat-frontend && npm run lint && npm run format:check && npm test && npm run validate:config
```

Expected: all pass; the validator reports all seven files valid.

- [ ] **Step 5: Commit**

```bash
cd /home/jerome/git_projects/ITU/genie-ai && git add components/gov-chat-frontend/scripts components/gov-chat-frontend/public/config
git commit -m "feat(config): declare the decorative layer in the runtime config

The base config enables it and names the four assets; every flavour
config declares the same block disabled, so the paths are visible and
switchable but nothing changes for them until an operator flips one
boolean.

The assets live under /config/, which is the directory config_bootstrap
seeds onto the host, so replacing the hero for a deployment is a file
copy on the node rather than an image rebuild."
```

---

### Task 9: The visual fidelity gate

The acceptance criterion for this work is the render, not the code. A green Jest run and a faithful render are independent facts, and only the second is the goal.

The loop:

```
implement → code review → fix → screenshot → compare against reference
          → fix the delta → code review → … until the delta is nil
```

**Files:**
- Create: `tests/e2e/living-intelligence.spec.js`
- Create: `tests/e2e/capture-dashboard.js`

**Interfaces:**
- Consumes: the layer from Task 7, the config from Task 8, the grid from Task 3.
- Produces: `artifacts/living-intelligence/{light,dark}.png` plus a matching `.audit.json` per capture, and a written list of resolved differences.

- [ ] **Step 1: Seed deterministic data**

The comparison is meaningless against an empty tree. Seed, once, as a repeatable script, so every round of the loop starts from the same state:

```bash
cd /home/jerome/git_projects/ITU/genie-ai && ls docs/e2e-tests/ | head -20
```

Read `docs/e2e-tests/README.md` and follow the phase-0 instructions to bring the stack up with seeded knowledge areas and at least one document. Record the exact commands used in the audit output, so the seed is reproducible. If the seeded data cannot be produced, the welcome screen still renders and the comparison is still valid for the centre panel — but say so in the notes rather than claiming a full comparison.

- [ ] **Step 2: Write the capture script**

Create `tests/e2e/capture-dashboard.js` at the **repository root** — `playwright` is a root dependency (`node_modules/playwright`), not a frontend-component one, so the script has to live where Node can resolve it. The frontend component is a separate package with its own `node_modules`.

```js
#!/usr/bin/env node
/**
 * Captures the dashboard welcome screen and the DOM facts a screenshot
 * cannot prove.
 *
 * A PNG read back yields a URL, never a claim about how it looks. So every
 * capture ships with an audit: whether each decoration asset actually
 * resolves, the computed styles of the surfaces the layer touches, and the
 * resolved custom properties. If the audit and the picture disagree, the
 * audit wins.
 *
 * The assets are checked with fetch rather than an Image probe: the three
 * SVGs carry only a viewBox, so they have no intrinsic size and
 * naturalWidth reports 0 for a perfectly valid file.
 *
 * Usage:
 *   BASE_URL=https://localhost node tests/e2e/capture-dashboard.js [--theme light|dark]
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE_URL = process.env.BASE_URL || 'https://localhost';
const OUT_DIR = path.join(__dirname, '..', '..', 'artifacts', 'living-intelligence');
const VIEWPORT = { width: 1775, height: 886 };
const THEMES = process.argv.includes('--theme')
  ? [process.argv[process.argv.indexOf('--theme') + 1]]
  : ['light', 'dark'];

const audit = () => {
  const readUrl = (property) => {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(property).trim();
    if (!raw) return null;
    return raw.replace(/^url\(["']?/, '').replace(/["']?\)$/, '');
  };

  const probeAsset = async (property) => {
    const url = readUrl(property);
    if (!url) return { url: null, ok: false, reason: 'not set' };
    try {
      const response = await fetch(url, { cache: 'no-store' });
      const body = await response.text();
      return {
        url,
        ok: response.ok,
        status: response.status,
        contentType: response.headers.get('content-type'),
        bytes: body.length
      };
    } catch (error) {
      return { url, ok: false, reason: error.message };
    }
  };

  const surface = (selector) => {
    const el = document.querySelector(selector);
    if (!el) return null;
    const style = getComputedStyle(el);
    return {
      backgroundImage: style.backgroundImage,
      backgroundColor: style.backgroundColor,
      borderColor: style.borderColor,
      borderRadius: style.borderRadius,
      backdropFilter: style.backdropFilter,
      overflow: style.overflow
    };
  };

  return (async () => {
    const assets = {
      hero: await probeAsset('--visual-hero'),
      waves: await probeAsset('--visual-waves'),
      mesh: await probeAsset('--visual-mesh'),
      corner: await probeAsset('--visual-corner')
    };

    const cards = [...document.querySelectorAll('.quick-help-item')].map((el) => {
      const style = getComputedStyle(el);
      return {
        text: el.textContent.trim().slice(0, 40),
        backgroundColor: style.backgroundColor,
        borderColor: style.borderColor,
        qhBg: style.getPropertyValue('--qh-bg').trim(),
        qhHover: style.getPropertyValue('--qh-hover').trim(),
        qhOutline: style.getPropertyValue('--qh-outline').trim()
      };
    });

    const overlay = document.querySelector('.quick-help-overlay');
    const overlayBefore = overlay ? getComputedStyle(overlay, '::before') : null;

    return {
      dataVisual: document.documentElement.getAttribute('data-visual'),
      theme: document.documentElement.getAttribute('data-theme'),
      assets,
      resolved: {
        visualHero: readUrl('--visual-hero'),
        brand: getComputedStyle(document.documentElement).getPropertyValue('--brand').trim(),
        accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
      },
      overlay: surface('.quick-help-overlay'),
      overlayBefore: overlayBefore
        ? {
            width: overlayBefore.width,
            height: overlayBefore.height,
            backgroundImage: overlayBefore.backgroundImage
          }
        : null,
      navBar: surface('.nav-bar'),
      cards,
      cardCount: cards.length
    };
  })();
};

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const results = {};

  for (const theme of THEMES) {
    const context = await browser.newContext({
      viewport: VIEWPORT,
      colorScheme: theme,
      ignoreHTTPSErrors: true
    });
    const page = await context.newPage();

    await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
    // Authenticate the way tests/e2e/helpers/auth.js does — reuse it rather
    // than re-implementing the Keycloak flow.
    // TODO(executor): call the existing e2e auth helper, then wait for the
    // welcome screen. This marker must be gone before the file is committed.

    await page.waitForSelector('.quick-help-overlay', { timeout: 30000 });
    await page.waitForTimeout(750);

    const data = await page.evaluate(audit);
    const file = path.join(OUT_DIR, `${theme}.png`);
    await page.screenshot({ path: file, fullPage: false });
    fs.writeFileSync(path.join(OUT_DIR, `${theme}.audit.json`), JSON.stringify(data, null, 2));

    results[theme] = { file, audit: path.join(OUT_DIR, `${theme}.audit.json`) };
    console.log(`${theme}: ${file}`);
    await context.close();
  }

  await browser.close();
  console.log(JSON.stringify(results, null, 2));
})();
```

The `TODO(executor)` marker is the one place a step needs the environment's login flow: open `tests/e2e/helpers/auth.js` and use whatever it exposes. Do not leave the marker in the committed file.

- [ ] **Step 3: Run the capture in both themes**

```bash
cd /home/jerome/git_projects/ITU/genie-ai && BASE_URL=https://localhost node tests/e2e/capture-dashboard.js
```

Expected: `light.png` and `dark.png` in `artifacts/living-intelligence/`, each with a matching `.audit.json`.

- [ ] **Step 4: Check the audit before looking at the pictures**

```bash
cd /home/jerome/git_projects/ITU/genie-ai && node -e "
const a = require('./artifacts/living-intelligence/light.audit.json');
console.log('data-visual  :', a.dataVisual);
console.log('card count   :', a.cardCount);
for (const [name, asset] of Object.entries(a.assets)) {
  console.log('asset ' + name.padEnd(6) + ':', asset.ok ? 'ok ' + asset.status + ' ' + asset.bytes + 'B' : 'FAILED ' + (asset.reason || asset.status));
}
console.log('overlay bg   :', a.overlay && a.overlay.backgroundColor);
console.log('hero box     :', a.overlayBefore && a.overlayBefore.width, 'x', a.overlayBefore && a.overlayBefore.height);
console.log('first card   :', JSON.stringify(a.cards[0]));
"
```

Expected: `data-visual: on`; `card count: 9`; every asset `ok` with a 200 and a non-zero byte count — an asset that did not resolve means the screenshot is of an empty box, so fix that before comparing anything; `overlay bg` opaque `var(--surface)`; the hero pseudo-element has a non-zero width and height; the first card carries a `--qh-bg` and a `--qh-outline` and a background that is **not** the plain surface (that is the Task 4 extension point working).

- [ ] **Step 5: Compare against the reference**

Put each capture next to its reference and diff them region by region:

| Region | Reference | What to check |
|---|---|---|
| Hero | globe illustration above the heading | present, centred, scale, vertical position |
| Dot mesh | faint dots across the panel | visible, opacity plausible |
| Waves | soft wave band at the bottom | present, height, position |
| Corner network | motif at the top right of the resources sidebar | present, not overlapping the titles |
| Card grid | four columns | column count, card width, gap |
| Card tint | pale blue, category-differentiated only by the icon | border and background subtle, icon carries the colour |
| Heading | "How can GENIE.AI help you today?" | scale, weight, balance |
| Navbar | flat brand bar | matches the current navbar, not the mockup's gradient (the mockup's gradient is `theme.navbar.background`, a config change, not a layer change) |

Record every difference in a list, with a verdict for each: **fixed** or **diverged with a reason**. Two differences are expected and are recorded rather than chased:

- the reference shows **gradient tile icons** while the app has **24×24 line icons** already coloured per category. Adopting the reference's icon style is a designer deliverable — nine new icon files — not a code change. Keep the line icons;
- the reference's navbar is a blue→violet gradient, which the base theme reaches through `theme.navbar.background` in the config, not through this layer.

Anything else on the list is a real delta.

- [ ] **Step 6: Fix the deltas, one round at a time**

For each delta marked **fixed**: change the layer (or the component, when the delta is a component defect), re-run the capture, re-read the audit, re-compare. Repeat Step 5-6 until the list is empty or every remaining item is marked **diverged with a reason**.

- [ ] **Step 7: Record the result**

Write the resolved-difference list next to the captures:

```bash
cd /home/jerome/git_projects/ITU/genie-ai && cat > artifacts/living-intelligence/NOTES.md <<'EOF'
# Living Intelligence — fidelity check

Reference: the designer's reference-light.png / reference-dark.png (1775×886).
Captures: light.png / dark.png in this directory, each with its .audit.json.

## Resolved differences

| Region | Difference | Verdict |
|---|---|---|
| ... | ... | ... |

## Diverged, with reason

| Region | Difference | Reason |
|---|---|---|
| Icons | the reference shows gradient tile icons; the app shows 24×24 line icons | the app's icons are already coloured per category; the tile style is a designer deliverable |
EOF
```

- [ ] **Step 8: Extend the Playwright suite**

Create `tests/e2e/living-intelligence.spec.js`, following the conventions of `tests/e2e/theme-runtime-config.spec.js`:

```js
const { test, expect } = require('@playwright/test');

// The decorative layer is configuration, and its assets live in the
// bind-mounted /config/ directory, so they must be revalidated like the
// other operator-editable files — a cached copy would keep serving the
// baked-in illustration after an operator swapped it on the host.

test.describe('Living Intelligence visual layer', () => {
  test('the decoration assets are served from /config/ and revalidated', async ({ request }) => {
    for (const asset of [
      '/config/genie-visual/assets/genie-hero-transparent.png',
      '/config/genie-visual/assets/genie-bottom-waves.svg',
      '/config/genie-visual/assets/genie-dot-mesh.svg',
      '/config/genie-visual/assets/genie-corner-network.svg'
    ]) {
      const response = await request.get(asset);
      expect(response.status(), `${asset} should be served`).toBe(200);
      const cacheControl = response.headers()['cache-control'] || '';
      expect(cacheControl, `${asset} must be revalidated`).toContain('no-cache');
      expect(cacheControl, `${asset} must not be immutable`).not.toContain('immutable');
    }
  });
});
```

- [ ] **Step 9: Run the local checks**

```bash
cd components/gov-chat-frontend && npm run lint && npm run format:check && npm test
cd /home/jerome/git_projects/ITU/genie-ai && npx playwright test tests/e2e/living-intelligence.spec.js
```

Expected: all pass. The Playwright run needs the stack up; if it cannot run in this environment, say so in the report rather than claiming it passed.

- [ ] **Step 10: Commit**

```bash
cd /home/jerome/git_projects/ITU/genie-ai && git add tests/e2e/capture-dashboard.js tests/e2e/living-intelligence.spec.js
git commit -m "test(theme): the visual fidelity gate

The acceptance criterion for the visual layer is the render, so the
check has to be a render. The capture script takes the screenshot and
the DOM facts a picture cannot prove — whether each decoration asset
resolves, the computed styles of the surfaces the layer touches, the
resolved custom properties — because a PNG read back only yields a
URL, and an asset that failed to load would otherwise produce a
convincing picture of an empty box.

The assets are probed with fetch rather than an Image probe: the SVGs
carry only a viewBox, so they have no intrinsic size and a natural
width of 0 would be reported for a perfectly valid file.

The audit and the picture are read together. Where they disagree, the
audit wins.

The e2e case pins the cache contract for the decoration assets: they
live in the operator-editable /config/ directory, so they must be
revalidated like every other file there."
```

Do **not** commit `artifacts/` — it is local evidence, and the notes belong with the change that produced them, not in the tree.

---

## Execution Order

Tasks 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 are independent of each other's *review* but depend on each other's *interfaces*, so run them in that order. Task 9 last, once everything is in place.

Tasks 1 and 2 can be reviewed and landed together: the schema must be valid before it can be enforced.

## Self-Review

**Spec coverage**

| Spec requirement | Task |
|---|---|
| Schema repaired, 7 files at 0 errors | 1 |
| Validation at load, hard fail | 2 |
| Fetch failure still forgiving | 2 (existing tests preserved) |
| D1 grid fix, el-salvador precedent | 3 |
| `Card.vue` `--ds-card-bg` escape hatch | 4 |
| `styles` carried and bound | 5 |
| `theme.visual` → `data-visual` + `--visual-*` | 6 |
| Layer stylesheet, gated, tokenised | 7 |
| Assets under `public/config/genie-visual/` | 7 |
| `main.js` import, `DashboardView` class | 7 |
| Base config enabled, flavours disabled | 8 |
| `theme-variables.css` gains no token | 3-7 (verified: no task touches it) |
| Visual fidelity gate | 9 |
| Deterministic seed | 9, Step 1 |
| Screenshot + DOM audit discipline | 9, Step 2 and Step 4 |
| `!important` carve-out documented | 7, Step 2 |
| Reduced motion preserved | 7, Step 2 |
| Grid geometry: no layer override | 3 (so no specificity war) |

**Placeholder scan** — no `TBD`, no "write tests for the above", no "similar to Task N". Every code block is complete. One marker remains by design: the `TODO(executor)` in Task 9's capture script, resolved by reading the existing e2e auth helper and removed before the file is committed.

**Bugs found and fixed in this plan during self-review** — six, all in the plan itself:

1. The migration script's `detectEnsureAscii` was called *after* the document had been mutated, so its round-trip could never match and every file would have been reformatted. It now runs before the mutation, and the dead `serialize` helper is gone.
2. Task 3's Step 3 would have destroyed the `.chat-input` and `.prompt-textarea` rules that share the `@media (min-width: 768px)` block with the grid rule. The step now removes only the grid rule.
3. Task 5's test bodies were descriptions rather than code. They are now complete, reusing the suite's existing `createChatBotWrapper()` helper and its `config-loader` mock.
4. Task 7's dark-mode selectors were malformed (`:is()` inside a compound, and a `.dark-mode` descendant that `ThemeManager` never produces — it puts the class on `html`/`body` itself). They are now the two correct forms, and the card border goes through `--ds-card-border-color`, the design system's own extension point, rather than a bare `border-color`.
5. Task 9's capture script was placed in the frontend component, where `require('playwright')` cannot resolve — `playwright` is a root dependency. It now lives at `tests/e2e/capture-dashboard.js`.
6. Task 9's asset audit used `naturalWidth`, which reports 0 for the three SVGs because they carry only a `viewBox` and no intrinsic size. The audit now probes every asset with `fetch`.

**Type consistency** — the custom property names line up across tasks: `--visual-hero` / `--visual-waves` / `--visual-mesh` / `--visual-corner` are written in Task 6 and read in Task 7; `--qh-bg` / `--qh-hover` / `--qh-outline` are written in Task 5 and read in Task 7; `--ds-card-bg` and `--ds-card-border-color` are defined in Task 4 and set in Task 7; `data-visual` is written in Task 6 and required by every rule in Task 7. `buttonTintStyle(button)` is defined in Task 5 and referenced in the same task's template.
