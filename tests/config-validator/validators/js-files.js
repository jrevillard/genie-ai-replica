// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
const fs = require('fs');
const path = require('path');

/**
 * Every .js file under a root, with the dependency tree pruned.
 *
 * The tree under tests/e2e holds hundreds of .js files inside
 * node_modules — a copy of a contract inside a dependency is not a drift
 * these gates are for, and reading them costs time on every run.
 *
 * The pruning happens on the RESULT, before anything is read: the
 * recursive listing names the dependency files, and they are filtered out
 * here — the gates never open them.
 *
 * @param {string} root - the directory to walk
 * @returns {string[]} the absolute paths of the .js files
 */
const jsFiles = (root) =>
  fs
    .readdirSync(root, { recursive: true })
    .filter((entry) => entry.endsWith('.js'))
    .filter((entry) => !entry.split(path.sep).includes('node_modules'))
    .map((entry) => path.join(root, entry));

// Comments are prose about the code, not the code: a comment that names
// the contract a gate watches must not fail that gate. One pass over the
// whole source — string state (including multi-line template literals)
// must survive across lines, or a `//` inside a backtick template would
// cut real code as a comment. A `//` inside a string (a URL) is not a
// comment, so the scanner skips those. A `/` that OPENS a regex literal
// is not a comment either: the classic heuristic (JSLint's) says a
// slash after `(,=:[!&|?{};` or line start or an operator is a regex,
// one after an identifier/`)`/`]` is division — a quote inside the regex
// therefore cannot flip the scanner into string state.
//
// (The sibling handle-locators gate keeps its own copy of this scanner:
// this one knows a regex may follow a keyword, the sibling's does not.
// Consolidating the two is a separate cleanup, in the wave that owns that
// file.)
const stripJsComments = (source) => {
  let out = '';
  let state = null; // null | "'" | '"' | '`' | '/'
  let prevSignificant = ''; // last non-whitespace character kept
  let wordBuffer = ''; // the word being read
  let lastWord = ''; // the last COMPLETED word
  let wordAfterDot = false; // was that word a member name (obj.return)?
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (state && state !== '/') {
      out += ch;
      if (ch === '\\') {
        out += source[i + 1] || '';
        i++;
      } else if (ch === state) {
        state = null;
      }
      continue;
    }
    if (state === '/') {
      // Inside a regex literal: a `\` escapes the next character.
      out += ch;
      if (ch === '\\') {
        out += source[i + 1] || '';
        i++;
      } else if (ch === '/') {
        state = null;
        prevSignificant = ch;
      }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      state = ch;
      out += ch;
      prevSignificant = ch;
      wordBuffer = '';
      continue;
    }
    if (ch === '/') {
      // The word before the slash is complete: flush it before the
      // regex heuristic looks at it.
      if (wordBuffer) {
        lastWord = wordBuffer;
        wordBuffer = '';
      }
      if (source[i + 1] === '/') {
        while (i < source.length && source[i] !== '\n') i++;
        out += '\n';
        continue;
      }
      if (source[i + 1] === '*') {
        const end = source.indexOf('*/', i + 2);
        i = end === -1 ? source.length : end + 1;
        continue;
      }
      // A regex literal can follow a keyword too: `return /…/` is a
      // regex, not a division — reading it as division flips the scanner
      // into string state and the rest of the file (comments included)
      // survives the strip.
      const regexStart =
        '(,=:[!&|?{};+-*%~^<>'.includes(prevSignificant) ||
        prevSignificant === '' ||
        // A keyword may open a regex — but only as a STANDALONE word:
        // `obj.return / 2` is a division.
        (!wordAfterDot &&
          ['return', 'typeof', 'case', 'in', 'of', 'new', 'delete', 'void', 'do', 'else', 'yield', 'await'].includes(
            lastWord
          ));
      if (regexStart && source[i + 1] !== '=') {
        state = '/';
        out += ch;
        continue;
      }
      out += ch;
      prevSignificant = ch;
      continue;
    }
    out += ch;
    // The character BEFORE this one — the word's first character reads
    // it, to know whether the word is a member name (obj.return).
    const before = prevSignificant;
    if (!/\s/.test(ch)) prevSignificant = ch;
    if (/[A-Za-z0-9_$]/.test(ch)) {
      // The first character of a word: what came before it decides
      // whether it is a member name (obj.return) or a keyword.
      if (!wordBuffer) wordAfterDot = before === '.';
      wordBuffer += ch;
    } else {
      // Whitespace ENDS the word (a keyword may be followed by a
      // space); the completed word is what the regex heuristic reads.
      if (wordBuffer) {
        lastWord = wordBuffer;
        wordBuffer = '';
      }
    }
  }
  return out;
};

module.exports = { jsFiles, stripJsComments };
