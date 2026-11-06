const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '../../..');
const E2E_ROOT = path.join(ROOT, 'tests/e2e');

// The gate is DEFAULT-ON: every .js file under tests/e2e/ is scanned,
// and a file is exempt only while it still carries grandfathered class
// locators. A NEW spec therefore lands inside the gate automatically —
// writing class locators into it fails the same pipeline that runs the
// spec. A file leaves the exemption list in the MR that converts it
// (the standing "migrated when next touched" rule); from then on any
// class locator in it, named or not, is an offender. Coverage cannot
// lag by forgetting a name OR a file.
const CONVERTED_FILES = [
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
  'tests/e2e/helpers/layout.js',
  'tests/e2e/helpers/welcome.js',
  'tests/e2e/capture-dashboard.js'
];

// Locator-style APIs a class selector can travel through: the locator
// object, the DOM queries (including the $eval variants, which take a
// selector first), the wait, the page-level $ shorthands, and the
// action APIs whose FIRST argument is always a selector (click, hover,
// check, ...). `fill`/`press`/`type` are deliberately absent — on a
// locator their argument is input text, not a selector, and a '.md'
// filename would false-positive. A selector built in a variable and
// passed indirectly escapes this net — in the converted files every
// locator call takes its selector literally.
const LOCATOR_CALL =
  /(?:locator|querySelector|querySelectorAll|waitForSelector|click|dblclick|tap|hover|check|uncheck|dragAndDrop|setInputFiles|frameLocator|\$\$?eval|\$\$?)\(\s*/;

// Inside a locator argument the string IS a CSS selector, so every
// dot-name in it is a class segment (`'.chat-message.bot'` is two) —
// unlike in ordinary code, where `.padEnd` is a method call. Attribute
// values are stripped first: a dot inside `[data-x="a.b"]` is data, not
// a class, in either quote spelling. Class names are matched
// case-insensitively to the HTML class attribute (a `.ChatWindow`
// locator is as much a class coupling as a lowercase one). The trailing
// guard keeps `.sidebar` from matching inside `.sidebar-inner`.
const CLASS_SELECTOR = /\.([a-zA-Z][a-zA-Z0-9_-]*)(?![a-zA-Z0-9_-])/g;

const classSelectorsIn = (source) => {
  const found = [];
  // Quoted strings, in all three spellings, with their contents. The
  // argument scan is anchored on the call opening before the quote, so a
  // `.js` extension or a `.padEnd(4)` inside an unrelated template
  // string is not a locator and does not trip the gate.
  for (const call of source.matchAll(new RegExp(LOCATOR_CALL.source + /(['"`])(?:\\.|(?!\1)[^\\])*\1/.source, 'g'))) {
    const selector = call[0].replace(/=("[^"]*"|'[^']*')/g, '=""');
    for (const m of selector.matchAll(CLASS_SELECTOR)) {
      found.push({ className: m[1], quoted: call[0] });
    }
  }
  return found;
};

// Comments are prose about the code, not the code: a comment that names
// the class the handle replaced must not fail the gate. One pass over
// the whole source — string state (including multi-line template
// literals) must survive across lines, or a `//` inside a backtick
// template would cut real locator code as a comment. A `//` inside a
// string (a URL) is not a comment, so the scanner skips those. A `/`
// that OPENS a regex literal is not a comment either: the classic
// heuristic (JSLint's) says a slash after `(,=:[!&|?{};` or line start
// or an operator is a regex, one after an identifier/`)`/`]` is
// division — a quote inside the regex therefore cannot flip the
// scanner into string state.
const stripComments = (source) => {
  let out = '';
  let state = null; // null | "'" | '"' | '`' | '/'
  let prevSignificant = ''; // last non-whitespace character kept
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
      continue;
    }
    if (ch === '/') {
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
      const regexStart = '(,=:[!&|?{};+-*%~^<>'.includes(prevSignificant) || prevSignificant === '';
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
    if (!/\s/.test(ch)) prevSignificant = ch;
  }
  return out;
};

describe('the e2e suite locates application elements by declared handle', () => {
  test('a file outside the grandfathered list locates no element by class', () => {
    const offenders = [];
    const files = fs
      .readdirSync(E2E_ROOT, { recursive: true })
      .filter((f) => f.endsWith('.js'))
      .map((f) => path.join(E2E_ROOT, f))
      .sort();
    for (const file of files) {
      const rel = path.relative(ROOT, file);
      if (!CONVERTED_FILES.includes(rel)) continue; // grandfathered
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

  test('every converted file exists and is a real path under tests/e2e', () => {
    // The converted set is what KEEPS a file inside the default-on gate;
    // a listed path that has drifted away (renamed, deleted) would
    // silently drop that file back under the grandfathered umbrella —
    // reading every one of them is what keeps the set honest.
    for (const rel of CONVERTED_FILES) {
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

  test('a mixed-quote attribute value inside a selector is not an offender', () => {
    const sample = "page.locator('[data-x='a.b']')";
    expect(classSelectorsIn(sample)).toEqual([]);
  });

  test('an uppercase class locator is an offender', () => {
    const sample = "page.locator('.ChatWindow')";
    expect(classSelectorsIn(sample).map((o) => o.className)).toEqual(['ChatWindow']);
  });

  test('a class locator after a // inside a template literal is an offender', () => {
    const sample = "const s = `x // `;\nawait page.click('.chat-composer');";
    expect(classSelectorsIn(stripComments(sample)).map((o) => o.className)).toEqual(['chat-composer']);
  });

  test('a quote inside a regex literal does not corrupt the stripper', () => {
    // The failure this pins: the quote flips the scanner into string
    // state, the following // comment is preserved, and a prose locator
    // citation inside it fails the gate on an unrelated MR.
    const sample = [
      'const url = /^url(["\']?/) ;',
      "// a prose citation: page.locator('.old-class') is gone",
      "await page.click('.chat-composer');"
    ].join('\n');
    expect(classSelectorsIn(stripComments(sample)).map((o) => o.className)).toEqual(['chat-composer']);
  });

  test('a $eval selector is an offender', () => {
    const sample = "await page.$eval('.chat-composer', (el) => el.value);";
    expect(classSelectorsIn(sample).map((o) => o.className)).toEqual(['chat-composer']);
  });

  test('an extension or method call in a template string is not an offender', () => {
    const sample = 'const f = `${locale}.js`; x.padEnd(4);';
    expect(classSelectorsIn(sample)).toEqual([]);
  });
});
