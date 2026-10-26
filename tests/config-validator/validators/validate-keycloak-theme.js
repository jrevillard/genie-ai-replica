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
const { readProperties, PropertiesError } = require('./theme-properties');

const THEMES_DIR = path.join('configs', 'keycloak', 'themes');

/**
 * The assignment that decides whether the page is the base theme's. The
 * marker follows the theme directory name, so the assignment has to be
 * the test of the resource path: an assignment that also matches
 * another theme hands the marker to the child themes too, and a child
 * loses its own ground and wave.
 */
const BASE_THEME_ASSIGNMENT = /<#assign\s+isBaseTheme\s*=\s*([^>]*?)>/;

/**
 * The test of the resource path of a theme, and nothing else. The
 * expression has to be the test on its own: a test joined to another
 * one by `||` covers more than the theme it names.
 */
const RESOURCE_PATH_TEST = /^url\.resources(?:Path|Url)\?ends_with\('\/login\/([^']+)'\)$/;

/**
 * The content of a file, or an empty string when it is not there. A
 * theme that lost a file is a failed check, not a failed suite.
 *
 * @param {string} file path of the file
 * @returns {string} the content
 */
function readFileOrEmpty(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

/**
 * A quote character, the one an attribute may be delimited with.
 */
const QUOTE = /["']/;

/**
 * The attributes of an element's start tag: the text between `<name`
 * and the `>` that closes it.
 *
 * A FreeMarker directive inside the tag may hold a `>` of its own, and
 * an attribute value may hold one too, so the tag is read with the
 * quotes and the directives taken into account.
 *
 * @param {string} source the file's content
 * @param {string} name the element name
 * @returns {string|null} the attributes of the start tag, or null when
 *          there is no such tag
 */
function readStartTag(source, name) {
  const start = new RegExp(`<${name}(?=[\\s/>])`).exec(source);
  if (!start) return null;
  let index = start.index + name.length + 1;
  let quote = null;
  while (index < source.length) {
    const char = source[index];
    if (quote) {
      if (char === quote) quote = null;
      index += 1;
      continue;
    }
    if (QUOTE.test(char)) {
      quote = char;
      index += 1;
      continue;
    }
    if (char === '<') {
      // A FreeMarker directive: it may hold a `>` of its own.
      const close = source.indexOf('>', index);
      if (close < 0) return null;
      index = close + 1;
      continue;
    }
    if (char === '>') return source.slice(start.index + name.length + 1, index);
    index += 1;
  }
  return null;
}

/**
 * The value of an attribute of a start tag.
 *
 * The attribute has to stand on its own: the `id` of `data-page-id` is
 * not an `id`.
 *
 * @param {string} tag the attributes of the start tag
 * @param {string} name the attribute name
 * @returns {string} the value, or an empty string when the tag does not
 *          carry the attribute
 */
function readAttribute(tag, name) {
  const match = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(tag);
  return match ? match[1] : '';
}

/**
 * Split a comma-separated selector list at the commas that separate
 * selectors — the ones outside parentheses and brackets, so a `:is(a, b)`
 * or an `[title="a,b"]` stays in one piece.
 *
 * @param {string} list selector list
 * @returns {string[]} the selectors
 */
function splitSelectorList(list) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const char of list) {
    if (char === '(' || char === '[') depth += 1;
    else if (char === ')' || char === ']') depth -= 1;
    if (char === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
}

/**
 * The compound selectors of a selector — the simple selectors joined by
 * no combinator. The compound that carries `#keycloak-bg` is the one
 * that has to carry the marker: `body.kc-theme-genie #keycloak-bg`
 * selects a body that is not its own descendant.
 *
 * @param {string} selector one selector
 * @returns {string[]} its compounds
 */
function splitCompounds(selector) {
  return selector.split(/\s*[>+~]\s*|\s+/).filter(Boolean);
}

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
  return selectors.flatMap(splitSelectorList);
}

/**
 * Read the coupled names of a login theme.
 *
 * @param {string} root repository root
 * @param {string} themeName theme directory name, e.g. 'genie'
 * @returns {{themeName: string, testedPath: string|null,
 *            emittedClass: string|null, emittedConditionally: boolean, styles: string[],
 *            paintedSelectors: string[],
 *            paintedByStyle: {style: string, pseudoElements: string[]}[]}}
 *            the parsed names, and every selector of every stylesheet the
 *            theme declares that paints the ground or the wave
 */
function readLoginThemeNames(root, themeName) {
  const loginDir = path.join(root, THEMES_DIR, themeName, 'login');
  const propertiesFile = path.join(loginDir, 'theme.properties');
  let properties = {};
  if (fs.existsSync(propertiesFile)) {
    try {
      properties = readProperties(propertiesFile);
    } catch (error) {
      // A theme.properties the themes guard cannot read either: the
      // marker checks have nothing to work with.
      if (!(error instanceof PropertiesError)) throw error;
    }
  }
  const template = readFileOrEmpty(path.join(loginDir, 'template.ftl'));
  // FreeMarker comments and HTML comments are not output: a marker that
  // survives only in a comment is not a marker the page carries.
  const templateBody = template.replace(/<#--[\s\S]*?-->/g, '').replace(/<!--[\s\S]*?-->/g, '');

  // The assignment that decides whether the page is the base theme's.
  // The marker is emitted under the name of that assignment, so the
  // assignment and the marker are read from the same place.
  const assignment = BASE_THEME_ASSIGNMENT.exec(templateBody);
  const baseThemeExpression = assignment ? assignment[1].trim() : null;
  // The resource path the assignment tests — it ends with the theme
  // name, and the assignment is that test and nothing else.
  const pathTest = baseThemeExpression ? RESOURCE_PATH_TEST.exec(baseThemeExpression) : null;

  // The body tag carries the id the CSS selects on and the class the
  // marker is emitted from. Only the start tag counts: an id that
  // moved to an inner element is not the body's id.
  const bodyTag = readStartTag(templateBody, 'body') || '';
  const bodyId = readAttribute(bodyTag, 'id') || readAttribute(bodyTag, 'data-page-id');
  const classValue = readAttribute(bodyTag, 'class');
  // Every guarded block, and what the class carries outside of them.
  const guards = [...classValue.matchAll(/<#if\s+isBaseTheme\b[^>]*>([\s\S]*?)<\/#if>/g)];
  // An `<#else>` branch runs when the guard is false — the child theme's
  // case — so the marker there counts as unguarded.
  const guardedText = guards.map((guard) => guard[1].split(/<#else\b/)[0]).join(' ');
  const elseText = guards.map((guard) => guard[1].split(/<#else\b/)[1] || '').join(' ');
  const unguardedText = `${classValue.replace(guards.map((guard) => guard[0]).join(''), '')} ${elseText}`;
  const guarded = /kc-theme-[A-Za-z0-9_-]+/.exec(guardedText);
  const unguarded = /kc-theme-[A-Za-z0-9_-]+/.exec(unguardedText);

  // The stylesheets the theme declares are the ones the page loads, so
  // the ground and the wave are looked for in all of them.
  const styles = (properties.styles || '').split(/\s+/).filter(Boolean);
  const paintedSelectors = [];
  const paintedByStyle = [];
  for (const style of styles) {
    const css = readFileOrEmpty(path.join(loginDir, 'resources', style));
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
    bodyId,
    // The class the page carries is the one inside the guard; a class
    // outside it would reach every theme, the guarded one only the base.
    emittedClass: guarded ? guarded[0] : null,
    emittedConditionally: Boolean(guarded) && !unguarded,
    styles,
    paintedSelectors,
    paintedByStyle
  };
}

module.exports = { readLoginThemeNames, readStartTag, readAttribute, splitCompounds };
