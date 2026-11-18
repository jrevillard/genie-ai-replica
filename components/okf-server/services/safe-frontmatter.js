// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Front-matter parsing that CANNOT execute code.
//
// gray-matter picks its parser from the TEXT right after the opening
// delimiter: a document that starts with "---js" (or "---javascript")
// selects the JavaScript engine, which eval()s the front matter
// (CVE-2026-78847 — every published version is affected, there is no
// upstream fix). The documents parsed here come from crawls, imports and
// uploads, so that path is reachable: an attacker-controlled document
// would execute code inside this container.
//
// Two barriers, both cheap:
//   1. only YAML and JSON front matter is accepted — any other declared
//      language is refused with a clear error, and nothing is evaluated;
//   2. the code-executing engines are unregistered, so a path that still
//      reaches gray-matter's own dispatch throws instead of evaluating.
//
// `stringify` is not affected: it writes YAML, it never parses.

const matter = require('gray-matter');

// gray-matter reads the language from the line right after the opening
// delimiter ("---js", "--- javascript", ...). A bare "---" declares none.
const LANGUAGE_MARKER = /^---[ \t]*([A-Za-z0-9_+-]*)[ \t]*\r?\n/;

const ALLOWED_LANGUAGES = new Set(['', 'yaml', 'yml', 'json']);

/**
 * The front-matter language a document declares, or '' when it declares
 * none. Mirrors gray-matter's own detection (the text after the opening
 * delimiter, up to the first newline, trimmed).
 *
 * @param {string} content - the raw document
 * @returns {string} the declared language, lowercased ('' = none)
 */
function declaredLanguage(content) {
  const match = LANGUAGE_MARKER.exec(content == null ? '' : String(content));
  return match ? match[1].trim().toLowerCase() : '';
}

/**
 * Parse front matter without ever evaluating it.
 *
 * @param {string} content - the raw document (delimiters included)
 * @param {object} [options] - gray-matter options
 * @returns {object} the parsed file (data / content / excerpt)
 * @throws {Error} when the document declares a language that can execute code
 */
function safeMatter(content, options = {}) {
  const language = declaredLanguage(content);
  if (!ALLOWED_LANGUAGES.has(language)) {
    throw new Error(`Front matter language "${language}" is not allowed (only yaml and json are)`);
  }
  return matter(content, {
    ...options,
    // Ours last: a caller cannot re-enable an engine we just disabled.
    // gray-matter merges the default engines with ours, so `false` here
    // replaces the eval()-based ones and their dispatch throws.
    engines: { ...(options.engines || {}), javascript: false, coffee: false }
  });
}

/**
 * Serialize a document with its front matter. Writing YAML never
 * evaluates anything — this wrapper exists so that NO service has to
 * require gray-matter directly (the guard test asserts it), which keeps
 * the parse path impossible to reopen by accident.
 *
 * @param {string} content - the document body
 * @param {object} data - the front matter
 * @param {object} [options] - gray-matter options
 * @returns {string} the document, front matter included
 */
function stringify(content, data, options = {}) {
  return matter.stringify(content, data, options);
}

module.exports = { safeMatter, stringify, declaredLanguage };
