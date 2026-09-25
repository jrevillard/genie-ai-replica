<!-- OkfVersionsDialog.vue — Story #978 lifecycle (David, 2026-08-28): the
  VERSIONS PANEL. Versions were minted server-side since Story 2.9.7 but were
  invisible to the steward — nothing in the UI listed them, and the published
  bundle zip had no UI link. This dialog is shared by the dashboard cards AND
  the editor shell (equal features, one implementation):
    - header: current version + serving badge + bundle zip file name
    - version ledger table (vN, tag, trigger, curator, concepts, minted at)
    - "Create new version" = the publish transition (mint + zip supersede)
-->
<template>
  <DsDialog
    :visible="visible"
    :title="translate('okf.versions.title', 'Versions')"
    size="lg"
    :actions="actions"
    @close="$emit('close')"
    @action="onAction"
  >
    <p v-if="repo" class="okf-versions__repo-line">
      <strong>{{ repo.name || repo.repo_id }}</strong>
      <span class="okf-versions__meta-inline">
        v{{ repo.version || 0 }}
        <DsPill :variant="serving ? 'success' : 'info'">
          {{
            serving
              ? translate('okf.versions.serving', 'Ingested (serving)')
              : translate('okf.versions.notServing', 'Not serving')
          }}
        </DsPill>
      </span>
      <span v-if="bundleName" class="okf-versions__bundle" :title="bundleName">
        {{ translate('okf.versions.bundle', 'Bundle') }}: <code>{{ bundleName }}</code>
      </span>
    </p>

    <DsTable :columns="columns" :rows="versions" :loading="loading">
      <template #cell-version="{ row }">
        v{{ row.bundle_version }}
        <DsPill v-if="row.bundle_version === (repo && repo.version)" variant="accent">
          {{ translate('okf.versions.current', 'current') }}
        </DsPill>
      </template>
      <template #cell-trigger="{ row }">{{ row.trigger }}</template>
      <template #cell-minted="{ row }">{{ shortDate(row.minted_at) }}</template>
      <!-- WS4 (David, 2026-09-25): per-version bundle download link. The
        backend (version-service.linkBundleToVersion) records bundle_file_id
        against the version manifest on each publish; this cell renders a
        download icon linking to /api/files/{file_id} (doc-repo's auth-gated
        download endpoint). For legacy manifests minted before WS4, the
        file_id is null and we show a "missing" badge instead. -->
      <template #cell-bundle="{ row }">
        <a
          v-if="row.bundle_file_id"
          :href="bundleDownloadUrl(row.bundle_file_id)"
          class="okf-versions__bundle-link"
          :title="row.bundle_file_name || row.bundle_file_id"
          target="_blank"
          rel="noopener"
        >
          <DsPill variant="success">
            {{ translate('okf.versions.bundleDownload', 'Download zip') }}
          </DsPill>
        </a>
        <DsPill v-else variant="warn">
          {{ translate('okf.versions.bundleMissing', 'zip missing') }}
        </DsPill>
      </template>
      <!-- Per-version ingest outcome (completed / partial-failed / failed).
        Null when the version has not been ingested yet. -->
      <template #cell-ingest="{ row }">
        <DsPill v-if="row.ingest_status === 'completed'" variant="success">
          {{ translate('okf.versions.ingestCompleted', 'ingested') }}
        </DsPill>
        <DsPill v-else-if="row.ingest_status === 'partial-failed'" variant="warn">
          {{ translate('okf.versions.ingestPartialFailed', 'partial') }}
        </DsPill>
        <DsPill v-else-if="row.ingest_status === 'failed'" variant="danger">
          {{ translate('okf.versions.ingestFailed', 'failed') }}
        </DsPill>
        <span v-else class="okf-versions__not-ingested">—</span>
      </template>
    </DsTable>

    <p v-if="!loading && versions.length === 0" class="okf-versions__empty">
      {{ translate('okf.versions.none', 'No versions minted yet — publishing creates v1.') }}
    </p>
    <p v-if="error" class="okf-versions__error">{{ error }}</p>
    <p v-if="lastResult" class="okf-versions__result">
      {{
        translate('okf.versions.published', 'Version v{v} published — bundle {f} stored in the document repository.')
          .replace('{v}', String(lastResult.bundle_version || ''))
          .replace('{f}', String((lastResult.bundle && lastResult.bundle.file_name) || ''))
      }}
    </p>
  </DsDialog>
</template>

<script>
import { mapGetters } from 'vuex';
import translateMixin from '../../../mixins/translateMixin';
import DsDialog from '../../ds/Dialog.vue';
import DsTable from '../../ds/Table.vue';
import DsPill from '../../ds/Pill.vue';
import okfRepoOps from '../../../services/okfRepoOps';

export default {
  name: 'OkfVersionsDialog',
  components: { DsDialog, DsTable, DsPill },
  mixins: [translateMixin],
  props: {
    visible: { type: Boolean, default: false },
    repo: { type: Object, default: null }
  },
  emits: ['close', 'changed'],
  data() {
    return {
      loading: false,
      error: '',
      lastResult: null,
      columns: [
        { key: 'version', label: this.translate('okf.versions.col.version', 'Version') },
        { key: 'okf_tag', label: this.translate('okf.versions.col.tag', 'Tag') },
        { key: 'trigger', label: this.translate('okf.versions.col.trigger', 'Trigger') },
        { key: 'curator', label: this.translate('okf.versions.col.curator', 'Curator') },
        { key: 'concept_count', label: this.translate('okf.versions.col.concepts', 'Concepts') },
        { key: 'minted', label: this.translate('okf.versions.col.minted', 'Minted') },
        // WS4 (David, 2026-09-25): per-version bundle download link.
        { key: 'bundle', label: this.translate('okf.versions.col.bundle', 'Bundle') },
        // Per-version ingest outcome (completed / partial-failed / failed).
        { key: 'ingest', label: this.translate('okf.versions.col.ingest', 'Ingest') }
      ]
    };
  },
  computed: {
    ...mapGetters('okf', ['versionsByRepo']),
    versions() {
      return this.repo ? this.versionsByRepo(this.repo.repo_id) : [];
    },
    serving() {
      return !!(this.repo && this.repo.ingested_at);
    },
    bundleName() {
      return (this.repo && this.repo.bundle && this.repo.bundle.file_name) || '';
    },
    /** publish is legal from approve | publish | retracted (the machine),
     * but NEVER while serving — a serving repo is READ ONLY (retract first). */
    canPublish() {
      if (!this.repo || this.repo.ingested_at) return false;
      return ['approve', 'publish', 'retracted'].includes(this.repo.lifecycle_state);
    },
    actions() {
      return [
        {
          key: 'publish',
          label: this.translate('okf.versions.publish', 'Create new version'),
          variant: 'primary',
          disabled: !this.canPublish || this.loading
        },
        {
          key: 'close',
          label: this.translate('common.close', 'Close'),
          variant: 'secondary'
        }
      ];
    }
  },
  watch: {
    visible: {
      immediate: true,
      handler(open) {
        if (open && this.repo) this.refresh();
      }
    }
  },
  methods: {
    async refresh() {
      this.loading = true;
      this.error = '';
      const res = await this.$store.dispatch('okf/fetchVersions', this.repo.repo_id);
      this.loading = false;
      if (!res.ok) this.error = res.message || this.translate('okf.versions.loadFailed', 'Failed to load versions');
    },
    async onAction(key) {
      if (key === 'close') {
        this.$emit('close');
        return;
      }
      if (key === 'publish' && this.repo) {
        this.loading = true;
        this.error = '';
        this.lastResult = null;
        const res = await this.$store.dispatch('okf/lifecycleTransition', {
          repoId: this.repo.repo_id,
          action: 'publish'
        });
        this.loading = false;
        if (!res.ok) {
          this.error = okfRepoOps.friendlyLifecycleError(res.code, res.message);
          return;
        }
        this.lastResult = res.result;
        this.$emit('changed');
        this.refresh();
      }
    },
    shortDate(iso) {
      try {
        return new Date(iso).toLocaleString();
      } catch {
        return iso || '—';
      }
    },
    /** WS4: build the doc-repo download URL for a bundle file. The path is
     * auth-gated by the existing /api/files/:fileId/download endpoint; the
     * browser's session cookie (or bearer) carries the auth header. */
    bundleDownloadUrl(fileId) {
      // The frontend proxies API calls to /api/* via the Vue/Vite dev proxy
      // in dev and via Kong in prod — both relative paths work. We embed the
      // file id directly in the URL (no extra encoding needed — IDs are safe).
      return `/api/files/${encodeURIComponent(fileId)}/download`;
    }
  }
};
</script>

<style scoped>
.okf-versions__repo-line {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-sm);
  margin: 0 0 var(--space-md);
  align-items: center;
}
.okf-versions__meta-inline {
  display: inline-flex;
  gap: var(--space-xs);
  align-items: center;
}
.okf-versions__bundle {
  font-size: var(--text-sm);
  color: var(--muted);
}
.okf-versions__bundle code {
  background: var(--bg);
  padding: 2px 6px;
  border-radius: var(--radius-sm);
}
.okf-versions__bundle-link {
  text-decoration: none;
}
.okf-versions__not-ingested {
  color: var(--muted);
}
.okf-versions__empty,
.okf-versions__error,
.okf-versions__result {
  margin: var(--space-sm) 0 0;
  font-size: var(--text-sm);
}
.okf-versions__error {
  color: var(--danger);
}
.okf-versions__result {
  color: var(--success);
}
</style>
