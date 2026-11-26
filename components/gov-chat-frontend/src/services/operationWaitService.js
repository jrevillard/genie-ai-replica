// #2195 — the Studio's operation-wait registry.
//
// The Law (David, 2026-11-26): any operation that can exceed ~1 s registers
// here; the browser's native busy state never does the app's job again.
//
// Deliberately Vue-free: the registry holds PLAIN state and notifies plain
// subscribers. The overlay (AdminDashboard-mounted, fence-clean ruling)
// bridges snapshots into its own component state, so the wait UI renders off
// the reactive data path the operation feeds — the whole point when the main
// thread is saturated by a 10k-row commit.
//
// Fence note (2026-11-26): this service is consumed by the OKF Studio (an
// AdminDashboard tab) and mounts nothing global; httpService is NOT wired.

const MIN_VISIBLE_MS = 600; // a completed op stays listed this long — no flicker on fast ops

let nextId = 0;
/** id -> operation {id, name, label, done, total, state, startedAt} */
const operations = new Map();
/** id -> handle (the overlay cancels by id — snapshots carry no handles) */
const handles = new Map();
const subscribers = new Set();
let lastFailure = null;

function snapshot() {
  return {
    operations: Array.from(operations.values()).map((op) => ({
      id: op.id,
      name: op.name,
      label: op.label,
      labelKey: op.labelKey,
      done: op.done,
      total: op.total,
      state: op.state,
      cancellable: op.cancellable
    })),
    lastFailure: lastFailure ? { ...lastFailure } : null
  };
}

function notify() {
  const snap = snapshot();
  for (const fn of subscribers) {
    try {
      fn(snap);
    } catch (e) {
      // A subscriber must never break an operation's bookkeeping.
      console.warn('operationWait: subscriber threw', e && e.message);
    }
  }
}

function scheduleRemoval(id) {
  // Per-op timer, not an overlay-hide timer: a completion inside another
  // op's min-visible window removes only its own entry.
  setTimeout(() => {
    handles.delete(id);
    if (operations.delete(id)) notify();
  }, MIN_VISIBLE_MS);
}

/**
 * Register a long operation. Returns a handle the caller drives:
 *   setProgress(done, total?)  — update the visible counter
 *   complete()                 — success; leaves the list after MIN_VISIBLE_MS
 *   fail(message)              — records lastFailure; leaves the list after MIN_VISIBLE_MS
 *   cancel()                   — removes the op NOW, fires onCancel, rejects `cancelled`
 *   cancelled                  — promise rejecting when cancelled (await it to abort)
 */
function begin(name, opts = {}) {
  const id = `op${++nextId}`;
  let cancelReject = null;
  const cancelled = new Promise((resolve, reject) => {
    cancelReject = reject;
  });
  // Mark the rejection as handled at the source: an operation that never
  // awaits `cancelled` must not crash the app with an unhandled rejection
  // when the curator clicks Cancel. Awaiters still get the Error.
  cancelled.catch(() => {});
  const op = {
    id,
    name,
    label: opts.label || name,
    labelKey: opts.labelKey || null,
    done: 0,
    total: opts.total === undefined ? null : opts.total,
    state: 'active',
    cancellable: opts.cancellable !== false,
    startedAt: Date.now()
  };
  operations.set(id, op);
  notify();

  const handle = {
    id,
    get state() {
      const live = operations.get(id);
      return live ? live.state : 'removed';
    },
    cancelled,
    setProgress(done, total) {
      const live = operations.get(id);
      if (!live || live.state !== 'active') return;
      live.done = done;
      if (total !== undefined) live.total = total;
      notify();
    },
    complete() {
      const live = operations.get(id);
      if (!live || live.state !== 'active') return;
      live.state = 'completing';
      notify();
      scheduleRemoval(id);
    },
    fail(message) {
      const live = operations.get(id);
      if (!live || live.state !== 'active') return;
      live.state = 'failed';
      live.message = String(message || 'operation failed');
      lastFailure = { name: live.name, message: live.message, at: Date.now() };
      notify();
      scheduleRemoval(id);
    },
    cancel() {
      const live = operations.get(id);
      if (!live) return;
      operations.delete(id);
      handles.delete(id);
      notify();
      if (typeof opts.onCancel === 'function') opts.onCancel();
      cancelReject(new Error(`operation cancelled: ${live.name}`));
    }
  };
  handles.set(id, handle);
  return handle;
}

/**
 * Cancel by id — the overlay's affordance. The overlay holds SNAPSHOTS
 * (plain objects), never handles, so cancellation goes back through the
 * registry; this is the seam that keeps the render path decoupled.
 */
function cancel(id) {
  const handle = handles.get(id);
  if (handle) handle.cancel();
}

/** Subscribe to snapshot changes; returns the unsubscribe function. */
function subscribe(fn) {
  subscribers.add(fn);
  fn(snapshot());
  return () => subscribers.delete(fn);
}

/** Reset everything — test seam only; never called in production. */
function resetForTests() {
  operations.clear();
  handles.clear();
  subscribers.clear();
  lastFailure = null;
}

export default { begin, subscribe, cancel, getSnapshot: snapshot, resetForTests };
