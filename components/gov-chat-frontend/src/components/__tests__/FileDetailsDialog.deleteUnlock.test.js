/**
 * I.1 pins — delete unlocked for stuck-"Ingesting" documents.
 *
 * - Delete button is ENABLED while status is 'ingesting' (isFileLocked no longer
 *   includes it — a stuck row must stay deletable).
 * - Confirming delete on an ingesting file: best-effort kill FIRST, then delete —
 *   in that order, and a kill failure (404 orphaned task) never blocks the delete.
 * - Deleting an ingested file never calls kill.
 *
 * Mount technique mirrors FileDetailsDialog.autoRefresh.test.js: shallowMount with
 * fileId prop only, then setData to simulate the fetched state.
 */
import { shallowMount, flushPromises } from '@vue/test-utils';
import FileDetailsDialog from '../FileDetailsDialog.vue';

jest.mock('../../services/documentFileService.js', () => ({
  getIngestionProgress: jest.fn().mockResolvedValue({}),
  getIngestionLogs: jest.fn().mockResolvedValue({ data: [] }),
  getFileMetadata: jest.fn(),
  getFileDetails: jest.fn(),
  getCrawlJob: jest.fn().mockResolvedValue({ data: null }),
  getCrawlMetrics: jest.fn().mockResolvedValue({ data: {} }),
  getAdminCategories: jest.fn().mockResolvedValue([]),
  deleteFile: jest.fn().mockResolvedValue({}),
  killIngestion: jest.fn().mockResolvedValue({}),
}));

jest.mock('../../services/serviceTreeService.js', () => ({
  getAdminCategories: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../eventBus.js', () => ({
  eventBus: { $emit: jest.fn(), $on: jest.fn(), $off: jest.fn() },
}));

import documentFileService from '../../services/documentFileService.js';

const makeFile = (status) => ({
  file_id: 'test-file-123',
  file_name: 'test.pdf',
  file_type: 'pdf',
  file_size: 1024,
  file_hash: 'abc123',
  upload_date: '2025-01-01T00:00:00Z',
  author: 'Test Author',
  labels: ['Crop Advice'],
  dataprep: { status },
});

function createWrapper(file) {
  // The microtask boundary inside confirmDelete (the awaited best-effort kill) can
  // let a pending fetch lifecycle run — keep the fetch mocks returning the file.
  documentFileService.getFileMetadata.mockResolvedValue(file);
  documentFileService.getFileDetails.mockResolvedValue({ data: file });
  const w = shallowMount(FileDetailsDialog, {
    props: { fileId: 'test-file-123' },
    global: {
      stubs: { Teleport: true, ConfirmDialog: true, IngestionProgressIndicator: true },
      mocks: { $i18n: { locale: 'en', t: (key) => key } },
    },
  });
  w.setData({
    isLoading: false,
    isFetchingData: false,
    isHierarchyLoading: false,
    file,
    editableFile: { file_name: file.file_name, author: file.author, labels: [...file.labels] },
    knowledgeHierarchy: [],
  });
  return w;
}

const deleteButton = (wrapper) =>
  Array.from(wrapper.findAll('button')).find((b) => b.text().includes('Delete'));

describe('FileDetailsDialog delete unlock (I.1)', () => {
  let wrapper;

  afterEach(() => {
    if (wrapper) wrapper.unmount();
    wrapper = null;
    jest.clearAllMocks();
  });

  it("delete button is ENABLED while status is 'ingesting'", async () => {
    wrapper = createWrapper(makeFile('Ingesting'));
    await wrapper.vm.$nextTick();
    expect(deleteButton(wrapper).attributes('disabled')).toBeUndefined();
  });

  it("delete button stays LOCKED for 'ingested' (retract-first flow unchanged)", async () => {
    wrapper = createWrapper(makeFile('Ingested'));
    await wrapper.vm.$nextTick();
    expect(deleteButton(wrapper).attributes('disabled')).toBeDefined();
  });

  it('confirmDelete on an ingesting file kills first, then deletes — kill failure does not block delete', async () => {
    documentFileService.killIngestion.mockRejectedValueOnce(new Error('404 orphaned'));
    wrapper = createWrapper(makeFile('Ingesting'));

    await wrapper.vm.confirmDelete();
    await flushPromises();

    expect(documentFileService.killIngestion).toHaveBeenCalledWith('test-file-123');
    expect(documentFileService.deleteFile).toHaveBeenCalledWith('test-file-123');
    const killOrder = documentFileService.killIngestion.mock.invocationCallOrder[0];
    const deleteOrder = documentFileService.deleteFile.mock.invocationCallOrder[0];
    expect(killOrder).toBeLessThan(deleteOrder);
  });

  it('confirmDelete on an ingested file does NOT kill', async () => {
    wrapper = createWrapper(makeFile('Ingested'));

    await wrapper.vm.confirmDelete();
    await flushPromises();

    expect(documentFileService.killIngestion).not.toHaveBeenCalled();
    expect(documentFileService.deleteFile).toHaveBeenCalled();
  });
});
