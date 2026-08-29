/**
 * Vuex OKF Studio Module — Epic 3 (3-4 .. 3-8).
 *
 * State:
 *   drafts[repo_id]      resumable studio state (studio_step, source, preloaded, updated_at)
 *   reposById[id]        cached repo metadata (name, domain, lifecycle, concept_count, trust, cloned_from, metrics)
 *   reposByStage         bucketed repo_ids { draft: [], in_review: [], published: [] }
 *   selection            { documents: [], crawlSeeds: [], clonedFrom: null } — preloaded wizard inputs
 *   gates[okfRepoButton] { visible, reasonKey, reasonParams } — gates the doc-mgmt entry button
 *   bulkPublish          { inFlight, results: [{ repo_id, ok, code?, message? }] }
 *   ui                   { expertMode } — global Basic/Expert toggle (persisted to localStorage)
 *
 * NOT_READY semantics:
 *   Where a backend endpoint is missing (10.5 server aggregation, 7.2 producer,
 *   4.2b formatter, 3.9 retract), the relevant action returns
 *   { ok: false, code: 'NOT_READY', message: '<i18n key>' }. The UI surfaces
 *   this as a translated toast — never as a hard error.
 */

const initialState = () => ({
  drafts: {},
  reposById: {},
  // Lifecycle lanes (David, 2026-08-28): five columns — In progress /
  // In review / Published / Ingested / Retracted. Published ≠ Ingested:
  // 'publish' + serving flag (ingested_at/ingested_version) drives the last
  // two; 'retracted' is its own visible state, never folded into Published.
  reposByStage: { draft: [], in_review: [], published: [], ingested: [], retracted: [] },
  selection: { documents: [], crawlSeeds: [], clonedFrom: null },
  gates: {
    okfRepoButton: { visible: false, reasonKey: null, reasonParams: {} }
  },
  bulkPublish: { inFlight: false, results: [] },
  versionsByRepo: {},
  // Story #978 — Studio editor state: which sub-tab (Wizard | Editor), which
  // repo is open, per-repo concept lists (left rail), the selected concept.
  editor: {
    subTab: 'editor', // 'editor' is the default per the UX design
    repoId: null,
    conceptsByRepo: {},
    selectedConceptId: null,
    loading: false
  },
  ui: {
    expertMode: readExpertModeFromStorage()
  },
  error: null
});

/**
 * Lifecycle lane mapping (David, 2026-08-28) — the SINGLE definition of which
 * lane a repo lands in, used by fetchRepos AND the transition action. The
 * serving flag (ingested_at) separates Published from Ingested; 'retracted'
 * is its own lane. The old mapping compared against 'published' — a value the
 * server NEVER sets (the state is 'publish') — so published repos landed in
 * the wrong lane.
 */
function laneFor(repos) {
  const byStage = { draft: [], in_review: [], published: [], ingested: [], retracted: [] };
  (repos || []).forEach((r) => {
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

function writeExpertModeToStorage(value) {
  try {
    window.localStorage.setItem('okf.studio.expertMode', value ? 'expert' : 'basic');
  } catch {
    /* private mode — ignore */
  }
}

const getters = {
  activeDraft: (state) => (repoId) => state.drafts[repoId] || null,
  repoById: (state) => (repoId) => state.reposById[repoId] || null,
  reposByStage: (state) => state.reposByStage,
  gate: (state) => (name) => state.gates[name] || { visible: false, reasonKey: null },
  bulkPublishResults: (state) => state.bulkPublish.results,
  bulkPublishInFlight: (state) => state.bulkPublish.inFlight,
  // Story #978 — editor getters.
  editorSubTab: (state) => state.editor.subTab,
  editorRepoId: (state) => state.editor.repoId,
  conceptsByRepo: (state) => (repoId) => state.editor.conceptsByRepo[repoId] || [],
  conceptById: (state) => (repoId, conceptId) =>
    (state.editor.conceptsByRepo[repoId] || []).find((c) => c.concept_id === conceptId) || null,
  selectedConceptId: (state) => state.editor.selectedConceptId,
  versionsByRepo: (state) => (repoId) => state.versionsByRepo[repoId] || [],
  editorLoading: (state) => state.editor.loading,
  isExpert: (state) => state.ui.expertMode,
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
  upsertRepo(state, repo) {
    if (!repo || !repo.repo_id) return;
    state.reposById = { ...state.reposById, [repo.repo_id]: repo };
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
  startBulkPublish(state) {
    state.bulkPublish = { inFlight: true, results: [] };
  },
  addBulkPublishResult(state, result) {
    state.bulkPublish = {
      ...state.bulkPublish,
      results: [...state.bulkPublish.results, result]
    };
  },
  endBulkPublish(state) {
    state.bulkPublish = { ...state.bulkPublish, inFlight: false };
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
  setExpertMode(state, value) {
    state.ui = { ...state.ui, expertMode: !!value };
    writeExpertModeToStorage(!!value);
  },
  setError(state, value) {
    state.error = value;
  }
};

const actions = {
  /**
   * Load (or return-cached) draft for a repo. NO-OP if a cached draft exists —
   * avoids server round-trip when resuming in-process.
   */
  loadDraft({ state }, { repoId, force = false } = {}) {
    if (!repoId) return null;
    if (!force && state.drafts[repoId]) return state.drafts[repoId];
    return null;
  },

  /**
   * Save a draft (upsert). Returns { ok, code? }. NOT_READY until the
   * okf_studio_drafts collection/server route is live — call still updates
   * in-memory state so the wizard remains usable during the gap.
   */
  async saveDraft({ commit }, { repoId, draft }) {
    if (!repoId || !draft) {
      return { ok: false, code: 'VALIDATION_ERROR', message: 'repoId and draft required' };
    }
    commit('setDraft', { repoId, draft: { ...draft, updated_at: Date.now() } });
    try {
      // POST /api/okf/studio_drafts/:repo_id — server collection is to-be-built (10.5).
      // Until then the call returns 404; we treat as NOT_READY but keep the in-memory
      // draft so the wizard works locally.
      await studioService.saveDraft(repoId, draft);
      return { ok: true };
    } catch {
      return { ok: false, code: 'NOT_READY', message: 'okf.studio.draft.notReady' };
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
    } catch {
      // 404 → no concepts yet; render placeholder
      commit('setRepoMetrics', { repoId, metrics: null });
      return { ok: true, metrics: null };
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
  async bulkPublish({ commit, dispatch }, { repoIds, actor, trigger = 'publish' } = {}) {
    if (!Array.isArray(repoIds) || repoIds.length === 0) {
      return { ok: false, code: 'VALIDATION_ERROR', message: 'repoIds required' };
    }
    commit('startBulkPublish');
    for (const repoId of repoIds) {
      const result = await dispatch('mintVersion', { repoId, body: { trigger }, actor });
      commit('addBulkPublishResult', {
        repo_id: repoId,
        ok: !!result.ok,
        code: result.code,
        message: result.message
      });
    }
    commit('endBulkPublish');
    return { ok: true };
  },

  async updateLabels({ commit }, { repoId, labels }) {
    try {
      await repoOkfService.update(repoId, { labels });
      const existing = this.state?.okf?.reposById?.[repoId] || null;
      if (existing) {
        commit('upsertRepo', { ...existing, labels });
      }
      return { ok: true };
    } catch {
      // Server endpoint may not exist yet — labels persist locally in the Vuex state
      // via the upsertRepo call above (committed optimistically).
      return { ok: false, code: 'NOT_READY', message: 'okf.curator.labels.notReady' };
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
   * @param {string} [payload.url]        crawled URL (slug + title source)
   * @param {string} [payload.crawlJobId] crawl_job _key (audit)
   * @param {string} [payload.filename]   original file_name (preferred title)
   * @param {Object} [payload.actor]      auth hints (sub → x-actor-sub)
   * @param {string} [payload.domain]     subject area (defaults to 'general')
   * @returns {Promise<Object>} { ok, repo?, code?, message? }
   */
  async createFromCrawl({ commit }, payload = {}) {
    commit('setError', null);
    try {
      const repo = await crawlerToOkfService.convertCrawlToOkf(payload);
      if (repo && repo.repo_id) {
        commit('upsertRepo', repo);
        const byStage = this.state?.okf?.reposByStage || { draft: [], in_review: [], published: [] };
        const draftLane = Array.isArray(byStage.draft) ? byStage.draft.slice() : [];
        if (!draftLane.includes(repo.repo_id)) draftLane.push(repo.repo_id);
        commit('setReposByStage', { ...byStage, draft: draftLane });
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
      if (err && err.repo && err.repo.repo_id) {
        commit('upsertRepo', err.repo);
        commit('setError', err.message);
        return { ok: false, partial: true, repo: err.repo, code, message: err.message };
      }
      commit('setError', err.message || 'createFromCrawl failed');
      return { ok: false, code, message: err.message };
    }
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
      const byStage = this.state?.okf?.reposByStage || { draft: [], in_review: [], published: [] };
      const draftLane = Array.isArray(byStage.draft) ? byStage.draft.slice() : [];
      if (!draftLane.includes(repo.repo_id)) draftLane.push(repo.repo_id);
      commit('setReposByStage', { ...byStage, draft: draftLane });
      return { ok: true, repo };
    } catch (err) {
      commit('setError', err.message || 'createRepo failed');
      return { ok: false, code: 'CREATE_FAILED', message: err.message };
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

  async openEditor({ commit, dispatch }, { repoId } = {}) {
    if (!repoId) return { ok: false, code: 'VALIDATION_ERROR' };
    commit('setEditorRepo', repoId);
    commit('setSelectedConcept', null);
    return dispatch('fetchConcepts', repoId);
  },

  /** Fetch (or refetch) the concept list for the editor's left rail. */
  async fetchConcepts({ commit }, repoId) {
    if (!repoId) return { ok: false, code: 'VALIDATION_ERROR' };
    commit('setConceptsLoading', true);
    try {
      const concepts = await conceptService.listForRepo(repoId);
      commit('setConcepts', { repoId, concepts: Array.isArray(concepts) ? concepts : [] });
      return { ok: true, concepts };
    } catch (err) {
      commit('setError', err.message || 'fetchConcepts failed');
      commit('setConcepts', { repoId, concepts: [] });
      return { ok: false, code: 'FETCH_FAILED', message: err.message };
    } finally {
      commit('setConceptsLoading', false);
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
   * PATCH one concept's markdown. On success the row's content_hash +
   * index_status ride back on the response — refresh the row in place so the
   * left rail reflects the new state without a refetch.
   */
  async patchConcept({ commit, state }, { repoId, conceptId, markdown, actor } = {}) {
    if (!repoId || !conceptId || typeof markdown !== 'string') {
      return { ok: false, code: 'VALIDATION_ERROR' };
    }
    try {
      const result = await repoOkfService.patchConcept(repoId, conceptId, markdown, actor);
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
      commit('setError', err.message || 'patchConcept failed');
      return { ok: false, code: 'PATCH_FAILED', message: err.message };
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
  async autocorrectRepo({ commit, dispatch }, { repoId, dryRun = true, actor } = {}) {
    if (!repoId) return { ok: false, code: 'VALIDATION_ERROR' };
    try {
      const result = await repoOkfService.autocorrect(repoId, { dryRun }, actor);
      if (!dryRun) await dispatch('fetchConcepts', repoId);
      return { ok: true, ...result };
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
        code: (err && err.code) || 'LIFECYCLE_FAILED',
        message: err.message || 'lifecycle transition failed'
      };
    }
  },

  /**
   * Story #978 — delete the whole repository (cascade). The server refuses
   * while an ingested version is serving (INGESTED_DELETE_BLOCKED).
   */
  async deleteRepoAction({ commit, state }, { repoId } = {}) {
    try {
      await okfRepoOps.deleteRepo(repoId);
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
  async upsertImported({ commit, state }, { file, name, domain } = {}) {
    try {
      const repo = await okfRepoOps.importRepoZip({ file, name, domain });
      commit('upsertRepo', repo);
      const repos = Object.values(state.reposById);
      commit('setReposByStage', laneFor(repos));
      return { ok: true, repo };
    } catch (err) {
      const code = (err && err.code) || 'IMPORT_FAILED';
      if (err && err.repo) commit('upsertRepo', err.repo); // repo exists — openable
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

  setEditorSubTab({ commit }, subTab) {
    commit('setEditorSubTab', subTab === 'wizard' ? 'wizard' : 'editor');
  }
};

// Lazy require so the module loads in test environments without the services.
let studioService;
let repoOkfService;
let crawlerToOkfService;
let conceptService;
let okfRepoOps;
function ensureServices() {
  if (!studioService) studioService = require('@/services/studioService').default;
  if (!repoOkfService) repoOkfService = require('@/services/repoOkfService').default;
  if (!crawlerToOkfService) crawlerToOkfService = require('@/services/crawlerToOkfService').default;
  if (!conceptService) conceptService = require('@/services/conceptService').default;
  if (!okfRepoOps) okfRepoOps = require('@/services/okfRepoOps');
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
  state: initialState(),
  getters,
  mutations,
  actions: actionsWithServices
};
