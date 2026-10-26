/**
 * Every file a Keycloak theme points at has to be on disk.
 *
 * A theme that names a stylesheet, a logo or an image that is not there
 * fails silently: the page loads, the masthead shows a broken image,
 * the band that should be under the form never appears. Nothing in
 * Keycloak reports it. These checks turn that silence into a red job.
 *
 * Three contracts live here:
 *
 * - a reference resolves to a file that exists;
 * - a stylesheet the theme ships is a stylesheet the theme declares: a
 *   file nobody loads does nothing;
 * - the email templates carry no `cid:` image. Keycloak attaches
 *   nothing to an email, so a `cid:` reference is a broken image in
 *   every mail client — the images are fetched from the theme's own
 *   resources over HTTP instead.
 *
 * The reading of a theme follows Keycloak's own:
 *
 * - `theme.properties` is a Java properties file: `java.util.Properties`
 *   reads it, so a `:` separator and a backslash continuation are as
 *   valid as `=`, the value carries the escapes Java resolves, and a
 *   malformed `\u` escape is a broken file rather than a literal. That
 *   reading lives in `theme-properties.js`, on its own.
 * - A theme's files are looked for in the theme itself, in the
 *   ancestors it inherits from and in the theme it imports, within the
 *   same theme type. A child theme serves the parent's stylesheets and
 *   the parent's images, so a file the child borrows is not a broken
 *   reference.
 * - The built-in themes are not on disk. A file the theme does not
 *   hold but whose directory the theme does not hold either comes from
 *   the built-in parent, where the guard cannot see it: a reference in
 *   a directory the theme provides has to resolve, a reference in one
 *   it does not provide cannot be decided.
 */
const fs = require('fs');
const path = require('path');
const { readProperties, PropertiesError } = require('./theme-properties');

const THEMES_DIR = path.join('configs', 'keycloak', 'themes');

// The theme types Keycloak serves (org.keycloak.theme.Theme$Type). A
// theme provides the ones it has directories for; the others are served
// by the built-in parent.
const THEME_TYPES = ['login', 'admin', 'account', 'email', 'welcome', 'common'];

// The themes that ship inside the Keycloak image. They are not on disk,
// so a theme that inherits from one of them is not a broken reference.
const BUILTIN_THEMES = new Set(['keycloak', 'keycloak.v2', 'keycloak.v3', 'base']);

// The theme the common stylesheets are served from. Keycloak's UrlBean
// builds that path from the `common` property and falls back to this.
const DEFAULT_COMMON_PATH = 'common/keycloak';

// The properties that name a file of the theme, served from the theme's
// own resources. `logoUrl` holds an absolute URL and `favIconType` a
// mime type: neither names a file, so neither is checked.
const STYLE_PROPERTIES = ['styles'];
const SCRIPT_PROPERTIES = ['scripts'];
const IMAGE_PROPERTIES = ['logo', 'favIcon'];

// The property that names the stylesheets of the *common* theme. They
// are served from that theme's resources, not from the theme's own.
const COMMON_STYLE_PROPERTIES = ['stylesCommon'];

/**
 * A quote character, the one a string may be delimited with.
 */
const QUOTE = /["']/;

/**
 * Whether a path is a regular file.
 *
 * @param {string} file path
 * @returns {boolean} true when the path is a file
 */
function isFile(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

/**
 * Whether a path is a directory.
 *
 * @param {string} dir path
 * @returns {boolean} true when the path is a directory
 */
function isDirectory(dir) {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Whether a theme is one of the themes that ship with Keycloak.
 *
 * @param {string} name the theme name
 * @returns {boolean} true when the theme lives in the image
 */
function isBuiltinTheme(name) {
  return BUILTIN_THEMES.has(name);
}

/**
 * A theme type and a theme name, as the `parent`-free references of a
 * theme.properties file write them: `common/keycloak`.
 *
 * @param {string} value the reference
 * @returns {{type: string, name: string}|null} the type and the name, or
 *          null when the reference names neither
 */
function parseThemePath(value) {
  const parts = String(value || '').split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return { type: parts[0].toLowerCase(), name: parts[1] };
}

/**
 * The chain of themes a theme inherits from: the theme itself, then its
 * parent, then the parent's parent. The chain stops at the first
 * ancestor that is not in the repository — the built-in themes live in
 * the image, not on disk.
 *
 * @param {string} themesDir the themes directory
 * @param {string} theme the theme name
 * @param {string} type the theme type
 * @returns {{chain: {name: string, typeDir: string, properties: Object}[],
 *          missing: string|null}} the chain, nearest first, and the
 *          parent that does not exist
 */
function themeChain(themesDir, theme, type) {
  const chain = [];
  const seen = new Set();
  let name = theme;
  let missing = null;
  while (name && !seen.has(name)) {
    seen.add(name);
    const themeDir = path.join(themesDir, name);
    const typeDir = path.join(themeDir, type);
    if (!isDirectory(typeDir)) {
      if (isDirectory(themeDir)) {
        // The theme is on disk but does not provide this type: the
        // chain stops here.
        break;
      }
      // The theme is not on disk. The built-in themes live in the
      // image; any other name is a broken reference, because Keycloak
      // refuses to load the theme whose parent is missing.
      if (!isBuiltinTheme(name) && missing === null) missing = name;
      break;
    }
    const propertiesFile = path.join(typeDir, 'theme.properties');
    let properties = Object.create(null);
    if (isFile(propertiesFile)) {
      try {
        properties = readProperties(propertiesFile);
      } catch (error) {
        // The file is invalid; the scan of the theme it belongs to
        // reports it. The chain stops here.
        if (!(error instanceof PropertiesError)) throw error;
        break;
      }
    }
    chain.push({ name, typeDir, properties });
    name = properties.parent;
  }
  return { chain, missing };
}

/**
 * The theme whose resources carry the common stylesheets.
 *
 * Keycloak's UrlBean builds the path those stylesheets are served from
 * out of the `common` property, and falls back to `common/keycloak`.
 *
 * @param {{properties: Object}[]} chain the theme's chain
 * @returns {string} the path, as `<type>/<name>`
 */
function commonPath(chain) {
  for (const entry of chain) {
    const value = entry.properties.common;
    if (value) return value;
  }
  return DEFAULT_COMMON_PATH;
}

/**
 * The resources directories a theme of a type serves its files from: its
 * own, those of the themes it inherits from, and those of the themes it
 * imports.
 *
 * @param {string} themesDir the themes directory
 * @param {{chain: object[], missing: string|null}} resolution the
 *        theme's chain
 * @returns {string[]} the resources directories
 */
function resourceRoots(themesDir, resolution) {
  const roots = resolution.chain.map((entry) => path.join(entry.typeDir, 'resources'));
  for (const entry of resolution.chain) {
    const imported = parseThemePath(entry.properties.import);
    if (!imported) continue;
    const typeDir = path.join(themesDir, imported.name, imported.type);
    if (isDirectory(typeDir)) roots.push(path.join(typeDir, 'resources'));
  }
  return roots;
}

/**
 * The file a theme holds for a path relative to a resources directory.
 *
 * @param {string[]} roots the resources directories to look in
 * @param {string} relative the path, relative to a resources directory
 * @returns {{file: string, root: string}|null} the file and the
 *          resources directory it was found in
 */
function findInRoots(roots, relative) {
  for (const root of roots) {
    const file = path.join(root, relative);
    if (isFile(file)) return { file, root };
  }
  return null;
}

/**
 * The path a reference names inside a resources directory, or null when
 * it points outside it: a reference that leaves the theme is not a file
 * of the theme.
 *
 * @param {string} root the resources directory
 * @param {string} reference the reference
 * @returns {string|null} the relative path, or null when the reference
 *          leaves the resources directory
 */
function resolveResource(root, reference) {
  const file = path.resolve(root, reference);
  const relative = path.relative(root, file);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return relative.split(path.sep).join('/');
}

/**
 * Whether a reference points outside the theme — another host, a data
 * URI, a fragment.
 *
 * @param {string} reference the reference
 * @returns {boolean} true when the reference is not a file of the theme
 */
function isExternalReference(reference) {
  if (!reference || reference.startsWith('#')) return true;
  if (/^(https?:)?\/\//.test(reference)) return true;
  return /^[a-z][a-z0-9+.-]*:/i.test(reference);
}

/**
 * The images a stylesheet or a template points at.
 *
 * A stylesheet names them with `url(...)`; a template names them with
 * the theme's own resource URL.
 *
 * @param {string} source the file's content
 * @returns {string[]} the referenced paths
 */
function readAssetReferences(source) {
  const references = [];
  const patterns = [/url\(\s*['"]?([^'")]+)['"]?\s*\)/g, /\$\{url\.resources(?:Url|Path)\}\/([^'"\s)]+)/g];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      references.push(match[1]);
    }
  }
  return references;
}

/**
 * The stylesheets a stylesheet imports.
 *
 * @param {string} source the stylesheet's content
 * @returns {string[]} the imported paths
 */
function readImports(source) {
  const references = [];
  const pattern = /@import\s+(?:url\(\s*['"]?([^'")]+)['"]?\s*\)|['"]([^'"]+)['"])/gi;
  for (const match of source.matchAll(pattern)) {
    references.push(match[1] || match[2]);
  }
  return references;
}

/**
 * The end of an at-rule's prelude: the `;` of a statement at-rule or
 * the `{` of a block at-rule.
 *
 * @param {string} css the stylesheet
 * @param {number} start the `@` of the at-rule
 * @returns {{block: boolean, end: number}|null} the end of the prelude
 */
function readAtRulePrelude(css, start) {
  let index = start;
  while (index < css.length) {
    const char = css[index];
    if (QUOTE.test(char)) {
      index += 1;
      while (index < css.length && css[index] !== char) index += 1;
      index += 1;
      continue;
    }
    if (char === '{') return { block: true, end: index };
    if (char === ';') return { block: false, end: index };
    index += 1;
  }
  return null;
}

/**
 * The stylesheet without its at-rule preludes. An at-rule names no file
 * of the theme: what it holds is scanned, what its prelude names is not.
 *
 * @param {string} css the stylesheet
 * @returns {string} the stylesheet without the preludes
 */
function stripAtRulePreludes(css) {
  let result = '';
  let index = 0;
  while (index < css.length) {
    const at = css.indexOf('@', index);
    if (at < 0) {
      result += css.slice(index);
      break;
    }
    result += css.slice(index, at);
    const prelude = readAtRulePrelude(css, at);
    if (!prelude) {
      result += css.slice(at);
      break;
    }
    if (prelude.block) {
      // A block at-rule: its prelude goes, what it holds stays.
      result += '{';
    }
    index = prelude.end + 1;
  }
  return result;
}

/**
 * The comments of a template and of a stylesheet: none of them is
 * output, so what they name is not what the page carries.
 *
 * @param {string} source the file's content
 * @param {string} kind 'template' or 'stylesheet'
 * @returns {string} the content without its comments
 */
function stripComments(source, kind) {
  const withoutFreemarker = source.replace(/<#--[\s\S]*?-->/g, '');
  if (kind === 'template') return withoutFreemarker.replace(/<!--[\s\S]*?-->/g, '');
  return withoutFreemarker.replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * The templates of a theme type — the files Keycloak renders. The
 * resources directory holds static files, not templates.
 *
 * @param {string} typeDir the theme type's directory
 * @returns {string[]} the template paths
 */
function themeTemplates(typeDir) {
  const templates = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'resources') continue;
        walk(file);
        continue;
      }
      if (entry.name.endsWith('.ftl')) templates.push(file);
    }
  };
  walk(typeDir);
  return templates;
}

/**
 * Check a stylesheet and everything it pulls in.
 *
 * @param {{file: string, root: string}} found the stylesheet
 * @param {string[]} roots the resources directories of the theme
 * @param {Function} report reports a broken reference
 * @param {Set<string>} seen the stylesheets already checked
 */
function checkStylesheet(found, roots, report, seen) {
  if (seen.has(found.file)) return;
  seen.add(found.file);
  const source = stripComments(fs.readFileSync(found.file, 'utf8'), 'stylesheet');

  for (const reference of readAssetReferences(stripAtRulePreludes(source))) {
    if (isExternalReference(reference)) continue;
    const relative = resolveResource(found.root, path.resolve(path.dirname(found.file), reference));
    if (!relative) continue;
    if (!findInRoots(roots, relative)) report('asset', reference);
  }

  for (const reference of readImports(source)) {
    if (isExternalReference(reference)) continue;
    const relative = resolveResource(found.root, path.resolve(path.dirname(found.file), reference));
    if (!relative) continue;
    const imported = findInRoots(roots, relative);
    if (!imported) {
      report('import', reference);
      continue;
    }
    checkStylesheet(imported, roots, report, seen);
  }
}

/**
 * The `styles` property a theme serves: its own when it declares one,
 * the nearest ancestor's otherwise, the way Keycloak inherits it.
 *
 * @param {{properties: Object}[]} chain the theme's chain
 * @returns {string} the value of the property
 */
function effectiveStyles(chain) {
  for (const entry of chain) {
    if (entry.properties.styles) return entry.properties.styles;
  }
  return '';
}

/**
 * The stylesheets a theme holds in its own resources.
 *
 * @param {string} typeDir the theme type's directory
 * @returns {string[]} the paths of the stylesheets
 */
function ownStylesheets(typeDir) {
  const resources = path.join(typeDir, 'resources');
  const stylesheets = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(file);
        continue;
      }
      if (entry.name.toLowerCase().endsWith('.css')) stylesheets.push(file);
    }
  };
  if (isDirectory(resources)) walk(resources);
  return stylesheets;
}

/**
 * The directories the resources directories hold.
 *
 * A file in a directory the theme does not provide comes from the
 * built-in parent, which is not on disk: the guard cannot see it, so
 * it cannot decide it. A file in a directory the theme does provide
 * has to be there.
 *
 * @param {string[]} roots the resources directories
 * @returns {Set<string>} the names of the directories
 */
function providedDirectories(roots) {
  const directories = new Set();
  for (const root of roots) {
    if (!isDirectory(root)) continue;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (entry.isDirectory()) directories.add(entry.name);
    }
  }
  return directories;
}

/**
 * Check every theme in the repository.
 *
 * @param {string} root repository root
 * @returns {{theme: string, type: string, kind: string, reference: string}[]}
 *          one entry per broken reference
 */
function collectThemeIssues(root) {
  const issues = [];
  const themesDir = path.join(root, THEMES_DIR);
  if (!isDirectory(themesDir)) return issues;

  for (const theme of fs.readdirSync(themesDir).sort()) {
    const themeDir = path.join(themesDir, theme);
    if (!isDirectory(themeDir)) continue;

    for (const type of THEME_TYPES) {
      const typeDir = path.join(themeDir, type);
      // A theme type without a theme.properties is not a theme: Keycloak
      // ignores it. The other types of the theme are still checked.
      if (!isDirectory(typeDir)) continue;
      const propertiesFile = path.join(typeDir, 'theme.properties');
      if (!isFile(propertiesFile)) continue;

      let properties;
      try {
        properties = readProperties(propertiesFile);
      } catch (error) {
        if (!(error instanceof PropertiesError)) throw error;
        issues.push({
          theme,
          type,
          kind: 'properties',
          reference: 'theme.properties',
          detail: error.reason
        });
        continue;
      }

      const report = (kind, reference, detail) => {
        issues.push(detail === undefined ? { theme, type, kind, reference } : { theme, type, kind, reference, detail });
      };

      const resolution = themeChain(themesDir, theme, type);
      // A parent that is not on disk and not built in: Keycloak refuses
      // to load the theme whose parent is missing.
      if (resolution.missing) report('parent', resolution.missing);

      // The theme this theme imports: its resources are served too, and
      // a theme that is not there is a broken reference.
      for (const entry of resolution.chain) {
        if (!entry.properties.import) continue;
        const imported = parseThemePath(entry.properties.import);
        if (!imported) {
          report('themeImport', entry.properties.import, 'the import names no theme type');
        } else if (!THEME_TYPES.includes(imported.type)) {
          report('themeImport', entry.properties.import, `the theme type ${imported.type} is not one Keycloak serves`);
        } else if (!isDirectory(path.join(themesDir, imported.name, imported.type)) && !isBuiltinTheme(imported.name)) {
          report('themeImport', entry.properties.import, 'the imported theme does not exist');
        }
      }

      const roots = resourceRoots(themesDir, resolution);

      // The common stylesheets are served from the common theme's
      // resources, not from the theme's own. The theme that holds them
      // has to be there: a `common` that names a theme that is neither
      // on disk nor built in leaves the browser asking for a path that
      // does not exist.
      const commonValue = commonPath(resolution.chain);
      const common = parseThemePath(commonValue);
      let commonRoot = null;
      let commonMissing = false;
      if (!common) {
        report('common', commonValue, 'the common names no theme type');
        commonMissing = true;
      } else if (!THEME_TYPES.includes(common.type)) {
        report('common', commonValue, `the theme type ${common.type} is not one Keycloak serves`);
        commonMissing = true;
      } else if (isDirectory(path.join(themesDir, common.name, common.type))) {
        commonRoot = path.join(themesDir, common.name, common.type, 'resources');
      } else if (!isBuiltinTheme(common.name)) {
        report('common', commonValue, 'the common theme does not exist');
        commonMissing = true;
      }
      // A built-in common theme lives in the image: its files are not
      // on disk, so the guard cannot decide whether they are there.

      // The logo and the favicon the page header asks for.
      for (const key of IMAGE_PROPERTIES) {
        const value = properties[key];
        if (!value || isExternalReference(value)) continue;
        const resource = value.replace(/^\//, '');
        const relative = resolveResource(roots[0], resource);
        if (!relative) continue;
        if (!findInRoots(roots, relative)) report(key, value);
      }

      // The stylesheets and the scripts the page loads, and the images
      // they name. A value that leaves the theme's resources names no
      // file of the theme: the browser asks for a path that does not
      // exist.
      const reachable = new Set();
      for (const key of [...STYLE_PROPERTIES, ...SCRIPT_PROPERTIES]) {
        for (const name of (properties[key] || '').split(/\s+/).filter(Boolean)) {
          const relative = resolveResource(roots[0], name);
          const found = relative ? findInRoots(roots, relative) : null;
          if (!found) {
            report(key, name);
            continue;
          }
          if (key !== 'scripts') checkStylesheet(found, roots, report, reachable);
        }
      }

      // The common stylesheets: they live in the common theme, not in
      // the theme's own resources.
      for (const key of COMMON_STYLE_PROPERTIES) {
        for (const name of (properties[key] || '').split(/\s+/).filter(Boolean)) {
          if (!commonRoot) {
            // The common theme is not on disk: its stylesheets are
            // neither there nor in the theme's own resources.
            if (commonMissing) report(key, name);
            continue;
          }
          const relative = resolveResource(commonRoot, name);
          const found = relative ? findInRoots([...roots, commonRoot], relative) : null;
          if (!found) {
            report(key, name);
            continue;
          }
          checkStylesheet(found, [...roots, commonRoot], report, new Set());
        }
      }

      // The templates: no `cid:` image, and every file a template names
      // has to be in the theme's resources.
      const directories = providedDirectories(roots);
      const named = new Set();
      for (const template of themeTemplates(typeDir)) {
        const source = stripComments(fs.readFileSync(template, 'utf8'), 'template');
        for (const match of source.matchAll(/cid:([A-Za-z0-9._/-]+)/gi)) {
          report('cid', match[1]);
        }
        for (const reference of readAssetReferences(source)) {
          // A reference that holds a template expression names a value
          // the template computes at runtime: the guard cannot know it.
          if (reference.includes('${')) continue;
          const resource = reference.replace(/^\//, '');
          const relative = resolveResource(roots[0], resource);
          // A reference that leaves the theme is not a file of the
          // theme.
          if (!relative) continue;
          // The directory the reference is in. A theme that does not
          // provide it gets the file from the built-in parent, where
          // the guard cannot see it; a theme that does provide it has
          // to hold the file.
          const directory = relative.includes('/') ? relative.split('/')[0] : '';
          if (directory && !directories.has(directory)) continue;
          named.add(relative);
          if (!findInRoots(roots, relative)) {
            report('asset', reference);
          }
        }
      }

      // A stylesheet the theme ships but does not declare is a file
      // nobody loads: the page never asks for it, so it does nothing.
      // The common theme is not checked: its files are served to the
      // themes that name them in their `stylesCommon`, and the guard
      // cannot tell which of them are used.
      if (type !== 'common') {
        const declared = new Set(effectiveStyles(resolution.chain).split(/\s+/).filter(Boolean));
        for (const file of ownStylesheets(typeDir)) {
          // A stylesheet a declared stylesheet imports is loaded.
          if (reachable.has(file)) continue;
          const name = path.relative(path.join(typeDir, 'resources'), file).split(path.sep).join('/');
          if (declared.has(name)) continue;
          // A stylesheet a template names is loaded too.
          if (named.has(name)) continue;
          report('stylesheet', name);
        }
      }
    }
  }
  return issues;
}

module.exports = {
  collectThemeIssues
};
