/**
 * The base Keycloak login theme marks its own pages with a class, so a
 * child theme (genie-el-salvador, whose `parent=` is `genie`) does not
 * inherit the base theme's ground and wave band.
 *
 * The marker follows the theme directory name: the login template tests
 * the resource path, which ends with the theme name, and the CSS scopes
 * the ground and the band to the class that test emits. Renaming the
 * directory without renaming the marker drops both silently — nothing
 * errors, the page just loses its ground. These checks make that
 * failure loud at build time.
 */
const fs = require('fs');
const path = require('path');

const THEMES_DIR = path.join('configs', 'keycloak', 'themes');

/**
 * Every selector of a stylesheet, one per comma-separated part, with the
 * rules nested in at-rules (@media) included.
 *
 * @param {string} css stylesheet source
 * @returns {string[]} the selectors
 */
function parseSelectors(css) {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const selectors = [];
  let buffer = '';
  for (const char of source) {
    if (char === '{') {
      const prelude = buffer.trim();
      buffer = '';
      // An at-rule prelude (@media …) is not a selector; what it holds is.
      if (!prelude.startsWith('@')) selectors.push(prelude);
      continue;
    }
    if (char === '}') {
      buffer = '';
      continue;
    }
    buffer += char;
  }
  return selectors.flatMap((selector) => selector.split(',').map((part) => part.trim())).filter(Boolean);
}

/**
 * Read the coupled names of a login theme.
 *
 * @param {string} root repository root
 * @param {string} themeName theme directory name, e.g. 'genie'
 * @returns {{themeName: string, testedPath: string|null, emittedClass: string|null,
 *            emittedConditionally: boolean, paintedSelectors: string[],
 *            paintedByStyle: {style: string, pseudoElements: string[]}[]}}
 *            the parsed names, and every selector of every stylesheet the
 *            theme declares that paints the ground or the wave
 */
function readLoginThemeNames(root, themeName) {
  const loginDir = path.join(root, THEMES_DIR, themeName, 'login');
  const properties = fs.readFileSync(path.join(loginDir, 'theme.properties'), 'utf8');
  const template = fs.readFileSync(path.join(loginDir, 'template.ftl'), 'utf8');
  // FreeMarker comments are not output: a marker that survives only in a
  // comment is not a marker the page carries.
  const templateBody = template.replace(/<#--[\s\S]*?-->/g, '');

  // The resource path the template tests — it ends with the theme name.
  const pathTest = /ends_with\('\/login\/([^']+)'\)/.exec(templateBody);
  // The marker the body tag emits. Anchored to the tag, so a marker that
  // only survives elsewhere in the file does not pass for one that is
  // rendered.
  const emitted = /<body[^>]*\bclass="[^"]*\b(kc-theme-[A-Za-z0-9_-]+)\b/.exec(templateBody);
  // The marker has to be conditional on the theme's own resource path, or
  // a child theme inherits it and with it the base ground and wave.
  const conditional = /<#if\s+isBaseTheme\b[^>]*>[^<]*\bkc-theme-[A-Za-z0-9_-]+/.test(templateBody);

  // The stylesheets the theme declares are the ones the page loads, so
  // the ground and the wave are looked for in all of them.
  const styles = (/^styles=(.*)$/m.exec(properties)?.[1] || '').trim().split(/\s+/).filter(Boolean);
  const paintedSelectors = [];
  const paintedByStyle = [];
  for (const style of styles) {
    const css = fs.readFileSync(path.join(loginDir, 'resources', style), 'utf8');
    const selectors = parseSelectors(css).filter((selector) => /#keycloak-bg::(before|after)/.test(selector));
    paintedSelectors.push(...selectors);
    paintedByStyle.push({
      style,
      pseudoElements: [...new Set(selectors.map((selector) => selector.match(/::(before|after)/)[1]))]
    });
  }

  return {
    themeName,
    testedPath: pathTest ? pathTest[1] : null,
    emittedClass: emitted ? emitted[1] : null,
    emittedConditionally: conditional,
    paintedSelectors,
    paintedByStyle
  };
}

module.exports = { readLoginThemeNames, parseSelectors };
