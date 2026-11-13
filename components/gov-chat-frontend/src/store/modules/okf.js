/**
 * Vuex OKF Studio Module — Epic 3 (3-4 .. 3-8).
 *
 * State:
 *   drafts[repo_id]      resumable studio state (studio_step, source, preloaded, updated_at)
 *   reposById[id]        cached repo metadata (name, domain, lifecycle, concept_count, trust, cloned_from, metrics)
 *   reposByStage         bucketed repo_ids { draft: [], in_review: [], published: [] }
 *   selection            { documents: [], crawlSeeds: [], clonedFrom: null } — preloaded wizard inputs
 *   gates[okfRepoButton] { visible, reasonKey, reasonParams } — gates the doc-mgmt entry button
 *   ui                   { expertMode } — global Basic/Expert toggle (persisted to localStorage)
 *
 * NOT_READY semantics:
 *   Where a backend endpoint is missing (7.2 producer, 4.2b formatter,
 *   3.9 retract), the relevant action returns
 *   { ok: false, code: 'NOT_READY', message: '<i18n key>' }. The UI surfaces
 *   this as a translated toast — never as a hard error.
 *   Studio drafts are the exception since Story 10.5: the endpoint is live,
 *   so NOT_READY only surfaces against an older backend, and it is silent.
 *
 * POLL-ENVELOPE i18n (#80805): every message THIS module authors for a poll
 *   envelope (pollJob's abort/timeout arms and each action's `timeout`/
 *   `failed` fallbacks) is an okf.labErrors.* KEY, not English — the store
 *   has no translate context, so the consumer renders it through
 *   okfRepoOps.translateLabError(). A message that came from the SERVER
 *   (doc.error.message, err.message) stays verbatim and that helper passes
 *   it through untouched. The key strings live in ONE registry
 *   (LAB_ERROR_KEYS below, #80928/#80940) — never inline a labErrors
 *   literal at an emission site.
 */

const initialState = () => ({
  drafts: {},
  // Flips true when the studio-drafts endpoint proves genuinely ABSENT on
  // this server (NOT_READY from getDraft/saveDraft) — the session then stops
  // writing it (no spam). Story 10.5 shipped the route, so this only arms
  // against an older backend, never against an empty draft.
  draftsUnavailable: false,
  reposById: {},
  // Lifecycle lanes (David, 2026-08-28): five columns — In progress /
  // In review / Published / Ingested / Retracted. Published ≠ Ingested:
  // 'publish' + serving flag (ingested_at/ingested_version) drives the last
  // two; 'retracted' is its own visible state, never folded into Published.
  reposByStage: { draft: [], in_review: [], published: [], ingested: [], retracted: [] },
  selection: { documents: [], crawlSeeds: [], clonedFrom: null },
  // Server-side crawl→OKF conversions (David, 2026-09-02): repo_id →
  // {repo_id, name, conversion, file_id}. Live progress for the Dashboard
  // status bars; survives dialog close (store-scoped, poller-driven).
  crawlConversions: {},
  conversionPollTimer: null,
  gates: {
    okfRepoButton: { visible: false, reasonKey: null, reasonParams: {} }
  },
  versionsByRepo: {},
  // Story #978 — Studio editor state: which sub-tab (Wizard | Editor), which
  // repo is open, per-repo concept lists (left rail), the selected concept.
  editor: {
    subTab: 'editor', // 'editor' is the default per the UX design
    repoId: null,
    conceptsByRepo: {},
    selectedConceptId: null,
    loading: false,
    // NON-BLOCKING LOAD (David, 2026-09-12): { repoId, done, total } while a
    // chunked concept fetch is in flight (large repos), null otherwise.
    loadProgress: null
  },
  ui: {
    expertMode: readExpertModeFromStorage()
  },
  // W9 (concept tree browse, 2026-11-08) — the citizen modal browser's state,
  // opened from a working OKF citation card in EITHER chat surface. `concepts`
  // is the paginated tree index assembled progressively (stale-guarded, the
  // fetchConcepts pattern); the selection is the per-hop CAP-2 fetch. Never a
  // full-corpus payload: the store pages the server 200 rows at a time.
  // Shaped by initialBrowserState() (defined below initialState) so the
  // openBrowser reset and the initial state are ONE definition.
  browser: initialBrowserState(),
  error: null
});

/**
 * Lifecycle lane mapping (David, 2026-08-28) — the SINGLE definition of which
 * lane a repo lands in, used by fetchRepos AND the transition action. The
 * serving flag (ingested_at) separates Published from Ingested; 'retracted'
 * is its own lane. The old mapping compared against 'published' — a value the
 * server NEVER sets (the state is 'publish') — so published repos landed in
 * the wrong lane.
 *
 * BUILDING GATE (David, 2026-09-02): a repo whose source file is still
 * converting or whose concepts are still indexing stays pinned to the
 * "In progress" lane regardless of its lifecycle_state — the UI mirror of
 * the server's buildingBlocker (it refuses every transition while building).
 */
/** Append a repo_id to the DRAFT lane (round 23, review 81261: the identical
 * 4-line block was pasted in createFromCrawl and createRepo — and the
 * per-lane Array.isArray guard was dead by #80913's own reasoning, since
 * initialState() declares all five lanes as arrays). One paste, one place. */
function pushRepoToDraft(context, commit, repoId) {
  const byStage = context.state.okf.reposByStage;
  const draftLane = byStage.draft.slice();
  if (!draftLane.includes(repoId)) draftLane.push(repoId);
  commit('setReposByStage', { ...byStage, draft: draftLane });
}

function laneFor(repos) {
  // P0-UI: no isBuilding consult here anymore — lifecycle truth alone
  // buckets the lanes (the building state renders on the card, never as a
  // lane override).
  const byStage = { draft: [], in_review: [], published: [], ingested: [], retracted: [] };
  (repos || []).forEach((r) => {
    // P0-UI (David's re-test, 2026-09-08): LIFECYCLE TRUTH IS UNCONDITIONED.
    // The old !isBuilding(r) gate threw any repo with a stale drain flag
    // into the Import lane — a SERVING repo must never render there.
    // Building state shows via the card's pill/progress, never via the lane.
    let key = 'draft';
    if (r.lifecycle_state === 'review' || r.lifecycle_state === 'approve') key = 'in_review';
    else if (r.lifecycle_state === 'publish' && r.ingested_at) key = 'ingested';
    else if (r.lifecycle_state === 'publish') key = 'published';
    else if (r.lifecycle_state === 'retracted') key = 'retracted';
    else if (['version', 'deprecate', 'retire'].includes(r.lifecycle_state)) key = 'published'; // reserved → Published
    if (byStage[key]) byStage[key].push(r.repo_id);
  });
  return byStage;
}

function readExpertModeFromStorage() {
  try {
    return window.localStorage.getItem('okf.studio.expertMode') === 'expert';
  } catch {
    return false;
  }
}

/** The browser slice's rest state (openBrowser resets to it). Kept beside
 * initialState so the two can never drift — initialState composes it. */
function initialBrowserState() {
  return {
    visible: false,
    repoId: null,
    startConceptId: null,
    concepts: [],
    total: 0,
    loading: false,
    extending: false,
    treeComplete: false,
    progress: null,
    unavailable: false,
    error: null,
    selectedConceptId: null,
    selectedConcept: null,
    selectedLoading: false,
    selectedUnavailable: false,
    // #1836 back/forward: the browser is a browser — history of visited
    // concepts, most recent last; historyIndex points at the CURRENT entry.
    // browserVisit appends (truncating any forward tail, the web-history
    // semantic); browserGo moves the index. Seeded with startConceptId on
    // open; cleared by every openBrowser reset.
    history: [],
    historyIndex: -1
  };
}

function writeExpertModeToStorage(value) {
  try {
    window.localStorage.setItem('okf.studio.expertMode', value ? 'expert' : 'basic');
  } catch {
    /* private mode — ignore */
  }
}

/** NON-BLOCKING LOAD generation counter (see fetchConcepts). */
let fetchGeneration = 0;

/** Browser index-assembly generation counter (see fetchConceptTree): every
 * open increments it; an in-flight assembly whose generation moved (a newer
 * open, or a repo switch) drops its pages and exits without clearing the
 * NEWER fetch's loading/progress flags — the fetchConcepts round-11 rule. */
let browserTreeGeneration = 0;

/**
 * THE bounded poll loop behind every Testing-Lab async action (round 16,
 * #80124 — this replaced seven near-identical for(;;)+setTimeout copies).
 * The loop itself now lives in services/pollJob.js (the UX-4 bulk-PII job
 * nearly became the ninth copy, so the helper moved where services can use
 * it too); this store wrapper injects ONLY the Lab's two abort envelopes —
 * every other contract arm (deadline, transient tolerance, signal, done
 * mapping) is the shared module's, byte-for-byte.
 *
 * @param {object} p  the services/pollJob.js parameter object
 * @returns {Promise<{ok: boolean, code?: string, message?: string, result?: *}>}
 */
async function pollJob(p) {
  const { pollJob: pollJobLoop } = require('@/services/pollJob');
  return pollJobLoop({
    ...p,
    aborted: { code: 'POLL_ABORTED', message: LAB_ERROR_KEYS.pollAborted },
    abortedAfterSleep: { code: 'POLL_ABORTED', message: LAB_ERROR_KEYS.trackingStopped },
    // the Lab actions' onProgress callbacks read doc.progress — the shared
    // loop hands them the whole doc and the wrapper keeps that contract
    onProgress: p.onProgress ? (doc) => p.onProgress(doc && doc.progress) : null
  });
}

/**
 * LAB-ERROR KEY REGISTRY (#1350 review closeout) — the ONE place the
 * okf.labErrors.* key strings appear. Before the registry the literals were
 * inlined at every emission site and five of them appeared verbatim TWICE
 * (runFailed, suiteRunFailed, runCancelled, generationFailed, explainFailed),
 * so a rename touched each duplicate pair by hand and a miss drifted the
 * two families apart. The registry is the single owner; the locale tree
 * keeps exactly one leaf per key (localeConsistency's deep-key parity owns
 * the other 13 locales).
 *
 * ONE CODE, ONE KEY (#80928): the Lab's suite run used to answer the SAME
 * code RUN_FAILED the RAGAS run answers, with a DIFFERENT key — a consumer
 * switching on res.code could not tell which sentence it would get. The
 * suite family now answers SUITE_RUN_FAILED (pollHeadSuiteRun), so
 * RUN_FAILED means the RAGAS run everywhere. The shared horizon/cancel
 * codes (RUN_TIMEOUT, GENERATION_TIMEOUT, RUN_CANCELLED, EXPLAIN_TIMEOUT)
 * still carry one flavour key per FAMILY — visible side by side here —
 * their split is deliberately NOT part of this fix.
 */
const LAB_ERROR_KEYS = {
  pollAborted: 'okf.labErrors.pollAborted',
  trackingStopped: 'okf.labErrors.trackingStopped',
  suiteGenTimeout: 'okf.labErrors.suiteGenTimeout',
  suiteGenFailed: 'okf.labErrors.suiteGenFailed',
  suiteRunFailed: 'okf.labErrors.suiteRunFailed',
  suiteRunTimeout: 'okf.labErrors.runUnusuallyLong',
  runTimeout: 'okf.labErrors.runStillRunning',
  runAdoptTimeout: 'okf.labErrors.runStillExecuting',
  rescoreTimeout: 'okf.labErrors.rescoreStillRunning',
  runFailed: 'okf.labErrors.runFailed',
  runCancelled: 'okf.labErrors.runCancelled',
  rescoreCancelled: 'okf.labErrors.rescoreCancelled',
  runNotStarted: 'okf.labErrors.runNotStarted',
  rescoreNotStarted: 'okf.labErrors.rescoreNotStarted',
  rescoreFailed: 'okf.labErrors.rescoreFailed',
  generationTimeout: 'okf.labErrors.generationStillRunning',
  generationAdoptTimeout: 'okf.labErrors.generationStillServerSide',
  generationFailed: 'okf.labErrors.generationFailed',
  explainTimeout: 'okf.labErrors.explainStillRunning',
  explainShortTimeout: 'okf.labErrors.explainStillRunningShort',
  explainFailed: 'okf.labErrors.explainFailed'
};

const getters = {
  activeDraft: (state) => (repoId) => state.drafts[repoId] || null,
  repoById: (state) => (repoId) => state.reposById[repoId] || null,
  reposByStage: (state) => state.reposByStage,
  gate: (state) => (name) => state.gates[name] || { visible: false, reasonKey: null },
  // Story #978 — editor getters.
  editorSubTab: (state) => state.editor.subTab,
  editorRepoId: (state) => state.editor.repoId,
  conceptsByRepo: (state) => (repoId) => state.editor.conceptsByRepo[repoId] || [],
  conceptById: (state) => (repoId, conceptId) =>
    (state.editor.conceptsByRepo[repoId] || []).find((c) => c.concept_id === conceptId) || null,
  selectedConceptId: (state) => state.editor.selectedConceptId,
  editorLoadProgress: (state) => state.editor.loadProgress,
  versionsByRepo: (state) => (repoId) => state.versionsByRepo[repoId] || [],
  editorLoading: (state) => state.editor.loading,
  // W9 — the citizen concept-tree browser's whole state slice.
  browser: (state) => state.browser,
  isExpert: (state) => state.ui.expertMode,
  // The session latch: the draft endpoint is not available on this server.
  // ONE degraded state, ONE notice. A repo that is gone (REPO_NOT_FOUND) is
  // NOT a session state — it is that repo's own outcome, reported to the
  // caller (the wizard surfaces it); arming the latch for it would push
  // every OTHER repo's saves to local-only behind a notice nobody can act on.
  draftsUnavailable: (state) => state.draftsUnavailable === true,
  selection: (state) => state.selection,
  error: (state) => state.error
};

const mutations = {
  setDraft(state, { repoId, draft }) {
    state.drafts = { ...state.drafts, [repoId]: draft };
  },
  clearDraft(state, repoId) {
    const next = { ...state.drafts };
    delete next[repoId];
    state.drafts = next;
  },
  // Set only when the drafts endpoint proves genuinely missing (NOT_READY):
  // the session stops writing it, so a route that does not exist is not
  // hammered once per step change.
  setDraftsUnavailable(state) {
    state.draftsUnavailable = true;
  },
  clearDraftsUnavailable(state) {
    state.draftsUnavailable = false;
  },
  upsertRepo(state, repo) {
    if (!repo || !repo.repo_id) return;
    state.reposById = { ...state.reposById, [repo.repo_id]: repo };
  },
  setCrawlConversion(state, { repo_id, name, conversion, file_id }) {
    if (!repo_id) return;
    const prev = state.crawlConversions[repo_id];
    state.crawlConversions = {
      ...state.crawlConversions,
      [repo_id]: {
        repo_id,
        name: name || (prev && prev.name) || repo_id,
        conversion: conversion || (prev && prev.conversion) || { status: 'queued' },
        file_id: file_id || (prev && prev.file_id) || null
      }
    };
  },
  setConversionPollTimer(state, timer) {
    state.conversionPollTimer = timer;
  },
  removeRepo(state, repoId) {
    const next = { ...state.reposById };
    delete next[repoId];
    state.reposById = next;
  },
  setReposByStage(state, byStage) {
    state.reposByStage = byStage;
  },
  setRepoMetrics(state, { repoId, metrics }) {
    const existing = state.reposById[repoId];
    if (!existing) return;
    state.reposById = {
      ...state.reposById,
      [repoId]: { ...existing, metrics }
    };
  },
  setSelection(state, selection) {
    state.selection = { ...state.selection, ...selection };
  },
  clearSelection(state) {
    state.selection = { documents: [], crawlSeeds: [], clonedFrom: null };
  },
  setGate(state, { name, value }) {
    state.gates = { ...state.gates, [name]: value };
  },
  // Story #978 — editor mutations.
  setEditorSubTab(state, subTab) {
    state.editor = { ...state.editor, subTab: subTab === 'wizard' ? 'wizard' : 'editor' };
  },
  setEditorRepo(state, repoId) {
    state.editor = { ...state.editor, repoId: repoId || null };
  },
  setConcepts(state, { repoId, concepts }) {
    state.editor = {
      ...state.editor,
      conceptsByRepo: { ...state.editor.conceptsByRepo, [repoId]: concepts || [] }
    };
  },
  setSelectedConcept(state, conceptId) {
    state.editor = { ...state.editor, selectedConceptId: conceptId || null };
  },
  setVersions(state, { repoId, versions }) {
    state.versionsByRepo = { ...state.versionsByRepo, [repoId]: versions || [] };
  },
  setConceptsLoading(state, loading) {
    state.editor = { ...state.editor, loading: !!loading };
  },
  setConceptsLoadProgress(state, progress) {
    state.editor = { ...state.editor, loadProgress: progress || null };
  },
  setExpertMode(state, value) {
    state.ui = { ...state.ui, expertMode: !!value };
    writeExpertModeToStorage(!!value);
  },
  setError(state, value) {
    state.error = value;
  },

  // W9 — concept-tree browser mutations (the citizen modal viewer).
  /** Merge a patch into the browser slice (loading/total/unavailable/error...). */
  setBrowser(state, patch) {
    state.browser = { ...state.browser, ...patch };
  },
  /** Open the dialog fresh at a cited concept — every open RESETS the index
   * (browse reflects what is indexed NOW, never a stale cached corpus). */
  openBrowser(state, { repoId, conceptId } = {}) {
    state.browser = {
      ...initialBrowserState(),
      visible: true,
      repoId: repoId || null,
      startConceptId: conceptId || null,
      // The entry concept seeds the history (issue #1836 back/forward).
      history: conceptId ? [conceptId] : [],
      historyIndex: conceptId ? 0 : -1
    };
  },
  closeBrowser(state) {
    state.browser = { ...state.browser, visible: false };
  },
  appendBrowserConcepts(state, { repoId, rows }) {
    // A page from a SUPERSEDED repo is dropped, never appended (the stale
    // guard checks generation too — this is the repo-identity backstop).
    if (!repoId || state.browser.repoId !== repoId) return;
    state.browser = {
      ...state.browser,
      concepts: state.browser.concepts.concat(Array.isArray(rows) ? rows : [])
    };
  },
  setBrowserProgress(state, progress) {
    state.browser = { ...state.browser, progress: progress || null };
  },
  setBrowserSelected(state, { conceptId, concept }) {
    state.browser = {
      ...state.browser,
      selectedConceptId: conceptId || null,
      selectedConcept: concept || null,
      selectedUnavailable: false
    };
  },
  setBrowserSelectedLoading(state, loading) {
    state.browser = { ...state.browser, selectedLoading: !!loading };
  },
  setBrowserSelectedUnavailable(state) {
    state.browser = { ...state.browser, selectedConcept: null, selectedUnavailable: true };
  },
  /** #1836 — record a NEW visit: append to the history, truncating any
   * forward tail (the web-history semantic — after back, a new click kills
   * "forward"). A repeat of the CURRENT entry is a no-op (the click that
   * re-selects the shown concept must not grow the stack). */
  browserVisit(state, conceptId) {
    const b = state.browser;
    if (!conceptId || b.history[b.historyIndex] === conceptId) return;
    const history = b.history.slice(0, b.historyIndex + 1).concat(conceptId);
    state.browser = { ...b, history, historyIndex: history.length - 1 };
  },
  /** #1836 — move along the existing history (delta -1 back / +1 forward),
   * clamped to the ends: a boundary call is a no-op, never a wrap. The
   * selection follows the entry; the ACTION layer loads the content. */
  browserGo(state, delta) {
    const b = state.browser;
    const next = b.historyIndex + delta;
    if (next < 0 || next >= b.history.length) return;
    state.browser = { ...b, historyIndex: next, selectedConceptId: b.history[next] };
  }
};

const actions = {
  /** In-memory-only draft write (round 17, #80359): the pre-create wizard
   *  has no server repo to attach a draft to. Going through saveDraft with a
   *  'pending' alias PUT a route that 404s on every keystroke and armed
   *  draftsUnavailable against a healthy backend; this writes ONLY the
   *  local cache (same mutation saveDraft uses). */
  setDraftLocal({ commit }, { repoId, draft } = {}) {
    if (!repoId || !draft) return { ok: false, code: 'VALIDATION_ERROR' };
    // This action OWNS the updated_at stamp (round 18, #80468): leaving it to
    // the caller was one forgotten field away from silently breaking resume
    // ordering — and saveDraft's unavailable branch now delegates here rather
    // than inlining a second stamping site.
    commit('setDraft', { repoId, draft: { ...draft, updated_at: draft.updated_at ?? Date.now() } });
    return { ok: true, local: true };
  },
  /**
   * STORY 10.5 — hydrate the draft from the SERVER (this is what makes the
   * wizard survive a browser refresh: before it, `drafts` lived only in the
   * Vuex store and a refresh reopened the wizard at a fallback step with none
   * of the curation view-state).
   *
   * Cache-first, exactly like loadDraft: a draft already in `state.drafts` is
   * returned without a round-trip, so an in-session resume costs nothing.
   * `force: true` bypasses the cache (a re-read from disk).
   *
   * Outcomes (all non-throwing — the caller is UI code):
   *   { ok: true, draft, cached }  a draft is now in the store,
   *   { ok: true, draft: null }    the repo exists but has no draft yet, or
   *                                the repo is gone (REPO_NOT_FOUND resolves to
   *                                null in studioService) — NOT an error,
   *   { ok: false, code: 'NOT_READY' } the endpoint is not available on this
   *                                server; flags the session so later saves
   *                                do not hammer it.
   *
   * draftsUnavailable is set ONLY on a genuine NOT_READY — never on a
   * null draft, which is the normal first-open case.
   */
  async fetchDraft({ commit, state }, { repoId, force = false } = {}) {
    if (!repoId) return { ok: false, code: 'VALIDATION_ERROR', message: 'repoId required' };
    // While the session latch is armed, the CACHED draft proves nothing about
    // the endpoint: the server may have been upgraded (or the routing gap
    // that answered 404 closed) since it was fetched. Probe the server
    // instead — that probe is what recovers the latch, so the cache must not
    // short-circuit it.
    const latched = state.draftsUnavailable === true;
    if (!force && !latched && state.drafts[repoId]) {
      return { ok: true, draft: state.drafts[repoId], cached: true };
    }
    try {
      const draft = await studioService.getDraft(repoId);
      if (latched) {
        // The endpoint ANSWERED: the 404 that armed the latch was a routing
        // gap, not a missing route — recover. A null draft is an answer too
        // (the repo has no draft yet, or is gone — a REPO_NOT_FOUND 404 still
        // means the route exists), so the recovery must not sit behind the
        // null-draft early return.
        commit('clearDraftsUnavailable');
        // Keep the LOCAL draft: while the latch was armed, saves went
        // local-only, so the local copy is the fresher one. The server's
        // copy predates it and must not overwrite the curator's work.
        if (state.drafts[repoId]) return { ok: true, draft: state.drafts[repoId] };
        if (!draft) return { ok: true, draft: null };
        commit('setDraft', { repoId, draft: { ...draft, repo_id: repoId } });
        return { ok: true, draft };
      }
      if (!draft) return { ok: true, draft: null };
      // The wire draft is FLAT — commit it verbatim. A server that echoes a
      // stale/other repo_id would corrupt the map key, so trust the id we asked for.
      commit('setDraft', { repoId, draft: { ...draft, repo_id: repoId } });
      return { ok: true, draft };
    } catch (err) {
      if (err && err.code === 'NOT_READY') {
        // The endpoint is not available on this server (the server may be
        // older than this page, or the page older than the server — a 404
        // alone cannot tell the two apart, so the message stays party-neutral).
        // Flag the session so saveDraft stops re-hammering it; the wizard
        // keeps working off the in-memory draft exactly as it did before
        // Story 10.5.
        commit('setDraftsUnavailable');
        return { ok: false, code: 'NOT_READY', message: 'okf.studio.draft.notReady' };
      }
      return { ok: false, code: (err && err.code) || 'DRAFT_FETCH_FAILED', message: err && err.message };
    }
  },

  /**
   * Save a draft (upsert). Returns { ok, code? }.
   *
   * Story 10.5: the server endpoint is LIVE (`PUT /okf/repos/:id/draft`), so
   * every call now reaches the okf_studio_drafts collection. The R-D
   * session short-circuit is gone — with a real endpoint it only suppressed
   * legitimate writes after one transient failure. The in-memory draft is
   * still committed FIRST (Vuex-first), so the wizard renders regardless of
   * the network outcome.
   */
  async saveDraft({ commit, state, dispatch }, { repoId, draft }) {
    if (!repoId || !draft) {
      return { ok: false, code: 'VALIDATION_ERROR', message: 'repoId and draft required' };
    }
    // draftsUnavailable IS consumed (round 17, #80359): once the endpoint has
    // proven absent, later saves keep the local cache but stop re-hammering
    // the missing route — the "session stops writing it" the state flag
    // always promised.
    if (state.draftsUnavailable) {
      // delegate to the ONE local-write owner (#80468) — no second stamping site
      await dispatch('setDraftLocal', { repoId, draft });
      return { ok: true, skipped: 'unavailable' };
    }
    // WIZARD IDEMPOTENCY R-C (David, 2026-09-04): a published/ingested repo
    // has nothing to draft — the server write is SKIPPED entirely (it would
    // 409-spam); the in-memory draft still updates so the wizard keeps
    // rendering the resume state.
    const repo = state.reposById[repoId];
    if (repo && (repo.ingested_at || repo.lifecycle_state === 'publish')) {
      commit('setDraft', { repoId, draft: { ...draft, updated_at: Date.now() } });
      return { ok: true, skipped: 'frozen' };
    }
    commit('setDraft', { repoId, draft: { ...draft, updated_at: Date.now() } });
    try {
      // PUT /okf/repos/:repo_id/draft — the flat wire draft is passed through
      // unchanged; the service strips its reserved keys (repo_id,
      // studio_step, created_at, updated_at, schema_version) and stamps its
      // own timestamps.
      const saved = await studioService.saveDraft(repoId, draft);
      return { ok: true, saved: saved || null };
    } catch (err) {
      if (err && err.code === 'NOT_READY') {
        // Only reachable against a server WITHOUT the endpoint — flag it so
        // the session stops re-hammering a route it cannot reach.
        commit('setDraftsUnavailable');
        return { ok: false, code: 'NOT_READY', message: 'okf.studio.draft.notReady' };
      }
      if (err && err.code === 'REPO_NOT_FOUND') {
        // Definitive answer (typed by studioService's classifier — the ONE
        // owner of what a 404 means): THIS repo is gone. It must NOT arm
        // the session latch — that would push every OTHER repo's saves to
        // local-only behind a notice that blames a version mismatch. The
        // local draft stays (committed above); the caller surfaces the
        // repo-scoped outcome.
        return { ok: false, code: 'REPO_NOT_FOUND', message: err.message };
      }
      return {
        ok: false,
        code: (err && err.data && err.data.error) || 'DRAFT_SAVE_FAILED',
        message: err && err.message
      };
    }
  },

  async clearDraft({ commit }, repoId) {
    commit('clearDraft', repoId);
    return { ok: true };
  },

  async fetchRepos({ commit }, { stage = 'all' } = {}) {
    try {
      const repos = await repoOkfService.list({ stage });
      repos.forEach((r) => commit('upsertRepo', r));
      commit('setReposByStage', laneFor(repos));
      return { ok: true, repos };
    } catch (err) {
      commit('setError', err.message || 'fetchRepos failed');
      return { ok: false, code: 'FETCH_FAILED', message: err.message };
    }
  },

  async fetchRepoMetrics({ commit }, repoId) {
    try {
      const metrics = await repoOkfService.getMetrics(repoId);
      commit('setRepoMetrics', { repoId, metrics });
      return { ok: true, metrics };
    } catch (err) {
      // ONLY a 404 means 'no concepts yet' — every other failure (5xx,
      // network) must surface, not masquerade as empty placeholders
      // (review !622 round 10, #78748).
      const status = err && (err.status || (err.response && err.response.status));
      if (status === 404) {
        commit('setRepoMetrics', { repoId, metrics: null });
        return { ok: true, metrics: null };
      }
      commit('setError', err.message || 'fetchRepoMetrics failed');
      return { ok: false, code: 'METRICS_FAILED', message: err.message };
    }
  },

  async mintVersion({ commit }, { repoId, body, actor }) {
    try {
      return await repoOkfService.mintVersion(repoId, body, actor);
    } catch (err) {
      commit('setError', err.message || 'mintVersion failed');
      return { ok: false, code: 'MINT_FAILED', message: err.message };
    }
  },

  /**
   * Story 3.9 placeholder. Until the retract endpoint lands, returns NOT_READY.
   * The UI surfaces this as a disabled-with-tooltip + toast.
   */
  async requestRetract({ commit }, repoId) {
    commit('setError', null);
    return { ok: false, code: 'NOT_READY', message: 'okf.repos.retract.notReady', repoId };
  },

  /**
   * Bulk publish: iterate mintVersion per repo; collect per-row results.
   * NEVER force-publishes past a gate — a single failure does not abort the loop.
   */

  async updateLabels({ commit }, { repoId, labels }) {
    try {
      await repoOkfService.update(repoId, { labels });
      const existing = this.state?.okf?.reposById?.[repoId] || null;
      if (existing) {
        commit('upsertRepo', { ...existing, labels });
      }
      return { ok: true };
    } catch (err) {
      // Nothing persisted locally on failure — the optimistic upsertRepo above
      // runs only AFTER a successful PUT (the old comment claimed otherwise,
      // review !622 round 10, #78749). Pass the real status through so the UI
      // can tell 'endpoint missing' from 'labels rejected'.
      const status = err && (err.status || (err.response && err.response.status));
      return {
        ok: false,
        code: status === 404 ? 'NOT_READY' : 'LABELS_FAILED',
        message: err.message || 'okf.curator.labels.notReady',
        status
      };
    }
  },

  setExpertMode({ commit }, value) {
    commit('setExpertMode', value);
  },

  setSelection({ commit }, selection) {
    commit('setSelection', selection);
  },

  clearSelection({ commit }) {
    commit('clearSelection');
  },

  /**
   * Story 3-7 (fixed in #977): convert a crawled document into a draft OKF
   * repository. Wraps `crawlerToOkfService.convertCrawlToOkf` and upserts the
   * resulting repo into the store so the Studio dashboard sees it immediately.
   * Emits the `okf:okf-repo-created` window event so the StudioTab handler
   * can switch to the wizard at Step 5 (Curate) with the new repo loaded.
   *
   * Additive: the existing crawler freeform path (target=freeform) is
   * untouched — this action is only invoked from AddFromLinkDialog /
   * FileDetailsDialog when the steward explicitly selects OKF as the target.
   *
   * @param {Object} payload
   * @param {string} payload.fileId       doc-repo file_id of the crawled .md
   * @param {string} [payload.url]        crawled URL (name + title source, sent RAW — the server slugs)
   * @param {string} [payload.crawlJobId] crawl_job _key (audit)
   * @param {string} [payload.filename]   original file_name (preferred title, sent RAW — the server slugs)
   * @param {Object} [payload.actor]      auth hints (sub → x-actor-sub)
   * @param {string} [payload.domain]     subject area (defaults to 'general')
   * @returns {Promise<Object>} { ok, repo?, code?, message? }
   */
  async createFromCrawl({ commit, dispatch }, payload = {}) {
    commit('setError', null);
    try {
      const repo = await crawlerToOkfService.convertCrawlToOkf(payload);
      if (repo && repo.repo_id) {
        commit('upsertRepo', repo);
        // No fallback (#80913) — see createRepo: the 5-lane state always exists.
        // The append itself is shared with createRepo (pushRepoToDraft, below).
        pushRepoToDraft(this, commit, repo.repo_id);
        // Register for live progress tracking (the conversion is a
        // SERVER-SIDE job now — the repo doc's `conversion` field is the
        // source of truth; the poller keeps it fresh until terminal).
        commit('setCrawlConversion', {
          repo_id: repo.repo_id,
          name: repo.name,
          conversion: repo.conversion || { status: 'queued', stage: 'queued' },
          file_id: payload.fileId || null
        });
        dispatch('pollCrawlConversions');
        if (typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent('okf:okf-repo-created', {
              detail: { repo_id: repo.repo_id, repo, file_id: payload.fileId || null }
            })
          );
        }
      }
      return { ok: true, repo };
    } catch (err) {
      const code = err && err.code ? err.code : 'CRAWL_TO_OKF_FAILED';
      commit('setError', err.message || 'createFromCrawl failed');
      return { ok: false, code, message: err.message };
    }
  },

  /**
   * Poll GET /okf/repos/:id for every NON-TERMINAL crawl conversion and
   * merge the repo doc's `conversion` progress into the registry. One
   * lightweight interval serves all in-flight conversions; it stops itself
   * when none are active. Non-blocking by design — the UI never waits on it.
   */
  pollCrawlConversions({ commit }) {
    const state = this.state?.okf;
    if (!state || !state.crawlConversions) return;
    const active = Object.values(state.crawlConversions).filter(
      (c) => c.conversion && !['done', 'failed'].includes(c.conversion.status)
    );
    if (active.length === 0) return;
    if (state.conversionPollTimer) return; // already running
    const timer = setInterval(async () => {
      const s = this.state?.okf;
      const ids = Object.values(s.crawlConversions || {})
        .filter((c) => c.conversion && !['done', 'failed'].includes(c.conversion.status))
        .map((c) => c.repo_id);
      if (ids.length === 0) {
        clearInterval(s.conversionPollTimer);
        commit('setConversionPollTimer', null);
        return;
      }
      for (const repoId of ids) {
        try {
          const repo = await repoOkfService.get(repoId);
          if (repo && repo.conversion) {
            commit('setCrawlConversion', {
              repo_id: repoId,
              name: repo.name,
              conversion: repo.conversion,
              file_id: null
            });
          }
        } catch {
          // transient — the next tick retries; never block the UI
        }
      }
    }, 3000);
    commit('setConversionPollTimer', timer);
  },

  // ─── Story #978 — Studio Editor (Wizard | Editor sub-tabs) ───────────────

  /**
   * Create an EMPTY repo from scratch (Studio "+ New repository" dialog).
   * Delegates to the shared okfRepoOps library (equal features for the
   * wizard and editor UIs) and updates the dashboard lanes.
   */
  async createRepo({ commit }, { name, domain } = {}) {
    if (!name || typeof name !== 'string') {
      return { ok: false, code: 'VALIDATION_ERROR', message: 'name required' };
    }
    try {
      const repo = await okfRepoOps.createRepo({ name, domain });
      commit('upsertRepo', repo);
      // Round 21 audit (#80913): no fallback — initialState() declares the
      // full 5-lane reposByStage, so it is never nullish here; the round-20
      // `|| laneFor()` arm (and the 3-lane literal before it) was dead code.
      pushRepoToDraft(this, commit, repo.repo_id);
      return { ok: true, repo };
    } catch (err) {
      commit('setError', err.message || 'createRepo failed');
      // Preserve the server's code (DUPLICATE_REPO etc.) — Entry's curated
      // refusal copy keys off it; a hardcoded CREATE_FAILED made the branch
      // unreachable (max-review F11, 2026-09-27).
      // #1350 review closeout: when the repo was created but its index-skeleton
      // import failed, okfRepoOps promotes the error to the TYPED
      // partial-create contract — the stable INDEX_IMPORT_FAILED code (the
      // ONE discriminator okfRepoOps → store → create UIs agree on) plus
      // the created repo as a first-class `repo` field. Both flow through
      // so the UI can say "open it from the dashboard" instead of a blind
      // "failed" that invites a retry (which mints a SECOND repo).
      return { ok: false, code: err.code || 'CREATE_FAILED', message: err.message, repo: err.repo };
    }
  },

  /**
   * "+ Add concept": normalized paste + auto-append to the index TOC via
   * the shared okfRepoOps library.
   */
  async createConcept(
    { commit, dispatch, state },
    { repoId, title, type = 'topic', body = '', updateIndex = true } = {}
  ) {
    if (!repoId || !title) return { ok: false, code: 'VALIDATION_ERROR' };
    try {
      const rows = state.editor.conceptsByRepo[repoId] || [];
      const result = await okfRepoOps.addConcept({
        repoId,
        title,
        type,
        body,
        existingIds: rows.map((c) => c.concept_id),
        indexRow: updateIndex ? rows.find((c) => c.is_index) || null : null
      });
      await dispatch('fetchConcepts', repoId);
      return { ok: true, ...result };
    } catch (err) {
      commit('setError', err.message || 'createConcept failed');
      return { ok: false, code: 'CREATE_FAILED', message: err.message };
    }
  },

  /** Delete ONE concept (meta + chunks + graph) and refresh the rail. */
  async deleteConcept({ commit, dispatch, state }, { repoId, conceptId } = {}) {
    if (!repoId || !conceptId) return { ok: false, code: 'VALIDATION_ERROR' };
    try {
      await okfRepoOps.deleteConcept(repoId, conceptId);
      if (state.editor.selectedConceptId === conceptId) commit('setSelectedConcept', null);
      await dispatch('fetchConcepts', repoId);
      return { ok: true };
    } catch (err) {
      commit('setError', err.message || 'deleteConcept failed');
      return { ok: false, code: 'DELETE_FAILED', message: err.message };
    }
  },

  /**
   * RE-INGEST FAILED CONCEPTS (David, 2026-10-14). Omit conceptId for the whole
   * repo; pass one for a single row.
   *
   * Never throws — matches every other action in this module. Refetches the
   * concept list afterwards so the failed rows repaint out of their error state,
   * and refetches the repo so the card's ingest state follows the new drain.
   */
  async reingestFailed({ commit, dispatch }, { repoId, conceptId, actor } = {}) {
    if (!repoId) return { ok: false, code: 'VALIDATION_ERROR', message: 'repoId is required' };
    try {
      const result = await repoOkfService.reingestFailed(repoId, { conceptId: conceptId || null }, actor || {});
      if (!result || result.ok !== true) {
        return {
          ok: false,
          code: (result && result.code) || 'REINGEST_FAILED',
          message: (result && result.message) || 'Re-ingest failed'
        };
      }
      await dispatch('fetchConcepts', repoId);
      // Refresh the repo doc the way lifecycleTransition does — there is no
      // fetchRepo action, and a stale card would keep showing the old ingest
      // state (rag_drain_active flips to true the moment the action arms).
      const repo = await repoOkfService.get(repoId).catch(() => null);
      if (repo) commit('upsertRepo', repo);
      return { ok: true, requeued: result.requeued || 0, conceptIds: result.concept_ids || [] };
    } catch (err) {
      commit('setError', err.message || 'reingestFailed failed');
      return { ok: false, code: 'REINGEST_FAILED', message: err.message };
    }
  },

  async openEditor({ commit, dispatch }, { repoId } = {}) {
    if (!repoId) return { ok: false, code: 'VALIDATION_ERROR' };
    commit('setEditorRepo', repoId);
    commit('setSelectedConcept', null);
    return dispatch('fetchConcepts', repoId);
  },

  /**
   * Fetch (or refetch) the concept list for the editor's left rail.
   *
   * NON-BLOCKING LOAD (David, 2026-09-12): a large repository arrived as ONE
   * payload and rendered in one synchronous patch — the browser showed the
   * "page unresponsive" wait message. The fetch now pages the server
   * (?limit=&offset=) and commits each page as it lands: rows appear
   * progressively, every Vue patch stays bounded, and a REAL progress bar
   * (done/total from the server) renders while the load runs. A legacy
   * array response (or any single-page repo) commits once with no progress
   * state — small repos never see a flash of bar.
   */
  async fetchConcepts({ commit, state }, repoId) {
    if (!repoId) return { ok: false, code: 'VALIDATION_ERROR' };
    const PAGE = 200;
    const myGen = ++fetchGeneration;
    commit('setConceptsLoading', true);
    commit('setConceptsLoadProgress', null);
    const stale = () => myGen !== fetchGeneration || (state.editor.repoId && state.editor.repoId !== repoId);
    try {
      const first = await conceptService.listForRepo(repoId, { limit: PAGE, offset: 0 });
      // STALE GUARD BEFORE THE FIRST COMMIT (round 20): the repo could have
      // switched while page 1 was in flight — committing then would plant
      // the OLD repo's rows over the NEW repo's editor. Same cleanup rule
      // as the in-loop guard below.
      if (stale()) {
        if (myGen === fetchGeneration) {
          commit('setConceptsLoading', false);
          commit('setConceptsLoadProgress', null);
        }
        return { ok: true, concepts: [], stale: true };
      }
      // Legacy contract: a plain array (mocked tests / older servers) — one commit.
      if (Array.isArray(first)) {
        commit('setConcepts', { repoId, concepts: first });
        return { ok: true, concepts: first };
      }
      const total = (first && first.total) || 0;
      let acc = (first && Array.isArray(first.concepts) ? first.concepts : []).slice();
      commit('setConcepts', { repoId, concepts: acc });
      const multiPage = total > PAGE;
      if (multiPage) commit('setConceptsLoadProgress', { repoId, done: acc.length, total });
      while (acc.length < total) {
        // Pages are SEQUENTIAL by design — each offset needs the previous count.
        const page = await conceptService.listForRepo(repoId, { limit: PAGE, offset: acc.length });
        if (stale()) {
          // Round 11 (!622): the abandoned fetch must clean up after itself
          // — EXCEPT when a NEWER fetch superseded it (generation moved):
          // that fetch owns the loading/progress flags now and clearing
          // them here would flash its bar off. Repo-switched with no newer
          // fetch: nobody else clears them, so this exit does (it used to
          // leave loading=true + a frozen {done,total} for the dead repo).
          if (myGen === fetchGeneration) {
            commit('setConceptsLoading', false);
            commit('setConceptsLoadProgress', null);
          }
          return { ok: true, concepts: acc, stale: true };
        }
        const rows = page && Array.isArray(page.concepts) ? page.concepts : Array.isArray(page) ? page : [];
        acc = acc.concat(rows);
        commit('setConcepts', { repoId, concepts: acc });
        if (multiPage) commit('setConceptsLoadProgress', { repoId, done: acc.length, total });
      }
      // TAIL GUARD (round 20b, #80862): the natural-completion arm needs the
      // same predicate as the in-loop guard — a fetch superseded while its
      // LAST page was in flight must not clear the NEWER fetch's live
      // progress bar on its way out. Repo-switched with no newer fetch:
      // nobody else owns the flags, so this exit clears them. (Defense-in-
      // depth: the round-11 guard RETURNS at every page boundary and there
      // is no await between the last boundary and here, so this arm is not
      // reachable stale today — it holds the line if one is ever added.)
      if (stale()) {
        if (myGen === fetchGeneration) {
          commit('setConceptsLoading', false);
          commit('setConceptsLoadProgress', null);
        }
        return { ok: true, concepts: acc, stale: true };
      }
      commit('setConceptsLoadProgress', null);
      return { ok: true, concepts: acc };
    } catch (err) {
      commit('setError', err.message || 'fetchConcepts failed');
      // KEEP THE LAST KNOWN LIST (round 20, #80803): the already-loaded rows
      // are known-good data — one gateway 502 (or a failed page N of the
      // paging loop) must not blank the rail to "0 concepts" and destroy
      // the curator's context; the editor re-fetches on the next concept
      // click anyway. Empty the list only when none was ever loaded here.
      if (!state.editor.conceptsByRepo[repoId]) commit('setConcepts', { repoId, concepts: [] });
      commit('setConceptsLoadProgress', null);
      return { ok: false, code: 'FETCH_FAILED', message: err.message };
    } finally {
      if (!stale()) commit('setConceptsLoading', false);
    }
  },

  /** Full meta row (frontmatter + body) for the center pane. */
  async getConcept(_ctx, { repoId, conceptId } = {}) {
    if (!repoId || !conceptId) return { ok: false, code: 'VALIDATION_ERROR' };
    try {
      const concept = await conceptService.get(repoId, conceptId);
      return { ok: !!concept, concept };
    } catch (err) {
      return { ok: false, code: 'FETCH_FAILED', message: err.message };
    }
  },

  /**
   * PATCH one concept — full markdown OR body-only (labels write-through,
   * 2026-09-05: the editor saves body-only while its frontmatter is
   * untouched, so a concurrent label write is never clobbered by a stale
   * fm snapshot). Exactly one of the two is required. On success the row's
   * content_hash + index_status ride back on the response — refresh the row
   * in place so the left rail reflects the new state without a refetch.
   */
  async patchConcept({ commit, state }, { repoId, conceptId, markdown, body, actor } = {}) {
    const hasMarkdown = typeof markdown === 'string';
    const hasBody = typeof body === 'string';
    if (!repoId || !conceptId || hasMarkdown === hasBody) {
      return { ok: false, code: 'VALIDATION_ERROR' };
    }
    try {
      const result = hasMarkdown
        ? await repoOkfService.patchConcept(repoId, conceptId, markdown, actor)
        : await repoOkfService.patchConceptBody(repoId, conceptId, body, actor);
      const rows = (state.editor.conceptsByRepo[repoId] || []).slice();
      const idx = rows.findIndex((c) => c.concept_id === conceptId);
      if (idx !== -1) {
        rows[idx] = {
          ...rows[idx],
          content_hash: result.content_hash,
          index_status: result.index_status,
          updated_at: result.updated_at
        };
        commit('setConcepts', { repoId, concepts: rows });
      }
      return { ok: true, ...result };
    } catch (err) {
      // A rejection can carry anything, including no error object at all.
      // Reading `err.message` unguarded threw on such a rejection — inside
      // the catch, so the dispatch REJECTED instead of answering "the save
      // failed", and the editor was left with nothing. The guard the code
      // below already used (`err && err.data && …`) is applied to the
      // message as well, so both reads agree on what a failure is.
      const message = (err && err.message) || 'patchConcept failed';
      commit('setError', message);
      // KEEP THE SERVER'S ERROR CODE (the pattern every other action in this
      // module already uses — see the draft-save action's
      // `code: (err && err.data && err.data.error) || '…'`). Flattening every
      // failure to PATCH_FAILED made the server's specific refusals
      // invisible: a 409 CONCEPT_TOO_LARGE (the concept-document ceiling)
      // reached the editor as a generic failure, and the curator was told
      // "retry" — advice that cannot work, because retrying an over-ceiling
      // save fails identically forever.
      return {
        ok: false,
        code: (err && err.data && err.data.error) || 'PATCH_FAILED',
        message
      };
    }
  },

  /**
   * Story 1.7 (2026-10-08) — TWO-WRITE save for the per-repo frontmatter
   * (the chip UI's "Save tags" action). Writes the approved set to BOTH
   * the curator-facing index.md YAML block (via concept PATCH, which the
   * server's patchConceptFields path handles) AND the canonical
   * okf_repositories.frontmatter doc field (via repo PATCH, which the
   * service's writeFrontmatterToRepoDoc handles). The publish gate reads
   * the doc field; the curator edits the YAML.
   *
   * Order matters: the YAML write first, the doc field second. If the
   * YAML write fails, do NOT touch the doc field (avoids divergence). If
   * the doc field write fails after a successful YAML write, surface the
   * partial-success error and let the curator retry (both writes are
   * idempotent).
   *
   * Pre-save flush: the caller (FrontmatterPanel) MUST call the editor's
   * flushPendingSave() before this action so the editor's debounced
   * autosave does not overwrite the wizard's just-saved YAML with stale
   * uncommitted draft text.
   */
  async saveFrontmatter({ commit, dispatch }, { repoId, shape } = {}) {
    if (!repoId || !shape) return { ok: false, code: 'VALIDATION_ERROR' };
    try {
      const { mergeFrontmatterIntoIndexMarkdown } = await import(
        /* webpackChunkName: "frontmatter-merge" */ '../../services/frontmatterMerge'
      );
      const conceptService = (await import(/* webpackChunkName: "concept" */ '../../services/conceptService')).default;
      const frontmatterService = await import(/* webpackChunkName: "fm" */ '../../services/frontmatterService');

      // 1. Read current index.md to merge into the existing YAML.
      const indexDoc = await conceptService.get(repoId, 'index');
      if (!indexDoc) return { ok: false, code: 'CONCEPT_NOT_FOUND', step: 'get' };
      // conceptService.get returns { frontmatter, body, ... } (the parsed
      // doc). Reconstruct the markdown via gray-matter so the
      // helper's matter() parse is symmetric.
      const matter =
        (await import(/* webpackChunkName: "gm" */ 'gray-matter')).default || (await import('gray-matter'));
      const indexMarkdown = indexDoc.frontmatter
        ? matter.stringify(indexDoc.body || '', indexDoc.frontmatter)
        : indexDoc.body || '';

      // 2. Build the new index.md with the approved frontmatter block
      //    written in. Preserves the rest of the YAML + the body.
      const nextMarkdown = mergeFrontmatterIntoIndexMarkdown(indexMarkdown, shape);

      // 3. PATCH the index concept (writes the YAML).
      const yamlResult = await dispatch('patchConcept', {
        repoId,
        conceptId: 'index',
        markdown: nextMarkdown
      });
      if (!yamlResult || !yamlResult.ok) {
        return { ok: false, code: 'PATCH_FAILED', step: 'yaml', error: yamlResult };
      }

      // 4. PATCH the repo doc (writes okf_repositories.frontmatter —
      //    the canonical store the publish gate reads at
      //    lifecycle-service.js:618).
      const docResult = await frontmatterService.patchFrontmatter(repoId, shape);
      // patchFrontmatter returns the doc field's summary (or 4xx on
      // validation failure). Treat any 2xx as success.

      return { ok: true, step: 'done', yaml: yamlResult, doc: docResult };
    } catch (err) {
      commit('setError', err.message || 'saveFrontmatter failed');
      return {
        ok: false,
        code: err && err.code ? err.code : 'SAVE_FAILED',
        step: err && err.step ? err.step : 'unknown',
        message: err && err.message
      };
    }
  },

  /**
   * Re-split from source: deletes all concepts + graph, re-ingests per mode.
   * Refreshes the concept list afterwards (the old rows are all stale).
   */
  async resplitRepo({ commit, dispatch }, { repoId, mode, fileId, actor } = {}) {
    if (!repoId || !mode) return { ok: false, code: 'VALIDATION_ERROR' };
    try {
      const summary = await repoOkfService.resplit(repoId, mode, fileId, actor);
      await dispatch('fetchConcepts', repoId);
      return { ok: true, ...summary };
    } catch (err) {
      commit('setError', err.message || 'resplitRepo failed');
      return { ok: false, code: 'RESPLIT_FAILED', message: err.message };
    }
  },

  /**
   * Frontmatter autocorrect. dryRun=true (default) → { changes, warnings }
   * preview only; dryRun=false applies. Always refetches when applying so the
   * rows reflect the written frontmatter.
   */
  async autocorrectRepo({ commit, dispatch }, { repoId, dryRun = true, mode, conceptId, actor } = {}) {
    if (!repoId) return { ok: false, code: 'VALIDATION_ERROR' };
    try {
      const result = await repoOkfService.autocorrect(repoId, { dryRun, mode, conceptId }, actor);
      if (!dryRun) await dispatch('fetchConcepts', repoId);
      // D-L/D-B: curated modes return {ok, mode, dry_run, proposals,
      // applied} — normalize proposals (array OR single object) into the
      // panel's change rows. Heuristics returns the legacy {changes,
      // warnings} untouched.
      const normalized = { ...result };
      if (result && Array.isArray(result.proposals)) {
        normalized.changes = result.proposals;
      } else if (result && result.proposals && typeof result.proposals === 'object') {
        normalized.changes = [result.proposals];
      }
      return { ok: true, ...normalized };
    } catch (err) {
      commit('setError', err.message || 'autocorrectRepo failed');
      return { ok: false, code: 'AUTOCORRECT_FAILED', message: err.message };
    }
  },

  /**
   * Story #978 lifecycle (David, 2026-08-28) — apply ONE lifecycle transition
   * via the shared okfRepoOps wrappers (wizard + editor + dashboard all go
   * through here), then refresh the repo row from the server so the lanes,
   * version + bundle info update immediately.
   */
  async lifecycleTransition({ commit }, { repoId, action, actor } = {}) {
    try {
      const result = await okfRepoOps.lifecycle(repoId, action, actor || {});
      const repo = await repoOkfService.get(repoId).catch(() => null);
      if (repo) commit('upsertRepo', repo);
      return { ok: true, result };
    } catch (err) {
      return {
        ok: false,
        // axios interceptor rejections carry the server error code in
        // err.data.error (err.code is undefined for HTTP error responses).
        code: (err && (err.code || (err.data && err.data.error))) || 'LIFECYCLE_FAILED',
        message: err.message || 'lifecycle transition failed'
      };
    }
  },

  /**
   * Story #978 — delete the whole repository (cascade). The server refuses
   * while an ingested version is serving (INGESTED_DELETE_BLOCKED).
   * W8 (#925): `reason` rides to the server and lands on the delete audit row.
   */
  async deleteRepoAction({ commit, state }, { repoId, reason } = {}) {
    try {
      await okfRepoOps.deleteRepo(repoId, reason);
      commit('removeRepo', repoId);
      // Recompute the lanes from the remaining repos — a stale lane entry
      // would keep rendering a deleted card (live-caught by the store test).
      commit('setReposByStage', laneFor(Object.values(state.reposById)));
      return { ok: true };
    } catch (err) {
      return { ok: false, code: (err && err.code) || 'DELETE_FAILED', message: err.message };
    }
  },

  /**
   * Story #978 (David, 2026-08-28) — import a zip bundle as a NEW draft repo
   * via the shared library, cache the repo, and recompute the lanes.
   */
  async upsertImported({ commit, state }, { file, name, domain, classification } = {}) {
    try {
      const repo = await okfRepoOps.importRepoZip({ file, name, domain, classification });
      commit('upsertRepo', repo);
      const repos = Object.values(state.reposById);
      commit('setReposByStage', laneFor(repos));
      return { ok: true, repo };
    } catch (err) {
      const code = (err && err.code) || 'IMPORT_FAILED';
      // A partial create (typed contract, #80937) carries the minted repo —
      // cache it so the steward can open the repo instead of re-importing.
      if (err && err.repo) commit('upsertRepo', err.repo);
      return { ok: false, code, message: err.message, repo: err && err.repo };
    }
  },

  /** Story #978 — fetch the repo's version manifests for the versions panel. */
  async fetchVersions({ commit }, repoId) {
    try {
      const versions = await okfRepoOps.listVersions(repoId);
      commit('setVersions', { repoId, versions });
      return { ok: true, versions };
    } catch (err) {
      return { ok: false, code: 'VERSIONS_FAILED', message: err.message };
    }
  },

  // ─── Step-7 validation (#1030 + #1036, David 2026-10-02) ──────────────────

  /** The unified Validate issue list — conformance, orphans, near-duplicates,
   * unlinked citations — each with severity + remedy. */
  async fetchValidation(_ctx, repoId) {
    try {
      const report = await repoOkfService.getValidation(repoId);
      return { ok: true, report };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  },

  /** Citation hub wiring (#1036): create the Sources page when missing and
   * link every citing page to it (born-right frontmatter links). */
  async wireCitations(_ctx, { repoId, hubConceptId } = {}) {
    try {
      const result = await repoOkfService.wireCitations(repoId, hubConceptId);
      return { ok: true, result };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  },

  /** LLM link suggestions for an orphaned page (read-only proposals). */
  async suggestLinks(_ctx, { repoId, conceptId }) {
    try {
      const result = await repoOkfService.suggestLinks(repoId, conceptId);
      return { ok: true, result };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  },

  /** Accept one suggested link — a frontmatter links[] append (born right). */
  async acceptLink(_ctx, { repoId, conceptId, toConceptId, label }) {
    try {
      const result = await repoOkfService.acceptLink(repoId, conceptId, toConceptId, label);
      return { ok: true, result };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  },

  /** Start a whole-corpus topic-link run (Story 1-8g-p) — the same generic
   * pass the wizard runs at import time. Detached server-side. */
  async startTopicLinks(_ctx, { repoId, dryRun } = {}) {
    try {
      const result = await repoOkfService.startTopicLinks(repoId, dryRun);
      return { ok: true, result };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  },

  /** Poll the topic-link run state (null when the repo never ran one). */
  async getTopicLinkRun(_ctx, { repoId } = {}) {
    try {
      const result = await repoOkfService.getTopicLinkRun(repoId);
      return { ok: true, result };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  },

  // ─── PII RE-SCAN (2026-10-12) ────────────────────────────────────────────────
  // The PERSISTING scan paths. pii-inspect ("Nothing persisted") is still
  // what the panel OPENS with — it is cheap and cache-backed — but the
  // curator's Re-scan button must write, or a concept stuck on pii_state
  // 'error' can never be cleared and the publish gate stays blocked forever.
  // The error envelope is preserved (status + server message) because the UI
  // has to say WHY a re-scan failed — a 404 here means "this server build has
  // no re-scan route", which is the exact silent no-op this replaces.

  /** Re-scan ONE concept and persist the verdict onto its meta row. */
  async rescanConceptPii(_ctx, { repoId, conceptId } = {}) {
    if (!repoId || !conceptId) return { ok: false, code: 'VALIDATION_ERROR', error: 'repoId + conceptId required' };
    try {
      // FETCH THE CONTENT FIRST (round 16, #80119): scanConceptPii's own
      // contract requires frontmatter+body — the server scans what it is
      // given, so an empty body would write a meaningless verdict onto the
      // meta row, and a 'clean' from an empty scan is a FALSE all-clear the
      // publish gate then trusts. No content → no scan (fail closed).
      const concept = await conceptService.get(repoId, conceptId);
      if (!concept || typeof concept.body !== 'string') {
        return { ok: false, code: 'CONCEPT_UNAVAILABLE', error: 'concept content could not be loaded — scan refused' };
      }
      const result = await repoOkfService.scanConceptPii(repoId, conceptId, {
        rescan: true,
        frontmatter: concept.frontmatter || {},
        body: concept.body
      });
      return { ok: true, result };
    } catch (err) {
      return {
        ok: false,
        code: (err && (err.code || (err.data && err.data.error))) || 'RESCAN_FAILED',
        status: err && err.status,
        error: err && err.message
      };
    }
  },

  /** ARM the repository-wide concept rescan (async — 202 + poll). */
  async startRepoPiiScan(_ctx, { repoId } = {}) {
    if (!repoId) return { ok: false, code: 'VALIDATION_ERROR', error: 'repoId required' };
    try {
      const result = await repoOkfService.startRepoPiiScan(repoId);
      return { ok: true, result };
    } catch (err) {
      return {
        ok: false,
        code: (err && (err.code || (err.data && err.data.error))) || 'RESCAN_FAILED',
        status: err && err.status,
        error: err && err.message
      };
    }
  },

  /** POLL an armed concept rescan: {status:'running'|'failed'|'done', ...}. */
  async getRepoPiiScan(_ctx, { repoId, scanKey } = {}) {
    if (!repoId || !scanKey) return { ok: false, code: 'VALIDATION_ERROR', error: 'repoId + scanKey required' };
    try {
      const result = await repoOkfService.getRepoPiiScan(repoId, scanKey);
      return { ok: true, result };
    } catch (err) {
      return {
        ok: false,
        code: (err && (err.code || (err.data && err.data.error))) || 'RESCAN_FAILED',
        status: err && err.status,
        error: err && err.message
      };
    }
  },

  // ─── Story 1-8 (2026-10-08): Testing Lab ─────────────────────
  // All wrap headTestService and return {ok, code?, message?, result?} —
  // the dialog renders err.data.error/message (server envelope) like
  // lifecycleTransition does.

  /** Re-run the vectorized head from the CURRENT stored frontmatter. */
  async headRebuild(_ctx, { repoId } = {}) {
    try {
      const result = await headTestService.rebuildHead(repoId);
      return { ok: true, result };
    } catch (err) {
      return {
        ok: false,
        code: (err && (err.code || (err.data && err.data.error))) || 'REBUILD_FAILED',
        message: err.message
      };
    }
  },

  /** Two-leg routing simulation for ONE query (the Test tab). */
  async headRoutingTest(_ctx, { repoId, query, formula } = {}) {
    try {
      const result = await headTestService.routingTest(repoId, { query, formula, include_probes: false });
      return { ok: true, result };
    } catch (err) {
      return {
        ok: false,
        code: (err && (err.code || (err.data && err.data.error))) || 'ROUTING_TEST_FAILED',
        message: err.message
      };
    }
  },

  /** Generate a test suite (LLM + forbidden-derived negatives). The
   * 1-8c count knobs are optional — undefined lets the server apply its
   * own per-class defaults/clamps. */
  async headSuiteGenerate(_ctx, { repoId, nPositive, nNegative, nNegativeRandom, nMeta, nNearMiss, name } = {}) {
    try {
      const result = await headTestService.generateSuite(repoId, {
        n_positive: nPositive,
        n_negative: nNegative,
        n_negative_random: nNegativeRandom,
        n_meta: nMeta,
        n_near_miss: nNearMiss,
        name
      });
      return { ok: true, result };
    } catch (err) {
      return {
        ok: false,
        code: (err && (err.code || (err.data && err.data.error))) || 'SUITE_FAILED',
        message: err.message
      };
    }
  },

  /** Curator free-text additions to a suite. */
  async headSuiteAddQueries(_ctx, { repoId, suiteKey, queries } = {}) {
    try {
      const result = await headTestService.addSuiteQueries(repoId, suiteKey, queries);
      return { ok: true, result };
    } catch (err) {
      return {
        ok: false,
        code: (err && (err.code || (err.data && err.data.error))) || 'SUITE_UPDATE_FAILED',
        message: err.message
      };
    }
  },

  /** Story 1-8f — load ONE saved suite (full rows) back into the Lab. */
  async headSuiteGet(_ctx, { repoId, suiteKey } = {}) {
    try {
      const result = await headTestService.getSuite(repoId, suiteKey);
      return { ok: true, result };
    } catch (err) {
      return {
        ok: false,
        code: (err && (err.code || (err.data && err.data.error))) || 'SUITE_LOAD_FAILED',
        message: err.message
      };
    }
  },

  /** Story 1-8f — edit a suite's rows in place (kind flips + removes). */
  async headSuiteUpdateRows(_ctx, { repoId, suiteKey, payload } = {}) {
    try {
      const result = await headTestService.updateSuiteRows(repoId, suiteKey, payload);
      return { ok: true, result };
    } catch (err) {
      return {
        ok: false,
        code: (err && (err.code || (err.data && err.data.error))) || 'SUITE_UPDATE_FAILED',
        message: err.message
      };
    }
  },

  /** Story 1-8f — name/rename a suite. */
  async headSuiteRename(_ctx, { repoId, suiteKey, name } = {}) {
    try {
      const result = await headTestService.renameSuite(repoId, suiteKey, name);
      return { ok: true, result };
    } catch (err) {
      return {
        ok: false,
        code: (err && (err.code || (err.data && err.data.error))) || 'SUITE_RENAME_FAILED',
        message: err.message
      };
    }
  },

  /** Story 1-8g — delete a saved suite (and its run docs). */
  async headSuiteDelete(_ctx, { repoId, suiteKey } = {}) {
    try {
      const result = await headTestService.deleteSuite(repoId, suiteKey);
      return { ok: true, result };
    } catch (err) {
      return {
        ok: false,
        code: (err && (err.code || (err.data && err.data.error))) || 'SUITE_DELETE_FAILED',
        message: err.message
      };
    }
  },

  /** Story 1-8g — the click-test: one query against the LIVE corpus
   * (coverage verdict via the pipeline's reranker). */
  async headSuiteProbe(_ctx, { repoId, suiteKey, query } = {}) {
    try {
      const result = await headTestService.probeSuiteQuery(repoId, suiteKey, query);
      return { ok: true, result };
    } catch (err) {
      return {
        ok: false,
        code: (err && (err.code || (err.data && err.data.error))) || 'PROBE_FAILED',
        message: err.message
      };
    }
  },

  /** Run every suite query + aggregate pass rates / margins / steals. */
  async headSuiteRun(_ctx, { repoId, suiteKey } = {}) {
    try {
      const result = await headTestService.runSuite(repoId, suiteKey);
      return { ok: true, result };
    } catch (err) {
      // ONE CODE, ONE KEY for the suite family — the synchronous start
      // failure answers SUITE_RUN_FAILED like the poll path's failure
      // envelopes, so RUN_FAILED means the RAGAS run everywhere.
      return {
        ok: false,
        code:
          err && err.code === 'RUN_FAILED'
            ? 'SUITE_RUN_FAILED'
            : (err && (err.code || (err.data && err.data.error))) || 'SUITE_RUN_FAILED',
        message: err.message
      };
    }
  },

  /** 1-8g-v — poll/load ONE run doc (the async run's keep-waiting
   * envelope, its terminal failure, or the full doc). */
  async headSuiteGetRun(_ctx, { repoId, suiteKey, runKey } = {}) {
    try {
      const result = await headTestService.getRun(repoId, suiteKey, runKey);
      return { ok: true, result };
    } catch (err) {
      return {
        ok: false,
        code: (err && (err.code || (err.data && err.data.error))) || 'RUN_NOT_FOUND',
        message: err.message
      };
    }
  },

  /** Round 18 (#80465) — the Lab's suite-generation wait, on pollJob instead
   * of the dialog's hand-rolled loop: transient gateway failures (one 502
   * mid-generation) now tolerate up to 60 consecutive misses instead of
   * rejecting the whole wait. FIRST-FETCH FAST PATH: pollJob sleeps before
   * its first fetch, but a fast generation lands on attempt 0 — fetch once
   * up front and only enter the loop while still generating. */
  async pollHeadSuite({ dispatch }, { repoId, suiteKey, signal } = {}) {
    const fetchDoc = () => dispatch('headSuiteGet', { repoId, suiteKey }).then((r) => (r && r.ok ? r.result : null));
    const first = await fetchDoc();
    if (first && first.suite_key && first.status !== 'generating') return { ok: true, result: first };
    return pollJob({
      fetchDoc,
      pollMs: 2500,
      deadlineMs: 4 * 60 * 1000,
      // The server answers 200 {suite_key, status:'generating'} while the
      // async worker runs (never a 404) — keep waiting on that envelope.
      isRunning: (doc) => !doc || !doc.suite_key || doc.status === 'generating',
      timeout: { code: 'SUITE_GEN_TIMEOUT', message: LAB_ERROR_KEYS.suiteGenTimeout },
      failed: { code: 'SUITE_GEN_FAILED', message: LAB_ERROR_KEYS.suiteGenFailed },
      done: (doc) => ({ ok: true, result: doc }),
      signal
    });
  },

  /** Round 18 (#80465) — the Lab's async-run wait, same treatment: pollJob
   * tolerance + first-fetch fast path; onProgress keeps the live bar fed
   * ({phase, done, total} straight off the run envelope). */
  async pollHeadSuiteRun({ dispatch }, { repoId, suiteKey, runKey, signal, onProgress } = {}) {
    const fetchDoc = () =>
      dispatch('headSuiteGetRun', { repoId, suiteKey, runKey }).then((r) => (r && r.ok ? r.result : null));
    // ONE CODE, ONE KEY (#1350 review closeout): the suite family's terminal
    // failure answers SUITE_RUN_FAILED — the RAGAS run keeps RUN_FAILED, so
    // a consumer switching on res.code now knows which sentence it will get
    // (the two families used to share RUN_FAILED with different English).
    const failedEnvelope = (doc) => ({
      ok: false,
      code: (doc.error && doc.error.code) || 'SUITE_RUN_FAILED',
      message: (doc.error && doc.error.message) || LAB_ERROR_KEYS.suiteRunFailed
    });
    const first = await fetchDoc();
    if (onProgress && first && first.progress && first.progress.total) onProgress(first.progress);
    // Fast path keeps the SAME contract as the slow path: a failed run maps
    // to the failed envelope (not ok:true), a finished run to its doc.
    if (first && first.status === 'failed') return failedEnvelope(first);
    if (first && !first.status) return { ok: true, result: first };
    return pollJob({
      fetchDoc,
      pollMs: 2500,
      deadlineMs: 6 * 60 * 1000,
      isRunning: (doc) => !doc || doc.status === 'running',
      onProgress,
      timeout: { code: 'RUN_TIMEOUT', message: LAB_ERROR_KEYS.suiteRunTimeout },
      failed: { code: 'SUITE_RUN_FAILED', message: LAB_ERROR_KEYS.suiteRunFailed },
      done: (doc) => (doc.status === 'failed' ? failedEnvelope(doc) : { ok: true, result: doc }),
      signal
    });
  },

  /** Story 1-8c — explain ONE query's gate outcome; the result carries
   * suggestion {tags, source, reason} when the head (wrongly) claims it.
   * The teaching half of the Lab loop. */
  async headRoutingExplain(_ctx, { repoId, query } = {}) {
    try {
      const result = await headTestService.explainRouting(repoId, query);
      return { ok: true, result };
    } catch (err) {
      return {
        ok: false,
        code: (err && (err.code || (err.data && err.data.error))) || 'EXPLAIN_FAILED',
        message: err.message
      };
    }
  },

  /** Story 1-8c — BATCH advice for the latest run of a suite: every
   * failing negative, ONE LLM call, consolidated suggested forbidden
   * tags (the anti-treadmill: one review per run). */
  /**
   * Story 1-8c — batch advice for a suite run's failing negatives.
   * Async since 1-8g-y: the POST is 202 + poll (see headTestService), because
   * the work fans out over the shared remote GPU node and outran the gateway.
   * Polling lives here rather than in the component so the dialog's existing
   * spinner and error handling stay untouched.
   */
  async headSuiteExplainFailures(_ctx, { repoId, suiteKey, signal } = {}) {
    try {
      const started = await headTestService.explainSuiteFailures(repoId, suiteKey);
      // Tolerate a synchronous server that answers 200 with the advice inline
      // (no run_key), so the frontend is not coupled to deploy order.
      if (!started || !started.run_key) return { ok: true, result: started };
      // 15-min ceiling: a wedged job surfaces as a readable error instead of
      // an endless spinner; the doc keeps its state server-side regardless.
      return await pollJob({
        fetchDoc: () => headTestService.getExplainFailures(repoId, suiteKey, started.run_key),
        pollMs: 2000,
        deadlineMs: 15 * 60 * 1000,
        signal,
        timeout: {
          code: 'EXPLAIN_TIMEOUT',
          message: LAB_ERROR_KEYS.explainTimeout
        },
        failed: { code: 'EXPLAIN_FAILED', message: LAB_ERROR_KEYS.explainFailed },
        done: (doc) => ({ ok: true, result: doc.payload })
      });
    } catch (err) {
      return {
        ok: false,
        code: (err && (err.code || (err.data && err.data.error))) || 'EXPLAIN_FAILED',
        message: err.message
      };
    }
  },

  /** Analytics history across tag cycles. */
  async headSuiteListRuns(_ctx, { repoId, kind = 'all', limit = 20 } = {}) {
    try {
      const runs = await headTestService.listRuns(repoId, { kind, limit });
      return { ok: true, runs };
    } catch (err) {
      return {
        ok: false,
        code: (err && (err.code || (err.data && err.data.error))) || 'RUNS_FAILED',
        message: err.message
      };
    }
  },

  /** Story 1-8d — the bounded frontmatter save history (the Lab's
   * Revert-tags panel). Returns {ok, entries: [{saved_at, actor,
   * forbidden_count, shape}]}. */
  async frontmatterHistory(_ctx, { repoId } = {}) {
    try {
      const entries = await headTestService.frontmatterHistory(repoId);
      return { ok: true, entries };
    } catch (err) {
      return {
        ok: false,
        code: (err && (err.code || (err.data && err.data.error))) || 'HISTORY_FAILED',
        message: err.message
      };
    }
  },

  /** Story 1-8d — restore the frontmatter snapshotted at saved_at. The
   * server re-enters update(), so the revert itself is snapshotted.
   * Returns {ok, result: {repo_id, reverted_to, frontmatter}}. */
  async frontmatterRevert(_ctx, { repoId, savedAt } = {}) {
    try {
      const result = await headTestService.revertFrontmatter(repoId, savedAt);
      return { ok: true, result };
    } catch (err) {
      return {
        ok: false,
        code: (err && (err.code || (err.data && err.data.error))) || 'REVERT_FAILED',
        message: err.message
      };
    }
  },

  /** Story 1-8d — the comprehensive advisor: aggregates recent runs (all
   * classes), simulates tag-set configurations against the gate, recommends
   * the globally-optimal add/remove set. Returns
   * {ok, result: {current_scorecard, recommended_scorecard, changes, ...}}. */
  async headRecommend(_ctx, { repoId, runLimit } = {}) {
    try {
      const result = await headTestService.recommendTags(repoId, runLimit ? { run_limit: runLimit } : {});
      return { ok: true, result };
    } catch (err) {
      return {
        ok: false,
        code: (err && (err.code || (err.data && err.data.error))) || 'ADVISE_FAILED',
        message: err.message
      };
    }
  },

  // ------- Story 8-6 — RAGAS benchmark suites (ADR-okf-043) -------
  // Same {ok, code, message, result|runs} envelope and store-side poll
  // discipline as the headSuite actions above.

  /** Generate a benchmark suite (202 + store-side poll until the doc lands).
   * onStarted(suite_key) fires when the 202 returns so the UI can offer
   * Cancel mid-generation (David 2026-10-18 requirement). */
  async ragasGenerate(_ctx, { repoId, options, onStarted, onProgress, signal } = {}) {
    try {
      ensureServices();
      const started = await ragasService.generateSuite(repoId, options || {});
      if (!started || !started.suite_key) return { ok: true, result: started };
      if (typeof onStarted === 'function') onStarted(started.suite_key);
      // The server NEVER kills a healthy long job (David 2026-10-18: never
      // trash running work) — the 24h UI horizon only bounds a left-open
      // dialog; the job keeps running server-side and the timeout says so.
      return await pollJob({
        fetchDoc: () => ragasService.getSuite(repoId, started.suite_key),
        pollMs: 2500,
        signal,
        isRunning: (doc) => !doc || doc.status === 'generating',
        onProgress: typeof onProgress === 'function' ? onProgress : null,
        timeout: {
          code: 'GENERATION_TIMEOUT',
          message: LAB_ERROR_KEYS.generationTimeout
        },
        failed: { code: 'GENERATION_FAILED', message: LAB_ERROR_KEYS.generationFailed },
        done: (doc) => ({ ok: true, result: doc })
      });
    } catch (err) {
      return {
        ok: false,
        code: (err && (err.code || (err.data && err.data.error))) || 'GENERATION_FAILED',
        message: err.message
      };
    }
  },

  /** Cancel an in-flight benchmark-suite generation (user-initiated stop —
   * the GPU drains within one in-flight LLM batch; the ragasGenerate poll
   * then exits with RAGAS_JOB_CANCELLED). */
  async ragasCancelGeneration(_ctx, { repoId, suiteKey } = {}) {
    try {
      ensureServices();
      const result = await ragasService.cancelSuiteGeneration(repoId, suiteKey);
      return { ok: true, result };
    } catch (err) {
      return {
        ok: false,
        code: (err && (err.code || (err.data && err.data.error))) || 'CANCEL_FAILED',
        message: err.message
      };
    }
  },

  /** Cancel an in-flight benchmark RUN (user stop — the ragasRun poll then
   * exits with the cancelled run record). */
  async ragasCancelRun(_ctx, { repoId, suiteKey, runKey } = {}) {
    try {
      ensureServices();
      const result = await ragasService.cancelRun(repoId, suiteKey, runKey);
      return { ok: true, result };
    } catch (err) {
      return {
        ok: false,
        code: (err && (err.code || (err.data && err.data.error))) || 'CANCEL_FAILED',
        message: err.message
      };
    }
  },

  /** Delete one finished benchmark run + its explain docs. The 409s arrive as
   * codes (RUN_IN_FLIGHT / EXPLAIN_IN_FLIGHT) so the panel can name them. */
  async ragasDeleteRun(_ctx, { repoId, suiteKey, runKey } = {}) {
    try {
      ensureServices();
      const result = await ragasService.deleteRun(repoId, suiteKey, runKey);
      return { ok: true, result };
    } catch (err) {
      return {
        ok: false,
        code: (err && (err.code || (err.data && err.data.error))) || 'DELETE_FAILED',
        message: err.message
      };
    }
  },

  /** Re-score a finished run with a different judge — a NEW run doc, the
   * source untouched (David 2026-10-24).
   *
   * A re-score IS a run, so it polls like one: the SAME live progress and
   * the SAME cancel path as ragasRun (David 2026-10-25: "it also cannot be
   * tracked and does not connect to the UI with a progress bar… I cannot stop
   * the re-scoring"). opts.onStarted receives the NEW run key — that is the
   * cancel target, not the source run's key. */
  async ragasRescoreRun(_ctx, { repoId, suiteKey, runKey, payload, onProgress, onStarted, signal } = {}) {
    try {
      ensureServices();
      const started = await ragasService.rescoreRun(repoId, suiteKey, runKey, payload || {});
      // A 202 without a run key means the re-score never started. Reporting
      // SUCCESS there left the panel showing "done" with nothing running and
      // no run to cancel — the operator's re-score silently did nothing.
      if (!started || !started.run_key) {
        return {
          ok: false,
          code: 'RESCORE_NOT_STARTED',
          message: LAB_ERROR_KEYS.rescoreNotStarted
        };
      }
      if (typeof onStarted === 'function') onStarted(started.run_key);
      return await pollJob({
        fetchDoc: () => ragasService.getRun(repoId, suiteKey, started.run_key),
        pollMs: 2000,
        signal,
        onProgress: typeof onProgress === 'function' ? onProgress : null,
        timeout: {
          code: 'RUN_TIMEOUT',
          message: LAB_ERROR_KEYS.rescoreTimeout
        },
        failed: { code: 'RESCORE_FAILED', message: LAB_ERROR_KEYS.rescoreFailed },
        done: (doc) =>
          doc.status === 'cancelled'
            ? { ok: false, code: 'RUN_CANCELLED', message: LAB_ERROR_KEYS.rescoreCancelled, result: doc }
            : { ok: true, result: doc }
      });
    } catch (err) {
      return {
        ok: false,
        code: (err && (err.code || (err.data && err.data.error))) || 'RESCORE_FAILED',
        message: err.message
      };
    }
  },

  async ragasGetSuite(_ctx, { repoId, suiteKey } = {}) {
    try {
      ensureServices();
      const result = await ragasService.getSuite(repoId, suiteKey);
      return { ok: true, result };
    } catch (err) {
      return {
        ok: false,
        code: (err && (err.code || (err.data && err.data.error))) || 'SUITE_NOT_FOUND',
        message: err.message
      };
    }
  },

  async ragasUpdateRows(_ctx, { repoId, suiteKey, payload } = {}) {
    try {
      ensureServices();
      const result = await ragasService.updateSuiteRows(repoId, suiteKey, payload);
      return { ok: true, result };
    } catch (err) {
      return {
        ok: false,
        code: (err && (err.code || (err.data && err.data.error))) || 'UPDATE_FAILED',
        message: err.message
      };
    }
  },

  async ragasAddQueries(_ctx, { repoId, suiteKey, queries } = {}) {
    try {
      ensureServices();
      const result = await ragasService.addQueries(repoId, suiteKey, queries);
      return { ok: true, result };
    } catch (err) {
      return {
        ok: false,
        code: (err && (err.code || (err.data && err.data.error))) || 'ADD_FAILED',
        message: err.message
      };
    }
  },

  async ragasRename(_ctx, { repoId, suiteKey, name } = {}) {
    try {
      ensureServices();
      const result = await ragasService.renameSuite(repoId, suiteKey, name);
      return { ok: true, result };
    } catch (err) {
      return {
        ok: false,
        code: (err && (err.code || (err.data && err.data.error))) || 'RENAME_FAILED',
        message: err.message
      };
    }
  },

  async ragasDelete(_ctx, { repoId, suiteKey } = {}) {
    try {
      ensureServices();
      const result = await ragasService.deleteSuite(repoId, suiteKey);
      return { ok: true, result };
    } catch (err) {
      return {
        ok: false,
        code: (err && (err.code || (err.data && err.data.error))) || 'DELETE_FAILED',
        message: err.message
      };
    }
  },

  /** Run the suite (202 + store-side poll with live progress). opts.onProgress
   * (a plain function, not serialized) receives each poll's {phase, done, total}. */
  async ragasRun(
    _ctx,
    { repoId, suiteKey, metrics, judge_config_key, judge_model, onProgress, onStarted, signal } = {}
  ) {
    try {
      ensureServices();
      const body = { ...(metrics ? { metrics } : {}) };
      // 8-7: an explicit judge pick rides the run body (picked > active > env)
      if (judge_config_key) {
        body.judge_config_key = judge_config_key;
        if (judge_model) body.judge_model = judge_model;
      }
      const started = await ragasService.runSuite(repoId, suiteKey, body);
      // A 202 without a run key means the run never started — reporting
      // SUCCESS left the panel showing a finished run that does not exist.
      if (!started || !started.run_key) {
        return {
          ok: false,
          code: 'RUN_NOT_STARTED',
          message: LAB_ERROR_KEYS.runNotStarted
        };
      }
      if (typeof onStarted === 'function') onStarted(started.run_key);
      return await pollJob({
        fetchDoc: () => ragasService.getRun(repoId, suiteKey, started.run_key),
        pollMs: 2000,
        signal,
        onProgress: typeof onProgress === 'function' ? onProgress : null,
        timeout: {
          code: 'RUN_TIMEOUT',
          message: LAB_ERROR_KEYS.runTimeout
        },
        failed: { code: 'RUN_FAILED', message: LAB_ERROR_KEYS.runFailed },
        // A cancelled run is NOT a result (2026-10-21 review F4) — without
        // this branch a cancelled run resolved ok:true and rendered an empty
        // results section.
        done: (doc) =>
          doc.status === 'cancelled'
            ? { ok: false, code: 'RUN_CANCELLED', message: LAB_ERROR_KEYS.runCancelled, result: doc }
            : { ok: true, result: doc }
      });
    } catch (err) {
      return {
        ok: false,
        code: (err && (err.code || (err.data && err.data.error))) || 'RUN_FAILED',
        message: err.message
      };
    }
  },

  /** Adopt an ALREADY-RUNNING benchmark run after a page refresh or dialog
   * reopen (David 2026-10-18: refreshing must never orphan the UI from an
   * in-flight run — the run doc is the source of truth). Same poll loop and
   * envelope as ragasRun, minus the start call. */
  async ragasAdoptRun(_ctx, { repoId, suiteKey, runKey, onProgress, signal } = {}) {
    try {
      ensureServices();
      return await pollJob({
        fetchDoc: () => ragasService.getRun(repoId, suiteKey, runKey),
        pollMs: 2000,
        signal,
        onProgress: typeof onProgress === 'function' ? onProgress : null,
        timeout: { code: 'RUN_TIMEOUT', message: LAB_ERROR_KEYS.runAdoptTimeout },
        failed: { code: 'RUN_FAILED', message: LAB_ERROR_KEYS.runFailed },
        // Cancelled is its OWN arm (round 20, #79900): folding it into
        // RUN_FAILED rendered "Run failed" for a run someone deliberately
        // stopped — the operator retries a run that intentionally never
        // happened, and telemetry counts a phantom RUN_FAILED. The sibling
        // polls answer RUN_CANCELLED; the Lab translates this key.
        done: (doc) =>
          doc.status === 'cancelled'
            ? { ok: false, code: 'RUN_CANCELLED', message: LAB_ERROR_KEYS.runCancelled }
            : { ok: true, result: doc }
      });
    } catch (err) {
      return {
        ok: false,
        code: (err && (err.code || (err.data && err.data.error))) || 'RUN_FAILED',
        message: err.message
      };
    }
  },

  /** Adopt an ALREADY-GENERATING suite after a refresh/reopen — same poll
   * as ragasGenerate's tail; the generating envelope carries live progress. */
  async ragasAdoptGeneration(_ctx, { repoId, suiteKey, onProgress, signal } = {}) {
    try {
      ensureServices();
      return await pollJob({
        fetchDoc: () => ragasService.getSuite(repoId, suiteKey),
        pollMs: 2500,
        signal,
        isRunning: (doc) => !doc || doc.status === 'generating',
        onProgress: typeof onProgress === 'function' ? onProgress : null,
        timeout: { code: 'GENERATION_TIMEOUT', message: LAB_ERROR_KEYS.generationAdoptTimeout },
        failed: { code: 'GENERATION_FAILED', message: LAB_ERROR_KEYS.generationFailed },
        done: (doc) => ({ ok: true, result: doc })
      });
    } catch (err) {
      return {
        ok: false,
        code: (err && (err.code || (err.data && err.data.error))) || 'GENERATION_FAILED',
        message: err.message
      };
    }
  },

  /** Load one already-finished run doc (history View button) — no poll. */
  async ragasGetRunQuiet(_ctx, { repoId, suiteKey, runKey } = {}) {
    try {
      ensureServices();
      const result = await ragasService.getRun(repoId, suiteKey, runKey);
      return { ok: true, result };
    } catch (err) {
      return {
        ok: false,
        code: (err && (err.code || (err.data && err.data.error))) || 'RUN_NOT_FOUND',
        message: err.message
      };
    }
  },

  async ragasListRuns(_ctx, { repoId, kind = 'all', limit = 20 } = {}) {
    try {
      ensureServices();
      const runs = await ragasService.listRuns(repoId, { kind, limit });
      return { ok: true, runs };
    } catch (err) {
      return {
        ok: false,
        code: (err && (err.code || (err.data && err.data.error))) || 'RUNS_FAILED',
        message: err.message
      };
    }
  },

  async ragasProbe(_ctx, { repoId, suiteKey, id } = {}) {
    try {
      ensureServices();
      const result = await ragasService.probeEntry(repoId, suiteKey, id);
      return { ok: true, result };
    } catch (err) {
      return {
        ok: false,
        code: (err && (err.code || (err.data && err.data.error))) || 'PROBE_FAILED',
        message: err.message
      };
    }
  },

  /** Quiet fetch of the PERSISTED explain for a run — the advisor auto-load.
   * A 404 (the run was never explained) is a normal state, not an error —
   * silent: true keeps the shared httpService from toasting/console-logging
   * it; the caller owns the outcome. */
  async ragasGetExplainQuiet(_ctx, { repoId, suiteKey, runKey } = {}) {
    try {
      ensureServices();
      const doc = await ragasService.getExplain(repoId, suiteKey, runKey, { silent: true });
      return { ok: !!(doc && doc.payload), result: (doc && doc.payload) || null };
    } catch {
      return { ok: false, result: null };
    }
  },

  /** Story 8-7 — named remote-model configurations. All pass-through with
   * honest {ok, result|message} envelopes; the service masks keys. */
  async modelConfigList() {
    try {
      ensureServices();
      // Envelope: {configs, env_judge, env_pick} — env_judge names the model
      // the "System default (environment)" option resolves to.
      //
      // Field by field, NOT a spread: this action used to spread whatever
      // the service returned, and the service returned the ARRAY — so the
      // result carried neither `configs` nor `env_judge`, and both the
      // RAGAS judge picker and the admin Models tab went blank
      // (David 2026-10-25). The contract is written out so the shape
      // cannot change by accident again.
      const envelope = await modelConfigService.list();
      return {
        ok: true,
        configs: Array.isArray(envelope && envelope.configs) ? envelope.configs : [],
        env_judge: (envelope && envelope.env_judge) || null,
        env_pick: (envelope && envelope.env_pick) || null,
        // The deployment opt-in for the OKF LLM legs — the service owns the
        // normalisation (null when the server does not say), so the panel
        // warns only on a state it actually knows.
        deployment_opt_in: (envelope && envelope.deployment_opt_in) ?? null
      };
    } catch (err) {
      return { ok: false, code: (err && err.code) || 'MODEL_CONFIG_LIST_FAILED', message: err.message };
    }
  },
  async modelConfigCreate(_ctx, payload) {
    try {
      ensureServices();
      return { ok: true, result: await modelConfigService.create(payload) };
    } catch (err) {
      return { ok: false, code: (err && err.code) || 'MODEL_CONFIG_CREATE_FAILED', message: err.message };
    }
  },
  async modelConfigUpdate(_ctx, { key, payload } = {}) {
    try {
      ensureServices();
      return { ok: true, result: await modelConfigService.update(key, payload) };
    } catch (err) {
      return { ok: false, code: (err && err.code) || 'MODEL_CONFIG_UPDATE_FAILED', message: err.message };
    }
  },
  async modelConfigCopy(_ctx, { key } = {}) {
    try {
      ensureServices();
      return { ok: true, result: await modelConfigService.copy(key) };
    } catch (err) {
      return { ok: false, code: (err && err.code) || 'MODEL_CONFIG_COPY_FAILED', message: err.message };
    }
  },
  async modelConfigActivate(_ctx, { key } = {}) {
    try {
      ensureServices();
      return { ok: true, result: await modelConfigService.activate(key) };
    } catch (err) {
      return { ok: false, code: (err && err.code) || 'MODEL_CONFIG_ACTIVATE_FAILED', message: err.message };
    }
  },
  async modelConfigDeactivate(_ctx, { key } = {}) {
    try {
      ensureServices();
      return { ok: true, result: await modelConfigService.deactivate(key) };
    } catch (err) {
      return { ok: false, code: (err && err.code) || 'MODEL_CONFIG_DEACTIVATE_FAILED', message: err.message };
    }
  },
  async modelConfigDelete(_ctx, { key } = {}) {
    try {
      ensureServices();
      return { ok: true, result: await modelConfigService.remove(key) };
    } catch (err) {
      return { ok: false, code: (err && err.code) || 'MODEL_CONFIG_DELETE_FAILED', message: err.message };
    }
  },
  /** Live model listing for a config's dropdown (server-side, key-safe). */
  async modelConfigModels(_ctx, { key } = {}) {
    try {
      ensureServices();
      return { ok: true, models: await modelConfigService.models(key) };
    } catch (err) {
      return { ok: false, code: (err && err.code) || 'MODEL_LIST_FAILED', message: err.message };
    }
  },
  /** Dropdown listing with TYPED (unsaved) credentials — the create form. */
  async modelConfigModelsPreview(_ctx, payload = {}) {
    try {
      ensureServices();
      return { ok: true, models: await modelConfigService.modelsPreview(payload) };
    } catch (err) {
      return { ok: false, code: (err && err.code) || 'MODEL_LIST_FAILED', message: err.message };
    }
  },
  /** Connection test before enabling. Diagnostics arrive as {ok:false,...}, not rejects. */
  async modelConfigTest(_ctx, payload = {}) {
    try {
      ensureServices();
      return { ok: true, result: await modelConfigService.test(payload) };
    } catch (err) {
      return { ok: false, code: (err && err.code) || 'MODEL_TEST_FAILED', message: err.message };
    }
  },

  /** Explain failures (202 + store-side poll). */
  async ragasExplain(_ctx, { repoId, suiteKey, runKey, onProgress, signal } = {}) {
    try {
      ensureServices();
      const started = await ragasService.explainFailures(repoId, suiteKey, runKey ? { run_key: runKey } : {});
      if (!started || !started.run_key) return { ok: true, result: started };
      return await pollJob({
        fetchDoc: () => ragasService.getExplain(repoId, suiteKey, started.run_key),
        pollMs: 2000,
        deadlineMs: 15 * 60 * 1000,
        signal,
        onProgress: typeof onProgress === 'function' ? onProgress : null,
        timeout: {
          code: 'EXPLAIN_TIMEOUT',
          message: LAB_ERROR_KEYS.explainShortTimeout
        },
        failed: { code: 'EXPLAIN_FAILED', message: LAB_ERROR_KEYS.explainFailed },
        done: (doc) => ({ ok: true, result: doc.payload })
      });
    } catch (err) {
      return {
        ok: false,
        code: (err && (err.code || (err.data && err.data.error))) || 'EXPLAIN_FAILED',
        message: err.message
      };
    }
  },

  /** xlsx: suite export / import + results export (arraybuffer passthrough). */
  async ragasExportSuite(_ctx, { repoId, suiteKey } = {}) {
    try {
      ensureServices();
      const data = await ragasService.exportSuite(repoId, suiteKey);
      return { ok: true, data };
    } catch (err) {
      return {
        ok: false,
        code: (err && (err.code || (err.data && err.data.error))) || 'EXPORT_FAILED',
        message: err.message
      };
    }
  },

  async ragasImportSuite(_ctx, { repoId, arrayBuffer } = {}) {
    try {
      ensureServices();
      const result = await ragasService.importSuite(repoId, arrayBuffer);
      return { ok: true, result };
    } catch (err) {
      return {
        ok: false,
        code: (err && (err.code || (err.data && err.data.error))) || 'IMPORT_FAILED',
        message: err.message
      };
    }
  },

  async ragasExportResults(_ctx, { repoId, suiteKey, runKeys } = {}) {
    try {
      ensureServices();
      const data = await ragasService.exportResults(repoId, { suite_key: suiteKey, run_keys: runKeys });
      return { ok: true, data };
    } catch (err) {
      return {
        ok: false,
        code: (err && (err.code || (err.data && err.data.error))) || 'EXPORT_FAILED',
        message: err.message
      };
    }
  },

  setEditorSubTab({ commit }, subTab) {
    commit('setEditorSubTab', subTab === 'wizard' ? 'wizard' : 'editor');
  },

  // ── W9 (concept tree browse, 2026-11-08) — the citizen modal viewer ──────
  /**
   * Open the browser at a cited concept: reset the slice, then start the
   * FIRST index page AND the first per-hop CAP-2 fetch in parallel (David,
   * 2026-11-08: "the user must not have to wait until the whole repository
   * loads into the browser — only the initial tree and the focus document;
   * the rest on demand"). Validation is honest: an entry without repo
   * identity (a pre-CAP-1 persisted row) never opens a dead dialog — but
   * the affordances only render on working citations, so this arm is a
   * backstop, not the UI's gate.
   */
  openConceptBrowser({ commit, dispatch }, { repoId, conceptId } = {}) {
    if (!repoId || !conceptId) return { ok: false, code: 'VALIDATION_ERROR' };
    commit('openBrowser', { repoId, conceptId });
    // Both runs own their stale guards independently; neither blocks the
    // other — the list is usable from the first committed page, the detail
    // pane as soon as the CAP-2 card lands.
    dispatch('fetchConceptTree', { repoId });
    dispatch('browserLoadConcept', { repoId, conceptId });
    return { ok: true };
  },

  closeConceptBrowser({ commit }) {
    // Closing CANCELS an in-flight walk: the generation bump fires the
    // walk's stale() on its next page, so no hidden fetches continue into
    // the hidden slice (review r0).
    browserTreeGeneration += 1;
    commit('closeBrowser');
  },

  /**
   * The INITIAL index page ONLY (David, 2026-11-08 — lazy loading): one
   * request, then the dialog is interactive; further pages are fetched by
   * browserExtendConceptTree on demand. Stale guards: a superseded run (a
   * newer open) drops its page WITHOUT clearing the newer run's flags —
   * the round-11 rule — and a fenced/absent repo (the 404 anti-enumeration
   * envelope) arms the honest `unavailable` state instead of an error.
   */
  async fetchConceptTree({ commit, state }, { repoId } = {}) {
    if (!repoId) return { ok: false, code: 'VALIDATION_ERROR' };
    const PAGE = 200;
    const myGen = ++browserTreeGeneration;
    commit('setBrowser', {
      loading: true,
      unavailable: false,
      error: null,
      concepts: [],
      total: 0,
      treeComplete: false,
      extending: false
    });
    const stale = () => myGen !== browserTreeGeneration || state.browser.repoId !== repoId;
    try {
      const page = await conceptService.getConceptTree(repoId, { limit: PAGE, offset: 0 });
      if (stale()) return { ok: true, stale: true };
      // 404/501 → null: restricted / retracted / absent repo. The 404 is
      // the anti-enumeration refusal — an honest "cannot be browsed", not
      // an error.
      if (!page) {
        commit('setBrowser', { loading: false, unavailable: true });
        return { ok: false, code: 'UNAVAILABLE' };
      }
      const rows = Array.isArray(page.concepts) ? page.concepts : [];
      commit('appendBrowserConcepts', { repoId, rows });
      const total = typeof page.total === 'number' ? page.total : rows.length;
      const complete = rows.length < PAGE || rows.length >= total;
      commit('setBrowser', { total, loading: false, treeComplete: complete });
      return { ok: true };
    } catch (err) {
      if (stale()) return { ok: false, stale: true, message: err.message };
      commit('setBrowser', { loading: false, error: err.message || 'fetchConceptTree failed' });
      return { ok: false, code: 'FETCH_FAILED', message: err.message };
    }
  },

  /**
   * ONE on-demand page extension (David, 2026-11-08): the dialog's Show
   * more dispatches this when the render window reaches the loaded edge
   * and the tree is not complete. SEQUENTIAL (offset = the loaded count),
   * guarded by the same generation + repo-identity checks — a superseded
   * extension never commits into a newer open.
   */
  async browserExtendConceptTree({ commit, state }, { repoId } = {}) {
    if (!repoId) return { ok: false, code: 'VALIDATION_ERROR' };
    const myGen = browserTreeGeneration;
    const stale = () => myGen !== browserTreeGeneration || state.browser.repoId !== repoId;
    if (stale() || state.browser.treeComplete || state.browser.extending) {
      return { ok: false, code: 'STALE' };
    }
    const PAGE = 200;
    const offset = state.browser.concepts.length;
    commit('setBrowser', { extending: true });
    try {
      const page = await conceptService.getConceptTree(repoId, { limit: PAGE, offset });
      if (stale()) return { ok: true, stale: true };
      if (!page) {
        commit('setBrowser', { extending: false, unavailable: true });
        return { ok: false, code: 'UNAVAILABLE' };
      }
      const rows = Array.isArray(page.concepts) ? page.concepts : [];
      commit('appendBrowserConcepts', { repoId, rows });
      const total = typeof page.total === 'number' ? page.total : state.browser.concepts.length;
      const complete = rows.length < PAGE || state.browser.concepts.length >= total;
      commit('setBrowser', { total, extending: false, treeComplete: complete });
      return { ok: true };
    } catch (err) {
      if (stale()) return { ok: false, stale: true, message: err.message };
      commit('setBrowser', { extending: false, error: err.message || 'browserExtendConceptTree failed' });
      return { ok: false, code: 'FETCH_FAILED', message: err.message };
    }
  },

  /**
   * ONE per-hop fetch: the CAP-2 concept route under the caller's own scope,
   * through fetchOkfConcept (the shared unavailable mapping — 403, 404 and a
   * gone concept all land in the honest "unavailable" arm, never a dead
   * link or a generic error). A hop dispatched for a superseded repo is
   * dropped.
   */
  async browserLoadConcept({ commit, state }, { repoId, conceptId } = {}) {
    if (!repoId || !conceptId) return { ok: false, code: 'VALIDATION_ERROR' };
    if (state.browser.repoId !== repoId) return { ok: false, code: 'STALE' };
    commit('setBrowserSelected', { conceptId, concept: null });
    commit('setBrowserSelectedLoading', true);
    try {
      const meta = await documentOpener.fetchOkfConcept(repoId, conceptId);
      if (state.browser.repoId !== repoId) return { ok: false, code: 'STALE' };
      // Same-repo sequence guard (review r0): a NEWER hop was dispatched
      // while this one was in flight — the slower earlier fetch must not
      // overwrite the newer selection.
      if (state.browser.selectedConceptId !== conceptId) return { ok: false, code: 'STALE' };
      commit('setBrowserSelected', { conceptId, concept: meta });
      commit('setBrowserSelectedLoading', false);
      return { ok: true };
    } catch (err) {
      if (state.browser.repoId !== repoId) return { ok: false, code: 'STALE' };
      if (state.browser.selectedConceptId !== conceptId) return { ok: false, code: 'STALE' };
      commit('setBrowserSelectedLoading', false);
      if (err && err.code === 'OKF_CONCEPT_UNAVAILABLE') {
        commit('setBrowserSelectedUnavailable');
        return { ok: false, code: 'UNAVAILABLE' };
      }
      commit('setBrowser', { error: err.message || 'browserLoadConcept failed' });
      return { ok: false, code: 'FETCH_FAILED', message: err.message };
    }
  },

  /**
   * #1836 — the ONE entry point for a forward navigation (a tree-row click,
   * a related-concept hop): record the visit in the history (the web-history
   * truncation semantic lives in the mutation), then load the content
   * through the SAME guarded hop loader the open path uses.
   */
  browserVisitConcept({ commit, dispatch, state }, { repoId, conceptId } = {}) {
    if (!repoId || !conceptId) return { ok: false, code: 'VALIDATION_ERROR' };
    if (state.browser.repoId !== repoId) return { ok: false, code: 'STALE' };
    commit('browserVisit', conceptId);
    return dispatch('browserLoadConcept', { repoId, conceptId });
  },

  /** #1836 — one step BACK through the visited concepts; loads the entry's
   * content through the same guarded hop loader. A boundary call is a no-op.
   * The entry id reads from state AFTER the browserGo commit — the pre-commit
   * snapshot carries the OLD selection and the load would overwrite the
   * move right back. */
  browserBack({ commit, dispatch, state }) {
    const b = state.browser;
    if (b.historyIndex <= 0) return { ok: false, code: 'BOUNDARY' };
    commit('browserGo', -1);
    return dispatch('browserLoadConcept', { repoId: state.browser.repoId, conceptId: state.browser.selectedConceptId });
  },

  /** #1836 — one step FORWARD (after a back); boundary no-op. Reads the
   * post-commit state, same as browserBack. */
  browserForward({ commit, dispatch, state }) {
    const b = state.browser;
    if (b.historyIndex >= b.history.length - 1) return { ok: false, code: 'BOUNDARY' };
    commit('browserGo', 1);
    return dispatch('browserLoadConcept', { repoId: state.browser.repoId, conceptId: state.browser.selectedConceptId });
  }
};

// Lazy require so the module loads in test environments without the services.
let studioService;
let repoOkfService;
let crawlerToOkfService;
let conceptService;
let okfRepoOps;
let headTestService;
let ragasService;
let modelConfigService;
// W9 — the browser's per-hop fetch rides the shared unavailable mapping.
let documentOpener;
function ensureServices() {
  if (!studioService) studioService = require('@/services/studioService').default;
  if (!repoOkfService) repoOkfService = require('@/services/repoOkfService').default;
  if (!crawlerToOkfService) crawlerToOkfService = require('@/services/crawlerToOkfService').default;
  if (!conceptService) conceptService = require('@/services/conceptService').default;
  if (!okfRepoOps) okfRepoOps = require('@/services/okfRepoOps');
  if (!headTestService) headTestService = require('@/services/headTestService').default;
  if (!ragasService) ragasService = require('@/services/ragasService').default;
  if (!modelConfigService) modelConfigService = require('@/services/modelConfigService').default;
  if (!documentOpener) documentOpener = require('@/utils/document-opener');
}

const actionsWithServices = {};
Object.keys(actions).forEach((key) => {
  const original = actions[key];
  actionsWithServices[key] = function wrapped(context, payload) {
    ensureServices();
    return original.apply(this, [context, payload]);
  };
});

export default {
  namespaced: true,
  // Round 21: `initialState()` (INVOKED at import) created ONE object shared
  // by every store that registers this module — the jest suites' buildStore()
  // instances mutated each other's state through it. Vuex's module contract
  // takes the FACTORY here and calls it per store, so each store gets its
  // own deep-fresh state.
  state: initialState,
  getters,
  mutations,
  actions: actionsWithServices
};
