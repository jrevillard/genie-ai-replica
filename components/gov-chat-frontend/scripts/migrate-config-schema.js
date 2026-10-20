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
 * Serializes a config file in the project's single canonical format: 2-space
 * indent, trailing newline, raw UTF-8.
 *
 * Every config file in this repo (the base + six flavours) shares this one
 * serialization — Node's `JSON.stringify` with 2-space indent already emits
 * the document with no trailing newline, so we add one; it never escapes
 * non-ASCII characters, and the project does not use ASCII-only escapes
 * anywhere. There is therefore no encoding choice to make, and no flavour to
 * detect: the same function serializes every file identically.
 */
const serialize = (doc) => `${JSON.stringify(doc, null, 2)}\n`;

/**
 * Asserts the untouched document already round-trips through `serialize`. If
 * it does not, the file is not in the project's canonical format — somewhere
 * along the line it was authored or saved with different indentation, line
 * endings, or character handling. The migration refuses to silently reformat
 * a file it does not understand.
 *
 * The check MUST run against the untouched document; once the migration
 * mutates the document (cloning the theme, seeding styles, rewriting the
 * localized-text descriptions) the round-trip is no longer a check against
 * the original file's format.
 */
const assertRoundTrip = (doc, original) => {
  if (serialize(doc) === original) return;
  throw new Error(
    "Refusing to rewrite: the file is not in the project's canonical " +
      'format (2-space indent, trailing newline, raw UTF-8). ' +
      'Round-tripping it through the migration would reformat it silently.'
  );
};

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
    // Confirm the untouched document is already in the project's canonical
    // format before mutating — the round-trip only matches an untouched
    // document.
    assertRoundTrip(doc, raw.get(name));
    migrateSchema(doc, canonicalTheme);
    if (name === BASE_FILE) {
      seedBaseStyles(doc);
    }
    fs.writeFileSync(path.join(CONFIG_DIR, name), serialize(doc), 'utf8');
    console.log(`${name}: migrated`);
  }
};

main();
