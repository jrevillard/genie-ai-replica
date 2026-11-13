const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.resolve(__dirname, '../../..');
const E2E_ROOT = path.join(ROOT, 'tests/e2e');

// The gate is DEFAULT-ON: every .js file under tests/e2e/ is scanned for
// class selectors and text-selection APIs, and a file is exempt only
// while it is listed in GRANDFATHERED_FILES below — each entry carrying
// its one-line reason and the derived issue that owns its migration
// (#1822 delivered the audit; the derived issues carry the numbers).
// A NEW spec therefore lands inside the gate automatically — writing a
// class locator or a getByText call into it fails the same pipeline
// that runs the spec. A file leaves the list in the MR that converts
// it (the standing "migrated when next touched" rule); from then on
// any offender in it, named or not, fails. Coverage cannot lag by
// forgetting a name OR a file.
const GRANDFATHERED_FILES = [
  // Third-party Swagger UI DOM (the swagger-ui bundle): it declares no
  // test handles and this repo cannot add any — structural selection is
  // the only option on that page. Decision: #1831.
  'tests/e2e/auth/g1-swagger-authorize.spec.js',
  // Screenshot capture script (not a spec). Its remaining class
  // locators are DS state qualifiers, several anchored on declared
  // handles already; they migrate with the okf-ragas family: #1828.
  'tests/e2e/capture-admin.js',
  // OKF ragas family: class selectors on the Studio dashboard cards,
  // the DS modal/tab primitives and the RAGAS panes. Migration: #1828.
  'tests/e2e/okf/ragas-guide-errors.spec.js',
  'tests/e2e/okf/ragas-judge-selector.spec.js',
  'tests/e2e/okf/ragas-rescore-tracking.spec.js',
  // concept-ceiling: two .ds-pill--warning state lookups inside the
  // declared concept-ceiling advisory handle. Migration: #1829.
  'tests/e2e/okf/concept-ceiling.spec.js'
];

// Locator-style APIs a class selector can travel through: the locator
// object, the DOM queries (including the $eval variants, which take a
// selector first), the wait, the page-level $ shorthands, and the
// action APIs whose FIRST argument is always a selector (click, hover,
// check, ...). `fill`/`press`/`type` are deliberately absent — on a
// locator their argument is input text, not a selector, and a '.md'
// filename would false-positive. A selector built in a variable and
// passed indirectly escapes this net — in the scanned files every
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
    // Cut the call prefix off: the scan below must see only the selector
    // string, so an engine marker (`text=`) anchors on the selector's
    // own start, not on the word that opened the call.
    const selector = call[0].slice(call[0].search(/['"`]/) + 1).replace(/=("[^"]*"|'[^']*')/g, '=""');
    for (const m of selector.matchAll(CLASS_SELECTOR)) {
      found.push({ className: m[1], quoted: call[0] });
    }
  }
  return found;
};

// The second rot class: text coupling. A text selector breaks on any
// copy change — a renamed button label, a retranslated heading — and
// the breakage is invisible at review time. Two shapes are flagged:
// the text-addressing APIs (getByText/getByLabel/getByPlaceholder —
// they couple the test to visible copy or to label/placeholder text),
// and the text engines inside a selector string (`text=`, `:has-text()`,
// `:text()`, `:text-is()`). NOT flagged: `getByRole(..., { name })` — a
// role locator survives any redesign and is the accepted fallback when
// no handle exists; and a `hasText` DISCRIMINATOR (`locator(sel, {
// hasText })` / `.filter({ hasText })`) — it narrows a set the selector
// already resolved, typically a declared handle plus test-seeded data,
// so the copy it matches is the test's own, not the design's.
const TEXT_API_CALL = /\bgetBy(?:Text|Label|Placeholder)\s*\(/g;
const TEXT_ENGINE = /:has-text\(|:text\(|:text-is\(|(?:^|[\s>]+)text=/;

const textSelectorsIn = (source) => {
  const found = [];
  for (const m of source.matchAll(TEXT_API_CALL)) {
    found.push({ marker: m[0].trim(), quoted: m[0] });
  }
  for (const call of source.matchAll(new RegExp(LOCATOR_CALL.source + /(['"`])(?:\\.|(?!\1)[^\\])*\1/.source, 'g'))) {
    // Same cut as the class scan: the engine regex anchors on the
    // selector string, so `click('text=...')` matches at `^`.
    const selector = call[0].slice(call[0].search(/['"`]/) + 1).replace(/=("[^"]*"|'[^']*')/g, '=""');
    const engine = selector.match(TEXT_ENGINE);
    if (engine) {
      found.push({ marker: engine[0].trim(), quoted: call[0] });
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

// Walk a tree and return every offender a scanned file carries. `dir`
// is scanned recursively for .js files; `exemptRel` lists the paths
// (relative to `relBase`) that stay grandfathered. The real gate call
// passes the suite root and the repo root; the simulated-tree tests
// pass a temp dir for both, which is how a NEW file is proven covered
// without writing one into the real tree.
const findOffenders = (dir, exemptRel, relBase) => {
  const offenders = [];
  const files = fs
    .readdirSync(dir, { recursive: true })
    .filter((f) => f.endsWith('.js'))
    .map((f) => path.join(dir, f))
    .sort();
  for (const file of files) {
    const rel = path.relative(relBase, file);
    if (exemptRel.includes(rel)) continue; // grandfathered — see the list above
    const source = stripComments(fs.readFileSync(file, 'utf8'));
    for (const { className, quoted } of classSelectorsIn(source)) {
      offenders.push(
        `${rel}: ".${className}" in ${quoted} — use the declared ` + 'data-testid / data-test-id handle instead'
      );
    }
    for (const { marker, quoted } of textSelectorsIn(source)) {
      offenders.push(
        `${rel}: "${marker}" in ${quoted} — a text locator breaks on any ` +
          'copy change: use the declared handle, or a role locator anchored on it'
      );
    }
  }
  return offenders;
};

describe('the e2e suite locates application elements by declared handle', () => {
  test('every scanned file locates no element by class or by text', () => {
    expect(findOffenders(E2E_ROOT, GRANDFATHERED_FILES, ROOT)).toEqual([]);
  });

  test('every grandfathered entry exists and is a real path under tests/e2e', () => {
    // The grandfathered set is what KEEPS a file outside the default-on
    // gate; a listed path that has drifted away (renamed, deleted) would
    // keep covering a file that no longer exists while the migration it
    // documents never happens. Reading every one of them keeps the set
    // honest.
    for (const rel of GRANDFATHERED_FILES) {
      expect(fs.existsSync(path.join(ROOT, rel))).toBe(true);
    }
  });

  test('the gate would catch a class locator it is meant to catch', () => {
    // A gate that silently matches nothing is worse than no gate.
    const sample = "await page.locator('.some-class').count();";
    const found = classSelectorsIn(sample).map((o) => o.className);
    expect(found).toEqual(['some-class']);
  });

  test('the gate would catch a text API it is meant to catch', () => {
    const found = textSelectorsIn("await page.getByText('Upload complete').count();");
    expect(found.map((o) => o.marker)).toEqual(['getByText(']);
  });

  test('a declared handle is not an offender', () => {
    const sample = 'await page.locator(\'[data-testid="quick-help-grid"]\').count();';
    expect(classSelectorsIn(sample)).toEqual([]);
    expect(textSelectorsIn(sample)).toEqual([]);
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

  test('a getByRole name option is not an offender', () => {
    // The accepted fallback: a role locator couples to accessibility,
    // not to design. Its name is copy — allowed with eyes open, per the
    // locator map.
    const sample = "await page.getByRole('button', { name: 'Log out' }).click();";
    expect(textSelectorsIn(sample)).toEqual([]);
  });

  test('a hasText discriminator on a handle-anchored locator is not an offender', () => {
    const option = "page.locator('[data-testid=\"x\"]', { hasText: 'seeded' })";
    const filter = "page.locator('[data-testid=\"x\"]').filter({ hasText: 'seeded' })";
    expect(textSelectorsIn(option)).toEqual([]);
    expect(textSelectorsIn(filter)).toEqual([]);
  });

  test('a text= engine selector is an offender', () => {
    const sample = "await page.click('text=Sign in');";
    expect(textSelectorsIn(sample).map((o) => o.marker)).toEqual(['text=']);
  });

  test('a :has-text pseudo-class inside a selector is an offender', () => {
    const sample = 'await page.locator(\'div:has-text("Save")\').count();';
    expect(textSelectorsIn(sample).map((o) => o.marker)).toEqual([':has-text(']);
  });

  test('a text= inside an attribute value is not an offender', () => {
    const sample = 'page.locator(\'[data-x="text=y"]\')';
    expect(textSelectorsIn(sample)).toEqual([]);
  });

  describe('default-on semantics (simulated tree)', () => {
    let tmp;
    beforeEach(() => {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-handle-gate-'));
    });
    afterEach(() => {
      fs.rmSync(tmp, { recursive: true, force: true });
    });

    test('a NEW spec file with a class locator is an offender without being listed', () => {
      fs.writeFileSync(path.join(tmp, 'new.spec.js'), "await page.locator('.fresh-class').count();");
      const offenders = findOffenders(tmp, [], tmp);
      expect(offenders.length).toBe(1);
      expect(offenders[0]).toContain('new.spec.js');
      expect(offenders[0]).toContain('.fresh-class');
    });

    test('a grandfathered file is not scanned', () => {
      fs.writeFileSync(path.join(tmp, 'old.js'), "await page.locator('.old-class').count();");
      expect(findOffenders(tmp, ['old.js'], tmp)).toEqual([]);
    });

    test('a text API in a new file is an offender', () => {
      fs.writeFileSync(path.join(tmp, 'new.spec.js'), "await expect(page.getByText('Save')).toBeVisible();");
      const offenders = findOffenders(tmp, [], tmp);
      expect(offenders.length).toBe(1);
      expect(offenders[0]).toContain('getByText(');
    });

    test('a file using only declared handles produces no offender', () => {
      fs.writeFileSync(path.join(tmp, 'clean.spec.js'), 'await page.locator(\'[data-testid="ok-grid"]\').count();');
      expect(findOffenders(tmp, [], tmp)).toEqual([]);
    });

    test('a subdirectory file is covered too', () => {
      fs.mkdirSync(path.join(tmp, 'area'));
      fs.writeFileSync(path.join(tmp, 'area', 'deep.spec.js'), "page.waitForSelector('.spinner');");
      const offenders = findOffenders(tmp, [], tmp);
      expect(offenders.length).toBe(1);
      expect(offenders[0]).toContain(path.join('area', 'deep.spec.js'));
    });
  });
});
