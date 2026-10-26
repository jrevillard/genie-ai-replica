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
 * Read the three coupled names of a login theme.
 *
 * @param {string} root repository root
 * @param {string} themeName theme directory name, e.g. 'genie'
 * @returns {{themeName: string, testedPath: string|null, emittedClass: string|null,
 *            scopedClass: string|null}} the parsed names, null when absent
 */
function readLoginThemeNames(root, themeName) {
  const loginDir = path.join(root, THEMES_DIR, themeName, 'login');
  const template = fs.readFileSync(path.join(loginDir, 'template.ftl'), 'utf8');
  const css = fs.readFileSync(path.join(loginDir, 'resources', 'css', 'genie.css'), 'utf8');

  const pathTest = /ends_with\('\/login\/([^']+)'\)/.exec(template);
  const emitted = /kc-theme-[A-Za-z0-9_-]+/.exec(template);
  const scoped = /body\.(kc-theme-[A-Za-z0-9_-]+)#keycloak-bg/.exec(css);

  return {
    themeName,
    testedPath: pathTest ? pathTest[1] : null,
    emittedClass: emitted ? emitted[0] : null,
    scopedClass: scoped ? scoped[1] : null
  };
}

module.exports = { readLoginThemeNames };
