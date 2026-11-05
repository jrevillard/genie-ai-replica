const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '../../..');
const E2E_ROOT = path.join(ROOT, 'tests/e2e');

// The classes issue #1406 migrated to declared test handles. A spec
// that locates one of them by class again is the defect the migration
// removed: a frontend restyle renaming the class breaks the wait with a
// failure that says nothing about the behaviour the wait guards.
const MIGRATED_CLASSES = [
  'chat-composer',
  'quick-help-grid',
  'quick-help-item',
  'quick-help-overlay',
  'quick-help-banner',
  'side-bar',
  'sidebar',
  'chat-message',
  'message-bubble',
  'table-message',
  'tooltip',
  'loading-spinner'
];

// The two attribute spellings the web app declares. Both are valid
// handles; the app picks one per surface.
const HANDLE_ATTRIBUTE = /data-testid|data-test-id/;

// Every quoted string in the file that contains a class selector for one
// of the migrated classes. The quote is required: a class name in prose
// (a test title, a comment) is not a locator.
const classSelectorIn = (source) => {
  const found = [];
  // Quoted strings, in all three spellings, with their contents.
  const quoted = source.matchAll(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g);
  for (const match of quoted) {
    const body = match[0];
    for (const className of MIGRATED_CLASSES) {
      // A class selector is the class name preceded by a dot that is
      // itself not part of an identifier (so `data.sidebar` — a
      // property read — is not a selector) and not followed by a name
      // character (so `.sidebar` does not match `.sidebar-inner`).
      const pattern = new RegExp(`(^|[^A-Za-z0-9_$-])\\.${className}(?![a-z0-9_-])`);
      if (pattern.test(body) && !HANDLE_ATTRIBUTE.test(body)) {
        found.push({ className, quoted: body });
      }
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

function collectJsFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...collectJsFiles(full));
    else if (entry.name.endsWith('.js')) files.push(full);
  }
  return files;
}

describe('the e2e suite locates application elements by declared handle', () => {
  test('no migrated class is used as a locator again', () => {
    const offenders = [];
    for (const file of collectJsFiles(E2E_ROOT)) {
      const source = stripComments(fs.readFileSync(file, 'utf8'));
      for (const { className, quoted } of classSelectorIn(source)) {
        offenders.push(
          `${path.relative(ROOT, file)}: "${className}" in ${quoted} — ` +
            'use the declared data-testid / data-test-id handle instead'
        );
      }
    }
    expect(offenders).toEqual([]);
  });

  test('the gate would catch a class locator it is meant to catch', () => {
    // The list itself is the guard's coverage: if a class is added to
    // MIGRATED_CLASSES the gate must be able to see it. A gate that
    // silently matches nothing is worse than no gate.
    const sample = "await page.locator('.quick-help-grid .quick-help-item').count();";
    const found = classSelectorIn(sample).map((o) => o.className);
    expect(found).toEqual(expect.arrayContaining(['quick-help-grid', 'quick-help-item']));
  });

  test('a declared handle is not an offender', () => {
    const sample = 'await page.locator(\'[data-testid="quick-help-grid"]\').count();';
    expect(classSelectorIn(sample)).toEqual([]);
  });

  test('a class named in prose is not an offender', () => {
    const sample = "test('renders the quick-help-grid', () => {});";
    expect(classSelectorIn(sample)).toEqual([]);
  });
});
