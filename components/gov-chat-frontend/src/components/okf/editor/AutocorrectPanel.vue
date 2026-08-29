<!--
  OkfAutocorrectPanel.vue — Story #978 autocorrect modal (frontmatter-only).

  On open runs the dry-run and lists every planned change + warning. Apply
  sends dry_run=false (server applies atomically) and emits 'applied' so the
  parent refreshes the concept list.
-->
<template>
  <DsDialog
    :visible="visible"
    :title="translate('okf.editor.autocorrect.title', 'Autocorrect (frontmatter only)')"
    size="lg"
    :actions="actions"
    @close="$emit('close')"
    @action="onAction"
  >
    <p class="okf-ac__intro">
      {{
        translate(
          'okf.editor.autocorrect.body',
          'Planned frontmatter fixes across every concept. Bodies are never modified.'
        )
      }}
    </p>

    <p v-if="scanning" class="okf-ac__scanning">
      <DsSpinner size="sm" /> {{ translate('okf.editor.autocorrect.scanning', 'Scanning…') }}
    </p>

    <template v-else>
      <p v-if="changeCount === 0 && warnings.length === 0" class="okf-ac__clean">
        {{ translate('okf.editor.autocorrect.clean', 'Nothing to fix — all frontmatter already conforms.') }}
      </p>

      <DsTable v-else-if="changes.length" :columns="changeColumns" :rows="changes" class="okf-ac__table">
        <template #cell-concept_id="{ row }">
          <code>{{ row.concept_id }}</code>
        </template>
        <template #cell-before="{ row }">
          <code class="okf-ac__code">{{ row.before }}</code>
        </template>
        <template #cell-after="{ row }">
          <code class="okf-ac__code">{{ row.after }}</code>
        </template>
      </DsTable>

      <ul v-if="warnings.length" class="okf-ac__warnings">
        <li v-for="(w, i) in warnings" :key="i">
          <code>{{ w.concept_id }}</code> — {{ w.message }}
        </li>
      </ul>
    </template>

    <p v-if="error" class="okf-ac__error">{{ error }}</p>
  </DsDialog>
</template>

<script>
import translateMixin from '../../../mixins/translateMixin';
import DsDialog from '../../ds/Dialog.vue';
import DsSpinner from '../../ds/Spinner.vue';
import DsTable from '../../ds/Table.vue';

export default {
  name: 'OkfAutocorrectPanel',
  components: { DsDialog, DsSpinner, DsTable },
  mixins: [translateMixin],
  props: {
    visible: { type: Boolean, default: false },
    repoId: { type: String, default: null }
  },
  emits: ['close', 'applied'],
  data() {
    return {
      scanning: false,
      applying: false,
      changes: [],
      warnings: [],
      error: ''
    };
  },
  computed: {
    changeCount() {
      return this.changes.length;
    },
    changeColumns() {
      return [
        { key: 'concept_id', label: this.translate('okf.editor.autocorrect.col.concept', 'Concept') },
        { key: 'before', label: this.translate('okf.editor.autocorrect.col.before', 'Before') },
        { key: 'after', label: this.translate('okf.editor.autocorrect.col.after', 'After') }
      ];
    },
    actions() {
      return [
        {
          key: 'cancel',
          label: this.translate('common.cancel', 'Cancel'),
          variant: 'secondary',
          disabled: this.applying
        },
        {
          key: 'apply',
          label: this.translate('okf.editor.autocorrect.apply', 'Apply fixes'),
          variant: 'primary',
          disabled: this.applying || this.scanning || this.changeCount === 0
        }
      ];
    }
  },
  watch: {
    visible(v) {
      if (v) this.runDryRun();
    }
  },
  methods: {
    async runDryRun() {
      this.scanning = true;
      this.error = '';
      this.changes = [];
      this.warnings = [];
      const result = await this.$store.dispatch('okf/autocorrectRepo', { repoId: this.repoId, dryRun: true });
      this.scanning = false;
      if (!result.ok) {
        this.error = result.message || this.translate('okf.editor.autocorrect.failed', 'Scan failed.');
        return;
      }
      this.changes = Array.isArray(result.changes) ? result.changes : [];
      this.warnings = Array.isArray(result.warnings) ? result.warnings : [];
    },
    async onAction(key) {
      if (key === 'cancel') {
        this.$emit('close');
        return;
      }
      if (key !== 'apply' || this.applying || this.changeCount === 0) return;
      this.applying = true;
      this.error = '';
      const result = await this.$store.dispatch('okf/autocorrectRepo', { repoId: this.repoId, dryRun: false });
      this.applying = false;
      if (!result.ok) {
        this.error = result.message || this.translate('okf.editor.autocorrect.failed', 'Apply failed.');
        return;
      }
      this.$emit('applied', result);
      this.$emit('close');
    }
  }
};
</script>

<style scoped>
.okf-ac__intro {
  margin: 0 0 var(--space-md);
  font-size: var(--text-sm);
  color: var(--muted);
}
.okf-ac__scanning,
.okf-ac__clean {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  color: var(--muted);
  padding: var(--space-md) 0;
  margin: 0;
}
.okf-ac__table {
  margin-bottom: var(--space-md);
}
.okf-ac__code {
  font-size: var(--text-xs);
}
.okf-ac__warnings {
  margin: 0;
  padding-left: var(--space-lg);
  color: var(--warning);
  font-size: var(--text-sm);
}
.okf-ac__error {
  margin: var(--space-md) 0 0;
  color: var(--danger);
  font-size: var(--text-sm);
}
</style>
