<!--
  RetrievalCard.vue — Story 10.7 (#995): the live retrieval posture card in
  the OKF Studio tab.

  WHAT IT NAMES (and why it is not a settings form):
  the card shows the EFFECTIVE posture — the mode the chat path actually
  runs under, per the server's read-model — not the configured default and
  not the env default. Three facts travel together and must never be split:

    1. the MODE (legacy / okf_only / hybrid) — the governance posture;
    2. the ENGAGEMENT GATE — the fan-out only contributes when the mode is
       a known non-legacy mode AND ≥1 graph serves FOR THIS CALLER. A card
       showing "okf_only" over zero serving graphs is the foot-gun the
       issue names: it looks switched-on and contributes nothing;
    3. the SERVING COUNT + repo list — the same view the chat path resolves
       (per-caller scopes), so the operator sees what they actually have.

  WHO SEES WHAT: the posture is read-only for everyone (a curator must SEE
  that OKF grounding is on and what it covers) and editable only for the
  tools-admin realm role — the same role the PUT route enforces server-side.
  A non-admin sees no selector and no save button, so the card never
  promises an action the server would refuse.

  THE WRITE: a save opens a before→after confirmation (the change is
  global and live within 30s — the serving-set TTL), then PUTs the CHANGED
  fields only (the server rejects an empty patch) and refreshes from the
  GET — the card never renders its own optimistic guess as truth.
-->
<template>
  <section class="okf-retrieval" :data-test-id="dataTestId">
    <header class="okf-retrieval__header">
      <h3 class="okf-retrieval__title">
        {{ translate('okf.retrieval.title', 'Retrieval posture') }}
      </h3>
      <span class="okf-retrieval__pills">
        <DsPill v-if="loading" variant="info">
          {{ translate('okf.retrieval.loading', 'Reading…') }}
        </DsPill>
        <template v-else-if="posture">
          <DsPill :variant="modeVariant">
            {{ translate('okf.retrieval.mode.' + posture.config.mode, posture.config.mode) }}
          </DsPill>
          <DsPill :variant="posture.engaged ? 'success' : 'warning'">
            {{
              posture.engaged
                ? translate('okf.retrieval.engaged', 'Grounding active')
                : translate('okf.retrieval.notEngaged', 'Not contributing')
            }}
          </DsPill>
          <DsPill variant="neutral">
            {{ translate('okf.retrieval.servingCount', '{n} serving graph(s)').replace('{n}', String(servingCount)) }}
          </DsPill>
        </template>
        <DsButton v-if="canEdit" variant="ghost" small :disabled="loading || busy" @click="onRefresh">
          {{ translate('okf.retrieval.refresh', 'Refresh') }}
        </DsButton>
      </span>
    </header>

    <!-- READ ERROR: the posture is unknown, and an unknown posture must not
         render as a confident one. -->
    <p v-if="error" class="okf-retrieval__error" role="alert">
      {{ error }}
    </p>

    <p v-else-if="posture" class="okf-retrieval__meta">
      <span>
        {{ translate('okf.retrieval.sourceLabel', 'Source') }}:
        {{ translate('okf.retrieval.source.' + posture.source, posture.source) }}
      </span>
      <span> {{ translate('okf.retrieval.revision', 'Revision') }}: {{ posture.config.revision }} </span>
      <span v-if="posture.config.updated_at">
        {{ translate('okf.retrieval.updatedAt', 'Updated') }}: {{ posture.config.updated_at }}
      </span>
      <span v-if="posture.config.updated_by">
        {{ translate('okf.retrieval.updatedBy', 'By') }}: {{ posture.config.updated_by }}
      </span>
    </p>

    <!-- THE FOOT-GUN, named in the operator's own language: okf_only over
         zero serving graphs contributes nothing while LOOKING switched on.
         The server sends the same fact as an English string; the card's own
         sentence is the translated one, the server's is supplementary. -->
    <p v-if="isFootGun" class="okf-retrieval__warn" role="status">
      {{
        translate(
          'okf.retrieval.warnZeroServing',
          'okf_only with zero serving graphs — OKF contribution is zero. Publish and ingest a repository first.'
        )
      }}
    </p>

    <!-- THE SERVER'S OWN WARNINGS: the read-model carries them (ADR-039 D2),
         so a warning added server-side later reaches the operator without a
         frontend change. Supplementary to the card's translated sentence
         above — never a replacement for it. -->
    <ul v-if="serverWarnings.length" class="okf-retrieval__warnings">
      <li v-for="(warning, i) in serverWarnings" :key="i" class="okf-retrieval__warning-item">
        {{ warning }}
      </li>
    </ul>

    <details v-if="posture && posture.serving_graphs && posture.serving_graphs.length" class="okf-retrieval__serving">
      <summary class="okf-retrieval__summary">
        {{ translate('okf.retrieval.servingList', 'Serving graphs') }} ({{ posture.serving_graphs.length }})
      </summary>
      <ul class="okf-retrieval__serving-list">
        <li v-for="g in posture.serving_graphs" :key="g.repo_id" class="okf-retrieval__serving-item">
          <code>{{ g.repo_id }}</code>
          <span v-if="g.domain" class="okf-retrieval__serving-domain">{{ g.domain }}</span>
          <code v-if="g.graph_name" class="okf-retrieval__serving-graph">{{ g.graph_name }}</code>
        </li>
      </ul>
    </details>

    <!-- ADMIN CONTROLS: the mode selector + the advanced caps. Hidden
         entirely for a non-admin (no dead affordance). -->
    <div v-if="canEdit && posture" class="okf-retrieval__controls">
      <DsFormGroup :label="translate('okf.retrieval.modeLabel', 'Mode')" input-id="okf-retrieval-mode">
        <DsSelect id="okf-retrieval-mode" v-model="draftMode" size="sm" :disabled="busy">
          <option v-for="m in modes" :key="m" :value="m">
            {{ translate('okf.retrieval.mode.' + m, m) }}
          </option>
        </DsSelect>
      </DsFormGroup>
      <p class="okf-retrieval__consequence">
        {{ translate('okf.retrieval.consequence.' + draftMode, translate('okf.retrieval.consequence.unknown', '')) }}
      </p>

      <details class="okf-retrieval__advanced">
        <summary class="okf-retrieval__summary">
          {{ translate('okf.retrieval.advanced', 'Advanced limits') }}
        </summary>
        <div class="okf-retrieval__limits">
          <DsFormGroup
            v-for="field in limitFields"
            :key="field.key"
            :label="translate('okf.retrieval.limit.' + field.key, field.key)"
            :input-id="'okf-retrieval-' + field.key"
          >
            <DsInput
              :id="'okf-retrieval-' + field.key"
              v-model="draftLimits[field.key]"
              type="number"
              size="sm"
              :min="field.min"
              :max="field.max"
              :disabled="busy"
            />
            <!-- AN UNUSABLE DRAFT is named, not silently dropped: an emptied
                 input would otherwise be fabricated into a 0 and refused by
                 the server with no clue which field was at fault. -->
            <p v-if="limitDraft(field) === null" class="okf-retrieval__invalid" role="alert">
              {{
                translate('okf.retrieval.invalidValue', 'Enter a whole number between {min} and {max}.')
                  .replace('{min}', String(field.min))
                  .replace('{max}', String(field.max))
              }}
            </p>
          </DsFormGroup>
        </div>
      </details>

      <div class="okf-retrieval__actions">
        <DsButton
          variant="primary"
          small
          :disabled="busy || !hasChanges || invalidLimitFields.length > 0"
          @click="onAskSave"
        >
          {{ translate('okf.retrieval.save', 'Save') }}
        </DsButton>
        <DsButton variant="ghost" small :disabled="busy || !hasChanges" @click="resetDraft">
          {{ translate('okf.retrieval.revert', 'Revert') }}
        </DsButton>
      </div>
      <p v-if="saveError" class="okf-retrieval__error" role="alert">{{ saveError }}</p>
    </div>

    <!-- THE TRAIL: who changed the global posture, and when. -->
    <details v-if="canEdit" class="okf-retrieval__audit">
      <summary class="okf-retrieval__summary">
        {{ translate('okf.retrieval.audit', 'Change history') }}
      </summary>
      <p v-if="auditLoading" class="okf-retrieval__meta">
        {{ translate('okf.retrieval.auditLoading', 'Loading history…') }}
      </p>
      <p v-else-if="auditError" class="okf-retrieval__error" role="alert">{{ auditError }}</p>
      <p v-else-if="!auditRows.length" class="okf-retrieval__meta">
        {{ translate('okf.retrieval.auditEmpty', 'No changes recorded yet.') }}
      </p>
      <ul v-else class="okf-retrieval__audit-list">
        <li v-for="(row, i) in auditRows" :key="i" class="okf-retrieval__audit-item">
          <code>{{ row.ts }}</code>
          <span>{{ row.actor_name || row.actor || '—' }}</span>
          <span class="okf-retrieval__audit-desc">{{ row.description }}</span>
        </li>
      </ul>
    </details>

    <!-- BEFORE → AFTER: the posture is global and live within 30s, so the
         change is confirmed, never applied silently. -->
    <DsDialog
      :visible="confirmOpen"
      :title="translate('okf.retrieval.confirmTitle', 'Change the retrieval posture?')"
      size="sm"
      persistent
      :actions="confirmActions"
      @close="confirmOpen = false"
      @action="onConfirmAction"
    >
      <p class="okf-retrieval__confirm-lead">
        {{
          translate(
            'okf.retrieval.confirmLead',
            'This is a global setting — it changes how every query is grounded, within about 30 seconds.'
          )
        }}
      </p>
      <ul class="okf-retrieval__diff">
        <li v-for="d in diffRows" :key="d.key" class="okf-retrieval__diff-item">
          <span class="okf-retrieval__diff-key">{{ d.label }}</span>
          <span class="okf-retrieval__diff-before">{{ d.before }}</span>
          <span aria-hidden="true">→</span>
          <span class="okf-retrieval__diff-after">{{ d.after }}</span>
        </li>
      </ul>
    </DsDialog>
  </section>
</template>

<script>
import { mapGetters } from 'vuex';
import translateMixin from '../../mixins/translateMixin';
import DsButton from '../ds/Button.vue';
import DsDialog from '../ds/Dialog.vue';
import DsFormGroup from '../ds/FormGroup.vue';
import DsInput from '../ds/Input.vue';
import DsPill from '../ds/Pill.vue';
import DsSelect from '../ds/Select.vue';
import repoOkfService from '../../services/repoOkfService';

/** The cap fields the server exposes in its read-model `limits` — the card
 *  renders whatever the server sends (it is the single source of the
 *  bounds), with these as the FALLBACK when an older server omits it. */
const LIMIT_FIELDS = [
  { key: 'max_fanout_graphs', min: 1, max: 20 },
  { key: 'spine_max_hops', min: 1, max: 3 },
  { key: 'extracted_hop_cap', min: 1, max: 3 },
  { key: 'candidate_cap_per_graph', min: 1, max: 200 },
  { key: 'candidate_cap_global', min: 1, max: 1000 }
];

/**
 * The server's reason for a refusal, read from the envelope httpService
 * actually rejects with: `{ status, statusText, data, message }` — there is
 * NO `.response` on it (httpService.handleResponseError). The axios shape is
 * accepted as a fallback so a raw axios rejection still reads.
 * @returns {{body: object|null, message: string, details: string[]|null}}
 */
function refusalReason(err) {
  const body = (err && err.data) || (err && err.response && err.response.data) || null;
  const details = body && Array.isArray(body.details) ? body.details : null;
  const message = (body && body.message) || (err && err.message) || '';
  return { body, message, details };
}

export default {
  name: 'OkfRetrievalCard',
  components: { DsButton, DsDialog, DsFormGroup, DsInput, DsPill, DsSelect },
  mixins: [translateMixin],
  props: {
    /** The test handle for the Playwright surface. */
    testId: { type: String, default: 'okf-retrieval-card' }
  },
  data() {
    return {
      loading: false,
      busy: false,
      error: '',
      saveError: '',
      posture: null,
      draftMode: 'legacy',
      draftLimits: {},
      confirmOpen: false,
      auditRows: [],
      auditLoading: false,
      auditError: ''
    };
  },
  computed: {
    ...mapGetters('auth', ['currentUser']),
    dataTestId() {
      return this.testId;
    },
    /** The tools-admin realm role — the SAME role the PUT route enforces
     *  server-side (okf-server/middleware/require-role.js). A non-admin
     *  gets the posture, never the controls. */
    canEdit() {
      const roles = (this.currentUser && this.currentUser.roles) || [];
      return roles.includes('tools-admin');
    },
    modes() {
      const fromServer = this.posture && this.posture.modes;
      return Array.isArray(fromServer) && fromServer.length ? fromServer : ['legacy', 'okf_only', 'hybrid'];
    },
    limitFields() {
      const limits = (this.posture && this.posture.limits) || {};
      const keys = Object.keys(limits).length ? Object.keys(limits) : LIMIT_FIELDS.map((f) => f.key);
      return keys.map((key) => {
        const bound = limits[key];
        const fallback = LIMIT_FIELDS.find((f) => f.key === key) || { min: 1, max: 1 };
        return {
          key,
          min: bound && bound.min !== undefined ? bound.min : fallback.min,
          max: bound && bound.max !== undefined ? bound.max : fallback.max
        };
      });
    },
    servingCount() {
      return this.posture ? Number(this.posture.serving_graph_count || 0) : 0;
    },
    /** The server's own warnings (ADR-039 D2) — the read-model's list. */
    serverWarnings() {
      const warnings = this.posture && this.posture.warnings;
      return Array.isArray(warnings) ? warnings.filter((w) => typeof w === 'string' && w) : [];
    },
    modeVariant() {
      if (!this.posture) return 'neutral';
      if (this.posture.config.mode === 'legacy') return 'neutral';
      return this.posture.engaged ? 'success' : 'warning';
    },
    /** The foot-gun: okf_only over zero serving graphs contributes nothing
     *  while LOOKING switched on. */
    isFootGun() {
      return !!(this.posture && this.posture.config.mode === 'okf_only' && this.servingCount === 0);
    },
    /**
     * The draft value for ONE limit field, or null when the operator has
     * left it in a state the server would refuse (empty, non-numeric, or
     * outside the bounds the SERVER published). `Number('')` is 0 — NOT
     * NaN — so an emptied input would otherwise be silently fabricated into
     * a 0 and sent; the server's joi would refuse it and the confirmation
     * would have shown a value the operator never typed.
     */
    invalidLimitFields() {
      return this.limitFields.filter((f) => this.limitDraft(f) === null);
    },
    hasChanges() {
      if (!this.posture) return false;
      if (this.draftMode !== this.posture.config.mode) return true;
      return this.limitFields.some((f) => {
        const draft = this.limitDraft(f);
        if (draft === null) return false; // invalid drafts are not a change
        return draft !== Number(this.posture.config[f.key]);
      });
    },
    /** The before→after rows the confirmation shows. */
    diffRows() {
      if (!this.posture) return [];
      const rows = [];
      const label = (k) => this.translate('okf.retrieval.limit.' + k, k);
      if (this.draftMode !== this.posture.config.mode) {
        rows.push({
          key: 'mode',
          label: this.translate('okf.retrieval.modeLabel', 'Mode'),
          before: this.posture.config.mode,
          after: this.draftMode
        });
      }
      for (const f of this.limitFields) {
        const before = this.posture.config[f.key];
        const draft = this.limitDraft(f);
        if (draft === null) continue; // nothing valid to show
        if (Number(before) !== draft) {
          rows.push({ key: f.key, label: label(f.key), before: String(before), after: String(draft) });
        }
      }
      return rows;
    },
    confirmActions() {
      return [
        { key: 'cancel', label: this.translate('okf.retrieval.cancel', 'Cancel'), variant: 'secondary' },
        { key: 'confirm', label: this.translate('okf.retrieval.confirm', 'Apply'), variant: 'primary' }
      ];
    }
  },
  watch: {
    // The auth store resolves the session ASYNCHRONOUSLY — a card mounted
    // before the roles arrive would never load the change history (the
    // controls would appear, the history panel would not). Watch the
    // transition instead of reading it once at mount time.
    canEdit(isAdmin) {
      if (isAdmin && !this.auditRows.length && !this.auditLoading) this.loadAudit();
    }
  },
  mounted() {
    this.onRefresh();
  },
  methods: {
    /**
     * The draft value for ONE limit field, or null when the operator has
     * left it in a state the server would refuse (empty, non-numeric, or
     * outside the bounds the SERVER published). `Number('')` is 0 — NOT
     * NaN — so an emptied input would otherwise be silently fabricated into
     * a 0 and sent; the server's joi would refuse it and the confirmation
     * would have shown a value the operator never typed.
     */
    limitDraft(field) {
      const raw = this.draftLimits[field.key];
      if (raw === '' || raw === null || raw === undefined) return null;
      const value = Number(raw);
      if (!Number.isFinite(value)) return null;
      if (value < field.min || value > field.max) return null;
      return value;
    },
    async onRefresh() {
      this.loading = true;
      this.error = '';
      try {
        const posture = await repoOkfService.getRetrievalConfig();
        if (!posture) {
          // An unknown posture must not render as a confident one — the
          // previous read is dropped with it (see the catch below).
          this.posture = null;
          this.error = this.translate('okf.retrieval.readFailed', 'Could not read the retrieval posture.');
          return;
        }
        this.posture = posture;
        this.resetDraft();
        if (this.canEdit) this.loadAudit();
      } catch (err) {
        // A failed re-read must not leave the STALE posture on screen next
        // to the error — an operator would read the old mode pill as the
        // current one (and, after a write whose re-read failed, conclude the
        // change never landed).
        this.posture = null;
        const { message } = refusalReason(err);
        this.error = message || this.translate('okf.retrieval.readFailed', 'Could not read the retrieval posture.');
      } finally {
        this.loading = false;
      }
    },
    resetDraft() {
      if (!this.posture) return;
      this.draftMode = this.posture.config.mode;
      const limits = {};
      for (const f of this.limitFields) limits[f.key] = this.posture.config[f.key];
      this.draftLimits = limits;
      this.saveError = '';
    },
    onAskSave() {
      if (!this.hasChanges) return;
      this.confirmOpen = true;
    },
    async onConfirmAction(key) {
      if (key !== 'confirm') {
        this.confirmOpen = false;
        return;
      }
      this.confirmOpen = false;
      this.busy = true;
      this.saveError = '';
      try {
        if (!this.posture) return;
        // ONLY the changed fields — the server rejects an empty patch, and a
        // full-config PUT would bump the revision for nothing. An INVALID
        // draft is never sent (it would be refused, and the operator would
        // not know which field was at fault).
        const patch = {};
        if (this.draftMode !== this.posture.config.mode) patch.mode = this.draftMode;
        for (const f of this.limitFields) {
          const value = this.limitDraft(f);
          if (value === null) continue;
          if (Number(this.posture.config[f.key]) !== value) patch[f.key] = value;
        }
        if (!Object.keys(patch).length) {
          this.saveError = this.translate('okf.retrieval.nothingToSave', 'There is nothing to save.');
          return;
        }
        await repoOkfService.putRetrievalConfig(patch);
        // The card renders the SERVER's truth, never the optimistic guess.
        await this.onRefresh();
      } catch (err) {
        const { message, details } = refusalReason(err);
        this.saveError =
          (details && details.length && details.join('; ')) ||
          message ||
          this.translate('okf.retrieval.saveFailed', 'The change was refused.');
      } finally {
        this.busy = false;
      }
    },
    async loadAudit() {
      this.auditLoading = true;
      this.auditError = '';
      try {
        this.auditRows = await repoOkfService.getRetrievalConfigAudit(25);
      } catch (err) {
        // The server's own reason when it gives one (a 403 names the missing
        // role) — a bare "failed" would send the admin hunting.
        const { message } = refusalReason(err);
        this.auditError = message || this.translate('okf.retrieval.auditFailed', 'Could not read the change history.');
      } finally {
        this.auditLoading = false;
      }
    }
  }
};
</script>

<style scoped>
.okf-retrieval {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  padding: var(--space-md);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface);
}
.okf-retrieval__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--space-sm);
}
.okf-retrieval__title {
  margin: 0;
  font-size: var(--text-md);
  font-weight: 600;
}
.okf-retrieval__pills {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  flex-wrap: wrap;
}
.okf-retrieval__meta {
  margin: 0;
  display: flex;
  gap: var(--space-md);
  flex-wrap: wrap;
  font-size: var(--text-xs);
  color: var(--muted);
}
.okf-retrieval__warn {
  margin: 0;
  padding: var(--space-xs) var(--space-sm);
  border-radius: var(--radius-sm);
  background: var(--warning-bg);
  color: var(--warning-ink);
  font-size: var(--text-xs);
}
.okf-retrieval__error {
  margin: 0;
  color: var(--danger);
  font-size: var(--text-xs);
}
.okf-retrieval__invalid {
  margin: var(--space-xs) 0 0;
  color: var(--danger);
  font-size: var(--text-xs);
}
.okf-retrieval__warnings {
  margin: 0;
  padding-left: var(--space-md);
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  font-size: var(--text-xs);
  color: var(--muted);
}
.okf-retrieval__summary {
  cursor: pointer;
  font-size: var(--text-xs);
  color: var(--muted);
}
.okf-retrieval__serving-list,
.okf-retrieval__audit-list,
.okf-retrieval__diff {
  margin: var(--space-xs) 0 0;
  padding-left: var(--space-md);
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}
.okf-retrieval__serving-item,
.okf-retrieval__audit-item,
.okf-retrieval__diff-item {
  display: flex;
  align-items: baseline;
  gap: var(--space-xs);
  font-size: var(--text-xs);
  flex-wrap: wrap;
}
.okf-retrieval__serving-domain,
.okf-retrieval__audit-desc {
  color: var(--muted);
}
.okf-retrieval__controls {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}
.okf-retrieval__consequence {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--muted);
}
.okf-retrieval__limits {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-md);
  margin-top: var(--space-xs);
}
.okf-retrieval__actions {
  display: flex;
  gap: var(--space-sm);
}
.okf-retrieval__diff-before {
  color: var(--muted);
  text-decoration: line-through;
}
.okf-retrieval__diff-after {
  font-weight: 600;
}
.okf-retrieval__diff-key {
  color: var(--muted);
}
</style>
