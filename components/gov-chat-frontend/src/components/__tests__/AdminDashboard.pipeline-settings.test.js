/**
 * K.2 / DEC-29 admin-panel pins — the Pipeline Settings (LLM) manager
 * methods. Plain-methods seam (same as the quickhelp pins): SFC imported,
 * heavy child components and services mocked, methods invoked with a
 * constructed ctx. Pins: load populates form + audit + snapshot, the
 * snapshot dirty check, client-side range blocking (no PUT leaves the
 * browser), payload shape (trimmed strings, coerced numbers), the
 * re-ingestion caveat living in the rendered panel, and error toasts
 * surfacing backend 400/403 messages.
 */
import AdminDashboard from '../AdminDashboard.vue';
import adminDashboardService from '../../services/adminDashboardService';

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
  systemPrompt: '  You are the effective assistant.  ',
  enforceAbstention: true,
  abstentionInstructions: 'custom abstain',
  generation: {
    temperature: 0.01, topP: 0.95, repetitionPenalty: 1.03,
    frequencyPenalty: 0.0, presencePenalty: 0.0, maxTokens: 8192,
  },
  ingest: {
    labelSelectorPrompt: 'label prompt',
    contextualRetrievalPrompt: 'contextual prompt',
  },
};

function makeCtx(overrides = {}) {
  return Object.assign(
    {
      isPipelineSettingsLoading: false,
      isLoading: false,
      pipelineSettingsAudit: { version: null, updatedAt: null, updatedBy: null },
      originalPipelineSettingsState: null,
      pipelineSettingsForm: {
        systemPrompt: '',
        enforceAbstention: true,
        abstentionInstructions: '',
        generation: {
          temperature: 0.01, topP: 0.95, repetitionPenalty: 1.03,
          frequencyPenalty: 0.0, presencePenalty: 0.0, maxTokens: 8192,
        },
        ingest: { labelSelectorPrompt: '', contextualRetrievalPrompt: '' },
      },
      // data() reads this.getCurrentLanguage() — provide the minimal this.
      llmGenParamRanges: AdminDashboard.data.call({ getCurrentLanguage: () => 'en' }).llmGenParamRanges,
      // Helpers invoked by the method under test — bound like the quickhelp pins.
      _applyLlmSettings: AdminDashboard.methods._applyLlmSettings,
      _llmSettingsPayload: AdminDashboard.methods._llmSettingsPayload,
      _llmSettingsValidationError: AdminDashboard.methods._llmSettingsValidationError,
      translate: (k, d) => d,
      showNotification: jest.fn(),
    },
    overrides
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('AdminDashboard pipeline settings (K.2, DEC-29)', () => {
  it('loadLlmSettings populates form + audit and snapshots for the dirty check', async () => {
    adminDashboardService.getLlmSettings.mockResolvedValue({ success: true, data: EFFECTIVE });
    const ctx = makeCtx();

    await AdminDashboard.methods.loadLlmSettings.call(ctx);

    expect(ctx.pipelineSettingsForm.systemPrompt).toBe('  You are the effective assistant.  ');
    expect(ctx.pipelineSettingsForm.generation.maxTokens).toBe(8192);
    expect(ctx.pipelineSettingsAudit).toEqual({
      version: 3, updatedAt: '2026-10-05T01:02:03Z', updatedBy: 'admin-1',
    });
    // Untouched loaded form is NOT dirty (J.4 snapshot pattern)
    expect(AdminDashboard.computed.isPipelineSettingsDirty.call(ctx)).toBe(false);
    ctx.pipelineSettingsForm.generation.temperature = 0.5;
    expect(AdminDashboard.computed.isPipelineSettingsDirty.call(ctx)).toBe(true);
  });

  it('load failure → error toast, no crash', async () => {
    adminDashboardService.getLlmSettings.mockRejectedValue(new Error('boom'));
    const ctx = makeCtx();

    await AdminDashboard.methods.loadLlmSettings.call(ctx);

    expect(ctx.showNotification).toHaveBeenCalledWith(expect.stringContaining('Failed to load'), 'error');
    expect(ctx.isPipelineSettingsLoading).toBe(false);
  });

  it('range violation blocks the save client-side — no PUT leaves the browser', async () => {
    const ctx = makeCtx();
    AdminDashboard.methods._applyLlmSettings.call(ctx, EFFECTIVE);
    ctx.pipelineSettingsForm.generation.temperature = 5;

    await AdminDashboard.methods.saveLlmSettings.call(ctx);

    expect(adminDashboardService.updateLlmSettings).not.toHaveBeenCalled();
    expect(ctx.showNotification).toHaveBeenCalledWith(
      expect.stringContaining('generation.temperature'),
      'error'
    );
  });

  it('a cleared number input (v-model.number leaves "") is a REQUIRED error, not a silent 0', async () => {
    const ctx = makeCtx();
    AdminDashboard.methods._applyLlmSettings.call(ctx, EFFECTIVE);
    ctx.pipelineSettingsForm.generation.topP = ''; // Number('')===0 would pass [0,1]

    await AdminDashboard.methods.saveLlmSettings.call(ctx);

    expect(adminDashboardService.updateLlmSettings).not.toHaveBeenCalled();
    expect(ctx.showNotification).toHaveBeenCalledWith(
      expect.stringContaining('generation.topP is required'),
      'error'
    );
  });

  it('empty prompt fields are STRIPPED from the payload — non-prompt saves work on never-edited boxes', async () => {
    adminDashboardService.updateLlmSettings.mockResolvedValue({
      success: true,
      data: { ...EFFECTIVE, version: 2 },
    });
    const ctx = makeCtx({
      // broken-file / never-edited load: prompts empty, numbers defaulted
      pipelineSettingsForm: {
        systemPrompt: '',
        enforceAbstention: true,
        abstentionInstructions: '',
        generation: { ...EFFECTIVE.generation },
        ingest: { labelSelectorPrompt: '', contextualRetrievalPrompt: '' },
      },
    });
    ctx.originalPipelineSettingsState = JSON.stringify(ctx.pipelineSettingsForm);
    ctx.pipelineSettingsForm.generation.temperature = 0.2; // the actual edit

    await AdminDashboard.methods.saveLlmSettings.call(ctx);

    expect(adminDashboardService.updateLlmSettings).toHaveBeenCalledTimes(1);
    const payload = adminDashboardService.updateLlmSettings.mock.calls[0][0];
    expect(payload.systemPrompt).toBeUndefined();
    expect(payload.abstentionInstructions).toBe(''); // clearable: "" is legal (0..4000) and lands in the file
    expect(payload.ingest).toBeUndefined();
    expect(payload.generation.temperature).toBe(0.2); // the real change went out
    expect(ctx.showNotification).toHaveBeenCalledWith(expect.stringContaining('saved'), 'success');
  });

  it('clearing abstentionInstructions SAVES the empty string — no silent restore of the old value', async () => {
    adminDashboardService.updateLlmSettings.mockResolvedValue({
      success: true,
      data: { ...EFFECTIVE, abstentionInstructions: '', version: 5 },
    });
    const ctx = makeCtx();
    AdminDashboard.methods._applyLlmSettings.call(ctx, EFFECTIVE);
    ctx.pipelineSettingsForm.abstentionInstructions = ''; // the clear gesture

    await AdminDashboard.methods.saveLlmSettings.call(ctx);

    const payload = adminDashboardService.updateLlmSettings.mock.calls[0][0];
    expect(payload.abstentionInstructions).toBe('');
    expect(ctx.showNotification).toHaveBeenCalledWith(expect.stringContaining('saved'), 'success');
  });

  it('valid save: PUT payload trimmed + numbers coerced; audit refreshed; dirty cleared', async () => {
    adminDashboardService.updateLlmSettings.mockResolvedValue({
      success: true,
      data: { ...EFFECTIVE, version: 4, updatedBy: 'admin-2', systemPrompt: 'trimmed' },
    });
    const ctx = makeCtx();
    AdminDashboard.methods._applyLlmSettings.call(ctx, EFFECTIVE);

    await AdminDashboard.methods.saveLlmSettings.call(ctx);

    const payload = adminDashboardService.updateLlmSettings.mock.calls[0][0];
    expect(payload.systemPrompt).toBe('You are the effective assistant.'); // trimmed
    expect(payload.enforceAbstention).toBe(true);
    expect(payload.generation).toEqual({
      temperature: 0.01, topP: 0.95, repetitionPenalty: 1.03,
      frequencyPenalty: 0, presencePenalty: 0, maxTokens: 8192,
    });
    expect(payload.ingest.labelSelectorPrompt).toBe('label prompt');
    expect(ctx.pipelineSettingsAudit.version).toBe(4);
    expect(AdminDashboard.computed.isPipelineSettingsDirty.call(ctx)).toBe(false);
    expect(ctx.showNotification).toHaveBeenCalledWith(expect.stringContaining('saved'), 'success');
  });

  it('save failure surfaces the backend message (400 field name / 403)', async () => {
    adminDashboardService.updateLlmSettings.mockRejectedValue({
      response: { data: { message: 'Invalid value for \'generation\': generation.topP must be a number in [0, 1]' } },
    });
    const ctx = makeCtx();
    AdminDashboard.methods._applyLlmSettings.call(ctx, EFFECTIVE);

    await AdminDashboard.methods.saveLlmSettings.call(ctx);

    expect(ctx.showNotification).toHaveBeenCalledWith(
      expect.stringContaining('generation.topP'),
      'error'
    );
  });

  it('discard restores the loaded snapshot', () => {
    const ctx = makeCtx();
    AdminDashboard.methods._applyLlmSettings.call(ctx, EFFECTIVE);
    ctx.pipelineSettingsForm.systemPrompt = 'typed junk';
    expect(AdminDashboard.computed.isPipelineSettingsDirty.call(ctx)).toBe(true);

    AdminDashboard.methods.discardPipelineSettingsChanges.call(ctx);

    expect(ctx.pipelineSettingsForm.systemPrompt).toBe(EFFECTIVE.systemPrompt);
    expect(AdminDashboard.computed.isPipelineSettingsDirty.call(ctx)).toBe(false);
  });

  it('the ingest caveat is rendered in the panel (applies at next re-ingestion)', () => {
    // The compiled render function embeds the translate() English fallbacks
    // as literals — the caveat badge must be part of the panel.
    expect(String(AdminDashboard.render)).toContain('applies at next re-ingestion');
    expect(String(AdminDashboard.render)).toContain('defaults (never edited)');
  });

  it('GET warnings surface on the panel state and clear after a successful save', async () => {
    adminDashboardService.getLlmSettings.mockResolvedValue({
      success: true,
      data: EFFECTIVE,
      warnings: ['systemPrompt must be a string'],
    });
    const ctx = makeCtx();
    await AdminDashboard.methods.loadLlmSettings.call(ctx);
    expect(ctx.llmSettingsWarnings).toEqual(['systemPrompt must be a string']);

    adminDashboardService.updateLlmSettings.mockResolvedValue({
      success: true,
      data: { ...EFFECTIVE, version: 9 },
    });
    await AdminDashboard.methods.saveLlmSettings.call(ctx);
    expect(ctx.llmSettingsWarnings).toEqual([]);
  });

  it('the warnings banner text is rendered in the panel', () => {
    expect(String(AdminDashboard.render)).toContain('saving will overwrite them');
  });
});
