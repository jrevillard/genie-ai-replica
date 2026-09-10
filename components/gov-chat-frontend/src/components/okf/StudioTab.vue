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
      <DsFormGroup input-id="okf-create-domain">
        <template #label>
          {{ translate('okf.create.domain', 'Subject area') }}
          <DsInfoTip
            :text="
              translate(
                'okf.glossary.subjectArea',
                'Where does this knowledge belong? The Subject Area groups your repository and focuses which labels you can choose. It cannot be changed after creation.'
              )
            "
          />
        </template>
        <!-- EXPLICIT CHOICE REQUIRED (David, 2026-09-05): domain is IMMUTABLE
             post-create — a repo born 'General' can never get the
             bounded-labels experience. The placeholder forces the pick; the
             'general' fallback lives only in okfRepoOps as the
             unreachable-tree safety net, never as a silent default. -->
        <DsSelect id="okf-create-domain" v-model="createDomain" size="sm">
          <option value="">{{ translate('okf.create.domainPlaceholder', 'Select a subject area…') }}</option>
          <option v-for="opt in domainOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
        </DsSelect>
      </DsFormGroup>
      <p v-if="createError" class="okf-studio-tab__create-error">{{ createError }}</p>
      <hr class="okf-studio-tab__divider" />
      <p class="okf-studio-tab__create-hint">
        {{ translate('okf.create.importHint', 'Or import an existing zip bundle as a new repository.') }}
      </p>
      <DsFormGroup input-id="okf-create-zip">
        <template #label>
          Bundle (.zip)
          <DsInfoTip
            :text="
              translate(
                'okf.glossary.bundle',
                'The zip export of a repository — its concepts, structure and metadata in one file. Bundles are how repositories move between systems.'
              )
            "
          />
        </template>
        <!-- P0-UX: staged state is VISIBLE — the steward knows the import
             starts on Create, not on selection. -->
        <p v-if="stagedZipName" class="okf-studio-tab__create-hint">
          {{ translate('okf.create.stagedFile', 'Staged: {name}').replace('{name}', stagedZipName) }}
        </p>
        <input
          id="okf-create-zip"
          type="file"
          accept=".zip,application/zip"
          class="okf-studio-tab__file"
          @change="onImportFilePick"
        />
      </DsFormGroup>
      <!-- Concept-classification strategy for the imported bundle (David,
           2026-09-05): all three selectable, Heuristics default. Rides the
           import payload; the backend converter wires the parameter. -->
      <DsFormGroup input-id="okf-create-class">
        <template #label>
          {{ translate('okf.create.classLabel', 'Concept classification') }}
          <DsInfoTip
            :text="
              translate(
                'okf.glossary.classification',
                'How we decide what each concept IS (a topic, an entity, a process…). Heuristics reads the page automatically; the LLM option is slower but can handle tricky pages.'
              )
            "
          />
        </template>
        <DsSelect id="okf-create-class" v-model="importClassification" size="sm">
          <option value="heuristics">{{ translate('okf.create.classHeuristics', 'Heuristics (default)') }}</option>
          <option value="llm">{{ translate('okf.create.classLlm', 'LLM-assisted') }}</option>
          <option value="hybrid">{{ translate('okf.create.classHybrid', 'Hybrid') }}</option>
        </DsSelect>
        <!-- D-B honesty (David, 2026-09-07): the selected mode's real
             meaning + expected duration, visible where it is chosen. -->
        <p class="okf-studio-tab__create-hint">{{ classHint }}</p>
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
      :title="translate('okf.studio.helpTitle', 'About OKF Studio')"
      :actions="[{ key: 'close', label: translate('common.close', 'Close'), variant: 'primary' }]"
      size="md"
      @close="helpOpen = false"
      @action="helpOpen = false"
    >
      <p>
        {{
          translate(
            'okf.studio.helpBody',
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
import okfRepoOps from '../../services/okfRepoOps';
import DsButton from '../ds/Button.vue';
import DsDialog from '../ds/Dialog.vue';
import DsModeSwitch from '../ds/ModeSwitch.vue';
import DsFormGroup from '../ds/FormGroup.vue';
import DsInput from '../ds/Input.vue';
import DsSelect from '../ds/Select.vue';
import DsInfoTip from '../ds/InfoTip.vue';
import OkfNarrative from './Narrative.vue';
import OkfStudioDashboard from './StudioDashboard.vue';
import OkfStudioWizard from './StudioWizard.vue';
import OkfRepoEditorShell from './editor/RepoEditorShell.vue';

export default {
  name: 'OkfStudioTab',
  components: {
    DsButton,
    DsFormGroup,
    DsInfoTip,
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
      // '' = no subject area chosen yet (the placeholder forces the pick —
      // the old silent 'general' default is dead; David, 2026-09-05).
      createDomain: '',
      createError: '',
      khDomainOptions: [],
      creating: false,
      importBusy: false,
      importStatus: '',
      // P0-UX staged zip (David, 2026-09-08): file selection stages, the
      // Create Repository click imports.
      stagedZipFile: null,
      stagedZipName: '',
      // Concept-classification strategy for the imported bundle (David,
      // 2026-09-05): heuristics | llm | hybrid — Heuristics is the default.
      importClassification: 'heuristics'
    };
  },
  computed: {
    ...mapGetters('okf', ['isExpert']),
    // D-B honesty: the selected classification mode's real meaning.
    classHint() {
      const key =
        this.importClassification === 'llm'
          ? 'okf.crawl.classLlmHint'
          : this.importClassification === 'hybrid'
            ? 'okf.crawl.classHybridHint'
            : 'okf.crawl.classHeuristicsHint';
      const fallback =
        this.importClassification === 'llm'
          ? 'The LLM curates every concept — type, a Knowledge-Hierarchy label and a description. Far more accurate and complete than heuristics; expect added time per concept.'
          : this.importClassification === 'hybrid'
            ? 'Heuristics first; the LLM reviews uncertain cases and fills gaps. Balanced time and completeness.'
            : 'Fast rule-based classification — no LLM cost, good for well-structured crawls.';
      return this.translate(key, fallback);
    },
    domainOptions() {
      // SUBJECT AREAS follow the Knowledge Hierarchy Categories (David,
      // 2026-09-04) — loaded from the curated tree in refreshDomainOptions().
      // The loader itself returns the explicit 'General' option when the
      // hierarchy is unreachable; while it loads the list is empty and the
      // placeholder forces the pick.
      return this.khDomainOptions;
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
          // Subject Area REQUIRED (David, 2026-09-05): domain is immutable
          // post-create — no repo is born without an explicit pick.
          disabled: this.creating || !!this.matchingRepo || !(this.createName || '').trim() || !this.createDomain
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
    this.refreshDomainOptions();
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
      // CROSS-REPO STALE-STATE GUARD (David, 2026-09-06): drop any concept
      // selection left over from the previously-open repo BEFORE the new
      // shell mounts — the child editor fetches on mount, before the
      // store's openEditor reset runs.
      this.$store.commit('okf/setSelectedConcept', null);
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
      // P0-UX staged zip (David, 2026-09-08): the Create click is the
      // ACTION point — create the repo, go to the dashboard, and run the
      // zip import in the BACKGROUND so the card is visible immediately.
      // 409/validation errors surface HERE, before navigation.
      const zip = this.stagedZipFile;
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
      const repo = result.repo;
      const repoId = repo.repo_id;
      this.createOpen = false;
      this.createName = '';
      this.stagedZipFile = null;
      this.stagedZipName = '';
      this.importStatus = '';
      if (zip) {
        const classification = this.importClassification;
        this.view = 'dashboard'; // the card is the progress surface
        try {
          okfRepoOps
            .importZipIntoRepo({ repoId, file: zip, classification })
            .then(() => this.$store.dispatch('okf/fetchRepos', { stage: 'all' }).catch(() => {}))
            .catch((err) => {
              // The repo exists and stays visible; the import failure needs a
              // surface the steward actually sees.
              this.$store.commit('okf/setError', (err && err.message) || 'Zip import failed');
              console.error('[studio] background zip import failed:', err);
            });
        } catch (err) {
          // NO SILENT DEATHS (David, 2026-09-08): a synchronous throw (a
          // missing export, bad args) must reach the steward — never die as
          // an unhandled rejection with the import simply never happening.
          this.$store.commit('okf/setError', (err && err.message) || 'Zip import failed');
          console.error('[studio] background zip import threw synchronously:', err);
        }
        return;
      }
      // stale-selection guard — see onResume (David, 2026-09-06)
      this.$store.commit('okf/setSelectedConcept', null);
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
      // P0-UX (David, 2026-09-08, verbatim): "the file import should happen
      // when I click the Create Repository button... not immediately after
      // I select the file." File selection is STAGING ONLY — validate,
      // show the name, prefill it; the Create Repository button is the
      // action point (create → dashboard → background import).
      const file = evt && evt.target && evt.target.files ? evt.target.files[0] : null;
      if (!file) return;
      if (!/\.zip$/i.test(file.name)) {
        this.createError = this.translate('okf.create.zipOnly', 'Pick a .zip bundle file.');
        if (evt && evt.target) evt.target.value = '';
        return;
      }
      // Subject Area REQUIRED before the bundle is born (David, 2026-09-05):
      // domain is immutable post-create — a zip import must never silently
      // fall back to 'General'.
      if (!this.createDomain) {
        this.createError = this.translate(
          'okf.create.domainRequired',
          'Pick a subject area first — it cannot be changed after creation.'
        );
        if (evt && evt.target) evt.target.value = '';
        return;
      }
      this.createError = '';
      this.stagedZipFile = file;
      this.stagedZipName = file.name;
      // Prefill the name from the bundle so the staged state is visible and
      // editable before the Create click.
      if (!(this.createName || '').trim()) {
        const suggested = file.name.replace(/.zip$/i, '').replace(/[-_]+/g, ' ').trim();
        this.createName = suggested || this.translate('okf.create.importDefaultName', 'Imported repository');
      }
      this.importStatus = this.translate(
        'okf.create.staged',
        'Bundle staged — click Create Repository to start the import.'
      );
    },
    // SUBJECT AREAS follow the Knowledge Hierarchy Categories (David,
    // 2026-09-04): the create dialog loads its options from the curated
    // tree; the chosen domain is immutable post-create, so this picker is
    // the one place the value is born. NO auto-pick (David, 2026-09-05):
    // selecting the first KH category for the steward is not a choice — the
    // placeholder holds until they pick.
    async refreshDomainOptions() {
      try {
        const domains = Object.values((this.$store.state.okf && this.$store.state.okf.reposById) || {})
          .map((r) => r.domain)
          .filter(Boolean);
        const opts = await okfRepoOps.loadSubjectAreaOptions(domains);
        if (Array.isArray(opts) && opts.length) {
          this.khDomainOptions = opts;
        }
      } catch {
        /* the previous list (or the loader's explicit General fallback) stands */
      }
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
        // stale-selection guard — see onResume (David, 2026-09-06)
        this.$store.commit('okf/setSelectedConcept', null);
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
