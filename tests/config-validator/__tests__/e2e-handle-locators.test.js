const path = require('path');
const fs = require('fs');

const { jsFiles, stripJsComments } = require('../validators/js-files');
const { withTree } = require('../validators/temp-tree');

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
// selector first), the wait, the page-level $ shorthands, the action
// APIs whose FIRST argument is always a selector (click, hover, check,
// ...), and the PAGE/FRAME-level fill/type/press — there the first
// argument IS a selector, so `page.fill('.class', …)` is caught. The
// bare LOCATOR forms (`locator.fill`, `locator.press`) stay absent: on
// those the argument is input text or a key, not a selector, and a
// '.md' filename would false-positive. A selector built in a variable
// and passed indirectly escapes this net — in the scanned files every
// locator call takes its selector literally.
const LOCATOR_CALL =
  /(?:locator|querySelector|querySelectorAll|waitForSelector|click|dblclick|tap|hover|check|uncheck|dragAndDrop|setInputFiles|frameLocator|\$\$?eval|\$\$?|(?:page|frame)\.(?:fill|type|press))\(\s*/;

// Inside a locator argument the string IS a CSS selector, so every
// dot-name in it is a class segment (`'.chat-message.bot'` is two) —
// unlike in ordinary code, where `.padEnd` is a method call. Attribute
// values are stripped first: a dot inside `[data-x="a.b"]` is data, not
// a class, in either quote spelling — EXCEPT a class-matching attribute
// selector, whose value IS the coupling the gate exists for:
// `[class*="chat-message"]` must not survive the blanking. Class names
// are matched case-insensitively to the HTML class attribute (a
// `.ChatWindow` locator is as much a class coupling as a lowercase
// one). The trailing guard keeps `.sidebar` from matching inside
// `.sidebar-inner`.
const CLASS_SELECTOR = /\.([a-zA-Z][a-zA-Z0-9_-]*)(?![a-zA-Z0-9_-])/g;
// The caught spellings: quoted values ([class*="x"] and the ~=, ^=
// and $= siblings) with no surrounding whitespace — unquoted values
// and spaced forms ([class *= "x"]) are valid CSS the heuristic does
// not reach; the gate is a heuristic net, not a parser.
const CLASS_ATTR_SELECTOR = /\[class[*~^$]?=\s*(['"])([a-zA-Z][a-zA-Z0-9_-]*)\1/;

// Quoted selector strings, in all three quote spellings, extracted from
// locator-style calls — the ONE net both scanners read. The argument
// scan is anchored on the call opening before the quote, so a `.js`
// extension or a `.padEnd(4)` inside an unrelated template string is
// not a locator and does not trip the gate. Compiled once at module
// scope instead of once per scanned file (the file's source still runs
// through the net twice per scan pair — once per scanner).
const SELECTOR_STRING_CALL = new RegExp(LOCATOR_CALL.source + /(['"`])(?:\\.|(?!\1)[^\\])*\1/.source, 'g');
const selectorStringsIn = function* (source) {
  for (const call of source.matchAll(SELECTOR_STRING_CALL)) {
    // Cut the call prefix off: the scans below must see only the
    // selector string, so an engine marker (`text=`) anchors on the
    // selector's own start, not on the word that opened the call.
    const raw = call[0].slice(call[0].search(/['"`]/) + 1);
    // Every attribute value is blanked, so a dot inside `[data-x="a.b"]`
    // stays data — the class-matching attribute selectors are the one
    // consumer reading the RAW string (their value IS the coupling).
    yield { quoted: call[0], raw, blanked: raw.replace(/=("[^"]*"|'[^']*')/g, '=""') };
  }
};

const classSelectorsIn = (source) => {
  const found = [];
  for (const { quoted, raw, blanked } of selectorStringsIn(source)) {
    const classAttr = raw.match(CLASS_ATTR_SELECTOR);
    if (classAttr) {
      found.push({ className: classAttr[2], quoted });
    }
    for (const m of blanked.matchAll(CLASS_SELECTOR)) {
      found.push({ className: m[1], quoted });
    }
  }
  return found;
};

// The second rot class: text coupling. A text selector breaks on any
// copy change — a renamed button label, a retranslated heading — and
// the breakage is invisible at review time. THREE shapes are flagged:
// the text-addressing APIs (getByText/getByLabel/getByPlaceholder —
// they couple the test to visible copy or to label/placeholder text),
// the text engines inside a selector string (`text=`, `:has-text()`,
// `:text()`, `:text-is()`), and a `hasText` option on a locator whose
// selector is NOT a declared handle — the contract allows a hasText
// discriminator only on a set a handle already resolved
// (`locator('[data-test-id="…"]', { hasText })` passes). A `.filter({
// hasText })` is NOT flagged: it narrows whatever the chain resolved,
// and seeing the anchor would need chain parsing — that half of the
// rule stays by-contract, not by-gate. `getByRole(..., { name })` is
// the accepted fallback: a role locator survives any redesign.
const TEXT_API_CALL = /\bgetBy(?:Text|Label|Placeholder)\s*\(/g;
// The [^}]* reads the FIRST property block only: a hasText sitting
// behind a nested object in the options escapes — the same
// by-contract-not-by-gate class as the .filter half.
const UNANCHORED_HASTEXT = /locator\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1\s*,\s*\{[^}]*\bhasText/g;
const TEXT_ENGINE = /:has-text\(|:text\(|:text-is\(|(?:^|[\s>(])(text=)/;

const textSelectorsIn = (source) => {
  const found = [];
  for (const m of source.matchAll(TEXT_API_CALL)) {
    found.push({ marker: m[0].trim(), quoted: m[0] });
  }
  for (const m of source.matchAll(UNANCHORED_HASTEXT)) {
    // The accepted form: the hasText narrows a set a declared handle
    // already resolved — the selector carries the anchor.
    if (/^\[data-testid?=/.test(m[2])) continue;
    found.push({
      marker: 'hasText on an unanchored selector',
      quoted: m[0].slice(0, 60)
    });
  }
  for (const { quoted, blanked } of selectorStringsIn(source)) {
    // The engine regex anchors on the blanked selector string, so
    // `click('text=...')` matches at `^`.
    const engine = blanked.match(TEXT_ENGINE);
    if (engine) {
      // The text= alternative captures its token separately: the anchor
      // before it (a `(` in a nested engine call) is context, not part
      // of the marker.
      found.push({ marker: (engine[1] || engine[0]).trim(), quoted });
    }
  }
  return found;
};

// The scanner is the SHARED one (#1800): validators/js-files.js owns the
// comment stripper this gate reads the tree through — the stronger copy
// (it knows a regex may follow a keyword, and a character class may hold
// a slash), and the one the other gates already use. A fix to the
// scanner is made once, where every gate sees it.
const findOffenders = (dir, exemptRel, relBase = dir) => {
  const offenders = [];
  const files = jsFiles(dir).sort();
  for (const file of files) {
    const rel = path.relative(relBase, file);
    if (exemptRel.includes(rel)) continue; // grandfathered — see the list above
    const source = stripJsComments(fs.readFileSync(file, 'utf8'));
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
    expect(classSelectorsIn(stripJsComments(sample)).map((o) => o.className)).toEqual(['chat-composer']);
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
    expect(classSelectorsIn(stripJsComments(sample)).map((o) => o.className)).toEqual(['chat-composer']);
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

  test('a class-coupling attribute selector is an offender', () => {
    // The sample carries BOTH quote spellings (the selector delimiter and
    // the attribute value's), so neither JS quoting avoids escaping — and
    // an escaped spelling would put a backslash into the source the
    // scanner reads, changing what it sees. The template literal keeps
    // the scanner's input literal.
    // eslint-disable-next-line quotes
    const sample = `page.locator('[class*="chat-message"]')`;
    expect(classSelectorsIn(sample).map((o) => o.className)).toEqual(['chat-message']);
  });

  test('a text= nested in a layout engine call is an offender', () => {
    const sample = "await page.click('button:right-of(text=Publish)');";
    expect(textSelectorsIn(sample).map((o) => o.marker)).toEqual(['text=']);
  });

  test('a page-level fill with a class selector is an offender', () => {
    const sample = "await page.fill('.legacy-search', 'hello');";
    expect(classSelectorsIn(sample).map((o) => o.className)).toEqual(['legacy-search']);
  });

  test('a hasText option on an unanchored locator is an offender', () => {
    const sample = "page.locator('td', { hasText: 'Pending' })";
    expect(textSelectorsIn(sample).map((o) => o.marker)).toEqual(['hasText on an unanchored selector']);
  });

  describe('default-on semantics (simulated tree)', () => {
    test('a NEW spec file with a class locator is an offender without being listed', () => {
      withTree('e2e-handle-gate-', { 'new.spec.js': "await page.locator('.fresh-class').count();" }, (root) => {
        const offenders = findOffenders(root, []);
        expect(offenders.length).toBe(1);
        expect(offenders[0]).toContain('new.spec.js');
        expect(offenders[0]).toContain('.fresh-class');
      });
    });

    test('a grandfathered file is not scanned', () => {
      withTree('e2e-handle-gate-', { 'old.js': "await page.locator('.old-class').count();" }, (root) => {
        expect(findOffenders(root, ['old.js'])).toEqual([]);
      });
    });

    test('a text API in a new file is an offender', () => {
      withTree('e2e-handle-gate-', { 'new.spec.js': "await expect(page.getByText('Save')).toBeVisible();" }, (root) => {
        const offenders = findOffenders(root, []);
        expect(offenders.length).toBe(1);
        expect(offenders[0]).toContain('getByText(');
      });
    });

    test('a file using only declared handles produces no offender', () => {
      withTree(
        'e2e-handle-gate-',
        { 'clean.spec.js': 'await page.locator(\'[data-testid="ok-grid"]\').count();' },
        (root) => {
          expect(findOffenders(root, [])).toEqual([]);
        }
      );
    });

    test('a subdirectory file is covered too', () => {
      withTree('e2e-handle-gate-', { 'area/deep.spec.js': "page.waitForSelector('.spinner');" }, (root) => {
        const offenders = findOffenders(root, []);
        expect(offenders.length).toBe(1);
        expect(offenders[0]).toContain(path.join('area', 'deep.spec.js'));
      });
    });

    test('an installed dependency tree is not scanned', () => {
      // CI runs `npm ci` inside tests/e2e/: without the prune, the gate
      // regex-scans the whole dependency tree (and any bundled example
      // locator in it) on every run. The prune lives in jsFiles.
      withTree('e2e-handle-gate-', { 'node_modules/pkg/index.js': "page.locator('.bundled-class');" }, (root) => {
        expect(findOffenders(root, [])).toEqual([]);
      });
    });
  });
});
