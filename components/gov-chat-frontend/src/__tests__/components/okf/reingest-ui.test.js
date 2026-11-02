'use strict';

/**
 * Re-ingest UI gating (David, 2026-10-14): "the Re-Ingest menu must only be
 * available after a repo is ingested".
 *
 * The gate is asserted directly against the component's computed rather than
 * through a full mount. Mounting StudioDashboard drags in the whole service +
 * store mock surface (see lifecycle-ui.test.js) to exercise ONE boolean; calling
 * the computed with a bound `this` tests the same expression the template uses,
 * with none of that scaffolding able to hide a regression.
 */

jest.mock('@/services/repoOkfService', () => ({
  __esModule: true,
  default: {
    list: jest.fn().mockResolvedValue([]),
    get: jest.fn().mockResolvedValue(null),
    lifecycle: jest.fn().mockResolvedValue({ ok: true }),
    reingestFailed: jest.fn().mockResolvedValue({ ok: true, requeued: 0, concept_ids: [] }),
    deleteRepo: jest.fn().mockResolvedValue({ status: 'deleted' }),
    listVersions: jest.fn(),
    getRepoLogs: jest.fn().mockResolvedValue([]),
    create: jest.fn(),
    importConcepts: jest.fn(),
    mintVersion: jest.fn(),
    update: jest.fn().mockResolvedValue({ ok: true })
  }
}));

jest.mock('@/services/okfRepoOps', () => ({
  __esModule: true,
  default: {
    exportRepoZip: jest.fn(),
    lifecycle: jest.fn(),
    deleteRepo: jest.fn(),
    listVersions: jest.fn(),
    isBuilding: () => false,
    isRedraining: () => false,
    friendlyLifecycleError: (code) => String(code || '')
  },
  exportRepoZip: jest.fn(),
  lifecycle: jest.fn(),
  deleteRepo: jest.fn(),
  listVersions: jest.fn(),
  isBuilding: () => false,
  isRedraining: () => false,
  friendlyLifecycleError: (code) => String(code || '')
}));

const StudioDashboard = require('@/components/okf/StudioDashboard.vue').default;
const ConceptList = require('@/components/okf/editor/ConceptList.vue').default;

const INGESTED = {
  repo_id: 'r-1',
  name: 'Solar System',
  lifecycle_state: 'publish',
  ingested_at: '2026-10-01T00:00:00.000Z',
  ingested_version: 1,
  failed_count: 2
};

function gate(repo, draining = false) {
  // canReingest is a METHOD. Asserting it through `computed` would pass while
  // the template blew up — Vue evaluates a zero-arg computed on access, caches
  // the result, and the template's canReingest(r) then calls that cached value.
  const ctx = { isDraining: () => draining };
  return StudioDashboard.methods.canReingest.call(ctx, repo);
}

describe('Re-ingest menu gating (David 2026-10-14)', () => {
  it('AVAILABLE on an ingested repo — the state it exists for', () => {
    expect(gate(INGESTED)).toBe(true);
  });

  // David's directive, asserted as its negative: not available before ingest.
  it('HIDDEN when ingested_at is null (never ingested)', () => {
    expect(gate({ ...INGESTED, ingested_at: null })).toBe(false);
  });

  it('HIDDEN when ingested_at is undefined (field absent)', () => {
    const r = { ...INGESTED };
    delete r.ingested_at;
    expect(gate(r)).toBe(false);
  });

  it('HIDDEN on every pre-publish state', () => {
    for (const state of ['draft', 'register', 'review', 'approve', 'retracted']) {
      expect(gate({ ...INGESTED, lifecycle_state: state })).toBe(false);
    }
  });

  // A second arm would 409 DRAIN_IN_PROGRESS. Hiding beats a dead button that
  // looks live.
  it('HIDDEN while a drain is already running', () => {
    expect(gate(INGESTED, true)).toBe(false);
  });

  it('HIDDEN for a null repo (no crash on an empty list)', () => {
    expect(gate(null)).toBe(false);
    expect(gate(undefined)).toBe(false);
  });

  // David, 2026-10-14: "the re-ingest menu should only appear for repo's with
  // failed concept ingestions". A recovery action on a repo with nothing to
  // recover is a dead button that looks live.
  it('HIDDEN when there are NO failed concepts', () => {
    expect(gate({ ...INGESTED, failed_count: 0 })).toBe(false);
  });

  it('HIDDEN when failed_count is missing entirely (list predates the field)', () => {
    const r = { ...INGESTED };
    delete r.failed_count;
    expect(gate(r)).toBe(false);
  });

  // A non-numeric value means the attach query failed-soft and left the field
  // undefined. Hiding is the safe direction: the dialog is still reachable from
  // the concept rail's per-concept retry, so nothing becomes unreachable.
  it('HIDDEN when failed_count is non-numeric', () => {
    expect(gate({ ...INGESTED, failed_count: null })).toBe(false);
    expect(gate({ ...INGESTED, failed_count: '2' })).toBe(false);
  });

  it('VISIBLE with exactly one failed concept', () => {
    expect(gate({ ...INGESTED, failed_count: 1 })).toBe(true);
  });

  // REGRESSION GUARD for a mistake this batch actually made: declaring
  // canReingest as a `computed` compiles fine, lints fine, and passes a test
  // that reads `options.computed.canReingest` — but Vue calls a computed with
  // NO arguments, caches the resulting boolean, and every card render then
  // throws "TypeError: _ctx.canReingest is not a function". It must be a method.
  it('canReingest is a METHOD (a computed with a parameter breaks every render)', () => {
    expect(typeof StudioDashboard.methods.canReingest).toBe('function');
    expect(StudioDashboard.computed.canReingest).toBeUndefined();
  });

  // The gate must agree with the state machine's own retract condition, or the
  // card would offer a recovery action on a repo that has nothing to recover.
  // contextualAction is a METHOD (it is called as this.contextualAction(r) from
  // contextualLabel and onLifecycle), not a computed.
  it('agrees with contextualAction on when a repo is ingested', () => {
    const methodCtx = { translate: (k, d) => d };
    const action = StudioDashboard.methods.contextualAction.call(methodCtx, INGESTED);
    expect(action).toBe('retract');
    expect(gate(INGESTED)).toBe(true);
  });
});

describe('Re-ingest confirm dialog', () => {
  const actions = (over) =>
    StudioDashboard.computed.reingestActions.call({
      translate: (k, d) => d,
      reingestLoading: false,
      reingestCount: 2,
      actionBusy: false,
      ...over
    });

  it('CONFIRM is enabled when failed concepts exist', () => {
    const confirm = actions().find((a) => a.key === 'confirm');
    expect(confirm.disabled).toBe(false);
  });

  // A live action that would do nothing is the "dead button that looks live"
  // failure this dialog is built to avoid.
  it('CONFIRM is DISABLED when the live count is 0', () => {
    const confirm = actions({ reingestCount: 0 }).find((a) => a.key === 'confirm');
    expect(confirm.disabled).toBe(true);
  });

  it('CONFIRM is DISABLED while the count is still loading', () => {
    const confirm = actions({ reingestLoading: true }).find((a) => a.key === 'confirm');
    expect(confirm.disabled).toBe(true);
  });

  it('CONFIRM is DISABLED while another action is in flight', () => {
    const confirm = actions({ actionBusy: true }).find((a) => a.key === 'confirm');
    expect(confirm.disabled).toBe(true);
  });

  // null means "not fetched yet / fetch failed" and must NOT be treated as 0 —
  // otherwise a transient metrics failure silently disables recovery on a repo
  // that genuinely has failed concepts.
  it('CONFIRM stays ENABLED when the count is null (unknown, not zero)', () => {
    const confirm = actions({ reingestCount: null }).find((a) => a.key === 'confirm');
    expect(confirm.disabled).toBe(false);
  });

  const body = (over) =>
    StudioDashboard.computed.reingestBodyText.call({
      translate: (k, d) => d,
      reingestAsk: INGESTED,
      reingestCount: 3,
      ...over
    });

  it('states the live count in the body', () => {
    expect(body()).toContain('3');
    expect(body()).toContain('Solar System');
  });

  it('says so plainly when there is nothing to retry', () => {
    expect(body({ reingestCount: 0 })).toContain('no failed concepts');
  });
});

describe('Per-concept re-ingest affordance', () => {
  it('the rail emits "reingest"', () => {
    expect(ConceptList.emits).toContain('reingest');
  });
});
