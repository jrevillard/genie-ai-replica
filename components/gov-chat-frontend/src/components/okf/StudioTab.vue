<!--
  OkfStudioTab.vue — Story 3-4 host surface inside AdminDashboard.
  - Header: DsModeSwitch (Basic/Expert, rule 7) + OkfNarrative kind="intro"
  - View toggle: dashboard ↔ wizard
  - Empty state (no repo yet) renders a "Create new repository" entry
  - Dashboard view (Phase 3): the kanban
  - Wizard view (Phase 2): the 10-step shell
-->
<template>
  <div class="okf-studio-tab">
    <header class="okf-studio-tab__header">
      <h2 class="okf-studio-tab__title">{{ translate('okf.studio.title', 'OKF Studio') }}</h2>
      <div class="okf-studio-tab__modes">
        <DsModeSwitch :model-value="expertMode" @update:model-value="onExpertChange" @help="helpOpen = true" />
        <DsButton variant="ghost" small @click="helpOpen = true">{{ translate('okf.studio.help', 'Help') }}</DsButton>
      </div>
    </header>

    <OkfNarrative kind="intro" />

    <nav class="okf-studio-tab__view-toggle" aria-label="View">
      <DsButton :variant="view === 'dashboard' ? 'primary' : 'secondary'" small @click="view = 'dashboard'">
        {{ translate('okf.studio.view.dashboard', 'Dashboard') }}
      </DsButton>
      <DsButton :variant="view === 'wizard' ? 'primary' : 'secondary'" small @click="view = 'wizard'">
        {{ translate('okf.studio.view.wizard', 'Wizard') }}
      </DsButton>
    </nav>

    <OkfStudioDashboard v-if="view === 'dashboard'" @resume="onResume" />
    <OkfStudioWizard v-else :draft="activeDraft" @reset="resetWizard" />

    <DsDialog
      :visible="helpOpen"
      :title="translate('okf.studio.help.title', 'About OKF Studio')"
      :actions="[{ key: 'close', label: translate('common.close', 'Close'), variant: 'primary' }]"
      size="md"
      @close="helpOpen = false"
      @action="helpOpen = false"
    >
      <p>
        {{
          translate(
            'okf.studio.help.body',
            'OKF repositories are a lightweight ontological layer — labels define categories, topics define entities, sources define provenance. Once published, chat answers cite topics by id and surface their provenance.'
          )
        }}
      </p>
    </DsDialog>
  </div>
</template>

<script>
import { mapGetters } from 'vuex';
import translateMixin from '../../mixins/translateMixin';
import DsButton from '../ds/Button.vue';
import DsDialog from '../ds/Dialog.vue';
import DsModeSwitch from '../ds/ModeSwitch.vue';
import OkfNarrative from './Narrative.vue';
import OkfStudioDashboard from './StudioDashboard.vue';
import OkfStudioWizard from './StudioWizard.vue';

export default {
  name: 'OkfStudioTab',
  components: { DsButton, DsDialog, DsModeSwitch, OkfNarrative, OkfStudioDashboard, OkfStudioWizard },
  mixins: [translateMixin],
  data() {
    return {
      view: 'dashboard',
      helpOpen: false,
      activeDraft: null
    };
  },
  computed: {
    ...mapGetters('okf', ['isExpert']),
    expertMode() {
      return this.isExpert ? 'expert' : 'basic';
    }
  },
  mounted() {
    this.$store.dispatch('okf/fetchRepos', { stage: 'all' }).catch(() => {
      /* repository list unavailable; the dashboard shows its empty state */
    });
    // Story 3-6 / 3-7 entry points fire these custom events; the studio tab
    // switches to the wizard view with the preloaded selection already in
    // okf/selection (set by the source component before the event).
    window.addEventListener('okf:create-from-documents', this.onCreateFromDocuments);
    window.addEventListener('okf:create-from-crawl', this.onCreateFromCrawl);
    // Story 3-7 (fix #977): when the crawler flow creates a fresh OKF repo,
    // switch to the wizard view with a 'crawl'-source draft at Step 5 (Curate)
    // — mirrors the Clone amendment's UX (clone skips Produce → opens at Curate).
    window.addEventListener('okf:okf-repo-created', this.onOkfRepoCreated);
  },
  beforeUnmount() {
    window.removeEventListener('okf:create-from-documents', this.onCreateFromDocuments);
    window.removeEventListener('okf:create-from-crawl', this.onCreateFromCrawl);
    window.removeEventListener('okf:okf-repo-created', this.onOkfRepoCreated);
  },
  methods: {
    onExpertChange(mode) {
      this.$store.dispatch('okf/setExpertMode', mode === 'expert');
    },
    onResume(repoId) {
      // Phase 3 wiring: load the draft + switch to wizard view at the saved step.
      this.activeDraft = this.$store.getters['okf/activeDraft'](repoId);
      this.view = 'wizard';
    },
    onCreateFromDocuments() {
      // AdminDashboard already set the active tab to 'studio' + dispatched
      // this event with the documents preloaded into okf/selection.
      this.view = 'wizard';
    },
    onCreateFromCrawl() {
      // AddFromLinkDialog / FileDetailsDialog preloaded crawlSeeds; the wizard
      // surfaces Step 1 (Choose workflow) with the crawl source pre-selected.
      this.view = 'wizard';
    },
    onOkfRepoCreated(evt) {
      // Story 3-7 fix (#977): the crawler flow just produced a draft OKF
      // repo. Switch to the wizard view with the new repo as the active
      // draft, source='crawl', and the saved-step pinned to 5 (Curate) so the
      // steward lands directly on the concept list — the StudioWizard's
      // `mounted()` reads draft.source and bumps activeStep to >= 5 for
      // clone/crawl sources (mirrors the Clone amendment).
      const repoId = evt && evt.detail && evt.detail.repo_id;
      const repo = evt && evt.detail && evt.detail.repo;
      if (repoId) {
        this.$store.dispatch('okf/saveDraft', {
          repoId,
          draft: {
            studio_step: 5,
            source: 'crawl',
            repo_id: repoId,
            name: repo && repo.name,
            concept_count: (repo && repo.concept_count) || 1,
            updated_at: Date.now()
          }
        });
        this.activeDraft = {
          ...(this.$store.getters['okf/activeDraft'](repoId) || {}),
          repo_id: repoId,
          studio_step: 5,
          source: 'crawl'
        };
      }
      this.view = 'wizard';
    },
    resetWizard() {
      this.activeDraft = null;
      this.view = 'dashboard';
    }
  }
};
</script>

<style scoped>
.okf-studio-tab {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}
.okf-studio-tab__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
}
.okf-studio-tab__title {
  margin: 0;
  font-size: var(--text-lg);
  font-weight: 600;
}
.okf-studio-tab__modes {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}
.okf-studio-tab__view-toggle {
  display: inline-flex;
  gap: var(--space-xs);
}
</style>
