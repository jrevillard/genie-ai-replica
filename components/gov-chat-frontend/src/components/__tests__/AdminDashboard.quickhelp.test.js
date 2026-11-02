/**
 * J.4 / DEC-28 admin-panel pins — the Quick Help Buttons manager methods.
 *
 * Plain-methods seam (same as the ChatBotComponent payload pins): SFC
 * imported, heavy child components and services mocked, methods invoked
 * with a constructed ctx. Pins: the one-PUT quarter-step reorder (no equal-
 * order states, J.4 review F9), toggle inversion, payload shape (icon
 * prefix, st omitted when empty), create order = max+1, the
 * quick-help-updated emit after every mutation, and the snapshot-based
 * dirty check (F8).
 */
import AdminDashboard from '../AdminDashboard.vue';
import quickhelpService from '../../services/quickhelpService';
import { eventBus } from '../../eventBus.js';

jest.mock('../../services/serviceTreeService.js', () => ({ getAllCategories: jest.fn().mockResolvedValue([]), getAdminCategories: jest.fn().mockResolvedValue([]) }));
jest.mock('../../services/databaseOperationsService', () => ({ getDatabaseStats: jest.fn() }));
jest.mock('../../services/adminDashboardService', () => ({ getSystemHealth: jest.fn() }));
jest.mock('../../services/documentFileService.js', () => ({ getDocuments: jest.fn() }));
jest.mock('../../services/labelService.js', () => ({ getLabels: jest.fn() }));
jest.mock('../../services/quickhelpService.js', () => ({
  getButtons: jest.fn().mockResolvedValue([]),
  getAllButtons: jest.fn().mockResolvedValue([]),
  createButton: jest.fn().mockResolvedValue({}),
  updateButton: jest.fn().mockResolvedValue({}),
  deleteButton: jest.fn().mockResolvedValue({}),
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

const B = (key, order, extra = {}) => ({
  _key: key,
  order,
  enabled: true,
  isJustChat: false,
  title: { en: `T ${key}` },
  prompt: { en: `P ${key}` },
  icon: '/config/quickhelp/crop-management.svg',
  ...extra,
});

function makeCtx(overrides = {}) {
  return Object.assign(
    {
      quickHelpButtons: [B('a', 1), B('b', 2), B('c', 3)],
      quickHelpForm: {
        visible: true,
        mode: 'create',
        _key: null,
        titleEN: 'New one',
        titleST: '',
        promptEN: 'A prompt',
        promptST: '',
        iconFile: 'just-chat.svg',
        isJustChat: false,
      },
      originalQuickHelpFormState: null,
      isLoading: false,
      translate: (k, d) => d,
      showNotification: jest.fn(),
      // Capture the confirm flow's promise so tests can await the async
      // onConfirm body deterministically (deleteQuickHelpButton itself
      // returns before the confirmed action completes).
      _confirmPromise: null,
      showConfirmDialog(opts) {
        this._confirmPromise = opts.onConfirm();
      },
      _quickHelpPayload: AdminDashboard.methods._quickHelpPayload,
      _closeQuickHelpForm: AdminDashboard.methods._closeQuickHelpForm,
      showQuickHelpForm: AdminDashboard.methods.showQuickHelpForm,
      loadQuickHelpButtons: jest.fn(),
    },
    overrides
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('AdminDashboard quick-help manager (J.4, DEC-28)', () => {
  it('moveQuickHelpButton = ONE PUT with a quarter-step past the neighbor (F9)', async () => {
    const ctx = makeCtx();
    await AdminDashboard.methods.moveQuickHelpButton.call(ctx, ctx.quickHelpButtons[0], 1);

    expect(quickhelpService.updateButton).toHaveBeenCalledTimes(1);
    const [id, body] = quickhelpService.updateButton.mock.calls[0];
    expect(id).toBe('a');
    expect(body.order).toBe(2.25); // past b(2), never equal
    expect(eventBus.$emit).toHaveBeenCalledWith('quick-help-updated');
    expect(ctx.loadQuickHelpButtons).toHaveBeenCalled();
  });

  it('moveQuickHelpButton up goes a quarter-step below the neighbor', async () => {
    const ctx = makeCtx();
    await AdminDashboard.methods.moveQuickHelpButton.call(ctx, ctx.quickHelpButtons[2], -1);

    const [, body] = quickhelpService.updateButton.mock.calls[0];
    expect(body.order).toBe(1.75); // below b(2)
  });

  it('moveQuickHelpButton at the boundary does nothing', async () => {
    const ctx = makeCtx();
    await AdminDashboard.methods.moveQuickHelpButton.call(ctx, ctx.quickHelpButtons[0], -1);
    expect(quickhelpService.updateButton).not.toHaveBeenCalled();
  });

  it('toggleQuickHelpButton inverts enabled and reloads', async () => {
    const ctx = makeCtx();
    await AdminDashboard.methods.toggleQuickHelpButton.call(ctx, ctx.quickHelpButtons[1]);

    const [, body] = quickhelpService.updateButton.mock.calls[0];
    expect(body.enabled).toBe(false);
    expect(ctx.loadQuickHelpButtons).toHaveBeenCalled();
  });

  it('_quickHelpPayload prefixes the icon and omits empty st', () => {
    const ctx = makeCtx();
    const payload = AdminDashboard.methods._quickHelpPayload.call(ctx);
    expect(payload.title).toEqual({ en: 'New one' });
    expect(payload.prompt).toEqual({ en: 'A prompt' });
    expect(payload.icon).toBe('/config/quickhelp/just-chat.svg');
    expect(payload.enabled).toBe(true);
  });

  it('saveQuickHelpButton create appends at max(order)+1 and emits', async () => {
    const ctx = makeCtx();
    await AdminDashboard.methods.saveQuickHelpButton.call(ctx);

    expect(quickhelpService.createButton).toHaveBeenCalledTimes(1);
    const body = quickhelpService.createButton.mock.calls[0][0];
    expect(body.order).toBe(4); // max was 3
    expect(eventBus.$emit).toHaveBeenCalledWith('quick-help-updated');
    expect(ctx.quickHelpForm.visible).toBe(false);
  });

  it('deleteQuickHelpButton deletes, reloads, and emits', async () => {
    const ctx = makeCtx();
    await AdminDashboard.methods.deleteQuickHelpButton.call(ctx, ctx.quickHelpButtons[0]);
    await ctx._confirmPromise; // flush the confirmed async body

    expect(quickhelpService.deleteButton).toHaveBeenCalledWith('a');
    expect(eventBus.$emit).toHaveBeenCalledWith('quick-help-updated');
  });

  it('dirty check: untouched form is not dirty; an edit is (F8)', () => {
    const clean = makeCtx();
    AdminDashboard.methods.showQuickHelpForm.call(clean, 'create');
    expect(AdminDashboard.computed.isQuickHelpFormDirty.call(clean)).toBe(false);

    clean.quickHelpForm.titleEN = 'Edited';
    expect(AdminDashboard.computed.isQuickHelpFormDirty.call(clean)).toBe(true);
  });
});
