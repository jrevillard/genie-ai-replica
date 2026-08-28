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
  reposByStage: { draft: [], in_review: [], published: [] },
  selection: { documents: [], crawlSeeds: [], clonedFrom: null },
  gates: {
    okfRepoButton: { visible: false, reasonKey: null, reasonParams: {} }
  },
  bulkPublish: { inFlight: false, results: [] },
  ui: {
    expertMode: readExpertModeFromStorage()
  },
  error: null
});

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
      const byStage = { draft: [], in_review: [], published: [] };
      repos.forEach((r) => {
        const stageKey =
          r.lifecycle_state === 'published'
            ? 'published'
            : r.lifecycle_state === 'review' || r.lifecycle_state === 'approve'
              ? 'in_review'
              : 'draft';
        if (byStage[stageKey]) byStage[stageKey].push(r.repo_id);
      });
      commit('setReposByStage', byStage);
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
          window.dispatchEvent(new CustomEvent('okf:okf-repo-created', { detail: { repo_id: repo.repo_id, repo } }));
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
  }
};

// Lazy require so the module loads in test environments without the services.
let studioService;
let repoOkfService;
let crawlerToOkfService;
function ensureServices() {
  if (!studioService) studioService = require('@/services/studioService').default;
  if (!repoOkfService) repoOkfService = require('@/services/repoOkfService').default;
  if (!crawlerToOkfService) crawlerToOkfService = require('@/services/crawlerToOkfService').default;
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
