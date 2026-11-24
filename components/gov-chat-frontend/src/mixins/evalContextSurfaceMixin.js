/**
 * evalContextSurfaceMixin — the evaluation-context surface members every
 * Lab panel needs (#2061 phase 4 / E-5).
 *
 * Why a mixin: TestingLabDialog and RagasPanel each carried near-verbatim
 * copies of these, and the copies had already drifted (the two binding
 * labels counted the context's repositories differently). One surface, one
 * authority: the binding sentence, the context id of a suite, the reach
 * facts and the error envelope mapping are decided HERE and nowhere else.
 *
 * The gate consumes the auth store's `isOkfSuperadmin` getter (the role-OR-
 * wildcard-scope predicate the server's isSuperadminCaller enforces).
 * Client-side this is PRESENTATION gating only; the server enforces the
 * read on every call.
 */
import translateMixin from '@/mixins/translateMixin';

export default {
  mixins: [translateMixin],
  computed: {
    /**
     * May THIS caller see the composer tab and the context pickers?
     * (A repo-scoped admin still RUNS context-bound suites — the suite
     * carries its own frozen context — they just cannot mint for one.)
     */
    canUseContexts() {
      const getters = (this.$store && this.$store.getters) || {};
      return Boolean(getters.isOkfSuperadmin);
    },
    /**
     * The BINDING BADGE — which principal the loaded suite was minted for.
     * The engine froze the snapshot on the suite doc (payload.context) at
     * generation; the badge states it, it never recomputes it.
     */
    suiteBindingLabel() {
      const ctx = this.suite && this.suite.payload && this.suite.payload.context;
      if (!ctx) {
        return this.translate('okf.testingLab.suites.bindingOpen', 'Minted for the deployment — no evaluation context');
      }
      const reach = this.contextReach(ctx);
      return this.translate(
        'okf.testingLab.suites.binding',
        'Measured over “{name}” (v{version} · {repos} repositories)',
        {
          name: ctx.name || ctx.id,
          version: reach.version,
          repos: reach.repos
        }
      );
    }
  },
  methods: {
    /**
     * The context id a RUN of this suite must carry — the suite's OWN
     * binding, never the picker's current selection (a suite minted for a
     * context is measured over that context; the server refuses anything
     * else with CROSS_CONTEXT_BLOCKED). The server freezes the snapshot at
     * `payload.context` — that ONE shape is the contract.
     */
    suiteContextIdFor(suite) {
      const ctx = suite && suite.payload && suite.payload.context;
      return (ctx && ctx.id) || '';
    },
    /**
     * The reach facts (version, repository count) of a context, in the two
     * shapes they really occur: a SUITE's frozen snapshot (`repos` flat)
     * and a CATALOGUE document (`resolved.repos`). One derivation for the
     * badge and the picker label alike, so they cannot disagree.
     */
    contextReach(ctx) {
      const repos =
        (Array.isArray(ctx && ctx.repos) && ctx.repos.length) ||
        (ctx && ctx.resolved && Array.isArray(ctx.resolved.repos) ? ctx.resolved.repos.length : 0) ||
        0;
      return { version: (ctx && ctx.version) || 1, repos };
    },
    /** The server's error envelope, mapped to one honest sentence. */
    errorText(err, fallback = 'the request failed') {
      const data = err && err.data;
      if (data && data.message) return data.message;
      return (err && err.message) || fallback;
    }
  }
};
