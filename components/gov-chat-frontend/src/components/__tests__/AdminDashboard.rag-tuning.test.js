/**
 * K.3 / DEC-29 admin-panel pins — the Pipeline Settings (Retrieval) manager
 * methods. Same plain-methods seam as the K.2 pipeline-settings pins: SFC
 * imported, heavy child components and services mocked, methods invoked
 * with a constructed ctx. Pins: load populates form + audit + snapshot, the
 * snapshot dirty check (independent of the LLM form's), client-side range +
 * enum + fetchK>=retrievalK blocking (no PUT leaves the browser), payload
 * shape (numbers coerced, real booleans), the dirty-check shared with K.2's
 * panel, and error toasts surfacing backend 400/403 messages.
 */
import AdminDashboard from '../AdminDashboard.vue';
import adminDashboardService from '../../services/adminDashboardService';

jest.mock('../../services/serviceTreeService.js', () => ({ getAllCategories: jest.fn().mockResolvedValue([]), getAdminCategories: jest.fn().mockResolvedValue([]) }));
jest.mock('../../services/databaseOperationsService', () => ({ getDatabaseStats: jest.fn() }));
jest.mock('../../services/adminDashboardService', () => ({
  getSystemHealth: jest.fn(),
  getLlmSettings: jest.fn(),
  updateLlmSettings: jest.fn(),
  getRagTuning: jest.fn(),
  updateRagTuning: jest.fn(),
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
// Heavy child components — stubbed so importing the SFC stays cheap.
jest.mock('../OperationResultsModal.vue', () => ({ name: 'OperationResultsModal', render: () => null }));
jest.mock('../LogSearchDialog.vue', () => ({ name: 'LogSearchDialog', render: () => null }));
jest.mock('../UserEditDialog.vue', () => ({ name: 'UserEditDialog', render: () => null }));
jest.mock('../UploadFilesDialog.vue', () => ({ name: 'UploadFilesDialog', render: () => null }));
jest.mock('../AddFromLinkDialog.vue', () => ({ name: 'AddFromLinkDialog', render: () => null }));
jest.mock('../FileDetailsDialog.vue', () => ({ name: 'FileDetailsDialog', render: () => null }));
jest.mock('../ConfirmDialog.vue', () => ({ name: 'ConfirmDialog', render: () => null }));
jest.mock('../QueryInspector.vue', () => ({ name: 'QueryInspector', render: () => null }));

const EFFECTIVE = {
  version: 3,
  updatedAt: '2026-10-05T01:02:03Z',
  updatedBy: 'admin-1',
  retriever: {
    retrievalK: 20, fetchK: 30, scoreThreshold: 0.2, lambdaMult: 0.5,
    searchStart: 'chunk', searchMode: 'vector', filterStrategy: 'OR',
    enableTraversal: true, traversalMaxDepth: 2, traversalMaxReturned: 5,
    traversalScoreThreshold: 0.7, traversalConcurrentBatches: 4,
    hybridEnabled: true, hybridRrfK: 60, hybridDenseWeight: 1.0,
    hybridLexicalWeight: 1.0, hybridBm25Candidates: 50,
  },
  reranker: {
    strategy: 'slice', threshold: 0.75, topN: 3,
    noveltySigmoidA: 20.0, noveltySigmoidB: 0.25,
    contextDecayFactor: 0.0025, minValueThreshold: -1.0,
  },
};

function makeCtx(overrides = {}) {
  const data = AdminDashboard.data.call({ getCurrentLanguage: () => 'en' });
  return Object.assign(
    {
      isRagTuningLoading: false,
      isLoading: false,
      ragTuningAudit: { version: null, updatedAt: null, updatedBy: null },
      originalRagTuningState: null,
      ragTuningForm: JSON.parse(JSON.stringify(data.ragTuningForm)),
      ragRetrieverRanges: data.ragRetrieverRanges,
      ragRerankerRanges: data.ragRerankerRanges,
      _applyRagTuning: AdminDashboard.methods._applyRagTuning,
      _ragTuningPayload: AdminDashboard.methods._ragTuningPayload,
      _ragTuningValidationError: AdminDashboard.methods._ragTuningValidationError,
      translate: (k, d) => d,
      showNotification: jest.fn(),
    },
    overrides
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('AdminDashboard rag tuning (K.3, DEC-29)', () => {
  it('loadRagTuning populates form + audit and snapshots for the dirty check', async () => {
    adminDashboardService.getRagTuning.mockResolvedValue({ success: true, data: EFFECTIVE });
    const ctx = makeCtx();

    await AdminDashboard.methods.loadRagTuning.call(ctx);

    expect(ctx.ragTuningForm.retriever.retrievalK).toBe(20);
    expect(ctx.ragTuningForm.retriever.enableTraversal).toBe(true);
    expect(ctx.ragTuningForm.reranker.strategy).toBe('slice');
    expect(ctx.ragTuningAudit).toEqual({
      version: 3, updatedAt: '2026-10-05T01:02:03Z', updatedBy: 'admin-1',
    });
    // Untouched loaded form is NOT dirty (J.4 snapshot pattern)
    expect(AdminDashboard.computed.isRagTuningDirty.call(ctx)).toBe(false);
    ctx.ragTuningForm.retriever.retrievalK = 5;
    expect(AdminDashboard.computed.isRagTuningDirty.call(ctx)).toBe(true);
  });

  it('a rag edit does not dirty the LLM form and vice versa (one dirty state per file)', async () => {
    const ctx = makeCtx();
    AdminDashboard.methods._applyRagTuning.call(ctx, EFFECTIVE);
    ctx.originalPipelineSettingsState = JSON.stringify({ untouched: true });
    ctx.pipelineSettingsForm = { untouched: true };

    ctx.ragTuningForm.reranker.threshold = 0.9;
    expect(AdminDashboard.computed.isRagTuningDirty.call(ctx)).toBe(true);
    expect(AdminDashboard.computed.isPipelineSettingsDirty.call(ctx)).toBe(false);
  });

  it('load failure → error toast, no crash', async () => {
    adminDashboardService.getRagTuning.mockRejectedValue(new Error('boom'));
    const ctx = makeCtx();

    await AdminDashboard.methods.loadRagTuning.call(ctx);

    expect(ctx.showNotification).toHaveBeenCalledWith(expect.stringContaining('Failed to load'), 'error');
    expect(ctx.isRagTuningLoading).toBe(false);
  });

  it('range violation blocks the save client-side — no PUT leaves the browser', async () => {
    const ctx = makeCtx();
    AdminDashboard.methods._applyRagTuning.call(ctx, EFFECTIVE);
    ctx.ragTuningForm.retriever.traversalConcurrentBatches = 5; // hard cap 4

    await AdminDashboard.methods.saveRagTuning.call(ctx);

    expect(adminDashboardService.updateRagTuning).not.toHaveBeenCalled();
    expect(ctx.showNotification).toHaveBeenCalledWith(
      expect.stringContaining('retriever.traversalConcurrentBatches'),
      'error'
    );
  });

  it('a cleared number input is a REQUIRED error, not a silent 0', async () => {
    const ctx = makeCtx();
    AdminDashboard.methods._applyRagTuning.call(ctx, EFFECTIVE);
    ctx.ragTuningForm.reranker.topN = ''; // Number('')===0 would silently pass

    await AdminDashboard.methods.saveRagTuning.call(ctx);

    expect(adminDashboardService.updateRagTuning).not.toHaveBeenCalled();
    expect(ctx.showNotification).toHaveBeenCalledWith(
      expect.stringContaining('reranker.topN is required'),
      'error'
    );
  });

  it('fetchK < retrievalK blocks the save client-side (MMR requirement)', async () => {
    const ctx = makeCtx();
    AdminDashboard.methods._applyRagTuning.call(ctx, EFFECTIVE);
    ctx.ragTuningForm.retriever.retrievalK = 40;

    await AdminDashboard.methods.saveRagTuning.call(ctx);

    expect(adminDashboardService.updateRagTuning).not.toHaveBeenCalled();
    expect(ctx.showNotification).toHaveBeenCalledWith(
      expect.stringContaining('fetchK'),
      'error'
    );
  });

  it('valid save: PUT payload carries both blocks with coerced numbers + real booleans', async () => {
    adminDashboardService.updateRagTuning.mockResolvedValue({
      success: true,
      data: { ...EFFECTIVE, version: 4, updatedBy: 'admin-2' },
    });
    const ctx = makeCtx();
    AdminDashboard.methods._applyRagTuning.call(ctx, EFFECTIVE);
    ctx.ragTuningForm.retriever.retrievalK = 5;
    ctx.ragTuningForm.reranker.strategy = 'adaptive';

    await AdminDashboard.methods.saveRagTuning.call(ctx);

    const payload = adminDashboardService.updateRagTuning.mock.calls[0][0];
    expect(payload.retriever.retrievalK).toBe(5);
    expect(payload.retriever.enableTraversal).toBe(true);
    expect(payload.retriever.hybridEnabled).toBe(true);
    expect(payload.reranker.strategy).toBe('adaptive');
    expect(payload.reranker.minValueThreshold).toBe(-1);
    expect(ctx.ragTuningAudit.version).toBe(4);
    expect(AdminDashboard.computed.isRagTuningDirty.call(ctx)).toBe(false);
    expect(ctx.showNotification).toHaveBeenCalledWith(expect.stringContaining('saved'), 'success');
  });

  it('save failure surfaces the backend message (400 field name / 403)', async () => {
    adminDashboardService.updateRagTuning.mockRejectedValue({
      response: { data: { message: 'Invalid value for \'retriever\': retriever.searchStart must be one of chunk, edge, node' } },
    });
    const ctx = makeCtx();
    AdminDashboard.methods._applyRagTuning.call(ctx, EFFECTIVE);

    await AdminDashboard.methods.saveRagTuning.call(ctx);

    expect(ctx.showNotification).toHaveBeenCalledWith(
      expect.stringContaining('retriever.searchStart'),
      'error'
    );
  });

  it('discard restores the loaded snapshot', () => {
    const ctx = makeCtx();
    AdminDashboard.methods._applyRagTuning.call(ctx, EFFECTIVE);
    ctx.ragTuningForm.retriever.hybridEnabled = false;
    expect(AdminDashboard.computed.isRagTuningDirty.call(ctx)).toBe(true);

    AdminDashboard.methods.discardRagTuningChanges.call(ctx);

    expect(ctx.ragTuningForm.retriever.hybridEnabled).toBe(true);
    expect(AdminDashboard.computed.isRagTuningDirty.call(ctx)).toBe(false);
  });

  it('the panel renders enum selects and the concurrency hard-cap hint', () => {
    // The compiled render function embeds the translate() English fallbacks
    // and the option loops as literals — the selects and hints must be part
    // of the panel.
    const render = String(AdminDashboard.render);
    expect(render).toContain('hard-capped at 4');
    expect(render).toContain('only apply when strategy is adaptive');
  });

  it('enum option lists mirror the backend schema exactly', () => {
    const { ragEnumOptions } = AdminDashboard.data.call({ getCurrentLanguage: () => 'en' });
    expect(ragEnumOptions.searchStart).toEqual(['chunk', 'edge', 'node']);
    expect(ragEnumOptions.searchMode).toEqual(['vector', 'hybrid']);
    expect(ragEnumOptions.filterStrategy).toEqual(['AND', 'OR']);
    expect(ragEnumOptions.strategy).toEqual([
      'slice', 'threshold', 'knee_threshold', 'slice_threshold', 'adaptive',
    ]);
  });

  it('backend-legal values the UI would have "invented" bounds for save fine (no artificial maxes)', async () => {
    adminDashboardService.updateRagTuning.mockResolvedValue({
      success: true,
      data: { ...EFFECTIVE, version: 5 },
    });
    const ctx = makeCtx();
    AdminDashboard.methods._applyRagTuning.call(ctx, EFFECTIVE);
    // backend schema has NO upper bounds on these (and minValueThreshold none at all)
    ctx.ragTuningForm.retriever.retrievalK = 5000;
    ctx.ragTuningForm.retriever.fetchK = 6000; // keep the real cross-field constraint satisfied
    ctx.ragTuningForm.retriever.traversalMaxDepth = 25;
    ctx.ragTuningForm.reranker.minValueThreshold = -1234.5;
    ctx.ragTuningForm.reranker.noveltySigmoidA = 0.5; // > 0, below the old fake 0.01 floor? 0.5 fine; strict >0 pinned below

    await AdminDashboard.methods.saveRagTuning.call(ctx);

    expect(adminDashboardService.updateRagTuning).toHaveBeenCalledTimes(1);
    expect(ctx.showNotification).toHaveBeenCalledWith(expect.stringContaining('saved'), 'success');
  });

  it('noveltySigmoidA enforces the backend-exclusive strict > 0 (0 itself blocks)', async () => {
    const ctx = makeCtx();
    AdminDashboard.methods._applyRagTuning.call(ctx, EFFECTIVE);
    ctx.ragTuningForm.reranker.noveltySigmoidA = 0;

    await AdminDashboard.methods.saveRagTuning.call(ctx);

    expect(adminDashboardService.updateRagTuning).not.toHaveBeenCalled();
    expect(ctx.showNotification).toHaveBeenCalledWith(
      expect.stringContaining('reranker.noveltySigmoidA'),
      'error'
    );
  });

  it('GET warnings surface on the panel state and clear after a successful save', async () => {
    adminDashboardService.getRagTuning.mockResolvedValue({
      success: true,
      data: EFFECTIVE,
      warnings: ['retriever.retrievalK must be an integer >= 1'],
    });
    const ctx = makeCtx();
    await AdminDashboard.methods.loadRagTuning.call(ctx);
    expect(ctx.ragTuningWarnings).toEqual(['retriever.retrievalK must be an integer >= 1']);

    adminDashboardService.updateRagTuning.mockResolvedValue({
      success: true,
      data: { ...EFFECTIVE, version: 8 },
    });
    await AdminDashboard.methods.saveRagTuning.call(ctx);
    expect(ctx.ragTuningWarnings).toEqual([]);
  });

  it('the warnings banner text is rendered in the panel', () => {
    expect(String(AdminDashboard.render)).toContain('saving will overwrite them');
  });

  it('setActiveTab with a dirty rag form shows the confirm dialog; confirming nulls the snapshots', () => {
    const ctx = Object.assign(makeCtx(), {
      activeTab: 'pipelineSettings',
      isFormDirty: false,
      isQuickHelpFormDirty: false,
      isPipelineSettingsDirty: false,
      isRagTuningDirty: true,
      originalHierarchyFormState: 'x',
      originalPipelineSettingsState: '{"a":1}',
      showConfirmDialog: jest.fn(),
      loadDataForTab: jest.fn(),
      _closeQuickHelpForm: jest.fn(),
      securityDetails: null,
    });

    AdminDashboard.methods.setActiveTab.call(ctx, 'users');

    expect(ctx.showConfirmDialog).toHaveBeenCalledTimes(1);
    expect(ctx.activeTab).toBe('pipelineSettings'); // switch blocked until confirmed
    const opts = ctx.showConfirmDialog.mock.calls[0][0];
    expect(opts.message).toContain('unsaved pipeline settings');

    opts.onConfirm();
    expect(ctx.activeTab).toBe('users');
    expect(ctx.originalRagTuningState).toBeNull();
    expect(ctx.originalPipelineSettingsState).toBeNull();
    expect(ctx.loadDataForTab).toHaveBeenCalledWith('users');
  });

  it('setActiveTab with clean forms switches immediately (no dialog)', () => {
    const ctx = Object.assign(makeCtx(), {
      activeTab: 'pipelineSettings',
      isFormDirty: false,
      isQuickHelpFormDirty: false,
      isPipelineSettingsDirty: false,
      isRagTuningDirty: false,
      showConfirmDialog: jest.fn(),
      loadDataForTab: jest.fn(),
      securityDetails: null,
    });

    AdminDashboard.methods.setActiveTab.call(ctx, 'users');

    expect(ctx.showConfirmDialog).not.toHaveBeenCalled();
    expect(ctx.activeTab).toBe('users');
    expect(ctx.loadDataForTab).toHaveBeenCalledWith('users');
  });
});
