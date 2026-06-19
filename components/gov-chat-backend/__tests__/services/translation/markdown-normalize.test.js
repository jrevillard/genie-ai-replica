const { normalizeInlineSpacing } = require('../../../services/translation/markdown-normalize');

// Helpers to build synthetic remark AST fragments.
const text = (value) => ({ type: 'text', value });
const strong = (...children) => ({ type: 'strong', children });
const para = (...children) => ({ type: 'paragraph', children });
const root = (...children) => ({ type: 'root', children });

describe('normalizeInlineSpacing', () => {
  test('injects a space when strong is directly followed by Latin text (run-in bold)', () => {
    const t = root(para(strong(text('Hive Selection')), text('Choose hives')));
    normalizeInlineSpacing(t);
    expect(t.children[0].children[1].value).toBe(' Choose hives');
  });

  test('does NOT inject when the following text starts with punctuation (colon stays attached)', () => {
    // "**Heading**: text" — the text starts with ":", keep it attached.
    const t = root(para(strong(text('Heading')), text(': the text')));
    normalizeInlineSpacing(t);
    expect(t.children[0].children[1].value).toBe(': the text');
  });

  test('does NOT inject when a space is already present', () => {
    const t = root(para(strong(text('Heading')), text(' the text')));
    normalizeInlineSpacing(t);
    expect(t.children[0].children[1].value).toBe(' the text');
  });

  test('does NOT inject for CJK (no inter-word spaces)', () => {
    const t = root(para(strong(text('标题')), text('内容')));
    normalizeInlineSpacing(t);
    expect(t.children[0].children[1].value).toBe('内容');
  });

  test('does NOT inject for Thai (no inter-word spaces)', () => {
    const t = root(para(strong(text('ส่วนหัว')), text('เนื้อหา')));
    normalizeInlineSpacing(t);
    expect(t.children[0].children[1].value).toBe('เนื้อหา');
  });

  test('injects for Cyrillic and Greek (word-spaced scripts)', () => {
    const ru = root(para(strong(text('Заголовок')), text('текст')));
    normalizeInlineSpacing(ru);
    expect(ru.children[0].children[1].value).toBe(' текст');
  });

  test('handles emphasis (italic) the same as strong', () => {
    const t = root(para({ type: 'emphasis', children: [text('x')] }, text('follows')));
    normalizeInlineSpacing(t);
    expect(t.children[0].children[1].value).toBe(' follows');
  });

  test('walks nested children (list > listItem > paragraph)', () => {
    const t = root({
      type: 'list',
      children: [{ type: 'listItem', children: [para(strong(text('Hive')), text('Choose'))] }]
    });
    normalizeInlineSpacing(t);
    // root > list > listItem > paragraph > [strong, text]
    expect(t.children[0].children[0].children[0].children[1].value).toBe(' Choose');
  });

  test('handles non-strong/non-emphasis siblings (no change)', () => {
    const t = root(para(text('a'), text('b')));
    normalizeInlineSpacing(t);
    expect(t.children[0].children[1].value).toBe('b');
  });

  test('null/degenerate-safe', () => {
    expect(() => normalizeInlineSpacing(null)).not.toThrow();
    expect(() => normalizeInlineSpacing({})).not.toThrow();
    expect(() => normalizeInlineSpacing({ children: [] })).not.toThrow();
  });
});
