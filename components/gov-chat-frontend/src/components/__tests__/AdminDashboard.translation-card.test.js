/**
 * L.5 / DEC-30 pin — translationBackendDisplay: the overview card renders
 * "auto → gpu" when auto-mode picked the GPU sidecar, the bare type when
 * forced (never "gpu → gpu"), and the template shows "not initialized" when
 * no backend ever came up. Plain-computed seam, same as the K.2 pins.
 */
import AdminDashboard from '../AdminDashboard.vue';

jest.mock('../../services/serviceTreeService.js', () => ({ getAllCategories: jest.fn().mockResolvedValue([]), getAdminCategories: jest.fn().mockResolvedValue([]) }));
jest.mock('../../services/databaseOperationsService', () => ({ getDatabaseStats: jest.fn() }));
jest.mock('../../services/adminDashboardService', () => ({
  getSystemHealth: jest.fn(),
  getLlmSettings: jest.fn(),
  updateLlmSettings: jest.fn(),
}));
jest.mock('../../services/documentFileService.js', () => ({ getDocuments: jest.fn() }));
jest.mock('../../services/labelService.js', () => ({ getLabels: jest.fn() }));
jest.mock('../../services/quickhelpService.js', () => ({
  getButtons: jest.fn().mockResolvedValue([]),
  getAllButtons: jest.fn().mockResolvedValue([]),
  createButton: jest.fn(),
  updateButton: jest.fn(),
  deleteButton: jest.fn(),
}));
jest.mock('../../eventBus.js', () => ({
  eventBus: { $emit: jest.fn(), $on: jest.fn(), $off: jest.fn() },
}));
jest.mock('../OperationResultsModal.vue', () => ({ name: 'OperationResultsModal', render: () => null }));
jest.mock('../LogSearchDialog.vue', () => ({ name: 'LogSearchDialog', render: () => null }));
jest.mock('../UserEditDialog.vue', () => ({ name: 'UserEditDialog', render: () => null }));
jest.mock('../UploadFilesDialog.vue', () => ({ name: 'UploadFilesDialog', render: () => null }));
jest.mock('../AddFromLinkDialog.vue', () => ({ name: 'AddFromLinkDialog', render: () => null }));
jest.mock('../FileDetailsDialog.vue', () => ({ name: 'FileDetailsDialog', render: () => null }));
jest.mock('../ConfirmDialog.vue', () => ({ name: 'ConfirmDialog', render: () => null }));
jest.mock('../QueryInspector.vue', () => ({ name: 'QueryInspector', render: () => null }));

const getter = AdminDashboard.computed.translationBackendDisplay;

describe('translationBackendDisplay (L.5)', () => {
  it('renders "auto → gpu" when auto mode landed on the GPU sidecar', () => {
    expect(
      getter.call({ aiConfig: { translation: { backend: 'auto', activeType: 'gpu' } } })
    ).toBe('auto → gpu');
  });

  it('renders the bare type when the mode is forced (never "gpu → gpu")', () => {
    expect(
      getter.call({ aiConfig: { translation: { backend: 'gpu', activeType: 'gpu' } } })
    ).toBe('gpu');
  });

  it('renders "auto → none" pre-init and empty without config', () => {
    expect(
      getter.call({ aiConfig: { translation: { backend: 'auto', activeType: 'none' } } })
    ).toBe('auto → none');
    expect(getter.call({ aiConfig: null })).toBe('');
  });

  it('degrades to the bare mode against a pre-L.5 backend payload (no activeType — review skew guard)', () => {
    expect(
      getter.call({ aiConfig: { translation: { backend: 'auto' } } })
    ).toBe('auto');
  });
});
