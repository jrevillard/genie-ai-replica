// Front-matter parsing that CANNOT execute code.
//
// gray-matter picks its parser from the TEXT right after the opening
// delimiter: a document that starts with "---js" selects the JavaScript
// engine, which eval()s the front matter (CVE-2026-78847 — every published
// version is affected, there is no upstream fix). The documents that reach
// this code come from crawls, imports, uploads and pasted content, so that
// path is reachable: a document would execute attacker JavaScript in the
// steward's browser, with the admin session.
//
// Two barriers, both cheap:
//   1. only YAML and JSON front matter is accepted — any other declared
//      language is refused with a clear error, and nothing is evaluated;
//   2. the code-executing engines are unregistered, so a path that still
//      reaches gray-matter's own dispatch throws instead of evaluating.
//
// stringify needs the barrier too: gray-matter PARSES a string content
// before writing it (index.js:161), so matter.stringify('---js\\n…')
// evaluates the string — the whitelist alone would not close that path.
//
// The server-side counterpart is components/okf-server/services/safe-frontmatter.js
// (same two barriers, same reasoning).

import matter from 'gray-matter';

const DELIMITER = '---';

// gray-matter strips the BOM, then takes the language from the text right
// after the opening delimiter, up to the first newline, trimmed.
function declaredLanguage(content) {
  const text = String(content == null ? '' : content).replace(/^\uFEFF/, '');
  if (!text.startsWith(DELIMITER)) return '';
  const after = text.slice(DELIMITER.length);
  const newline = after.search(/\r?\n/);
  const line = newline === -1 ? after : after.slice(0, newline);
  return line.trim().toLowerCase();
}

const ALLOWED_LANGUAGES = new Set(['', 'yaml', 'yml', 'json']);

// The engines that can EXECUTE code are unregistered: gray-matter merges the
// default engines with the caller's, so `false` here replaces the eval-based
// ones and their dispatch throws instead of evaluating.
function safeEngines(options) {
  return { ...(options.engines || {}), javascript: false, coffee: false };
}

/**
 * Parse front matter without ever evaluating it.
 *
 * @param {string} content - the raw document (delimiters included)
 * @param {object} [options] - gray-matter options
 * @returns {object} the parsed file (data / content / excerpt)
 * @throws {Error} when the document declares a language that can execute code
 */
export function safeMatter(content, options = {}) {
  const language = declaredLanguage(content);
  if (!ALLOWED_LANGUAGES.has(language)) {
    throw new Error(`Front matter language "${language}" is not allowed (only yaml and json are)`);
  }
  return matter(content, { ...options, engines: safeEngines(options) });
}

/**
 * Serialize a document with its front matter, without ever evaluating the
 * content it is given.
 *
 * @param {string} content - the document body
 * @param {object} data - the front matter
 * @param {object} [options] - gray-matter options
 * @returns {string} the document, front matter included
 */
export function safeStringify(content, data, options = {}) {
  return matter.stringify(content, data, { ...options, engines: safeEngines(options) });
}

export { declaredLanguage };
