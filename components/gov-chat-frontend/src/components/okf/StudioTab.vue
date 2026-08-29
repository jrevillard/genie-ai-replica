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

    <OkfStudioDashboard v-if="view === 'dashboard'" @resume="onResume" @new="onNew" />

    <DsDialog
      :visible="createOpen"
      :title="translate('okf.create.title', 'New OKF repository')"
      size="sm"
      :actions="createActions"
      @close="createOpen = false"
      @action="onCreateAction"
    >
      <p class="okf-studio-tab__create-hint">
        {{
          translate('okf.create.hint', 'Creates an empty repository with an index.md you edit in the Studio editor.')
        }}
      </p>
      <DsFormGroup :label="translate('okf.create.name', 'Repository name')" input-id="okf-create-name">
        <DsInput id="okf-create-name" v-model="createName" size="sm" />
      </DsFormGroup>
      <!-- Duplicate names are caught HERE, before submit — the steward sees
           the clash and can open the existing repo in one click instead of
           discovering it as a 409 after the fact. -->
      <div v-if="matchingRepo" class="okf-studio-tab__create-dup">
        <p class="okf-studio-tab__create-dup-text">
          {{
            translate(
              'okf.create.duplicateInline',
              'A repository with this name already exists. Open it, or pick another name.'
            )
          }}
        </p>
        <DsButton variant="secondary" small @click="onOpenMatching">
          {{ translate('okf.create.openExisting', 'Open existing repository') }}
        </DsButton>
      </div>
      <DsFormGroup :label="translate('okf.create.domain', 'Subject area')" input-id="okf-create-domain">
        <DsSelect id="okf-create-domain" v-model="createDomain" size="sm">
          <option v-for="opt in domainOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
        </DsSelect>
      </DsFormGroup>
      <p v-if="createError" class="okf-studio-tab__create-error">{{ createError }}</p>
      <hr class="okf-studio-tab__divider" />
      <p class="okf-studio-tab__create-hint">
        {{ translate('okf.create.importHint', 'Or import an existing zip bundle as a new repository.') }}
      </p>
      <DsFormGroup label="Bundle (.zip)" input-id="okf-create-zip">
        <input
          id="okf-create-zip"
          type="file"
          accept=".zip,application/zip"
          class="okf-studio-tab__file"
          @change="onImportFilePick"
        />
      </DsFormGroup>
      <p v-if="importStatus" class="okf-studio-tab__create-hint">{{ importStatus }}</p>
    </DsDialog>
    <OkfRepoEditorShell
      v-if="view === 'repo' && activeRepoId"
      :repo-id="activeRepoId"
      :draft="activeDraft"
      :source-file-id="activeSourceFileId"
      @back="onBackToDashboard"
      @refresh="onRepoRefresh"
    />
    <OkfStudioWizard v-if="view === 'wizard'" :draft="activeDraft" @reset="resetWizard" />

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
import DsFormGroup from '../ds/FormGroup.vue';
import DsInput from '../ds/Input.vue';
import DsSelect from '../ds/Select.vue';
import OkfNarrative from './Narrative.vue';
import OkfStudioDashboard from './StudioDashboard.vue';
import OkfStudioWizard from './StudioWizard.vue';
import OkfRepoEditorShell from './editor/RepoEditorShell.vue';

export default {
  name: 'OkfStudioTab',
  components: {
    DsButton,
    DsFormGroup,
    DsInput,
    DsSelect,
    DsDialog,
    DsModeSwitch,
    OkfNarrative,
    OkfStudioDashboard,
    OkfStudioWizard,
    OkfRepoEditorShell
  },
  mixins: [translateMixin],
  data() {
    return {
      view: 'dashboard', // 'dashboard' | 'repo' (shell) | 'wizard' (create flows)
      helpOpen: false,
      activeDraft: null,
      activeRepoId: null,
      activeSourceFileId: null,
      createOpen: false,
      createName: '',
      createDomain: 'general',
      createError: '',
      creating: false,
      importBusy: false,
      importStatus: ''
    };
  },
  computed: {
    ...mapGetters('okf', ['isExpert']),
    domainOptions() {
      return [
        { value: 'general', label: 'General' },
        { value: 'transport', label: 'Transport' },
        { value: 'health', label: 'Health' },
        { value: 'education', label: 'Education' },
        { value: 'social-services', label: 'Social services' },
        { value: 'agriculture', label: 'Agriculture' },
        { value: 'housing', label: 'Housing' },
        { value: 'civil-registry', label: 'Civil registry' }
      ];
    },
    createActions() {
      return [
        {
          key: 'cancel',
          label: this.translate('common.cancel', 'Cancel'),
          variant: 'secondary',
          disabled: this.creating
        },
        {
          key: 'create',
          label: this.translate('okf.create.create', 'Create repository'),
          variant: 'primary',
          disabled: this.creating || !!this.matchingRepo || !(this.createName || '').trim()
        }
      ];
    },
    /**
     * Existing repo whose name clashes with the dialog input (case-insensitive).
     * The dashboard loads ALL repos on tab mount (okf/fetchRepos), so this is
     * evaluated offline of any extra request.
     */
    matchingRepo() {
      const name = (this.createName || '').trim().toLowerCase();
      if (!name) return null;
      const repos = Object.values(this.$store.state.okf.reposById || {});
      return repos.find((r) => (r.name || '').trim().toLowerCase() === name) || null;
    },
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
      // Story #978: a repo card click opens the Editor shell — Wizard | Editor
      // sub-tabs, Editor default (UX design AC5). The wizard sub-tab mounts
      // the existing 10-step flow; a repo without a stored draft gets a
      // permissive one (studio_step 9 → no locked steps, start at Curate).
      const draft = this.$store.getters['okf/activeDraft'](repoId);
      this.activeRepoId = repoId;
      this.activeSourceFileId = null;
      if (draft) {
        this.activeDraft = draft;
        this.activeSourceFileId = draft.source_file_id || null;
      } else {
        const repo = this.$store.getters['okf/repoById'](repoId) || {};
        this.activeDraft = {
          repo_id: repoId,
          name: repo.name,
          domain: repo.domain,
          concept_count: repo.concept_count || 0,
          studio_step: 9, // everything unlocked — an existing repo isn't step-locked
          source: 'editor'
        };
      }
      this.$store.dispatch('okf/setEditorSubTab', 'editor');
      this.view = 'repo';
    },
    onBackToDashboard() {
      this.activeDraft = null;
      this.activeRepoId = null;
      this.view = 'dashboard';
      this.$store.dispatch('okf/fetchRepos', { stage: 'all' }).catch(() => {});
    },
    onNew() {
      // "+ New repository": minimal create dialog, then straight into the
      // Editor with an index.md skeleton (Story #978 dialog-then-editor UX).
      this.createOpen = true;
    },
    /**
     * "Open existing repository" from the create dialog — same path as
     * clicking the repo card on the dashboard (Editor shell, Editor tab).
     */
    onOpenMatching() {
      if (!this.matchingRepo) return;
      const repoId = this.matchingRepo.repo_id;
      this.createOpen = false;
      this.createName = '';
      this.createError = '';
      this.onResume(repoId);
    },
    async onCreateAction(key) {
      if (key === 'cancel') {
        this.createOpen = false;
        return;
      }
      if (key !== 'create' || this.creating) return;
      this.creating = true;
      this.createError = '';
      const result = await this.$store.dispatch('okf/createRepo', {
        name: this.createName,
        domain: this.createDomain
      });
      this.creating = false;
      if (!result.ok) {
        this.createError =
          result.code === 'DUPLICATE_REPO'
            ? this.translate(
                'okf.create.duplicate',
                'A repository with this name already exists - open it from the dashboard or pick another name.'
              )
            : result.message || this.translate('okf.create.failed', 'Repository creation failed');
        return;
      }
      this.createOpen = false;
      this.createName = '';
      const repoId = result.repo.repo_id;
      this.activeRepoId = repoId;
      this.activeSourceFileId = null;
      this.activeDraft = {
        repo_id: repoId,
        name: result.repo.name,
        domain: result.repo.domain,
        concept_count: 1,
        studio_step: 9,
        source: 'editor'
      };
      this.$store.dispatch('okf/setEditorSubTab', 'editor');
      this.view = 'repo';
    },
    onImportFilePick(evt) {
      // Zip import (David, 2026-08-28): a bundle becomes a NEW draft repo +
      // its concepts are ingested server-side (2.9.5 unzip path).
      const file = evt && evt.target && evt.target.files ? evt.target.files[0] : null;
      if (!file || this.importBusy) return;
      this.importBusy = true;
      this.createError = '';
      this.importStatus = this.translate('okf.create.importing', 'Importing bundle…');
      const suggested = file.name.replace(/.zip$/i, '').replace(/[-_]+/g, ' ').trim();
      const name =
        (this.createName || '').trim() ||
        suggested ||
        this.translate('okf.create.importDefaultName', 'Imported repository');
      this.$store
        .dispatch('okf/upsertImported', { file, name })
        .then((res) => {
          if (!res || !res.ok) {
            this.createError = (res && res.message) || 'Import failed';
            return;
          }
          this.createOpen = false;
          this.createName = '';
          const repo = res.repo;
          this.activeRepoId = repo.repo_id;
          this.activeSourceFileId = null;
          this.activeDraft = {
            repo_id: repo.repo_id,
            name: repo.name,
            domain: repo.domain,
            concept_count: repo.concept_count || 0,
            studio_step: 9,
            source: 'editor'
          };
          this.$store.dispatch('okf/setEditorSubTab', 'editor');
          this.view = 'repo';
        })
        .catch((err) => {
          this.createError = (err && err.message) || 'Import failed';
        })
        .finally(() => {
          this.importBusy = false;
          this.importStatus = '';
          if (evt && evt.target) evt.target.value = '';
        });
    },
    onRepoRefresh() {
      // Resplit changed the concept set — refresh dashboard counts.
      this.$store.dispatch('okf/fetchRepos', { stage: 'all' }).catch(() => {});
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
      const fileId = evt && evt.detail && evt.detail.file_id;
      if (repoId) {
        this.$store.dispatch('okf/saveDraft', {
          repoId,
          draft: {
            studio_step: 5,
            source: 'crawl',
            repo_id: repoId,
            name: repo && repo.name,
            concept_count: (repo && repo.concept_count) || 1,
            source_file_id: fileId || null,
            updated_at: Date.now()
          }
        });
        this.activeDraft = {
          ...(this.$store.getters['okf/activeDraft'](repoId) || {}),
          repo_id: repoId,
          studio_step: 5,
          source: 'crawl',
          source_file_id: fileId || null
        };
        this.activeRepoId = repoId;
        this.activeSourceFileId = fileId || null;
        // Land in the shell on the Wizard sub-tab at Step 5 (Curate) — the
        // crawl flow's designed post-create UX (#977); the Editor is one
        // sub-tab click away.
        this.$store.dispatch('okf/setEditorSubTab', 'wizard');
      }
      this.view = 'repo';
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
.okf-studio-tab__divider {
  border: none;
  border-top: 1px solid var(--border);
  margin: var(--space-sm) 0;
  width: 100%;
}
.okf-studio-tab__file {
  font-size: var(--text-sm);
  color: var(--fg);
}
.okf-studio-tab__view-toggle {
  display: inline-flex;
  gap: var(--space-xs);
}
</style>
