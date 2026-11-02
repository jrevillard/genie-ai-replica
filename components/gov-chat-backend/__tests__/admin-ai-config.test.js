/**
 * L.5 / DEC-30 pins — getAIConfig translation section reports the ACTIVE
 * backend (singleton getBackendInfo), not the env-only legacy lie. The card
 * shows active-only: cpuModelId is GONE from the payload, activeModel is
 * null when nothing is initialized. Uses the .model field; the language-map
 * .modelId would stamp 'nllb-200-distilled-600M' on the GPU path too.
 */
jest.mock('../services/translation-service', () => ({
  getBackendInfo: jest.fn(),
  translate: jest.fn(),
}));

const translationService = require('../services/translation-service');
const adminDashboardService = require('../services/admin-dashboard-service');

const GPU_INFO = { type: 'gpu', model: 'facebook/nllb-200-3.3B', initialized: true, healthCheckPassed: true };
const CPU_INFO = { type: 'cpu', model: 'Xenova/nllb-200-distilled-600M', initialized: true };
const NONE_INFO = { type: 'none', initialized: false };

describe('getAIConfig translation section (L.5)', () => {
  afterEach(() => {
    delete process.env.TRANSLATION_BACKEND;
    jest.clearAllMocks();
  });

  it('reports the active GPU sidecar model when auto mode landed on GPU', () => {
    process.env.TRANSLATION_BACKEND = 'auto';
    translationService.getBackendInfo.mockReturnValue(GPU_INFO);

    const { translation } = adminDashboardService.getAIConfig();

    expect(translation.backend).toBe('auto');
    expect(translation.activeType).toBe('gpu');
    expect(translation.activeModel).toBe('facebook/nllb-200-3.3B');
    expect(translation.initialized).toBe(true);
    expect(translation).not.toHaveProperty('cpuModelId');
  });

  it('reports the CPU model as active when auto degraded to CPU (no stale GPU id)', () => {
    process.env.TRANSLATION_BACKEND = 'auto';
    translationService.getBackendInfo.mockReturnValue(CPU_INFO);

    const { translation } = adminDashboardService.getAIConfig();

    expect(translation.activeType).toBe('cpu');
    expect(translation.activeModel).toBe('Xenova/nllb-200-distilled-600M');
  });

  it('is honest when the service never initialized — no fabricated model', () => {
    translationService.getBackendInfo.mockReturnValue(NONE_INFO);

    const { translation } = adminDashboardService.getAIConfig();

    expect(translation.activeType).toBe('none');
    expect(translation.activeModel).toBeNull();
    expect(translation.initialized).toBe(false);
  });

  it('readiness-keys the model: assigned-but-uninitialized backend (review #1 — auto mode where both legs failed, or the boot window) shows no model', () => {
    process.env.TRANSLATION_BACKEND = 'auto';
    translationService.getBackendInfo.mockReturnValue({ type: 'cpu', model: 'Xenova/nllb-200-distilled-600M', initialized: false });

    const { translation } = adminDashboardService.getAIConfig();

    expect(translation.activeType).toBe('cpu');
    expect(translation.activeModel).toBeNull();
    expect(translation.initialized).toBe(false);
  });

  it('defaults the mode label when TRANSLATION_BACKEND is unset', () => {
    delete process.env.TRANSLATION_BACKEND;
    translationService.getBackendInfo.mockReturnValue(CPU_INFO);

    expect(adminDashboardService.getAIConfig().translation.backend).toBe('cpu');
  });
});
