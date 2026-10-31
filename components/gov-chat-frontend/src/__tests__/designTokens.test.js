// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
//
// Design-token guard (!1069).
//
// FrontmatterPanel.vue and ConceptEditor.vue styled against a `--color-*`
// vocabulary that the design system never defined: `--color-surface-base`,
// `--color-surface-raised`, `--color-text`, `--color-text-muted`,
// `--color-text-faint`, `--color-border`, `--color-border-subtle`. An
// undefined custom property in a declaration is invalid at computed-value
// time, so the declaration falls back to its initial value — which is why the
// frontmatter panel rendered saved tags as INVISIBLE in dark mode while the
// data was intact underneath. ConceptEditor had the same phantoms but with
// hardcoded light-mode fallbacks (`#fff`, `#999`), so it rendered visible but
// wrong in dark mode.
//
// This test reads the real token definitions and fails on any `var(--x)` in a
// component whose `--x` is not among them. A phantom token is invisible in
// review because it looks like ordinary styling; it is only observable by
// resolving the reference, which is what this does.

const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '..');
// The global token definitions moved to the runtime-config location (main's
// theme rework, 2026-10): public/config/theme-variables.css is the file the
// config-loader serves at runtime — and the authoritative definition source
// this guard reads. The old src/theme-variables.css no longer exists.
const THEME_VARS = path.resolve(SRC, '..', 'public', 'config', 'theme-variables.css');

/** Token names actually DEFINED by the design system. */
function definedTokens() {
  const css = fs.readFileSync(THEME_VARS, 'utf8');
  const names = new Set();
  // Matches `--name:` at any indentation, in every theme block (light, dark,
  // high-contrast) so a token defined only in a dark block still counts.
  for (const m of css.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)) names.add(m[1]);
  return names;
}

/** Every .vue file under components/. */
function vueFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) vueFiles(full, out);
    else if (entry.name.endsWith('.vue')) out.push(full);
  }
  return out;
}

describe('design tokens', () => {
  const tokens = definedTokens();

  test('the theme defines a usable vocabulary', () => {
    // A guard that passes because the parser found nothing is worse than none.
    expect(tokens.size).toBeGreaterThan(50);
    expect(tokens.has('--bg')).toBe(true);
    expect(tokens.has('--fg')).toBe(true);
    expect(tokens.has('--border')).toBe(true);
    expect(tokens.has('--surface')).toBe(true);
  });

  test('no OKF component references a custom property that is defined nowhere', () => {
    // A `var(--x)` is valid if `--x` is defined GLOBALLY (theme-variables.css)
    // or as a SCOPED OVERRIDE anywhere in the component tree. The DS components
    // consume tokens their consumers declare — `--ds-btn-ghost-color` is set in
    // NavBarComponent, StudioDashboard and RepoEditorShell and read by
    // ds/Button.vue — so the definition is in a different file by design. A
    // purely global check produces false positives on that pattern; the defect
    // condition is a token with no definition in EITHER scope.
    //
    // Scoped to the OKF tree, which is !1069's blast radius. The same scan over
    // the whole component tree reports 47 further undefined tokens in
    // AdminDashboard, FileDetailsDialog and several ds/ components — real
    // instances of this class, filed separately as they each need a per-token
    // decision about the intended value, and none of them render invisibly the
    // way the frontmatter panel did.
    const tree = path.resolve(SRC, 'components');
    const files = vueFiles(path.join(tree, 'okf'));
    expect(files.length).toBeGreaterThan(5);

    const scoped = new Set();
    for (const file of vueFiles(tree)) {
      const src = fs.readFileSync(file, 'utf8');
      for (const m of src.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)) scoped.add(m[1]);
    }

    const offenders = [];
    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8');
      for (const m of src.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)/g)) {
        if (!tokens.has(m[1]) && !scoped.has(m[1])) {
          offenders.push(`${path.relative(SRC, file)} -> ${m[1]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test('the specific !1069 phantoms are gone', () => {
    const files = vueFiles(path.resolve(SRC, 'components'));
    const phantom = /^--(color-(surface|text|border|danger|success|focus))/;
    const found = [];
    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8');
      for (const m of src.matchAll(/(--[a-zA-Z0-9-]+)/g)) {
        if (phantom.test(m[1])) found.push(`${path.relative(SRC, file)} -> ${m[1]}`);
      }
    }
    expect(found).toEqual([]);
  });

  test('frontmatter styling has no hardcoded light-mode colour fallbacks', () => {
    // A `var(--token, #fff)` fallback never fires while the token is defined,
    // so it is dead weight — but if the token is ever removed it silently
    // restores a white background in dark mode. The OKF frontmatter surfaces
    // must rely on the token alone.
    //
    // Scoped to <style> blocks on purpose. ConceptEditor also sets an inline
    // style from script for the transient PII flash — that one is tokenized
    // too (round 18, #80491: var(--warning)/var(--warning-ink), replacing a
    // hardcoded #111 that was unreadable on the dark theme).
    const files = [
      path.resolve(SRC, 'components/okf/FrontmatterPanel.vue'),
      path.resolve(SRC, 'components/okf/editor/ConceptEditor.vue'),
      path.resolve(SRC, 'components/okf/editor/PiiOccurrences.vue')
    ];
    const offenders = [];
    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8');
      for (const block of src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) {
        for (const m of block[1].matchAll(/var\(\s*--[a-zA-Z0-9-]+\s*,\s*#[0-9a-fA-F]{3,8}\s*\)/g)) {
          offenders.push(`${path.basename(file)} -> ${m[0]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
