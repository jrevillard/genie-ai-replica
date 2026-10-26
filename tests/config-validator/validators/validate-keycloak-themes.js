/**
 * Every file a Keycloak theme points at has to be on disk.
 *
 * A theme that names a stylesheet, a logo or an image that is not there
 * fails silently: the page loads, the masthead shows a broken image,
 * the band that should be under the form never appears. Nothing in
 * Keycloak reports it. These checks turn that silence into a red job.
 *
 * Two contracts live here:
 *
 * - a reference resolves to a file that exists;
 * - the email templates carry no `cid:` image. Keycloak attaches
 *   nothing to an email, so a `cid:` reference is a broken image in
 *   every mail client — the images are fetched from the theme's own
 *   resources over HTTP instead.
 *
 * The reading of a theme follows Keycloak's own:
 *
 * - `theme.properties` is a Java properties file: a `:` separator and a
 *   backslash continuation are as valid as `=`, and the value carries
 *   the escapes Java resolves.
 * - A theme's files are looked for in the theme itself and in the
 *   ancestors it inherits from, within the same theme type. A child
 *   theme serves the parent's stylesheets and the parent's images, so a
 *   file the child borrows is not a broken reference.
 */
const fs = require('fs');
const path = require('path');

const THEMES_DIR = path.join('configs', 'keycloak', 'themes');

// The theme types Keycloak serves. A theme provides the ones it has
// directories for; the others are served by the built-in parent.
const THEME_TYPES = ['login', 'admin', 'account', 'email', 'welcome', 'common'];

// The properties that name a file of the theme. `logoUrl` holds an
// absolute URL and `favIconType` a mime type: neither names a file, so
// neither is checked.
const STYLE_PROPERTIES = ['styles', 'stylesCommon'];
const SCRIPT_PROPERTIES = ['scripts'];
const IMAGE_PROPERTIES = ['logo', 'favIcon'];

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
 * The escapes Java's properties loader resolves into a single character.
 */
const SIMPLE_ESCAPES = { t: '\t', n: '\n', r: '\r', f: '\f' };

/**
 * The escapes Java's properties loader resolves.
 *
 * @param {string} value the raw value
 * @returns {string} the unescaped value
 */
function unescape(value) {
  let result = '';
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char !== '\\') {
      result += char;
      continue;
    }
    const escaped = value[index + 1];
    index += 1;
    if (escaped !== undefined && Object.hasOwn(SIMPLE_ESCAPES, escaped)) {
      result += SIMPLE_ESCAPES[escaped];
    } else if (escaped === 'u') {
      const code = value.slice(index + 1, index + 5);
      if (/^[0-9a-fA-F]{4}$/.test(code)) {
        result += String.fromCharCode(parseInt(code, 16));
        index += 4;
      } else {
        result += 'u';
      }
    } else if (escaped === undefined) {
      // A backslash at the end of the value stands for itself.
      result += '\\';
    } else {
      result += escaped;
    }
  }
  return result;
}

/**
 * Whether a line ends with an odd number of backslashes — a backslash
 * continuation, which joins the next line to this one.
 *
 * @param {string} text the line
 * @returns {boolean} true when the line continues on the next one
 */
function endsWithContinuation(text) {
  let backslashes = 0;
  for (let index = text.length - 1; index >= 0 && text[index] === '\\'; index -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

/**
 * One logical line of a properties file, joined across the backslash
 * continuations it ends with.
 *
 * @param {string[]} lines the file's lines
 * @param {number} start the first line of the logical line
 * @returns {{text: string, next: number}} the joined line, and the line
 *          the next logical line starts at
 */
function readLogicalLine(lines, start) {
  let text = lines[start].replace(/^[ \t\f]+/, '');
  let index = start;
  while (endsWithContinuation(text) && index + 1 < lines.length) {
    text = text.slice(0, -1) + lines[index + 1].replace(/^[ \t\f]+/, '');
    index += 1;
  }
  return { text, next: index + 1 };
}

/**
 * The key and the value of a logical line. The separator is the first
 * unescaped `=`, `:` or whitespace; a line without one is a key with an
 * empty value.
 *
 * @param {string} line the logical line
 * @returns {[string, string]} the key and the value
 */
function splitProperty(line) {
  let separator = -1;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '\\') {
      index += 1;
      continue;
    }
    if (char === '=' || char === ':' || /\s/.test(char)) {
      separator = index;
      break;
    }
  }
  if (separator < 0) return [unescape(line), ''];
  const key = line.slice(0, separator);
  const value = line.slice(separator + 1).replace(/^[ \t\f]+/, '');
  return [unescape(key), unescape(value)];
}

/**
 * The `key=value` pairs of a theme.properties file, read the way
 * Keycloak reads them.
 *
 * @param {string} file path of the file
 * @returns {Object} the properties
 */
function readProperties(file) {
  const properties = {};
  const lines = fs.readFileSync(file, 'utf8').split(/\r\n|\r|\n/);
  let index = 0;
  while (index < lines.length) {
    const logical = readLogicalLine(lines, index);
    index = logical.next;
    const line = logical.text.trim();
    if (!line || line.startsWith('#') || line.startsWith('!')) continue;
    const [key, value] = splitProperty(line);
    if (key) properties[key] = value;
  }
  return properties;
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
 * @returns {{name: string, typeDir: string, properties: Object}[]} the
 *          chain, nearest first
 */
function themeChain(themesDir, theme, type) {
  const chain = [];
  const seen = new Set();
  let name = theme;
  while (name && !seen.has(name)) {
    seen.add(name);
    const typeDir = path.join(themesDir, name, type);
    if (!isDirectory(typeDir)) break;
    const propertiesFile = path.join(typeDir, 'theme.properties');
    const properties = isFile(propertiesFile) ? readProperties(propertiesFile) : {};
    chain.push({ name, typeDir, properties });
    name = properties.parent;
  }
  return chain;
}

/**
 * The file a theme's chain holds for a path relative to a theme's
 * resources directory.
 *
 * @param {{typeDir: string}[]} chain the theme's chain
 * @param {string} relative the path, relative to the resources directory
 * @returns {{file: string, root: string}|null} the file and the
 *          resources directory it was found in
 */
function findInChain(chain, relative) {
  for (const entry of chain) {
    const root = path.join(entry.typeDir, 'resources');
    const file = path.join(root, relative);
    if (isFile(file)) return { file, root };
  }
  return null;
}

/**
 * The path of a file relative to the resources directory it lives in, as
 * a forward-slashed path. A file outside that directory is not a
 * resource of the theme.
 *
 * @param {string} root the resources directory
 * @param {string} file the absolute path of the file
 * @returns {string|null} the relative path, or null when the file is
 *          outside the resources directory
 */
function relativeToResources(root, file) {
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
 * @param {{typeDir: string}[]} chain the theme's chain
 * @param {Function} report reports a broken reference
 * @param {Set<string>} seen the stylesheets already checked
 */
function checkStylesheet(found, chain, report, seen) {
  if (seen.has(found.file)) return;
  seen.add(found.file);
  const source = stripComments(fs.readFileSync(found.file, 'utf8'), 'stylesheet');

  for (const reference of readAssetReferences(source)) {
    if (isExternalReference(reference)) continue;
    const relative = relativeToResources(found.root, path.resolve(path.dirname(found.file), reference));
    if (!relative) continue;
    if (!findInChain(chain, relative)) report('asset', reference);
  }

  for (const reference of readImports(source)) {
    if (isExternalReference(reference)) continue;
    const relative = relativeToResources(found.root, path.resolve(path.dirname(found.file), reference));
    if (!relative) continue;
    const imported = findInChain(chain, relative);
    if (!imported) {
      report('import', reference);
      continue;
    }
    checkStylesheet(imported, chain, report, seen);
  }
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

  for (const theme of fs.readdirSync(themesDir)) {
    const themeDir = path.join(themesDir, theme);
    if (!isDirectory(themeDir)) continue;

    for (const type of THEME_TYPES) {
      const typeDir = path.join(themeDir, type);
      if (!isDirectory(typeDir)) continue;
      const propertiesFile = path.join(typeDir, 'theme.properties');
      if (!isFile(propertiesFile)) continue;
      const properties = readProperties(propertiesFile);
      const chain = themeChain(themesDir, theme, type);

      const report = (kind, reference) => {
        issues.push({ theme, type, kind, reference });
      };

      // The logo and the favicon the page header asks for.
      for (const key of IMAGE_PROPERTIES) {
        const value = properties[key];
        if (!value || isExternalReference(value)) continue;
        const resource = value.replace(/^\//, '');
        if (!findInChain(chain, resource)) {
          report(key, value);
        }
      }

      // The stylesheets and the scripts the page loads, and the images
      // they name.
      for (const key of [...STYLE_PROPERTIES, ...SCRIPT_PROPERTIES]) {
        for (const name of (properties[key] || '').split(/\s+/).filter(Boolean)) {
          const found = findInChain(chain, name);
          if (!found) {
            report(key, name);
            continue;
          }
          if (key !== 'scripts') checkStylesheet(found, chain, report, new Set());
        }
      }

      // The templates: no `cid:` image, and every image a template
      // names has to be in the theme's resources.
      for (const template of themeTemplates(typeDir)) {
        const source = stripComments(fs.readFileSync(template, 'utf8'), 'template');
        for (const match of source.matchAll(/cid:([A-Za-z0-9._/-]+)/gi)) {
          report('cid', match[1]);
        }
        // The theme owns its images; the scripts and stylesheets it
        // names come from the parent theme, which lives in the image.
        for (const reference of readAssetReferences(source)) {
          const resource = reference.replace(/^\//, '');
          if (!resource.startsWith('img/')) continue;
          if (!findInChain(chain, resource)) {
            report('asset', reference);
          }
        }
      }
    }
  }
  return issues;
}

module.exports = { collectThemeIssues, readAssetReferences, readProperties, themeChain };
