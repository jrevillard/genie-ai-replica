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
 * Read the coupled names of a login theme.
 *
 * @param {string} root repository root
 * @param {string} themeName theme directory name, e.g. 'genie'
 * @returns {{themeName: string, testedPath: string|null, emittedClass: string|null,
 *            paintedSelectors: string[]}} the parsed names, and every CSS
 *            selector that paints the ground or the wave
 */
function readLoginThemeNames(root, themeName) {
  const loginDir = path.join(root, THEMES_DIR, themeName, 'login');
  const template = fs.readFileSync(path.join(loginDir, 'template.ftl'), 'utf8');
  const css = fs.readFileSync(path.join(loginDir, 'resources', 'css', 'genie.css'), 'utf8');

  // The resource path the template tests — it ends with the theme name.
  const pathTest = /ends_with\('\/login\/([^']+)'\)/.exec(template);
  // The marker the body tag emits. Anchored to the tag, so a marker that
  // only survives in a comment does not pass for one that is rendered.
  const emitted = /<body[^>]*\bclass="[^"]*\b(kc-theme-[A-Za-z0-9_-]+)\b/.exec(template);
  // Every selector that paints the ground or the wave: each of them has
  // to carry the marker, or the paint reaches a child theme.
  const paintedSelectors = css
    .split('}')
    .map((chunk) => chunk.split('{')[0].trim())
    .filter((selector) => /#keycloak-bg::(before|after)/.test(selector));

  return {
    themeName,
    testedPath: pathTest ? pathTest[1] : null,
    emittedClass: emitted ? emitted[1] : null,
    paintedSelectors
  };
}

module.exports = { readLoginThemeNames };
