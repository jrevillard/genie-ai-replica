const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '../../..');
const E2E_ROOT = path.join(ROOT, 'tests/e2e');

// The spec and helper files the handle migration converted. In a listed
// file, ANY class selector handed to a locator API is an offender: the
// file's elements are all addressable by declared handles, so a class
// there is a coupling the migration removed and a restyle can silently
// break. The check is per FILE, not per class name — a denylist of
// migrated classes lags the migration by construction (a name someone
// forgot to add passes silently), while a file that has joined the set
// is covered completely, named or not.
//
// Files NOT listed still carry grandfathered class locators (documents/,
// admin/, okf/, epic*/, helpers/documents.js, helpers/keycloak-admin.js,
// ...). They are migrated when next touched (the standing rule); a file
// joins this set in the MR that converts it.
const MIGRATED_FILES = [
  'tests/e2e/chat-composer.spec.js',
  'tests/e2e/chat-conversation.spec.js',
  'tests/e2e/resizable-sidebars.spec.js',
  'tests/e2e/responsive-layout.spec.js',
  'tests/e2e/welcome-banner.spec.js',
  'tests/e2e/documents/search.spec.js',
  'tests/e2e/admin/authz.spec.js',
  'tests/e2e/chatbot/error-handling.spec.js',
  'tests/e2e/chatbot/quick-help-scope.spec.js',
  'tests/e2e/chatbot/send-message-and-stream.spec.js',
  'tests/e2e/helpers/chatbot.js',
  'tests/e2e/helpers/welcome.js',
  'tests/e2e/capture-dashboard.js'
];

// Locator-style APIs a class selector can travel through: the locator
// object, the DOM queries, the wait, the page-level $ shorthands, and
// the action APIs whose FIRST argument is always a selector (click,
// hover, check, ...). `fill`/`press`/`type` are deliberately absent —
// on a locator their argument is input text, not a selector, and a
// '.md' filename would false-positive. A selector built in a variable
// and passed indirectly escapes this net — in the converted files every
// locator call takes its selector literally.
const LOCATOR_CALL = /(?:locator|querySelector|querySelectorAll|waitForSelector|click|dblclick|tap|hover|check|uncheck|dragAndDrop|setInputFiles|frameLocator|\$\$?)\(\s*/;

// Inside a locator argument the string IS a CSS selector, so every
// dot-name in it is a class segment (`'.chat-message.bot'` is two) —
// unlike in ordinary code, where `.padEnd` is a method call. Attribute
// values are stripped first: a dot inside `[data-x="a.b"]` is data, not
// a class. The trailing guard keeps `.sidebar` from matching inside the
// single name `.sidebar-inner`.
const CLASS_SELECTOR = /\.([a-z][a-z0-9_-]*)(?![a-z0-9_-])/g;

const classSelectorsIn = (source) => {
  const found = [];
  // Quoted strings, in all three spellings, with their contents. The
  // argument scan is anchored on the call opening before the quote, so a
  // `.js` extension or a `.padEnd(4)` inside an unrelated template
  // string is not a locator and does not trip the gate.
  for (const call of source.matchAll(new RegExp(LOCATOR_CALL.source + /(['"`])(?:\\.|(?!\1)[^\\])*\1/.source, 'g'))) {
    const selector = call[0].replace(/="[^"]*"/g, '=""');
    for (const m of selector.matchAll(CLASS_SELECTOR)) {
      found.push({ className: m[1], quoted: call[0] });
    }
  }
  return found;
};

// Comments are prose about the code, not the code: a comment that names
// the class the handle replaced must not fail the gate. A `//` inside a
// string (a URL) is not a comment, so the stripper skips those.
const stripComments = (source) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => {
      let inString = null;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inString) {
          if (ch === '\\') {
            i++;
            continue;
          }
          if (ch === inString) inString = null;
          continue;
        }
        if (ch === "'" || ch === '"' || ch === '`') {
          inString = ch;
          continue;
        }
        if (ch === '/' && line[i + 1] === '/') return line.slice(0, i);
      }
      return line;
    })
    .join('\n');

describe('the e2e suite locates application elements by declared handle', () => {
  test('a converted file locates no element by class', () => {
    const offenders = [];
    for (const rel of MIGRATED_FILES) {
      const file = path.join(ROOT, rel);
      const source = stripComments(fs.readFileSync(file, 'utf8'));
      for (const { className, quoted } of classSelectorsIn(source)) {
        offenders.push(
          `${rel}: ".${className}" in ${quoted} — the file is converted: ` +
            'use the declared data-testid / data-test-id handle instead'
        );
      }
    }
    expect(offenders).toEqual([]);
  });

  test('every listed file exists', () => {
    // The file set is the guard's coverage: a listed path that has
    // drifted away (renamed, deleted) would silently shrink the gate —
    // reading every one of them is what keeps the set honest.
    for (const rel of MIGRATED_FILES) {
      expect(fs.existsSync(path.join(ROOT, rel))).toBe(true);
    }
  });

  test('the gate would catch a class locator it is meant to catch', () => {
    // A gate that silently matches nothing is worse than no gate.
    const sample = "await page.locator('.some-class').count();";
    const found = classSelectorsIn(sample).map((o) => o.className);
    expect(found).toEqual(['some-class']);
  });

  test('a declared handle is not an offender', () => {
    const sample = 'await page.locator(\'[data-testid="quick-help-grid"]\').count();';
    expect(classSelectorsIn(sample)).toEqual([]);
  });

  test('a class named in prose is not an offender', () => {
    const sample = "test('renders the quick-help-grid', () => {});";
    expect(classSelectorsIn(sample)).toEqual([]);
  });

  test('a mixed locator is still an offender', () => {
    const sample = 'page.locator(\'.chat-message.bot [data-testid="answer-error"]\')';
    expect(classSelectorsIn(sample).map((o) => o.className)).toEqual(['chat-message', 'bot']);
  });

  test('an extension or method call in a template string is not an offender', () => {
    const sample = 'const f = `${locale}.js`; x.padEnd(4);';
    expect(classSelectorsIn(sample)).toEqual([]);
  });
});
