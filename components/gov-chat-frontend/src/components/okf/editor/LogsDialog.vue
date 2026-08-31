<!-- OkfLogsDialog.vue — Story #978 (David, 2026-08-31): the repository's
  ACTION / AUDIT LOG VIEWER. "Every state transition and every modification
  must be tracked and auditable" — rows come from the okf_audit_logs
  collection (linked to okf_repositories by repo_id) via
  GET /okf/repos/:repo_id/logs, newest first. Each row shows the user,
  date/time, action and a human-readable description of the change.
  Shared by the editor shell (single implementation). -->
<template>
  <DsDialog
    :visible="visible"
    :title="translate('okf.logs.title', 'Activity log')"
    size="lg"
    :actions="actions"
    @close="$emit('close')"
    @action="onAction"
  >
    <p v-if="repo" class="okf-logs__repo-line">
      <strong>{{ repo.name || repo.repo_id }}</strong>
      <span class="okf-logs__meta-inline">
        {{ translate('okf.logs.count', '{n} entries').replace('{n}', String(logs.length)) }}
      </span>
    </p>

    <DsTable :columns="columns" :rows="logs" :loading="loading">
      <template #cell-when="{ row }">{{ shortDateTime(row.ts) }}</template>
      <template #cell-user="{ row }">{{ row.actor_name || row.actor || '—' }}</template>
      <template #cell-action="{ row }"
        ><code>{{ row.action }}</code></template
      >
      <template #cell-description="{ row }">{{ row.description || '—' }}</template>
    </DsTable>

    <p v-if="!loading && logs.length === 0" class="okf-logs__empty">
      {{ translate('okf.logs.none', 'No activity recorded yet — repository actions appear here as they happen.') }}
    </p>
    <p v-if="error" class="okf-logs__error">{{ error }}</p>
  </DsDialog>
</template>

<script>
import translateMixin from '../../../mixins/translateMixin';
import DsDialog from '../../ds/Dialog.vue';
import DsTable from '../../ds/Table.vue';
import repoOkfService from '../../../services/repoOkfService';

export default {
  name: 'OkfLogsDialog',
  components: { DsDialog, DsTable },
  mixins: [translateMixin],
  props: {
    visible: { type: Boolean, default: false },
    repo: { type: Object, default: null }
  },
  emits: ['close'],
  data() {
    return {
      loading: false,
      error: '',
      logs: [],
      columns: [
        { key: 'when', label: this.translate('okf.logs.col.when', 'Date & time') },
        { key: 'user', label: this.translate('okf.logs.col.user', 'User') },
        { key: 'action', label: this.translate('okf.logs.col.action', 'Action') },
        { key: 'description', label: this.translate('okf.logs.col.description', 'Description') }
      ]
    };
  },
  computed: {
    actions() {
      return [
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
    onAction(key) {
      if (key === 'close') this.$emit('close');
    },
    async refresh() {
      this.loading = true;
      this.error = '';
      try {
        this.logs = await repoOkfService.getRepoLogs(this.repo.repo_id);
      } catch (err) {
        this.error = err.message || this.translate('okf.logs.loadFailed', 'Failed to load the activity log.');
      } finally {
        this.loading = false;
      }
    },
    shortDateTime(ts) {
      if (!ts) return '—';
      const d = new Date(ts);
      if (Number.isNaN(d.getTime())) return ts;
      const pad = (n) => String(n).padStart(2, '0');
      return (
        d.getFullYear() +
        '-' +
        pad(d.getMonth() + 1) +
        '-' +
        pad(d.getDate()) +
        ' ' +
        pad(d.getHours()) +
        ':' +
        pad(d.getMinutes()) +
        ':' +
        pad(d.getSeconds())
      );
    }
  }
};
</script>

<style scoped>
.okf-logs__repo-line {
  margin: 0 0 var(--space-sm);
  font-size: var(--text-sm);
  color: var(--fg);
}
.okf-logs__meta-inline {
  margin-left: var(--space-sm);
  color: var(--muted);
}
.okf-logs__empty {
  margin: var(--space-sm) 0 0;
  color: var(--muted);
  font-size: var(--text-sm);
}
.okf-logs__error {
  margin: var(--space-sm) 0 0;
  color: var(--danger);
  font-size: var(--text-sm);
}
</style>
