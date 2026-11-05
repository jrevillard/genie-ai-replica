const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '../../..');
const E2E_ROOT = path.join(ROOT, 'tests/e2e');

// The classes issue #1406 migrated to declared test handles. A spec
// that locates one of them by class again is the defect the migration
// removed: a frontend restyle renaming the class breaks the wait with a
// failure that says nothing about the behaviour the wait guards.
// Every class whose locator the handle migration eliminated from the
// suite — the full set, not a sample: a gate that covers a third of the
// migration lets the other two thirds quietly re-couple to a class.
// (Classes the migration never touched — the grandfathered documents
// and admin locators — are deliberately absent; they are tracked for
// migration-when-next-touched, and listing them here would red the gate
// on files this migration never converted.)
const MIGRATED_CLASSES = [
  'answer-card',
  'answer-sources__list',
  'answer-warning',
  'brand-name',
  'brand-wordmark',
  'chat-composer',
  'chat-input',
  'chat-message',
  'chat-window',
  'chatbot-container',
  'config-error',
  'context-items',
  'context-panel',
  'conversation-header',
  'conversation-header__actions',
  'dashboard-content',
  'ds-state__hint',
  'ds-state__message',
  'filter-select',
  'genie-living-intelligence',
  'icon-btn',
  'just-chat',
  'language-select-container',
  'loading-spinner',
  'main-container',
  'message-avatar--assistant',
  'message-avatar__initials',
  'message-avatar--user',
  'message-bubble',
  'message-time',
  'nav-bar',
  'nav-right',
  'prompt-textarea',
  'quick-help-banner',
  'quick-help-composer',
  'quick-help-content',
  'quick-help-grid',
  'quick-help-heading',
  'quick-help-item',
  'quick-help-overlay',
  'quick-help-subtitle',
  'side-bar',
  'sidebar',
  'sidebar-handle',
  'sidebar-handle__button',
  'splash-screen',
  'status-error-message',
  'streaming-indicator',
  'table-message',
  'tooltip'
];

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
      // No exemption for strings that also carry a handle: a mixed
      // locator ('.chat-message.bot [data-testid="answer-error"]') is
      // still a class coupling, and the handle in it must not buy the
      // class a pass.
      if (pattern.test(body)) {
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
