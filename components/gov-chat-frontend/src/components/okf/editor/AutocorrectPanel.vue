<!--
  OkfAutocorrectPanel.vue — Story #978 autocorrect modal (frontmatter-only).

  D-L (David, 2026-09-07): blank/missing frontmatter is NOT a dead end —
  the proposal engine proposes the COMPLETE correct frontmatter for the
  concept, the before column renders "(blank)", and every FIELD is
  individually applicable (per-field apply via the {frontmatter} PATCH;
  null values ride the RFC 7386 merge-delete when the contract is live).
  Batch apply still exists. Data adapts to both the legacy flat rows
  {concept_id, before, after} and the propose-endpoint shape
  {concept_id, before, after, changes:[{field, before, after}]}.
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
      <p v-if="fieldRows.length === 0 && warnings.length === 0" class="okf-ac__clean">
        {{ translate('okf.editor.autocorrect.clean', 'Nothing to fix — all frontmatter already conforms.') }}
      </p>

      <div v-for="group in groupedRows" :key="group.concept_id" class="okf-ac__group">
        <header class="okf-ac__group-head">
          <code>{{ group.concept_id }}</code>
          <DsPill v-if="group.blank" variant="warning">{{
            translate('okf.editor.autocorrect.blankBadge', 'no frontmatter — full proposal')
          }}</DsPill>
        </header>
        <table class="okf-ac__fields">
          <thead>
            <tr>
              <th>{{ translate('okf.editor.autocorrect.col.field', 'Field') }}</th>
              <th>{{ translate('okf.editor.autocorrect.col.before', 'Before') }}</th>
              <th>{{ translate('okf.editor.autocorrect.col.after', 'After') }}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in group.rows" :key="row.field">
              <td>
                <code>{{ row.field }}</code>
              </td>
              <td>
                <code class="okf-ac__code">{{ row.beforeDisplay }}</code>
              </td>
              <td>
                <code class="okf-ac__code">{{ row.afterDisplay }}</code>
              </td>
              <td class="okf-ac__field-actions">
                <DsButton variant="secondary" small :disabled="applyingField === row.key" @click="applyField(row)">
                  {{ translate('okf.editor.autocorrect.applyField', 'Apply') }}
                </DsButton>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

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
import DsButton from '../../ds/Button.vue';
import DsPill from '../../ds/Pill.vue';
import conceptService from '../../../services/conceptService';

export default {
  name: 'OkfAutocorrectPanel',
  components: { DsDialog, DsSpinner, DsButton, DsPill },
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
      applyingField: '',
      changes: [],
      warnings: [],
      error: ''
    };
  },
  computed: {
    changeCount() {
      return this.changes.length;
    },
    // D-L: normalize every change row into per-FIELD rows. Accepts the
    // legacy flat shape {concept_id, before, after} and the propose shape
    // {concept_id, before, after, changes:[{field, before, after}]}.
    fieldRows() {
      const rows = [];
      for (const c of this.changes) {
        const cid = c.concept_id;
        if (Array.isArray(c.changes) && c.changes.length) {
          for (const f of c.changes) {
            rows.push({
              key: cid + '::' + f.field,
              concept_id: cid,
              field: f.field,
              before: f.before,
              after: f.after,
              blank: c.blank || this.isBlank(c.before)
            });
          }
        } else {
          rows.push({
            key: cid + '::frontmatter',
            concept_id: cid,
            field: 'frontmatter',
            before: c.before,
            after: c.after,
            blank: this.isBlank(c.before)
          });
        }
      }
      return rows;
    },
    groupedRows() {
      const groups = [];
      const byId = new Map();
      for (const row of this.fieldRows) {
        if (!byId.has(row.concept_id)) {
          const g = { concept_id: row.concept_id, blank: !!row.blank, rows: [] };
          byId.set(row.concept_id, g);
          groups.push(g);
        }
        const g = byId.get(row.concept_id);
        g.blank = g.blank || !!row.blank;
        g.rows.push({
          ...row,
          beforeDisplay: row.blank
            ? this.translate('okf.editor.autocorrect.blankBefore', '(blank)')
            : this.fmt(row.before),
          afterDisplay: this.fmt(row.after)
        });
      }
      return groups;
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
    isBlank(v) {
      return v === undefined || v === null || v === '' || (typeof v === 'object' && Object.keys(v || {}).length === 0);
    },
    fmt(v) {
      if (v === undefined || v === null || v === '') return '—';
      if (typeof v === 'object') return JSON.stringify(v);
      return String(v);
    },
    async runDryRun() {
      this.scanning = true;
      this.error = '';
      this.changes = [];
      this.warnings = [];
      // MECHANICAL, ALWAYS (David, 2026-09-12): this panel is the frontmatter
      // conformance fixer — mode is pinned to heuristics. The omitted-mode
      // fallback routed by the repo's PERSISTED classification, so on an
      // llm-classified crawl repo the scan fired one LLM proposal per concept
      // (997 of them on gov-uk) and the gateway timed out.
      const result = await this.$store.dispatch('okf/autocorrectRepo', {
        repoId: this.repoId,
        dryRun: true,
        mode: 'heuristics'
      });
      this.scanning = false;
      if (!result.ok) {
        this.error = result.message || this.translate('okf.editor.autocorrect.failed', 'Scan failed.');
        return;
      }
      this.changes = Array.isArray(result.changes) ? result.changes : [];
      this.warnings = Array.isArray(result.warnings) ? result.warnings : [];
    },
    // D-L: apply ONE field for ONE concept through the {frontmatter} PATCH.
    // Null `after` rides the RFC 7386 merge-delete when the contract is
    // live; the server refuses it safely before that. Re-runs the dry-run
    // so the remaining proposal stays true.
    async applyField(row) {
      if (this.applyingField || !this.repoId) return;
      this.applyingField = row.key;
      this.error = '';
      try {
        await conceptService.update(this.repoId, row.concept_id, { [row.field]: row.after });
        await this.runDryRun();
        this.$emit('applied', { ok: true, concept_id: row.concept_id });
      } catch (err) {
        const details = err && err.data && Array.isArray(err.data.details) ? err.data.details : null;
        this.error = details
          ? details.join(' · ')
          : err && err.message
            ? err.message
            : this.translate('okf.editor.autocorrect.failed', 'Apply failed.');
      } finally {
        this.applyingField = '';
      }
    },
    async onAction(key) {
      if (key === 'cancel') {
        this.$emit('close');
        return;
      }
      if (key !== 'apply' || this.applying || this.changeCount === 0) return;
      this.applying = true;
      this.error = '';
      const result = await this.$store.dispatch('okf/autocorrectRepo', {
        repoId: this.repoId,
        dryRun: false,
        mode: 'heuristics'
      });
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
.okf-ac__group {
  margin-bottom: var(--space-md);
}
.okf-ac__group-head {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  margin-bottom: var(--space-xs);
}
.okf-ac__fields {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-sm);
}
.okf-ac__fields th {
  text-align: left;
  color: var(--muted);
  font-weight: 500;
  padding: var(--space-xs);
  border-bottom: 1px solid var(--border);
}
.okf-ac__fields td {
  padding: var(--space-xs);
  border-bottom: 1px solid var(--border-light);
  vertical-align: top;
}
.okf-ac__field-actions {
  text-align: right;
  white-space: nowrap;
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
