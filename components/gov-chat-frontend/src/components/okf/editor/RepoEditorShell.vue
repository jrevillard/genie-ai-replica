<!-- OkfRepoEditorShell.vue — Story #978 lifecycle edition (David, 2026-08-28).
  Header: back-to-studio (ALWAYS visible — navigation audit), repo name,
  lifecycle state pill (correct state mapping incl. publish/retracted),
  current version, bundle zip name (the repo+version artifact link), and the
  contextual lifecycle actions shared with the dashboard. Versions dialog is
  one click away. Sub-tabs: Wizard | Editor (Editor default). -->
<template>
  <div class="okf-shell">
    <header class="okf-shell__header">
      <DsButton variant="ghost" small @click="$emit('back')">
        ← {{ translate('okf.shell.back', 'Studio dashboard') }}
      </DsButton>
      <h3 class="okf-shell__name">{{ repoName }}</h3>
      <DsStatusTag :variant="stateVariant">{{ stateLabel }}</DsStatusTag>
      <span v-if="repo.version" class="okf-shell__version">
        {{ translate('okf.shell.version', 'v{n}').replace('{n}', String(repo.version)) }}
      </span>
      <DsPill v-if="serving" variant="success">{{ translate('okf.shell.serving', 'Serving') }}</DsPill>
      <span v-if="bundleName" class="okf-shell__bundle" :title="bundleName">
        <code>{{ bundleName }}</code>
      </span>
      <div class="okf-shell__actions">
        <DsButton variant="primary" small :disabled="actionBusy" @click="onLifecycle">
          {{ lifecycleLabel }}
        </DsButton>
        <DsButton variant="secondary" small :disabled="actionBusy" @click="versionsOpen = true">
          {{ translate('okf.shell.versions', 'Versions') }}
        </DsButton>
        <DsButton variant="ghost" small :disabled="exportBusy" @click="onExport">
          {{ translate('okf.shell.export', 'Export .zip') }}
        </DsButton>
        <DsButton
          v-if="!serving"
          variant="ghost"
          small
          :disabled="actionBusy"
          class="okf-shell__delete"
          @click="deleteOpen = true"
        >
          {{ translate('okf.shell.delete', 'Delete') }}
        </DsButton>
      </div>
    </header>
    <p v-if="actionError" class="okf-shell__error">{{ actionError }}</p>

    <DsTabs :tabs="subTabs" :model-value="subTab" @update:model-value="onSubTab">
      <template #default>
        <OkfStudioWizard v-show="subTab === 'wizard'" :draft="draft" @reset="$emit('back')" />
        <OkfRepoEditor v-show="subTab === 'editor'" :repo-id="repoId" :source-file-id="sourceFileId" />
      </template>
    </DsTabs>

    <OkfVersionsDialog
      :visible="versionsOpen"
      :repo="repo && repo.repo_id ? repo : null"
      @close="versionsOpen = false"
      @changed="onChanged"
    />

    <DsDialog
      :visible="deleteOpen"
      :title="translate('okf.shell.delete.title', 'Delete repository')"
      size="sm"
      :actions="deleteActions"
      @close="deleteOpen = false"
      @action="onDeleteAction"
    >
      <p>
        {{
          translate(
            'okf.shell.delete.body',
            'This permanently removes the repository, its concepts, indexed content, graph and bundle artifacts.'
          )
        }}
        <strong>{{ repoName }}</strong>
      </p>
      <p v-if="deleteError" class="okf-shell__error">{{ deleteError }}</p>
    </DsDialog>
  </div>
</template>

<script>
import { mapGetters } from 'vuex';
import translateMixin from '../../../mixins/translateMixin';
import DsButton from '../../ds/Button.vue';
import DsDialog from '../../ds/Dialog.vue';
import DsPill from '../../ds/Pill.vue';
import DsStatusTag from '../../ds/StatusTag.vue';
import DsTabs from '../../ds/Tabs.vue';
import OkfStudioWizard from '../StudioWizard.vue';
import OkfRepoEditor from './RepoEditor.vue';
import OkfVersionsDialog from './VersionsDialog.vue';
import okfRepoOps from '../../../services/okfRepoOps';

const STATE_LABELS = {
  publish: 'Published',
  retracted: 'Retracted',
  review: 'In review',
  approve: 'In review',
  draft: 'Draft',
  register: 'Draft'
};

const LIFECYCLE_LABELS = {
  submit: 'Submit for review',
  approve: 'Approve',
  publish: 'Publish',
  ingest: 'Ingest',
  retract: 'Retract'
};

export default {
  name: 'OkfRepoEditorShell',
  components: { DsButton, DsDialog, DsPill, DsStatusTag, DsTabs, OkfStudioWizard, OkfRepoEditor, OkfVersionsDialog },
  mixins: [translateMixin],
  props: {
    repoId: { type: String, required: true },
    draft: { type: Object, default: null },
    sourceFileId: { type: String, default: null }
  },
  emits: ['back', 'refresh'],
  data() {
    return {
      versionsOpen: false,
      deleteOpen: false,
      deleteError: '',
      actionBusy: false,
      exportBusy: false,
      actionError: ''
    };
  },
  computed: {
    ...mapGetters('okf', ['editorSubTab', 'repoById']),
    subTab() {
      return this.editorSubTab;
    },
    repo() {
      return this.repoById(this.repoId) || {};
    },
    repoName() {
      return this.repo.name || this.repoId;
    },
    serving() {
      return !!(this.repo.lifecycle_state === 'publish' && this.repo.ingested_at);
    },
    stateLabel() {
      const s = this.repo.lifecycle_state;
      if (s === 'publish' && this.serving) return this.translate('okf.shell.state.ingested', 'Ingested');
      const label = STATE_LABELS[s] || 'Draft';
      return this.translate('okf.shell.state.' + (s || 'draft'), label);
    },
    stateVariant() {
      const s = this.repo.lifecycle_state;
      if (s === 'publish' && this.serving) return 'success';
      if (s === 'publish') return 'success';
      if (s === 'retracted') return 'warning';
      if (s === 'review' || s === 'approve') return 'pending';
      return 'info';
    },
    lifecycleAction() {
      const s = this.repo.lifecycle_state;
      if (s === 'review') return 'approve';
      if (s === 'approve') return 'publish';
      if (s === 'publish' && this.serving) return 'retract';
      if (s === 'publish') return 'ingest';
      if (s === 'retracted') return 'ingest';
      return 'submit';
    },
    lifecycleLabel() {
      const a = this.lifecycleAction;
      return this.translate('okf.lifecycle.' + a, LIFECYCLE_LABELS[a]);
    },
    bundleName() {
      return (this.repo.bundle && this.repo.bundle.file_name) || '';
    },
    subTabs() {
      return [
        { value: 'editor', label: this.translate('okf.shell.tab.editor', 'Editor') },
        { value: 'wizard', label: this.translate('okf.shell.tab.wizard', 'Wizard') }
      ];
    },
    deleteActions() {
      return [
        { key: 'cancel', label: this.translate('common.cancel', 'Cancel'), variant: 'secondary' },
        { key: 'confirm', label: this.translate('okf.shell.delete.confirm', 'Delete'), variant: 'danger' }
      ];
    }
  },
  methods: {
    onSubTab(v) {
      this.$store.dispatch('okf/setEditorSubTab', v);
    },
    async onLifecycle() {
      const action = this.lifecycleAction;
      if (action === 'publish') {
        // Publish confirms through the Versions dialog ("Create new version")
        // so the steward sees the mint + supersede consequence in context.
        this.versionsOpen = true;
        return;
      }
      this.actionBusy = true;
      this.actionError = '';
      const res = await this.$store.dispatch('okf/lifecycleTransition', { repoId: this.repoId, action });
      this.actionBusy = false;
      if (!res.ok) this.actionError = res.message || 'Action failed';
      else this.$emit('refresh');
    },
    async onExport() {
      this.exportBusy = true;
      this.actionError = '';
      try {
        await okfRepoOps.exportRepoZip(this.repo);
      } catch (err) {
        this.actionError = err.message || 'Export failed';
      } finally {
        this.exportBusy = false;
      }
    },
    onChanged() {
      this.$emit('refresh');
    },
    async onDeleteAction(key) {
      if (key === 'cancel') {
        this.deleteOpen = false;
        return;
      }
      if (key !== 'confirm') return;
      this.actionBusy = true;
      this.deleteError = '';
      const res = await this.$store.dispatch('okf/deleteRepoAction', { repoId: this.repoId });
      this.actionBusy = false;
      this.deleteOpen = false;
      if (!res.ok) {
        this.actionError = res.message || 'Delete failed';
        return;
      }
      this.$emit('back'); // the repo is gone — return to the dashboard
    }
  }
};
</script>

<style scoped>
.okf-shell__header {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  flex-wrap: wrap;
}
.okf-shell__name {
  margin: 0;
  font-size: var(--text-lg);
  font-weight: 600;
  color: var(--fg);
}
.okf-shell__version {
  font-size: var(--text-sm);
  color: var(--muted);
}
.okf-shell__bundle code {
  background: var(--bg);
  border: 1px solid var(--border);
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  font-size: var(--text-xs);
}
.okf-shell__actions {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  margin-left: auto;
  flex-wrap: wrap;
}
.okf-shell__delete {
  --ds-btn-ghost-color: var(--danger);
}
.okf-shell__error {
  margin: var(--space-xs) 0 0;
  color: var(--danger);
  font-size: var(--text-sm);
}
</style>
