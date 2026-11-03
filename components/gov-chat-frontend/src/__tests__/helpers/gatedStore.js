'use strict';

/**
 * PATCH-GATED STORE (round 26, #83615) — wrap a test store's dispatch so
 * ONE action type hangs on a manual gate: dispatching it returns a promise
 * that stays UNRESOLVED until release() fires, then settles with the given
 * envelope. Extracted from the verbatim 10-line scaffolds in editor.test.js
 * (the two flushPendingSave commit-ordering pins): the gate's resolution
 * shape is a hand-synced contract and the copies had already drifted from
 * the fake store's own patch shape — one owner now.
 *
 * @param {object} store       the test store whose dispatch is wrapped
 * @param {string} actionType  the action to gate (e.g. 'okf/patchConcept')
 * @param {*} [resolution]     what the gated dispatch resolves to on release
 *                             (default: the patch-success envelope the editor
 *                             pins assert against); spread per call, so no
 *                             caller can mutate a shared object
 * @returns {{store: object, release: () => void}} the SAME store (mutated in
 *         place) and the gate's release handle
 */
function gateStoreDispatch(store, actionType, resolution = { ok: true, content_hash: 'H2' }) {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const origDispatch = store.dispatch.bind(store);
  store.dispatch = (type, payload) => {
    if (type === actionType) return gate.then(() => ({ ...resolution }));
    return origDispatch(type, payload);
  };
  return { store, release };
}

module.exports = { gateStoreDispatch };
