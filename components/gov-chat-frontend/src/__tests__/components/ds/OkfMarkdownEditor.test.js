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
});

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
