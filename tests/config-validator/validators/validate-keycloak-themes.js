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
 */
const fs = require('fs');
const path = require('path');

const THEMES_DIR = path.join('configs', 'keycloak', 'themes');
const THEME_TYPES = ['login', 'admin', 'account', 'email'];

/**
 * The `key=value` pairs of a theme.properties file.
 *
 * @param {string} file path of the file
 * @returns {Object} the properties, lowercased keys
 */
function readProperties(file) {
  const properties = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('!')) continue;
    const separator = trimmed.indexOf('=');
    if (separator < 0) continue;
    properties[trimmed.slice(0, separator).trim()] = trimmed.slice(separator + 1).trim();
  }
  return properties;
}

/**
 * The images a stylesheet or a template points at, as paths relative to
 * the theme's resources directory.
 *
 * A stylesheet names them with `url(...)`; an email template names them
 * with the theme's own resource URL.
 *
 * @param {string} source the file's content
 * @returns {string[]} the referenced resource paths
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
 * Check every theme in the repository.
 *
 * @param {string} root repository root
 * @returns {{theme: string, type: string, kind: string, reference: string}[]}
 *          one entry per broken reference
 */
function collectThemeIssues(root) {
  const issues = [];
  const themesDir = path.join(root, THEMES_DIR);
  if (!fs.existsSync(themesDir)) return issues;

  for (const theme of fs.readdirSync(themesDir)) {
    const themeDir = path.join(themesDir, theme);
    if (!fs.statSync(themeDir).isDirectory()) continue;

    for (const type of THEME_TYPES) {
      const typeDir = path.join(themeDir, type);
      if (!fs.existsSync(typeDir)) continue;
      const resourcesDir = path.join(typeDir, 'resources');
      const propertiesFile = path.join(typeDir, 'theme.properties');
      if (!fs.existsSync(propertiesFile)) continue;
      const properties = readProperties(propertiesFile);

      const report = (kind, reference) => {
        issues.push({ theme, type, kind, reference });
      };

      // The logo and the favicon the page header asks for.
      for (const key of ['logo', 'favicon']) {
        const value = properties[key];
        if (!value) continue;
        const resource = value.replace(/^\//, '');
        if (!fs.existsSync(path.join(resourcesDir, resource))) {
          report(key, value);
        }
      }

      // The stylesheets the page loads, and the images they name.
      const styles = `${properties.styles || ''} ${properties.stylesCommon || ''}`.split(/\s+/).filter(Boolean);
      for (const style of styles) {
        const styleFile = path.join(resourcesDir, style);
        if (!fs.existsSync(styleFile)) {
          report('styles', style);
          continue;
        }
        for (const reference of readAssetReferences(fs.readFileSync(styleFile, 'utf8'))) {
          // An absolute URL or an inline value is not a file of the theme.
          if (/^(https?:)?\/\//.test(reference) || reference.startsWith('#')) continue;
          if (/^[a-z][a-z0-9+.-]*:/i.test(reference)) continue;
          const resolved = path.resolve(path.dirname(styleFile), reference);
          if (!fs.existsSync(resolved)) {
            report('asset', reference);
          }
        }
      }

      // The templates: no `cid:` image, and every image a template
      // names has to be in the theme's resources.
      const templates = [];
      for (const file of fs.readdirSync(typeDir)) {
        if (file.endsWith('.ftl')) templates.push(path.join(typeDir, file));
      }
      const htmlDir = path.join(typeDir, 'html');
      if (fs.existsSync(htmlDir)) {
        for (const file of fs.readdirSync(htmlDir)) {
          if (file.endsWith('.ftl')) templates.push(path.join(htmlDir, file));
        }
      }
      for (const template of templates) {
        // A comment is not output: a `cid:` that survives only in one
        // is not a `cid:` the mail carries.
        const source = fs.readFileSync(template, 'utf8').replace(/<#--[\s\S]*?-->/g, '');
        for (const match of source.matchAll(/cid:([A-Za-z0-9._/-]+)/g)) {
          report('cid', match[1]);
        }
        // The theme owns its images; the scripts and stylesheets it
        // names come from the parent theme, which lives in the image.
        for (const reference of readAssetReferences(source)) {
          const resource = reference.replace(/^\//, '');
          if (!resource.startsWith('img/')) continue;
          if (!fs.existsSync(path.join(resourcesDir, resource))) {
            report('asset', reference);
          }
        }
      }
    }
  }
  return issues;
}

module.exports = { collectThemeIssues, readAssetReferences, readProperties };
