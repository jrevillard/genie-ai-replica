'use strict';

/**
 * OkfSourceDialog (3.10 T1, D1+D3+D6): the wizard's source picker —
 * multi-select over the document repository with SEARCH (debounced
 * `search` param), ORIGIN CHIPS (`source` param; pre-stamp legacy docs
 * count as uploads), provenance pills (crawl + serving/already
 * preflight), and no single-select mode anywhere: the crawl variant is
 * multi-crawl by decision D3. Bundles are never sources; uploads land
 * selected on arrival.
 */

const mockGetFiles = jest.fn();
const mockUploadFile = jest.fn();

jest.mock('@/services/documentFileService', () => ({
  __esModule: true,
  default: { getFiles: (...a) => mockGetFiles(...a), uploadFile: (...a) => mockUploadFile(...a) }
}));

const { mount } = require('@vue/test-utils');
const OkfSourceDialog = require('@/components/okf/wizard/OkfSourceDialog.vue').default;

function page(n, prefix) {
  return Array.from({ length: n }, (_, i) => ({ file_id: `${prefix}-${i}`, file_name: `${prefix}-${i}.pdf` }));
}

function mountDialog(props) {
  return mount(OkfSourceDialog, {
    props: { visible: true, ...props },
    global: { stubs: { DsInfoTip: true } }
  });
}

function settled(wrapper, times = 2) {
  let p = Promise.resolve();
  for (let i = 0; i < times; i += 1) p = p.then(() => wrapper.vm.$nextTick());
  return p;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetFiles.mockResolvedValue({ data: page(2, 'a'), total: 2 });
  mockUploadFile.mockResolvedValue({ data: { file_id: 'up-1', file_name: 'new.pdf' } });
});

it('loads page 1 with limit 50 (backend schema max) and never lists bundle zips', async () => {
  mockGetFiles.mockResolvedValue({
    data: [...page(2, 'a'), { file_id: 'bundle', file_name: 'repo-v1.zip', is_bundle: true }],
    total: 3
  });
  const wrapper = mountDialog({});
  await settled(wrapper);
  expect(mockGetFiles).toHaveBeenCalledWith({ page: 1, limit: 50 });
  const rows = wrapper.findAll('.okf-src__row');
  expect(rows.length).toBe(2); // the bundle zip is filtered out
});

it('toggles rows multi-select style and confirming emits ids + rows', async () => {
  const wrapper = mountDialog({});
  await settled(wrapper);
  const rows = wrapper.findAll('.okf-src__row');
  await rows[0].trigger('click');
  await rows[1].trigger('click');
  await rows[0].trigger('click'); // deselect — checkbox semantics
  wrapper.vm.confirm();
  const evt = wrapper.emitted('confirm');
  expect(evt.length).toBe(1);
  expect(evt[0][0].ids).toEqual(['a-1']);
  expect(evt[0][0].rows.map((r) => r.file_id)).toEqual(['a-1']);
});

it('crawl variant: no single-select — a second pick JOINS the first (D3 multi-crawl)', async () => {
  const wrapper = mountDialog({ allowUpload: false, defaultSource: 'crawl' });
  await settled(wrapper);
  const rows = wrapper.findAll('.okf-src__row');
  await rows[0].trigger('click');
  await rows[1].trigger('click');
  wrapper.vm.confirm();
  expect(wrapper.emitted('confirm')[0][0].ids).toEqual(['a-0', 'a-1']);
});

it('a full page offers Load more and appends the next page (F8)', async () => {
  mockGetFiles.mockImplementation(async ({ page: p }) =>
    p === 1 ? { data: page(50, 'p1'), total: 0 } : { data: page(3, 'p2'), total: 0 }
  );
  const wrapper = mountDialog({});
  await settled(wrapper);
  expect(wrapper.findAll('.okf-src__row').length).toBe(50);
  const more = wrapper.find('.okf-src__more');
  expect(more.exists()).toBe(true);
  await more.trigger('click');
  await settled(wrapper);
  expect(mockGetFiles).toHaveBeenLastCalledWith({ page: 2, limit: 50 });
  expect(wrapper.findAll('.okf-src__row').length).toBe(53);
});

it('typing a search debounces and sends the search param from page 1 (D1)', async () => {
  jest.useFakeTimers();
  const wrapper = mountDialog({});
  await settled(wrapper);
  mockGetFiles.mockClear();

  const input = wrapper.find('input[type="search"]');
  input.element.value = 'naat';
  await input.trigger('input');
  expect(mockGetFiles).not.toHaveBeenCalled(); // debounced

  jest.advanceTimersByTime(400);
  await settled(wrapper);
  expect(mockGetFiles).toHaveBeenCalledTimes(1);
  expect(mockGetFiles).toHaveBeenCalledWith({ page: 1, limit: 50, search: 'naat' });
  jest.useRealTimers();
});

it('the crawl chip filters by origin; All clears the param (D1)', async () => {
  const wrapper = mountDialog({});
  await settled(wrapper);
  mockGetFiles.mockClear();

  const chips = wrapper.findAll('.okf-src__chip');
  await chips[1].trigger('click'); // Crawls
  await settled(wrapper);
  expect(mockGetFiles).toHaveBeenLastCalledWith({ page: 1, limit: 50, source: 'crawl' });

  await chips[0].trigger('click'); // All
  await settled(wrapper);
  expect(mockGetFiles).toHaveBeenLastCalledWith({ page: 1, limit: 50 });
});

it('crawl rows show the crawl pill with the seed URL tooltip (D1 provenance)', async () => {
  mockGetFiles.mockResolvedValue({
    data: [{ file_id: 'c1', file_name: 'naat.digital_full_crawl.md', source: 'crawl', source_url: 'https://naat.digital' }],
    total: 1
  });
  const wrapper = mountDialog({});
  await settled(wrapper);
  const pill = wrapper.find('.okf-src__row .ds-pill, .okf-src__row [class*="pill"]');
  expect(pill.exists()).toBe(true);
  expect(wrapper.vm.isCrawl(wrapper.vm.rows[0])).toBe(true);
  expect(wrapper.vm.crawlTip(wrapper.vm.rows[0])).toContain('https://naat.digital');
  // pre-stamp legacy doc: no crawl pill logic fires
  expect(wrapper.vm.isCrawl({ file_id: 'old', file_name: 'old.pdf' })).toBe(false);
});

it('uploading lands the file in the repository list and selects it', async () => {
  const wrapper = mountDialog({});
  await settled(wrapper);
  const fake = { name: 'new.pdf' };
  await wrapper.vm.onFsFiles({ target: { files: [fake] } });
  expect(mockUploadFile).toHaveBeenCalledTimes(1);
  const rows = wrapper.findAll('.okf-src__row');
  expect(rows.length).toBe(3); // 2 from the repo + the upload on top
  expect(wrapper.text()).toContain('new.pdf');
  wrapper.vm.confirm();
  const payload = wrapper.emitted('confirm')[0][0];
  expect(payload.ids).toContain('up-1');
});

it('confirming with nothing selected surfaces the inline error', () => {
  const wrapper = mountDialog({});
  wrapper.vm.confirm();
  expect(wrapper.emitted('confirm')).toBeUndefined();
  expect(wrapper.vm.confirmError).toBeTruthy();
});
