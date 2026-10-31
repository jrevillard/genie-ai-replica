'use strict';

/**
 * DsOkfMarkdownEditor — live mode bar + markdown formatting toolbar
 * (David, 2026-09-06): the internal Preview/Split/Source tabs used to emit
 * update:mode with NO listener (dead controls — worst UX defect class), and
 * OKF v0.2 bodies being markdown, users unfamiliar with the syntax need
 * insert-at-selection buttons.
 */

const { mount } = require('@vue/test-utils');
const DsOkfMarkdownEditor = require('@/components/ds/OkfMarkdownEditor.vue').default;

function mountEditor(props) {
  return mount(DsOkfMarkdownEditor, {
    props: Object.assign({ value: '# Title\n\nBody text', mode: 'source', enableFrontmatter: false }, props)
  });
}

beforeEach(() => jest.clearAllMocks());

it('the internal mode bar switches panes LIVE and emits update:mode (dead-bar regression)', async () => {
  const wrapper = mountEditor();
  expect(wrapper.find('.ds-okf-md__preview').exists()).toBe(false); // source only
  await wrapper
    .findAll('.ds-okf-md__mode')
    .filter((b) => b.text() === 'Preview')[0]
    .trigger('click');
  expect(wrapper.vm.currentMode).toBe('preview');
  const activeBtn = wrapper.find('.ds-okf-md__mode--active');
  expect(activeBtn.text()).toBe('Preview'); // the highlight tracks the live mode
  expect(wrapper.emitted('update:mode')).toEqual([['preview']]);
  expect(wrapper.find('.ds-okf-md__preview').exists()).toBe(true);
  expect(wrapper.find('.ds-okf-md__textarea').exists()).toBe(false); // preview only
  // Split shows BOTH panes
  await wrapper
    .findAll('.ds-okf-md__mode')
    .filter((b) => b.text() === 'Split')[0]
    .trigger('click');
  expect(wrapper.find('.ds-okf-md__preview').exists()).toBe(true);
  expect(wrapper.find('.ds-okf-md__textarea').exists()).toBe(true);
});

it('a parent-bound mode prop stays in sync through the internal bar', async () => {
  const wrapper = mountEditor({ mode: 'source' });
  await wrapper.setProps({ mode: 'preview' }); // parent drives
  expect(wrapper.vm.currentMode).toBe('preview');
  expect(wrapper.find('.ds-okf-md__preview').exists()).toBe(true);
});

it('BOLD wraps the textarea selection', async () => {
  const wrapper = mountEditor({ value: 'hello world' });
  const ta = wrapper.find('textarea');
  ta.element.value = 'hello world';
  ta.element.setSelectionRange(6, 11); // 'world'
  await ta.trigger('input');
  const bold = wrapper.findAll('.ds-okf-md__fmt').find((b) => b.text() === 'B');
  await bold.trigger('click');
  const emitted = wrapper.emitted('update:value');
  expect(emitted[emitted.length - 1][0]).toBe('hello **world**');
});

it('a heading prefixes every line of the selection', async () => {
  const wrapper = mountEditor({ value: 'line one\nline two\nline three' });
  const ta = wrapper.find('textarea');
  ta.element.value = wrapper.vm.localValue;
  ta.element.setSelectionRange(0, 17); // the first two lines
  const h2 = wrapper.findAll('.ds-okf-md__fmt').find((b) => b.text() === 'H2');
  await h2.trigger('click');
  const out = wrapper.emitted('update:value').pop()[0];
  expect(out.split('\n')[0]).toBe('## line one');
  expect(out.split('\n')[1]).toBe('## line two');
  expect(out.split('\n')[2]).toBe('line three'); // untouched
});

it('a NUMBERED list numbers each selected line', async () => {
  const wrapper = mountEditor({ value: 'alpha\nbeta' });
  const ta = wrapper.find('textarea');
  ta.element.value = 'alpha\nbeta';
  ta.element.setSelectionRange(0, 10);
  const num = wrapper.findAll('.ds-okf-md__fmt').find((b) => b.text() === '1.');
  await num.trigger('click');
  const out = wrapper.emitted('update:value').pop()[0];
  expect(out).toBe('1. alpha\n2. beta');
});

it('the TABLE action inserts a scaffold at the cursor', async () => {
  const wrapper = mountEditor({ value: 'before after' });
  const ta = wrapper.find('textarea');
  ta.element.value = 'before after';
  ta.element.setSelectionRange(6, 6); // cursor between the words
  const table = wrapper.findAll('.ds-okf-md__fmt').find((b) => b.text() === '▦');
  await table.trigger('click');
  const out = wrapper.emitted('update:value').pop()[0];
  expect(out).toContain('before\n| Column | Column |\n| --- | --- |\n| Value | Value |\n after');
});

it('the toolbar is hidden for readonly editors', () => {
  const wrapper = mountEditor({ readonly: true });
  expect(wrapper.find('.ds-okf-md__format').exists()).toBe(false);
});

it('renders a fenced code block without a language (markdown-it v14 utils fix)', async () => {
  // Regression: MarkdownIt.prototype.utils was removed in v14 — the fence
  // highlighter threw and the whole Rendered pane crashed (2026-09-09).
  // 2026-09-13: rendering is ASYNC + chunked ("Page Unresponsive" fix) —
  // drive the pipeline explicitly.
  const wrapper = mountEditor({ value: '```text\nplain fenced text <tag>\n```', mode: 'preview' });
  await wrapper.vm.renderNow();
  const html = wrapper.vm.renderedHtml;
  expect(html).toContain('<pre');
  expect(html).toContain('plain fenced text');
  expect(html).toContain('&lt;tag&gt;'); // still escaped
});

it('large bodies render async across chunks and complete (Page Unresponsive fix, 2026-09-13)', async () => {
  // The old whole-document synchronous render froze the main thread on big
  // crawled concepts. The chunked pipeline must render EVERY chunk (nothing
  // dropped at boundaries) and finish with the progress state cleared.
  const para = 'Paragraph line with some text to pad the chunk size.\n\n';
  const body = 'START-MARKER\n\n' + para.repeat(2200) + 'END-MARKER\n';
  const wrapper = mountEditor({ value: body, mode: 'preview' });
  await wrapper.vm.renderNow();
  expect(wrapper.vm.renderTotal).toBeGreaterThan(1); // it really was chunked
  expect(wrapper.vm.rendering).toBe(false); // pipeline completed
  expect(wrapper.vm.renderedHtml).toContain('START-MARKER');
  expect(wrapper.vm.renderedHtml).toContain('END-MARKER');
  // A ~130k-char body rendered in chunks is legitimately slower than jest
  // 5s default: it ran ~15s on a CI runner that was already thrashing
  // (2026-10-29, MR2 pipeline) and the timeout - not the pipeline - was
  // the failure. 30s bounds the slowest sane environment without hiding
  // a real hang.
}, 30000);

it('frontmatter is split cheaply: fm block parsed, body preserved verbatim', async () => {
  const wrapper = mountEditor({
    value: '---\ntitle: Test\n---\n\n# Body heading\n\nBody text.',
    mode: 'preview',
    enableFrontmatter: true
  });
  await wrapper.vm.renderNow();
  expect(wrapper.vm.parsedData.title).toBe('Test');
  expect(wrapper.vm.contentBody).toContain('# Body heading');
  expect(wrapper.vm.renderedHtml).toContain('<h1>'); // body still renders
});

// Round 20, #79191: the frontmatter dialog's save rebuilt `provenance` as
// `{ sources }` — wholesale — silently dropping the keys the import pipeline
// writes under it (crawled_at, source_ids). The spread must preserve them.
it('frontmatter save PRESERVES unknown provenance keys (crawled_at, source_ids)', async () => {
  const wrapper = mountEditor({
    value:
      '---\nokf_version: 0.2\nprovenance:\n  crawled_at: 2026-10-01\n  source_ids:\n    - s1\n  sources: []\n---\n\nBody.',
    mode: 'source',
    enableFrontmatter: true
  });
  await wrapper.vm.$nextTick();
  // (gray-matter's YAML coerces the date — assert the round-trip, not the
  // in-memory type: what matters is the SAVE preserving the key.)
  // the dialog's draft then edits only sources; the save round-trips:
  wrapper.vm.draftFrontmatter.provenance.sources = [{ author: 'a', type: 'url', uri: 'https://x' }];
  wrapper.vm.onFrontmatterAction('save');
  const out = wrapper.emitted('update:value').pop()[0];
  expect(out).toContain('crawled_at: 2026-10-01'); // survived the save
  expect(out).toContain('https://x'); // the new source is in
});

// Round 20, #79192: each chunk renders through an independent markdown-it
// pass — a mid-structure seam restarted list numbering and duplicated table
// headers. The cut must wait for a blank line once the size threshold is
// crossed (with a bounded fallback, pinned by the hard-cap case below).
it('splitRenderChunks cuts at a BLOCK boundary (blank line), not mid-list', () => {
  const item = '1. a sufficiently long list item to consume real column width\n';
  // ~55k of ONE ordered list, then a blank line and a closing paragraph —
  // the list exceeds the 48k window, so the cut must land on the blank.
  const list = item.repeat(900); // ~63k
  const body = list + '\nTail paragraph after the list.\n';
  const chunks = wrapper_chunks(body);
  expect(chunks.length).toBe(2);
  expect(chunks[0].trimEnd().endsWith('width')).toBe(true); // whole list items
  expect(chunks[0]).not.toContain('Tail paragraph'); // the tail is NOT absorbed
  expect(chunks[1].trim()).toBe('Tail paragraph after the list.');
  // no item is severed: every chunk boundary line is blank or ends a block
  for (const c of chunks.slice(0, -1)) expect(/\n\s*\n$/.test(c)).toBe(true);
  function wrapper_chunks(b) {
    const w = mountEditor({ value: b });
    return w.vm.splitRenderChunks(b);
  }
});

it('splitRenderChunks still bounds a runaway block (hard cap at a line boundary)', () => {
  // No blank line for 100k+ — the fallback cuts at a LINE boundary (never
  // mid-line), preserving the Page-Unresponsive guarantee.
  const line = 'x'.repeat(120) + '\n';
  const body = line.repeat(1200); // ~145k, zero blank lines
  const w = mountEditor({ value: body });
  const chunks = w.vm.splitRenderChunks(body);
  expect(chunks.length).toBeGreaterThan(1);
  const total = chunks.reduce((n, c) => n + c.length, 0);
  expect(total).toBe(body.length); // lossless
  for (const c of chunks) expect(c.endsWith('\n')).toBe(true); // line-aligned
  expect(Math.max(...chunks.map((c) => c.length))).toBeLessThanOrEqual(48000 * 2 + 200);
});
