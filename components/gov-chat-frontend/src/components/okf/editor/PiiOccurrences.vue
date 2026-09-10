<!--
  OkfPiiOccurrences.vue — PII REVIEW + REMEDIATION (David, 2026-09-09):
  every flagged issue is FLAGGED, CATEGORIZED and DESCRIBED in clear language,
  and processed IN PLACE: each occurrence offers Redact (→ "REDACTED"),
  Replace (→ user text), Remove and Accept. The server applies every splice
  against its own scan offsets, persists a before/after resolution (the GDPR
  accountability record), and re-scans via Presidio. Processed items move to
  the green RESOLVED list (before → after) while unprocessed findings stay
  orange. Every action's result is emitted to the editor ('applied') so the
  text pane reflects the fix immediately. Nothing to hunt for manually.
-->
<template>
  <section class="okf-pii" role="region" :aria-label="translate('okf.pii.panel', 'Flagged entities')">
    <header class="okf-pii__head">
      <span class="okf-pii__title">{{ translate('okf.pii.panel', 'Flagged entities') }}</span>
      <DsPill :variant="ok ? (occurrences.length ? 'warning' : 'success') : 'danger'">
        {{
          ok
            ? occurrences.length
              ? translate('okf.pii.nFlagged', '{n} found').replace('{n}', String(total))
              : translate('okf.pii.allClear', 'Clear')
            : translate('okf.pii.scanError', 'Scan unavailable')
        }}
      </DsPill>
      <DsButton small variant="secondary" :disabled="loading || busy !== null" @click="load">
        {{ translate('okf.pii.rescan', 'Re-scan') }}
      </DsButton>
    </header>

    <p v-if="error" class="okf-pii__error">{{ error }}</p>
    <p v-if="loading" class="okf-pii__empty">
      <DsSpinner size="sm" /> {{ translate('okf.pii.scanning', 'Scanning…') }}
    </p>
    <p v-else-if="!ok" class="okf-pii__empty">
      {{
        translate(
          'okf.publish.piiScanError',
          'The scanner is unreachable — publishing stays blocked (fail-closed) until a scan succeeds.'
        )
      }}
    </p>
    <p v-else-if="occurrences.length === 0 && resolutions.length === 0" class="okf-pii__empty">
      {{ translate('okf.pii.clean', 'No flagged entities — this concept is clear.') }}
    </p>

    <!-- Unprocessed findings (orange). Clicking the excerpt LOCATES the text
         in the editor (preview → highlight, source → select). -->
    <ol v-if="occurrences.length > 0" class="okf-pii__list">
      <li v-for="(o, i) in occurrences" :key="i" class="okf-pii__item">
        <div class="okf-pii__row">
          <DsPill variant="warning">{{ entityLabel(o.type) }}</DsPill>
          <span class="okf-pii__desc">{{ entityDesc(o.type) }}</span>
        </div>
        <div
          v-if="excerpt(o)"
          class="okf-pii__excerpt"
          role="button"
          tabindex="0"
          :title="translate('okf.pii.locateTip', 'Show this text in the editor')"
          @click="$emit('locate', o)"
          @keydown.enter="$emit('locate', o)"
        >
          …<span class="okf-pii__ctx">{{ excerpt(o).before }}</span
          ><mark class="okf-pii__mark">{{ excerpt(o).hit }}</mark
          ><span class="okf-pii__ctx">{{ excerpt(o).after }}</span
          >…
        </div>
        <!-- IN-PLACE ACTIONS (David, 2026-09-09) -->
        <div v-if="!readOnly" class="okf-pii__actions">
          <DsButton small variant="secondary" :disabled="busy !== null" @click="apply('redact', o)">
            {{ translate('okf.pii.action.redact', 'Redact') }}
          </DsButton>
          <DsButton small variant="secondary" :disabled="busy !== null" @click="toggleReplace(i)">
            {{ translate('okf.pii.action.replace', 'Replace') }}
          </DsButton>
          <DsButton small variant="secondary" :disabled="busy !== null" @click="apply('remove', o)">
            {{ translate('okf.pii.action.remove', 'Remove') }}
          </DsButton>
          <DsButton small variant="ghost" :disabled="busy !== null" @click="apply('accept', o)">
            {{ translate('okf.pii.action.accept', 'Accept') }}
          </DsButton>
          <template v-if="replacing === i">
            <DsInput
              v-model="replacementText"
              size="sm"
              class="okf-pii__replacement"
              :placeholder="translate('okf.pii.action.replacement', 'Replacement text')"
              @keyup.enter="applyReplace(o)"
            />
            <DsButton small variant="primary" :disabled="busy !== null" @click="applyReplace(o)">
              {{ translate('okf.pii.action.apply', 'Apply') }}
            </DsButton>
            <DsButton small variant="ghost" @click="toggleReplace(null)">{{
              translate('okf.pii.action.cancel', 'Cancel')
            }}</DsButton>
          </template>
          <DsSpinner v-if="busy === i" size="sm" />
        </div>
      </li>
    </ol>

    <!-- WHOLE-FILE CONTROLS (David, 2026-09-09): Redact / Remove / Accept for
         the entire file, for PII-dominated documents where per-item work is
         pointless. Destructive ones get a two-step confirm; all are scan-free
         server-side (the current list rides the request). -->
    <div v-if="!readOnly && occurrences.length > 0" class="okf-pii__file-actions">
      <span class="okf-pii__file-label">{{ translate('okf.pii.file.label', 'Whole file:') }}</span>
      <DsButton small variant="danger" :disabled="busy !== null" @click="fileAction('redact')">
        {{
          confirmFileAction === 'redact'
            ? translate('okf.pii.file.confirmRedact', 'Confirm: redact whole file?')
            : translate('okf.pii.file.redact', 'Redact file')
        }}
      </DsButton>
      <DsButton small variant="danger" :disabled="busy !== null" @click="fileAction('remove')">
        {{
          confirmFileAction === 'remove'
            ? translate('okf.pii.file.confirmRemove', 'Confirm: remove whole body?')
            : translate('okf.pii.file.remove', 'Remove body')
        }}
      </DsButton>
      <DsButton small variant="ghost" :disabled="busy !== null" @click="fileAction('accept')">
        {{ translate('okf.pii.file.accept', 'Accept all') }}
      </DsButton>
      <DsSpinner v-if="busy === -2" size="sm" />
    </div>

    <!-- Processed items (green): the persisted before/after ledger -->
    <section v-if="resolutions.length > 0" class="okf-pii__resolved">
      <header class="okf-pii__resolved-head">
        {{ translate('okf.pii.resolved.title', 'Processed in this file') }}
        <DsPill variant="success">{{ resolutions.length }}</DsPill>
      </header>
      <ol class="okf-pii__list">
        <li v-for="(r, i) in resolutions" :key="'r' + i" class="okf-pii__item okf-pii__item--resolved">
          <div class="okf-pii__row">
            <!-- ACTION COLORS (David, 2026-09-09): Accepted green, Redacted
                 black, Removed red, Replaced blue. -->
            <DsPill :variant="resolvedVariant(r)">{{ resolvedLabel(r) }}</DsPill>
            <span v-if="r.type" class="okf-pii__desc">{{ entityLabel(r.type) }}</span>
            <span class="okf-pii__when">{{ shortWhen(r.at) }}</span>
          </div>
          <div v-if="r.action !== 'redact_file'" class="okf-pii__diff">
            <del class="okf-pii__before">{{ r.before }}</del>
            <template v-if="r.action === 'accept'">
              <span class="okf-pii__arrow">→</span>
              <ins class="okf-pii__after">{{ translate('okf.pii.resolved.kept', 'kept in the text') }}</ins>
            </template>
            <template v-else>
              <span class="okf-pii__arrow">→</span>
              <ins class="okf-pii__after" :class="{ 'okf-pii__after--empty': !r.after }">{{
                r.after || translate('okf.pii.resolved.removedWord', 'removed')
              }}</ins>
            </template>
          </div>
          <div v-else class="okf-pii__diff">
            <ins class="okf-pii__after">{{ translate('okf.pii.resolved.wholeFile', 'Entire file body redacted') }}</ins>
          </div>
        </li>
      </ol>
    </section>
  </section>
</template>

<script>
import translateMixin from '../../../mixins/translateMixin';
import DsButton from '../../ds/Button.vue';
import DsInput from '../../ds/Input.vue';
import DsPill from '../../ds/Pill.vue';
import DsSpinner from '../../ds/Spinner.vue';
import repoOkfService from '../../../services/repoOkfService';

export default {
  name: 'OkfPiiOccurrences',
  components: { DsButton, DsInput, DsPill, DsSpinner },
  mixins: [translateMixin],
  props: {
    repoId: { type: String, required: true },
    conceptId: { type: String, required: true },
    // Bumped by the parent on every successful save — the save already
    // re-scanned server-side, so a bump simply re-reads the fresh findings.
    revision: { type: Number, default: 0 },
    // READ ONLY (serving repo): remediation actions are hidden.
    readOnly: { type: Boolean, default: false },
    // Async hook the parent fulfils BEFORE an action (flush a pending save so
    // the server splices the freshest saved content).
    beforeApply: { type: Function, default: null },
    // PRE-WARMED STATE (2026-09-09 lockup fix): {key, state, occurrences?,
    // resolutions?} — when it matches the current concept the panel renders
    // INSTANTLY from it and never issues the live pii-inspect scan. Clean
    // files (with a processed history) and recently-scanned flagged files
    // therefore cost ZERO Presidio work on revisit.
    initialState: { type: Object, default: null }
  },
  emits: ['scanned', 'applied', 'locate'],
  data() {
    return {
      loading: false,
      ok: null,
      occurrences: [],
      resolutions: [],
      busy: null,
      replacing: null,
      replacementText: '',
      error: '',
      confirmFileAction: null
    };
  },
  computed: {
    total() {
      return this.occurrences.length;
    }
  },
  watch: {
    revision() {
      this.adoptOrLoad();
    },
    conceptId() {
      this.adoptOrLoad();
    }
  },
  mounted() {
    this.adoptOrLoad();
  },
  methods: {
    // Render from the parent's pre-warmed state when it matches this concept;
    // only fall back to the live scan when there is nothing to adopt.
    adoptOrLoad() {
      const init = this.initialState;
      if (init && init.key === this.conceptId && (init.state === 'clean' || Array.isArray(init.occurrences))) {
        this.ok = true;
        this.error = '';
        this.loading = false;
        this.occurrences = Array.isArray(init.occurrences) ? init.occurrences : [];
        this.resolutions = Array.isArray(init.resolutions) ? init.resolutions : [];
        return;
      }
      this.load();
    },
    // Parent pushes fresh payloads (from the save PATCH or an action
    // response) directly — no second network round-trip.
    adopt(payload) {
      if (!payload) return;
      if (Array.isArray(payload.occurrences)) this.occurrences = payload.occurrences;
      if (Array.isArray(payload.resolutions)) this.resolutions = payload.resolutions;
    },
    async load() {
      this.loading = true;
      this.error = '';
      try {
        const out = await repoOkfService.inspectPii(this.repoId, this.conceptId);
        this.ok = Boolean(out.ok);
        this.occurrences = Array.isArray(out.occurrences) ? out.occurrences : [];
        this.resolutions = Array.isArray(out.resolutions) ? out.resolutions : [];
        this.$emit('scanned', {
          state: out.state,
          total: this.total,
          occurrences: this.occurrences,
          resolutions: this.resolutions
        });
      } catch {
        this.ok = false;
        this.occurrences = [];
      } finally {
        this.loading = false;
      }
    },
    async apply(action, o, replacement) {
      if (this.busy !== null) return;
      const index = this.occurrences.indexOf(o);
      this.busy = index;
      this.error = '';
      try {
        if (this.beforeApply) await this.beforeApply();
        const sel = {
          where: o.where,
          start: o.start,
          end: o.end,
          type: o.type,
          hit: o.excerpt ? o.excerpt.hit : ''
        };
        const out =
          action === 'accept'
            ? await repoOkfService.acceptPii(this.repoId, this.conceptId, sel)
            : await repoOkfService.remediatePii(this.repoId, this.conceptId, { ...sel, action, replacement });
        if (!out || !out.ok) {
          throw new Error((out && out.message) || 'Remediation failed');
        }
        this.replacing = null;
        this.replacementText = '';
        if (Array.isArray(out.occurrences)) {
          // replace (and old-server fallback): the response carries the fresh list
          this.occurrences = out.occurrences;
        } else {
          // SCAN-FREE action (accept/redact/remove): the server derives state
          // arithmetically and returns no list — drop the handled span locally.
          this.occurrences = this.occurrences.filter(
            (x) => !(x.where === sel.where && x.type === sel.type && x.excerpt && x.excerpt.hit === sel.hit)
          );
        }
        this.resolutions = Array.isArray(out.resolutions) ? out.resolutions : [];
        // The editor recomposes its text from the updated document — the fix
        // is visible in the editor pane immediately (David, 2026-09-09).
        this.$emit('applied', out);
      } catch (e) {
        this.error = (e && e.response && e.response.data && e.response.data.message) || e.message || 'Action failed';
        // A stale-offset 409 means content moved — refresh the findings.
        if (e && e.response && e.response.status === 409) this.load();
      } finally {
        this.busy = null;
      }
    },
    toggleReplace(i) {
      this.replacing = this.replacing === i ? null : i;
      this.replacementText = '';
    },
    applyReplace(o) {
      if (!String(this.replacementText || '').trim()) return;
      this.apply('replace', o, this.replacementText);
    },
    async onRedactFile() {
      await this.applyFileAction('redact');
    },
    // WHOLE-FILE ACTION (David, 2026-09-09): redact | remove | accept —
    // destructive ones confirm on first click; the current occurrence list
    // rides the request and the server path is SCAN-FREE.
    async fileAction(action) {
      if (action === 'redact' || action === 'remove') {
        if (this.confirmFileAction !== action) {
          this.confirmFileAction = action;
          setTimeout(() => {
            this.confirmFileAction = null;
          }, 6000);
          return;
        }
      }
      await this.applyFileAction(action);
    },
    async applyFileAction(action) {
      if (this.busy !== null) return;
      this.busy = -2;
      this.error = '';
      try {
        if (this.beforeApply) await this.beforeApply();
        const out = await repoOkfService.fileActionPii(this.repoId, this.conceptId, {
          action,
          occurrences: this.occurrences.map((o) => ({
            where: o.where,
            type: o.type,
            hit: o.excerpt ? o.excerpt.hit : ''
          }))
        });
        if (!out || !out.ok) throw new Error((out && out.message) || 'Action failed');
        this.confirmFileAction = null;
        this.occurrences = Array.isArray(out.occurrences) ? out.occurrences : [];
        this.resolutions = Array.isArray(out.resolutions) ? out.resolutions : [];
        this.$emit('applied', out);
      } catch (e) {
        this.error = (e && e.response && e.response.data && e.response.data.message) || e.message || 'Action failed';
      } finally {
        this.busy = null;
      }
    },
    excerpt(o) {
      return o && o.excerpt ? o.excerpt : null;
    },
    entityLabel(type) {
      const key = 'okf.pii.type.' + String(type || 'OTHER');
      return this.translate(key, this.pretty(type));
    },
    pretty(type) {
      const t = String(type || 'OTHER')
        .replace(/_/g, ' ')
        .toLowerCase();
      return t.charAt(0).toUpperCase() + t.slice(1);
    },
    entityDesc(type) {
      const key = 'okf.pii.desc.' + String(type || 'OTHER');
      return this.translate(
        key,
        this.translate(
          'okf.pii.descFallback',
          'Personal data was detected here (GDPR Art. 4(1) — relating to an identifiable person).'
        )
      );
    },
    resolvedLabel(r) {
      const map = {
        redact: this.translate('okf.pii.resolved.redacted', 'Redacted'),
        replace: this.translate('okf.pii.resolved.replaced', 'Replaced'),
        remove: this.translate('okf.pii.resolved.removed', 'Removed'),
        accept: this.translate('okf.pii.resolved.accepted', 'Accepted'),
        redact_file: this.translate('okf.pii.resolved.fileRedacted', 'File redacted')
      };
      return map[r && r.action] || (r && r.action) || '';
    },
    // ACTION COLORS (David, 2026-09-09): Accepted → green, Redacted → black,
    // Removed → red, Replaced → blue. Whole-file redaction rides Redacted's
    // neutral black. Rendered as DsPill variants (DS tokens, theme-safe).
    resolvedVariant(r) {
      const map = {
        redact: 'neutral',
        redact_file: 'neutral',
        replace: 'info',
        remove: 'danger',
        accept: 'success'
      };
      return map[r && r.action] || 'neutral';
    },
    shortWhen(at) {
      try {
        return String(at || '')
          .replace('T', ' ')
          .slice(0, 16);
      } catch {
        return '';
      }
    }
  }
};
</script>

<style scoped>
.okf-pii {
  border: 1px solid var(--warning, #b45309);
  border-left-width: 3px;
  border-radius: var(--radius-md);
  padding: var(--space-md);
  background: var(--surface);
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}
.okf-pii__head {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  flex-wrap: wrap;
}
.okf-pii__title {
  font-weight: 600;
  font-size: var(--text-sm);
}
.okf-pii__error {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--danger, #b91c1c);
}
.okf-pii__empty {
  color: var(--text-muted, inherit);
  margin: 0;
  font-size: var(--text-sm);
}
.okf-pii__list {
  margin: 0;
  padding: 0 0 0 var(--space-md);
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}
.okf-pii__row {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  flex-wrap: wrap;
}
.okf-pii__desc {
  font-size: var(--text-sm);
}
.okf-pii__excerpt {
  font-size: var(--text-sm);
  background: var(--accent-muted);
  border-radius: var(--radius-sm);
  padding: 2px var(--space-sm);
  overflow-wrap: anywhere;
  cursor: pointer;
}
.okf-pii__excerpt:hover {
  outline: 1px solid var(--accent);
}
.okf-pii__excerpt:focus-visible {
  outline: 2px solid var(--accent);
}
.okf-pii__mark {
  background: var(--warning, #f59e0b);
  color: #111;
  border-radius: 3px;
  padding: 0 2px;
  font-weight: 600;
}
.okf-pii__actions {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  flex-wrap: wrap;
}
/* WHOLE-FILE CONTROLS (2026-09-09): destructive file-level verbs */
.okf-pii__file-actions {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  flex-wrap: wrap;
  border-top: 1px dashed var(--border);
  padding-top: var(--space-sm);
}
.okf-pii__file-label {
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--text-muted, inherit);
}
.okf-pii__replacement {
  min-width: 180px;
  flex: 0 1 220px;
}
/* Resolved (green) list — processed items stay visible with before → after */
.okf-pii__resolved {
  border-top: 1px dashed var(--border);
  padding-top: var(--space-sm);
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}
.okf-pii__resolved-head {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  font-size: var(--text-sm);
  font-weight: 600;
}
.okf-pii__item--resolved .okf-pii__desc {
  color: var(--text-muted, inherit);
}
.okf-pii__when {
  margin-left: auto;
  font-size: var(--text-xs);
  color: var(--text-muted, inherit);
}
.okf-pii__diff {
  font-size: var(--text-sm);
  font-family: var(--font-mono, monospace);
  background: color-mix(in srgb, var(--success, #16a34a) 8%, transparent);
  border-radius: var(--radius-sm);
  padding: 2px var(--space-sm);
  overflow-wrap: anywhere;
}
.okf-pii__before {
  color: var(--danger, #b91c1c);
}
.okf-pii__after {
  color: var(--success, #16a34a);
  text-decoration: none;
  font-weight: 600;
}
.okf-pii__after--empty {
  font-style: italic;
  font-weight: 400;
}
.okf-pii__arrow {
  margin: 0 var(--space-xs);
  color: var(--text-muted, inherit);
}
</style>
