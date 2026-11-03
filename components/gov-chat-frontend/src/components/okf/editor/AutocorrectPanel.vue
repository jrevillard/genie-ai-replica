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
  <!-- A9 (audit 2026-09-29): the panel renders INLINE or as a modal. The
       wizard's step 8 used to mount the MODAL with :visible="!!repoId" and
       NO @close listener — Cancel/✕ emitted into the void and the modal
       overlay walled off the entire wizard ("frozen", field report). In
       inline mode the content is a plain card: nothing to cancel, the step
       is the surface. The editor keeps the modal (it passes @close). -->
  <component
    :is="inline ? 'div' : 'DsDialog'"
    v-bind="inline ? { class: 'okf-ac__inline' } : dialogBindings"
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

      <!-- The sheet is a WINDOW, not the whole corpus: rendering thousands
           of groups synchronously froze the main thread (browser "Page
           Unresponsive" on step entry — same class as the markdown-editor
           render freeze fixed 2026-09-13). Apply fixes iterates EVERY group
           regardless of what is displayed. -->
      <DsInput
        v-if="groupedRows.length > renderLimit"
        v-model="groupFilter"
        :placeholder="translate('okf.editor.autocorrect.sheetFilter', 'Filter by concept id')"
        class="okf-ac__filter"
      />
      <div v-for="group in visibleGroups" :key="group.concept_id" class="okf-ac__group">
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

      <p v-if="matchedGroups.length > visibleGroups.length" class="okf-ac__sheet-note">
        {{
          translate('okf.editor.autocorrect.sheetShowing', 'Showing {shown} of {total} concepts.')
            .replace('{shown}', String(visibleGroups.length))
            .replace('{total}', String(matchedGroups.length))
        }}
        {{ translate('okf.editor.autocorrect.sheetApplyCoversAll', 'Apply fixes covers all of them.') }}
        <DsButton variant="secondary" small @click="renderLimit += 100">
          {{ translate('okf.editor.autocorrect.sheetShowMore', 'Show more') }}
        </DsButton>
      </p>

      <ul v-if="warnings.length" class="okf-ac__warnings">
        <li v-for="(w, i) in warnings" :key="i">
          <code>{{ w.concept_id }}</code> — {{ w.rule ? w.rule + ': ' : '' }}{{ w.message }}
          <DsInfoTip
            v-if="w.rule && w.rule.startsWith('STALE_AFTER')"
            :text="
              translate(
                'okf.editor.autocorrect.staleAfterTip',
                'stale_after is the freshness date and must be written YYYY-MM-DD. Values in another date format are normalized on apply; values that are not dates at all are cleared. Nothing else in the page changes.'
              )
            "
          />
        </li>
      </ul>
    </template>

    <p v-if="error" class="okf-ac__error">{{ error }}</p>

    <!-- Apply outcome: the sheet must agree with the corpus. Live-caught
         2026-11-02 (Quran Core): the run silently skipped 785 rows, the
         sheet kept listing them and Apply looked like a no-op — the backend
         now reports failures and the panel names them here. -->
    <p v-if="applySummary" class="okf-ac__summary" :class="{ 'okf-ac__summary--partial': applySummary.failed > 0 }">
      {{ summaryText }}
    </p>
    <ul v-if="applySummary && applySummary.failures.length" class="okf-ac__warnings">
      <li v-for="f in applySummary.failures" :key="f.concept_id">
        <code>{{ f.concept_id }}</code> — {{ f.error }}
      </li>
      <li v-if="applySummary.failuresTotal > applySummary.failures.length">
        …{{
          translate('okf.editor.autocorrect.failuresMore', 'and {n} more').replace(
            '{n}',
            String(applySummary.failuresTotal - applySummary.failures.length)
          )
        }}
      </li>
    </ul>

    <!-- Live apply progress, visible in BOTH modes: the bulk apply used to
         be ONE long request (minutes on a 6k-concept repo — the modal froze
         around it, David 2026-11-02: "blocking wait dialog ... SHIT UX").
         The apply is now one {frontmatter} PATCH per concept with live
         progress and a Stop; Cancel/✕ stay usable throughout. -->
    <div v-if="applying && applyProgress" class="okf-ac__applying">
      <DsSpinner size="sm" />
      <span class="okf-ac__progress-label">{{ progressText }}</span>
      <DsProgress class="okf-ac__progress" :value="applyProgress.done" :max="applyProgress.total" />
      <DsButton variant="secondary" small @click="requestStop()">
        {{ translate('okf.editor.autocorrect.stop', 'Stop') }}
      </DsButton>
    </div>

    <!-- Inline mode carries its own actions (the modal's live in the
         DsDialog footer): Apply only — there is nothing to cancel. -->
    <div v-if="inline && !applying" class="okf-ac__inline-actions">
      <DsButton variant="primary" :disabled="scanning || changeCount === 0" @click="onAction('apply')">
        {{ translate('okf.editor.autocorrect.apply', 'Apply fixes') }}
      </DsButton>
    </div>
  </component>
</template>

<script>
import translateMixin from '../../../mixins/translateMixin';
import DsDialog from '../../ds/Dialog.vue';
import DsSpinner from '../../ds/Spinner.vue';
import DsButton from '../../ds/Button.vue';
import DsPill from '../../ds/Pill.vue';
import DsProgress from '../../ds/Progress.vue';
import DsInput from '../../ds/Input.vue';
import DsInfoTip from '../../ds/InfoTip.vue';
import conceptService from '../../../services/conceptService';

export default {
  name: 'OkfAutocorrectPanel',
  components: { DsDialog, DsSpinner, DsButton, DsPill, DsProgress, DsInput, DsInfoTip },
  mixins: [translateMixin],
  props: {
    visible: { type: Boolean, default: false },
    repoId: { type: String, default: null },
    // A9: render as an embedded card (wizard step 8) instead of a modal
    // dialog. The editor host keeps the modal (default false).
    inline: { type: Boolean, default: false }
  },
  emits: ['close', 'applied'],
  data() {
    return {
      scanning: false,
      applying: false,
      applyingField: '',
      changes: [],
      warnings: [],
      error: '',
      applySummary: null,
      applyProgress: null,
      stopping: false,
      // Sheet window (the render cap): how many concept groups are mounted.
      renderLimit: 25,
      groupFilter: ''
    };
  },
  computed: {
    // A9: the DsDialog bindings apply ONLY in modal mode (inline passes a
    // plain class — leaking visible/actions onto a div would render them
    // as DOM attributes).
    dialogBindings() {
      return {
        visible: this.visible,
        title: this.translate('okf.editor.autocorrect.title', 'Autocorrect (frontmatter only)'),
        size: 'lg',
        actions: this.actions
      };
    },
    changeCount() {
      return this.changes.length;
    },
    // The filtered corpus groups (the window's SOURCE — the apply iterates
    // groupedRows, i.e. EVERY group, whatever the sheet displays).
    matchedGroups() {
      const f = String(this.groupFilter || '')
        .trim()
        .toLowerCase();
      if (!f) return this.groupedRows;
      return this.groupedRows.filter((g) => g.concept_id.toLowerCase().includes(f));
    },
    // What the sheet MOUNTS — capped so a 6k-group corpus cannot freeze the
    // main thread (browser "Page Unresponsive" on step entry).
    visibleGroups() {
      return this.matchedGroups.slice(0, this.renderLimit);
    },
    progressText() {
      return this.translate('okf.editor.autocorrect.applyingProgress', 'Applying {done} / {total}…')
        .replace('{done}', String(this.applyProgress ? this.applyProgress.done : 0))
        .replace('{total}', String(this.applyProgress ? this.applyProgress.total : 0));
    },
    summaryText() {
      const s = this.applySummary;
      if (!s) return '';
      if (s.stopped) {
        return this.translate(
          'okf.editor.autocorrect.stopped',
          'Stopped — {n} concept(s) applied before stopping.'
        ).replace('{n}', String(s.applied));
      }
      if (s.failed > 0) {
        return this.translate(
          'okf.editor.autocorrect.applyFailed',
          'Applied {n} fix(es) — {f} concept(s) FAILED. Click "Apply fixes" to retry.'
        )
          .replace('{n}', String(s.applied))
          .replace('{f}', String(s.failed));
      }
      return this.translate('okf.editor.autocorrect.applySummary', 'Applied {n} fix(es).').replace(
        '{n}',
        String(s.applied)
      );
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
          // Never a dead button: while applying, Cancel means STOP the loop
          // (the dialog stays open for the summary). Disabling it during the
          // run is what turned the modal into a blocking wait dialog.
          disabled: this.scanning
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
    // immediate: the wizard shell remounts each step (StudioWizard :key) with
    // visible ALREADY true — a non-immediate watcher never fired there, the
    // panel showed a false "Nothing to fix" and Apply stayed disabled
    // (audit A1, 2026-09-29). The editor host mounts with visible=false, so
    // the immediate fire is a no-op there.
    visible: {
      immediate: true,
      handler(v) {
        if (v) this.runDryRun();
        // Backdrop / ✕ during a run must mean the same thing as the Stop
        // button (review 84598: closing the modal otherwise leaves the
        // 4-lane PATCH loop running hidden with no Stop reachable).
        else if (this.applying) this.stopping = true;
      }
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
      this.applySummary = null;
      this.changes = [];
      this.warnings = [];
      // A new scan is a new sheet: reset the window so the cap holds for
      // whatever corpus shape comes back.
      this.renderLimit = 25;
      this.groupFilter = '';
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
      // #1037: autocorrectRepo returns warnings NESTED ({concept_id,
      // warnings:[{rule, severity, message}]}) but the template renders the
      // FLAT {concept_id, rule, message} shape — the mismatch rendered bare
      // "id —" rows with no message. Flatten (tolerating already-flat rows).
      const nested = Array.isArray(result.warnings) ? result.warnings : [];
      const flat = [];
      for (const w of nested) {
        if (w && Array.isArray(w.warnings)) {
          for (const inner of w.warnings) flat.push({ concept_id: w.concept_id, ...inner });
        } else if (w) {
          flat.push(w);
        }
      }
      this.warnings = flat;
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
    requestStop() {
      // Cooperative stop: in-flight PATCHes finish, no NEW concept starts.
      // The loop drains, the summary reports where it got to.
      this.stopping = true;
    },
    async onAction(key) {
      if (key === 'cancel') {
        if (this.applying) {
          this.stopping = true;
          return;
        }
        this.$emit('close');
        return;
      }
      if (key !== 'apply' || this.applying || this.changeCount === 0) return;
      // CHUNKED APPLY — async with live progress (David, 2026-11-02: "if it
      // needs to be async then make it async and display the progress"). The
      // old bulk POST held ONE request open for the whole run — minutes on a
      // 6k-concept repo — freezing the modal around it. The apply is now one
      // {frontmatter} PATCH per concept through the SAME endpoint the
      // per-field Apply uses, 4 lanes wide, progress bar live, Stop always
      // available. Failures are collected per concept; nothing aborts the
      // rest. The apply iterates groupedRows — EVERY group — whatever the
      // sheet window displays.
      this.applying = true;
      this.stopping = false;
      this.error = '';
      this.applySummary = null;
      const groups = this.groupedRows;
      const total = groups.length;
      this.applyProgress = { done: 0, total };
      const failures = [];
      let applied = 0;
      let next = 0;
      const worker = async () => {
        while (next < groups.length && !this.stopping) {
          const group = groups[next++];
          try {
            const patch = {};
            for (const row of group.rows) patch[row.field] = row.after;
            await conceptService.update(this.repoId, group.concept_id, patch);
            applied += 1;
          } catch (err) {
            failures.push({
              concept_id: group.concept_id,
              error: err && err.message ? err.message : this.translate('okf.editor.autocorrect.failed', 'Apply failed.')
            });
          }
          this.applyProgress = { done: this.applyProgress.done + 1, total };
        }
      };
      await Promise.all(Array.from({ length: Math.min(4, groups.length) }, worker));
      const stopped = this.stopping;
      this.applying = false;
      this.applyProgress = null;
      this.$emit('applied', { ok: true, applied, failed: failures.length, stopped });
      // The sheet must agree with the corpus after an apply: re-scan so the
      // rows reflect what is STILL to fix. Inline (wizard) stays open with
      // the fresh scan; the modal closes only on a clean complete run — a
      // stopped or failed run stays open so the steward sees why. The
      // summary is set AFTER the scan — runDryRun clears it (a new scan is a
      // new story) — so the outcome report survives the refresh.
      const summary = {
        applied,
        failed: failures.length,
        failures: failures.slice(0, 20),
        failuresTotal: failures.length,
        stopped
      };
      // ONE repo-wide PII rescan after the run (review 84588): every
      // per-concept PATCH re-scans server-side against live ingest traffic,
      // so the verdicts written mid-run reflect partially-applied state.
      // Arming the async repo-wide rescan makes the PII verdicts
      // authoritative for the POST-apply frontmatter — fire-and-forget;
      // the dashboard and editor surfaces poll the scan.
      if (applied > 0) {
        this.$store.dispatch('okf/startRepoPiiScan', { repoId: this.repoId }).catch(() => {});
      }
      // BOTH modes re-scan after the run (review 84600): the sheet must
      // agree with the corpus in the failure case too — a modal sheet that
      // keeps listing applied rows makes "retry" re-PATCH concepts that no
      // longer need it. The modal closes only on a clean complete run;
      // stopped or failed stays open with the outcome.
      await this.runDryRun();
      this.applySummary = summary;
      if (!this.inline && failures.length === 0 && !stopped) this.$emit('close');
    }
  }
};
</script>

<style scoped>
/* A9: inline mode — an embedded card, no dialog chrome. */
.okf-ac__inline {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface);
  padding: var(--space-md);
}
.okf-ac__inline-actions {
  display: flex;
  justify-content: flex-end;
  border-top: 1px solid var(--border);
  padding-top: var(--space-sm);
}
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
.okf-ac__summary {
  margin: 0;
  color: var(--muted);
  font-size: var(--text-sm);
}
.okf-ac__summary--partial {
  color: var(--warning);
}
.okf-ac__applying {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-md) 0;
}
.okf-ac__progress-label {
  font-size: var(--text-sm);
  color: var(--muted);
  white-space: nowrap;
}
.okf-ac__progress {
  flex: 1;
}
.okf-ac__filter {
  margin-bottom: var(--space-md);
}
.okf-ac__sheet-note {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  margin: var(--space-md) 0 0;
  color: var(--muted);
  font-size: var(--text-sm);
}
</style>
