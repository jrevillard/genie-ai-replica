// #2195 — the operation-wait service contract.
//
// The Studio's Law (issue #2195): any operation that can exceed ~1 s must
// register with the operation-wait system; the overlay renders OFF the data
// path the operation feeds. These tests pin the service contract the overlay
// and every registration site consume: named operations, progress,
// min-visible busy window, cancellation, and concurrent-operation semantics.
describe('operationWaitService', () => {
  let opWait;

  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();
    opWait = require('@/services/operationWaitService').default;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('begin registers a named operation and notifies subscribers', () => {
    const seen = [];
    const unsubscribe = opWait.subscribe((snap) => seen.push(snap));

    const handle = opWait.begin('concept-list-fetch', { label: 'Loading concepts', cancellable: true });

    const active = opWait.getSnapshot().operations;
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ name: 'concept-list-fetch', label: 'Loading concepts', state: 'active' });
    expect(seen.length).toBeGreaterThan(0);
    expect(handle.id).toBeDefined();
    unsubscribe();
  });

  test('cancellation is OPT-IN: no wired onCancel means NO Cancel affordance (fake-affordance kill)', () => {
    // Code review !1094: begin() defaulted cancellable to TRUE, so five of
    // six registration sites rendered a Cancel button that cancelled
    // nothing. The default is now OFF — an op shows Cancel only when it
    // wires a real onCancel abort.
    const bare = opWait.begin('repos-list', { label: 'Loading repositories' });
    expect(bare.state).toBe('active');
    expect(opWait.getSnapshot().operations[0].cancellable).toBe(false);

    const withRealAbort = opWait.begin('ragas-generate', {
      label: 'Generating benchmark',
      cancellable: true,
      onCancel: () => {}
    });
    expect(opWait.getSnapshot().operations[1].cancellable).toBe(true);
    expect(withRealAbort.state).toBe('active');

    // cancellable:true WITHOUT onCancel is still not cancellable — the flag
    // alone must never summon the button.
    const flagged = opWait.begin('links-fetch', { label: 'Loading links', cancellable: true });
    expect(opWait.getSnapshot().operations[2].cancellable).toBe(false);
    expect(flagged.state).toBe('active');
  });

  test('a NEW operation supersedes the previous failure — the stale red line never resurfaces', () => {
    const a = opWait.begin('concept-list-fetch', { label: 'Loading concepts' });
    a.fail('gateway 502');
    expect(opWait.getSnapshot().lastFailure).toMatchObject({ name: 'concept-list-fetch' });

    // The next operation clears the old failure (code review !1094: it used
    // to reappear atop unrelated later work — module state nothing cleared).
    opWait.begin('repos-list', { label: 'Loading repositories' });
    expect(opWait.getSnapshot().lastFailure).toBeNull();
  });

  test('setProgress updates the snapshot and notifies subscribers', () => {
    const handle = opWait.begin('links-fetch', { label: 'Loading links', total: 4 });
    const seen = [];
    opWait.subscribe((snap) => seen.push(snap));

    handle.setProgress(2, 4);

    const [op] = opWait.getSnapshot().operations;
    expect(op.done).toBe(2);
    expect(op.total).toBe(4);
    // subscribe delivers the current state immediately (a late subscriber —
    // the overlay mounting mid-operation — sees the truth without a race),
    // then every change follows.
    expect(seen.length).toBe(2);
    expect(seen[0].operations).toHaveLength(1);
    expect(seen[1].operations[0].done).toBe(2);
  });

  test('complete removes the operation after the min-visible window', () => {
    const handle = opWait.begin('repos-list', { label: 'Loading repositories' });
    handle.setProgress(1, 1);
    handle.complete();

    // Still visible inside the min-visible window (no flicker on fast ops).
    expect(opWait.getSnapshot().operations).toHaveLength(1);

    jest.advanceTimersByTime(1000);

    expect(opWait.getSnapshot().operations).toHaveLength(0);
  });

  test('the overlay stays busy until the LAST concurrent operation completes', () => {
    const a = opWait.begin('grant-wave', { label: 'Applying grants' });
    const b = opWait.begin('revoke-wave', { label: 'Applying revokes' });

    a.complete();
    jest.advanceTimersByTime(1000);
    expect(opWait.getSnapshot().operations).toHaveLength(1); // b still active

    b.complete();
    jest.advanceTimersByTime(1000);
    expect(opWait.getSnapshot().operations).toHaveLength(0);
  });

  test('cancel marks the operation cancelled, rejects its promise, and removes it', async () => {
    const onCancel = jest.fn();
    const handle = opWait.begin('pii-scan', { label: 'Scanning for PII', cancellable: true, onCancel });
    const rejection = handle.cancelled.catch((e) => e);

    handle.cancel();

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(opWait.getSnapshot().operations).toHaveLength(0);
    await expect(rejection).resolves.toBeInstanceOf(Error);
  });

  test('fail records the message and clears after the min-visible window', () => {
    const handle = opWait.begin('conformance-pass', { label: 'Validating repo' });
    handle.fail('validation endpoint unreachable');

    expect(opWait.getSnapshot().operations).toHaveLength(1);
    expect(opWait.getSnapshot().lastFailure).toMatchObject({
      name: 'conformance-pass',
      message: 'validation endpoint unreachable'
    });

    jest.advanceTimersByTime(1000);
    expect(opWait.getSnapshot().operations).toHaveLength(0);
  });

  test('cancel(id) cancels by id — the overlay holds snapshots, not handles', async () => {
    const onCancel = jest.fn();
    const handle = opWait.begin('pii-scan', { label: 'Scanning for PII', cancellable: true, onCancel });
    const rejection = handle.cancelled.catch((e) => e);

    opWait.cancel(handle.id);

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(opWait.getSnapshot().operations).toHaveLength(0);
    await expect(rejection).resolves.toBeInstanceOf(Error);
  });

  test('min-visible does not stack: an overlapping begin resets the window cleanly', () => {
    const a = opWait.begin('topic-link-run', { label: 'Linking topics' });
    a.complete();
    // A new operation starts inside a's min-visible window.
    const b = opWait.begin('ragas-generate', { label: 'Generating benchmark' });
    jest.advanceTimersByTime(1000);

    // a is gone (its window elapsed), b remains active — not swallowed.
    const names = opWait.getSnapshot().operations.map((o) => o.name);
    expect(names).toEqual(['ragas-generate']);
    expect(b.state).toBe('active');
  });
});
