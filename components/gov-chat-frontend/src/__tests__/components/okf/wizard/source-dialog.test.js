'use strict';

/**
 * OkfSourceDialog (slice 4a, David 2026-09-27): dual-source picker for the
 * wizard's Documents choice — document repository (paginated; limit ≤ 50 per
 * the backend schema or the request 400s; bundles are never sources) AND
 * local file system (uploads land in doc-repo and are selected on arrival).
 * 'single' mode (crawl) allows one source and hides the upload section.
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
  const wrapper = mountDialog({ mode: 'multi' });
  await wrapper.vm.$nextTick();
  await wrapper.vm.$nextTick();
  expect(mockGetFiles).toHaveBeenCalledWith({ page: 1, limit: 50 });
  const rows = wrapper.findAll('.okf-src__row');
  expect(rows.length).toBe(2); // the bundle zip is filtered out
});

it('multi mode: toggling rows and confirming emits ids + rows', async () => {
  const wrapper = mountDialog({ mode: 'multi' });
  await wrapper.vm.$nextTick();
  await wrapper.vm.$nextTick();
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

it('single mode: a second pick replaces the first', async () => {
  const wrapper = mountDialog({ mode: 'single', allowUpload: false });
  await wrapper.vm.$nextTick();
  await wrapper.vm.$nextTick();
  const rows = wrapper.findAll('.okf-src__row');
  await rows[0].trigger('click');
  await rows[1].trigger('click');
  wrapper.vm.confirm();
  expect(wrapper.emitted('confirm')[0][0].ids).toEqual(['a-1']);
});

it('a full page offers Load more and appends the next page', async () => {
  mockGetFiles.mockImplementation(async ({ page: p }) =>
    p === 1 ? { data: page(50, 'p1'), total: 0 } : { data: page(3, 'p2'), total: 0 }
  );
  const wrapper = mountDialog({ mode: 'multi' });
  await wrapper.vm.$nextTick();
  await wrapper.vm.$nextTick();
  expect(wrapper.findAll('.okf-src__row').length).toBe(50);
  const more = wrapper.find('.okf-src__more');
  expect(more.exists()).toBe(true);
  await more.trigger('click');
  await wrapper.vm.$nextTick();
  await wrapper.vm.$nextTick();
  expect(mockGetFiles).toHaveBeenLastCalledWith({ page: 2, limit: 50 });
  expect(wrapper.findAll('.okf-src__row').length).toBe(53);
});

it('uploading lands the file in the repository list and selects it', async () => {
  const wrapper = mountDialog({ mode: 'multi' });
  await wrapper.vm.$nextTick();
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
  const wrapper = mountDialog({ mode: 'multi' });
  wrapper.vm.confirm();
  expect(wrapper.emitted('confirm')).toBeUndefined();
  expect(wrapper.vm.confirmError).toBeTruthy();
});
