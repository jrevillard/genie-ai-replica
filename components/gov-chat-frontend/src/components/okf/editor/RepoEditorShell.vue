<!-- OkfRepoEditorShell header (David, 2026-08-30): while SERVING the repo is
  READ ONLY — READ ONLY pill, the serving graph's NAME chip
  (ingested_graph_name, `OKF_<name-slug>_v<N>`), and all concept/metadata
  mutations disabled until Retract. Otherwise the lifecycle header as before:
  back-to-studio (ALWAYS visible — navigation audit), repo name, state pill,
  version, bundle zip chip, contextual actions, Versions dialog one click
  away. Sub-tabs: Wizard | Editor (Editor default). -->
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
      <DsPill v-if="readOnly" variant="warning">{{ translate('okf.shell.readonly', 'READ ONLY') }}</DsPill>
      <span v-if="serving && graphName" class="okf-shell__graph" :title="graphName">
        <code>{{ graphName }}</code>
      </span>
      <span v-if="bundleName" class="okf-shell__bundle" :title="bundleName">
        <code>{{ bundleName }}</code>
      </span>
      <span v-if="sourceDoc && sourceDoc.file_name" class="okf-shell__source" :title="sourceTooltip">
        <DsPill variant="info">Source document</DsPill>
        <code>{{ sourceDoc.file_name }}</code>
      </span>
      <div v-if="sourceDoc && sourceDoc.file_name" class="expanded-source">
        <div v-if="sourceDoc.size_bytes" class="expanded-source__row">
          <span class="expanded-source__label">Size</span>
          <span>{{ fmtBytes(sourceDoc.size_bytes) }}</span>
        </div>
        <div v-if="sourceDoc.file_type" class="expanded-source__row">
          <span class="expanded-source__label">Type</span>
          <span>{{ sourceDoc.file_type }}</span>
        </div>
        <div v-if="sourceDoc.url" class="expanded-source__row">
          <span class="expanded-source__label">Crawl seed</span>
          <span>
            <a :href="sourceDoc.url" target="_blank" rel="noopener">{{ sourceDoc.url }}</a>
          </span>
        </div>
      </div>
      <div class="okf-shell__actions">
        <DsButton variant="primary" small :disabled="actionBusy" @click="onLifecycle">
          {{ lifecycleLabel }}
        </DsButton>
        <DsButton variant="secondary" small :disabled="actionBusy" @click="versionsOpen = true">
          {{ translate('okf.shell.versions', 'Versions') }}
        </DsButton>
        <DsButton variant="secondary" small :disabled="logsBusy" @click="logsOpen = true">
          {{ translate('okf.shell.logs', 'Logs') }}
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
        <OkfRepoEditor
          v-show="subTab === 'editor'"
          :repo-id="repoId"
          :source-file-id="sourceFileId"
          :read-only="readOnly"
        />
      </template>
    </DsTabs>

    <OkfVersionsDialog
      :visible="versionsOpen"
      :repo="repo && repo.repo_id ? repo : null"
      @close="versionsOpen = false"
      @changed="onChanged"
    />

    <OkfLogsDialog :visible="logsOpen" :repo="repo && repo.repo_id ? repo : null" @close="logsOpen = false" />

    <DsDialog
      :visible="publishOpen"
      :title="translate('okf.shell.publish.title', 'Publish')"
      size="sm"
      :actions="publishActions"
      @close="publishOpen = false"
      @action="onPublishAction"
    >
      <p>{{ publishBodyText }}</p>
      <p v-if="publishError" class="okf-shell__error">{{ publishError }}</p>
      <div v-if="piiBlocked" class="okf-shell__pii">
        <p class="okf-shell__pii-note">
          {{
            translate(
              'okf.shell.pii.note',
              'The flagged entities are part of the published content. If you have reviewed them (e.g. official contact details), acknowledge and continue.'
            )
          }}
        </p>
        <DsButton variant="secondary" small :disabled="actionBusy" @click="onAcknowledgeAndPublish">
          {{ translate('okf.shell.pii.ack', 'Acknowledge flagged entities & publish') }}
        </DsButton>
      </div>
    </DsDialog>

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
import OkfLogsDialog from './LogsDialog.vue';
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
  components: {
    DsButton,
    DsDialog,
    DsPill,
    DsStatusTag,
    DsTabs,
    OkfStudioWizard,
    OkfRepoEditor,
    OkfVersionsDialog,
    OkfLogsDialog
  },
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
      logsOpen: false,
      logsBusy: false,
      publishOpen: false,
      publishError: '',
      piiBlocked: false,
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
    readOnly() {
      return this.serving;
    },
    graphName() {
      return this.repo.ingested_graph_name || '';
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
    sourceDoc() {
      return this.repo.source_document || null;
    },
    sourceTooltip() {
      const d = this.sourceDoc || {};
      const parts = [];
      if (d.size_bytes) parts.push(this.fmtBytes(d.size_bytes));
      if (d.file_type) parts.push(d.file_type);
      if (d.uploaded_date) parts.push('uploaded ' + String(d.uploaded_date).slice(0, 10));
      if (d.crawl_job_id) parts.push('crawl job ' + d.crawl_job_id);
      return parts.join(' · ');
    },
    publishBodyText() {
      const next = (this.repo.version || 0) + 1;
      const file = (this.repo.name || this.repoId) + '-v' + next + '.zip';
      return this.translate(
        'okf.shell.publish.body',
        'Publishing mints v{n} and stores bundle "{file}" in the document repository, superseding any previous zip. The new version is not serving until you Ingest it.'
      )
        .replace('{n}', String(next))
        .replace('{file}', file);
    },
    publishActions() {
      return [
        { key: 'cancel', label: this.translate('common.cancel', 'Cancel'), variant: 'secondary' },
        { key: 'confirm', label: this.translate('okf.shell.publish.confirm', 'Publish'), variant: 'primary' }
      ];
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
    fmtBytes(n) {
      if (!Number.isFinite(n) || n <= 0) return '';
      const units = ['B', 'KB', 'MB', 'GB', 'TB'];
      let i = 0;
      let v = n;
      while (v >= 1024 && i < units.length - 1) {
        v /= 1024;
        i += 1;
      }
      return v.toFixed(v >= 10 || i === 0 ? 0 : 1) + ' ' + units[i];
    },
    onSubTab(v) {
      this.$store.dispatch('okf/setEditorSubTab', v);
    },
    async onLifecycle() {
      const action = this.lifecycleAction;
      if (action === 'publish') {
        this.publishError = '';
        this.piiBlocked = false;
        this.publishOpen = true; // direct confirm — the Versions dialog is for the ledger
        return;
      }
      this.actionBusy = true;
      this.actionError = '';
      const res = await this.$store.dispatch('okf/lifecycleTransition', { repoId: this.repoId, action });
      this.actionBusy = false;
      if (!res.ok) this.actionError = okfRepoOps.friendlyLifecycleError(res.code, res.message);
      else this.$emit('refresh');
    },
    async onPublishAction(key) {
      if (key === 'cancel') {
        this.publishOpen = false;
        return;
      }
      if (key !== 'confirm') return;
      this.actionBusy = true;
      this.publishError = '';
      this.piiBlocked = false;
      const res = await this.$store.dispatch('okf/lifecycleTransition', { repoId: this.repoId, action: 'publish' });
      this.actionBusy = false;
      if (!res.ok) {
        this.publishError = okfRepoOps.friendlyLifecycleError(res.code, res.message);
        if (res.code === 'PII_GATE_BLOCKED') this.piiBlocked = true;
        return; // keep the dialog open — the steward decides on the ack
      }
      this.publishOpen = false;
      this.$emit('refresh');
    },
    async onAcknowledgeAndPublish() {
      // The explicit, audited steward decision: reviewed flagged entities.
      this.actionBusy = true;
      try {
        await okfRepoOps.acknowledgePii(this.repoId, true);
      } catch (err) {
        this.actionBusy = false;
        this.publishError = err.message || 'Acknowledgement failed';
        return;
      }
      this.actionBusy = false;
      await this.onPublishAction('confirm');
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
.okf-shell__bundle code,
.okf-shell__graph code {
  background: var(--bg);
  border: 1px solid var(--border);
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  font-size: var(--text-xs);
}
.okf-shell__source {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
}
.okf-shell__source code {
  background: var(--bg);
  border: 1px solid var(--border);
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  font-size: var(--text-xs);
}
.expanded-source {
  display: flex;
  gap: var(--space-md);
  flex-basis: 100%;
  font-size: var(--text-xs);
  color: var(--muted);
}
.expanded-source__row {
  display: inline-flex;
  gap: var(--space-xs);
}
.expanded-source__label {
  color: var(--muted-soft, var(--muted));
}
.expanded-source__row a {
  color: var(--accent);
  text-decoration: none;
  max-width: 420px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: inline-block;
  vertical-align: bottom;
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
.okf-shell__pii {
  margin-top: var(--space-sm);
}
.okf-shell__pii-note {
  margin: 0 0 var(--space-xs);
  font-size: var(--text-sm);
  color: var(--muted);
}
.okf-shell__error {
  margin: var(--space-xs) 0 0;
  color: var(--danger);
  font-size: var(--text-sm);
}
</style>
