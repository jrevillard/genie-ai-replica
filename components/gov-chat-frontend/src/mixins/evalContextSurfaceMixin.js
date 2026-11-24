/**
 * evalContextSurfaceMixin — the THREE evaluation-context surface members
 * every Lab panel needs (#2061 phase 4 / E-5).
 *
 * Why a mixin: TestingLabDialog and RagasPanel each carried near-verbatim
 * copies of these, and the copies had already drifted (the two binding
 * labels counted the context's repositories differently). One surface, one
 * authority: the binding sentence, the context id of a suite, and the
 * superadmin gate are decided HERE and nowhere else.
 *
 * The gate mirrors the SERVER's `isSuperadminCaller` predicate exactly: the
 * `tools-admin` realm role OR the wildcard `okf:*:*:admin` scope — both
 * populations the context API serves. Client-side this is PRESENTATION
 * gating only; the server enforces the read on every call.
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
      const user = getters.currentUser || null;
      const roles = (user && user.roles) || [];
      const scopes = (user && user.okf_scopes) || [];
      return roles.includes('tools-admin') || scopes.includes('okf:*:*:admin');
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
      const repos =
        (Array.isArray(ctx.repos) && ctx.repos.length) ||
        (ctx.resolved && Array.isArray(ctx.resolved.repos) ? ctx.resolved.repos.length : 0) ||
        0;
      return this.translate(
        'okf.testingLab.suites.binding',
        'Measured over “{name}” (v{version} · {repos} repositories)'
      )
        .replace('{name}', ctx.name || ctx.id)
        .replace('{version}', String(ctx.version || 1))
        .replace('{repos}', String(repos));
    }
  },
  methods: {
    /**
     * The context id a RUN of this suite must carry — the suite's OWN
     * binding, never the picker's current selection (a suite minted for a
     * context is measured over that context; the server refuses anything
     * else with CROSS_CONTEXT_BLOCKED).
     */
    suiteContextIdFor(suite) {
      const ctx = suite && ((suite.payload && suite.payload.context) || suite.context);
      return (ctx && ctx.id) || '';
    }
  }
};
