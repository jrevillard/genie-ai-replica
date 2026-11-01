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

  RE-SCAN IS A WRITE (2026-10-12). It used to POST pii-inspect {rescan:true},
  a route the server documents "Nothing persisted": the panel refreshed while
  pii_state stayed byte-identical, so a concept stuck on pii_state 'error' —
  the one state the publish gate refuses, and the one no per-occurrence
  action can reach — looked re-scanned and stayed blocked forever. The button
  now calls the PERSISTING scan and reports whatever verdict came back,
  INCLUDING 'error', which is rendered as its own blocking state rather than
  as "no findings". Opening the panel still uses the cheap, cache-backed
  pii-inspect; only the explicit Re-scan writes.
-->
<template>
  <section class="okf-pii" role="region" :aria-label="translate('okf.pii.panel', 'Flagged entities')">
    <header class="okf-pii__head">
      <span class="okf-pii__title">{{ translate('okf.pii.panel', 'Flagged entities') }}</span>
      <DsPill :variant="stateVariant">
        {{
          piiState === 'error'
            ? translate('okf.pii.stateError', 'Scan failed')
            : !ok
              ? translate('okf.pii.scanError', 'Scan unavailable')
              : occurrences.length
                ? translate('okf.pii.nFlagged', '{n} found').replace('{n}', String(total))
                : translate('okf.pii.allClear', 'Clear')
        }}
      </DsPill>
      <!-- RE-SCAN IS A WRITE (2026-10-12). It used to call pii-inspect with
           {rescan:true}, which the server documents "Nothing persisted": the
           panel refreshed and pii_state never moved, so a concept stuck on
           'error' looked re-scanned and stayed blocked. This is the
           PERSISTING scan (piiService.scanConcept) — the only thing that can
           clear an 'error' verdict. -->
      <DsButton small variant="secondary" :disabled="loading || busy !== null || readOnly" @click="rescan">
        <DsSpinner v-if="rescanning" size="sm" />
        {{ translate('okf.pii.rescan', 'Re-scan') }}
      </DsButton>
    </header>

    <p v-if="error" class="okf-pii__error">{{ error }}</p>

    <!-- PII_STATE 'error' IS NOT "NO FINDINGS" (2026-10-12): a failed scan and
         a clean scan are opposite verdicts and the publish gate treats them
         differently. Rendering them the same way is what made the failure
         un-actionable — the panel looked green over a concept that was
         blocking the hand-off. -->
    <p v-if="piiState === 'error'" class="okf-pii__state-error">
      <strong>{{ translate('okf.pii.errorTitle', 'This page is blocking the hand-off.') }}</strong>
      {{
        translate(
          'okf.pii.errorBody',
          'The PII scan of this page FAILED (it did not find nothing — it could not read the text). Publishing stays blocked until a scan succeeds. Use Re-scan above.'
        )
      }}
      <span v-if="scanError" class="okf-pii__state-error-detail">{{ scanError }}</span>
    </p>

    <!-- SCAN PROGRESS (David, 2026-09-13): a moving bar (not just a spinner)
         while the live Presidio scan runs — visible feedback that something
         is happening during the wait. -->
    <div v-if="loading" class="okf-pii__scanning">
      <DsProgress
        indeterminate
        size="sm"
        variant="warning"
        show-label
        :label="translate('okf.pii.scanning', 'Scanning…')"
        :aria-label="translate('okf.pii.scanning', 'Scanning…')"
      />
    </div>
    <p v-else-if="!ok && piiState !== 'error'" class="okf-pii__empty">
      {{
        translate(
          'okf.publish.piiScanError',
          'The scanner is unreachable — publishing stays blocked (fail-closed) until a scan succeeds.'
        )
      }}
    </p>
    <p v-else-if="occurrences.length === 0 && resolutions.length === 0 && piiState !== 'error'" class="okf-pii__empty">
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
            <template v-if="r.action === 'accept' || r.action === 'accept_all_findings' || r.action === 'accept_repo'">
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
import DsProgress from '../../ds/Progress.vue';
import DsSpinner from '../../ds/Spinner.vue';
import repoOkfService from '../../../services/repoOkfService';

export default {
  name: 'OkfPiiOccurrences',
  components: { DsButton, DsInput, DsPill, DsProgress, DsSpinner },
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
  emits: ['scanned', 'rescanned', 'applied', 'locate'],
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
      confirmFileAction: null,
      // PERSISTED VERDICT (2026-10-12): 'clean' | 'hit' | 'error' | null.
      // Distinct from `ok`, which only says "the request succeeded". An
      // 'error' verdict is the publish BLOCKER and has its own rendering —
      // collapsing it into "no findings" is what made it un-actionable.
      piiState: null,
      // WHY the scan failed (server's pii_scan_error). Null when the scan
      // itself never ran.
      scanError: null,
      rescanning: false,
      // STALE-ANSWER GUARD — see `rescan()`. A PII verdict belongs to ONE
      // concept; if the curator selects another page while a scan is in
      // flight, the answer describes a page no longer on screen. Bumped on
      // every scan dispatch AND on every concept change.
      scanEpoch: 0
    };
  },
  computed: {
    total() {
      return this.occurrences.length;
    },
    // A failed scan is the loudest state; an unreadable request second;
    // findings next; clear last.
    stateVariant() {
      if (this.piiState === 'error' || !this.ok) return 'danger';
      return this.occurrences.length ? 'warning' : 'success';
    }
  },
  watch: {
    revision() {
      this.adoptOrLoad();
    },
    conceptId() {
      // Invalidate any scan still in flight for the PREVIOUS concept before
      // loading the new one, so its verdict can never land here.
      this.scanEpoch += 1;
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
        // The pre-warmed state is the PERSISTED verdict — render it as such.
        // An 'error' here is the blocking case; without this the panel adopts
        // a clean-looking list over a concept the gate is refusing.
        this.piiState = init.state === 'error' ? 'error' : init.state || (this.occurrences.length ? 'hit' : 'clean');
        this.scanError = null;
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
      if (payload.pii_state) {
        this.piiState = payload.pii_state;
        this.scanError = payload.pii_scan_error || null;
      }
    },
    // OPEN (the panel's first read): pii-inspect — cheap, cache-backed, and
    // correctly persists NOTHING. It reports the CURRENT state so the panel
    // can render an 'error' verdict honestly, but it cannot clear one.
    async load() {
      const epoch = ++this.scanEpoch;
      const conceptId = this.conceptId;
      this.loading = true;
      this.error = '';
      try {
        const out = await repoOkfService.inspectPii(this.repoId, conceptId, { rescan: false });
        // STALE-ANSWER GUARD: the curator may have moved to another concept
        // while this request was in flight.
        if (epoch !== this.scanEpoch || conceptId !== this.conceptId) return;
        this.applyInspect(out);
      } catch {
        if (epoch !== this.scanEpoch || conceptId !== this.conceptId) return;
        this.ok = false;
        this.occurrences = [];
      } finally {
        if (epoch === this.scanEpoch) this.loading = false;
      }
    },
    /**
     * RE-SCAN — A WRITE (2026-10-12).
     *
     * This used to be `load(true)`, i.e. inspectPii({rescan:true}), which the
     * server documents "Nothing persisted": the DISPLAY refreshed while
     * pii_state stayed byte-identical, so a concept stuck on 'error' looked
     * re-scanned and stayed blocked. It now calls the PERSISTING scan
     * (piiService.scanConcept server-side), which is the ONLY path that can
     * move a concept off 'error'.
     *
     * Fail-LOUD: a missing route (404 on a stale build), a drain freeze
     * (409) or a transport failure all render a VISIBLE message. A silent
     * no-op here is precisely the bug this replaces.
     */
    async rescan() {
      if (this.rescanning || this.busy !== null) return;
      const epoch = ++this.scanEpoch;
      const conceptId = this.conceptId;
      this.rescanning = true;
      this.error = '';
      try {
        // The server scans the content it is HANDED, so the concept has to be
        // fetched first — sending an empty body would scan nothing and write a
        // verdict that means nothing.
        const concept = await repoOkfService.getConcept(this.repoId, conceptId);
        if (epoch !== this.scanEpoch || conceptId !== this.conceptId) return;
        if (!concept) throw { status: 404, data: { message: `Concept '${conceptId}' could not be loaded` } };
        // THE WRITE: POST /pii-scan {concepts:[…]} → the server runs the real
        // scanConcept and upserts pii_state onto this concept's meta row.
        const out = await repoOkfService.scanConceptPii(this.repoId, conceptId, {
          frontmatter: concept.frontmatter || {},
          body: concept.body || ''
        });
        if (epoch !== this.scanEpoch || conceptId !== this.conceptId) return;
        this.applyPersisted(out, conceptId);
        // pii-scan answers with the VERDICT, not the findings list, so re-read
        // the occurrences for display. That read is cache-backed and cheap —
        // and it is the read-only route, used for what it is good at.
        const fresh = await repoOkfService.inspectPii(this.repoId, conceptId, { rescan: false });
        if (epoch !== this.scanEpoch || conceptId !== this.conceptId) return;
        if (Array.isArray(fresh && fresh.occurrences)) this.occurrences = fresh.occurrences;
        if (Array.isArray(fresh && fresh.resolutions)) this.resolutions = fresh.resolutions;
        this.$emit('rescanned', {
          concept_id: conceptId,
          pii_state: this.piiState,
          pii_scan_error: this.scanError,
          total: this.total
        });
      } catch (e) {
        if (epoch !== this.scanEpoch || conceptId !== this.conceptId) return;
        this.ok = false;
        this.occurrences = [];
        this.error = this.rescanErrorMessage(e);
      } finally {
        if (epoch === this.scanEpoch) this.rescanning = false;
      }
    },
    // Render a NON-persisting inspect payload.
    applyInspect(out) {
      const state = (out && out.state) || null;
      // An inspect that failed its own transport reports ok:false/state
      // 'error'; render that as the persisted 'error' verdict rather than
      // pretending the concept is clean.
      this.ok = Boolean(out && out.ok);
      if (state === 'error') {
        this.piiState = 'error';
        this.scanError = (out && (out.pii_scan_error || out.error)) || null;
      } else if (state) {
        this.piiState = state;
        this.scanError = null;
      }
      this.occurrences = Array.isArray(out && out.occurrences) ? out.occurrences : [];
      this.resolutions = Array.isArray(out && out.resolutions) ? out.resolutions : [];
      this.$emit('scanned', {
        state: state || this.piiState,
        total: this.total,
        occurrences: this.occurrences,
        resolutions: this.resolutions
      });
    },
    // Render a PERSISTING scan payload — POST /pii-scan {concepts:[…]}, which
    // answers {scanned, results:[{concept_id, pii_state, pii_hits_summary}]}.
    // pii_state here IS what the publish gate now reads: the write already
    // landed. Occurrences are NOT in this payload (a follow-up inspect
    // supplies them), so the existing list is left alone here.
    applyPersisted(out, conceptId) {
      const results = Array.isArray(out && out.results) ? out.results : [];
      const row = results.find((r) => r && r.concept_id === conceptId) || results[0] || null;
      const state = (row && row.pii_state) || null;
      // A FAILED scan is not an HTTP failure: the server records pii_state
      // 'error' and still answers 200. Treating that as success is exactly how
      // a blocking verdict gets rendered as a clean page.
      this.ok = state !== 'error';
      this.piiState = state;
      this.scanError = state === 'error' ? (row && (row.error || row.pii_scan_error)) || null : null;
      this.$emit('scanned', {
        state: state,
        total: this.total,
        occurrences: this.occurrences,
        resolutions: this.resolutions
      });
    },
    // Why a re-scan could not run. Never swallowed — the curator pressed a
    // button that does not work and must be told which way it failed.
    rescanErrorMessage(e) {
      const status = e && (e.status || (e.response && e.response.status));
      const serverMessage = e && e.data && e.data.message;
      // The server's error CODE rides along when it sends no prose — a bare
      // "REPO_DRAINING" is more use to whoever has to act than silence.
      const serverCode = e && e.data && e.data.error;
      const explain = (code) => (serverCode && serverCode !== code ? ` (${serverCode})` : '');
      if (status === 404) {
        return (
          serverMessage ||
          this.translate(
            'okf.pii.rescanMissing',
            'Re-scan is not available on this server (404). Nothing was changed — the page is still blocking publishing.'
          ) + explain('NOT_FOUND')
        );
      }
      if (status === 409) {
        return (
          serverMessage ||
          this.translate(
            'okf.pii.rescanFrozen',
            'Re-scan refused: the repository is being published (409). Nothing was changed.'
          ) + explain('REPO_DRAINING')
        );
      }
      return (
        serverMessage ||
        (e && e.message) ||
        this.translate(
          'okf.pii.rescanFailed',
          'Re-scan failed. Nothing was changed — the page is still blocking publishing.'
        )
      );
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
        redact_file: this.translate('okf.pii.resolved.fileRedacted', 'File redacted'),
        // Whole-concept Remove (per-concept "Remove body" AND repo-wide Remove
        // both write remove_file). It was unmapped, so the ledger rendered the
        // raw action string in a NEUTRAL pill — a destructive action displayed
        // as if nothing happened. Removed is red, same as its per-item sibling.
        remove_file: this.translate('okf.pii.resolved.removed', 'Removed'),
        // Whole-concept acceptance (David 2026-10-13: Accept All should bulk
        // accept everything the same way individual accepts work). It MUST render
        // identically to a per-item Accept — green, "Accepted". accept_repo is the
        // legacy action and renders the same so the existing ledger reads
        // correctly rather than showing a raw action string in a neutral pill.
        accept_all_findings: this.translate('okf.pii.resolved.accepted', 'Accepted'),
        accept_repo: this.translate('okf.pii.resolved.accepted', 'Accepted')
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
        remove_file: 'danger',
        accept: 'success',
        // Accepted == green, per-item OR repo-wide. A bulk accept is still an
        // acceptance: showing it as neutral would read as "unprocessed", which
        // is exactly backwards.
        accept_all_findings: 'success',
        accept_repo: 'success'
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
  border: 1px solid var(--warning);
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
  color: var(--danger);
}
/* PERSISTED 'error' VERDICT (2026-10-12): a failed scan is not a clean scan.
   It gets its own block, in the danger tone, above the findings — the gate is
   refusing THIS concept and the curator has to know before they read a list. */
.okf-pii__state-error {
  margin: 0;
  padding: var(--space-sm) var(--space-md);
  font-size: var(--text-sm);
  color: var(--fg);
  background: var(--danger-bg);
  border: 1px solid var(--danger);
  border-left-width: 3px;
  border-radius: var(--radius-sm);
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}
.okf-pii__state-error-detail {
  font-family: var(--font-mono, monospace);
  font-size: var(--text-xs);
  color: var(--danger);
  overflow-wrap: anywhere;
}
.okf-pii__empty {
  color: var(--muted, inherit);
  margin: 0;
  font-size: var(--text-sm);
}
.okf-pii__scanning {
  padding: 2px 0;
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
  /* Round 18, #80491: the paired --warning-ink token (darkened warning on
     light ground, the badge token itself on dark) replaces the hardcoded
     near-black — the old #111 rendered near-black text on the amber token
     in dark theme. */
  background: var(--warning);
  color: var(--warning-ink);
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
  color: var(--muted, inherit);
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
  color: var(--muted, inherit);
}
.okf-pii__when {
  margin-left: auto;
  font-size: var(--text-xs);
  color: var(--muted, inherit);
}
.okf-pii__diff {
  font-size: var(--text-sm);
  font-family: var(--font-mono, monospace);
  background: color-mix(in srgb, var(--success) 8%, transparent);
  border-radius: var(--radius-sm);
  padding: 2px var(--space-sm);
  overflow-wrap: anywhere;
}
.okf-pii__before {
  color: var(--danger);
}
.okf-pii__after {
  color: var(--success);
  text-decoration: none;
  font-weight: 600;
}
.okf-pii__after--empty {
  font-style: italic;
  font-weight: 400;
}
.okf-pii__arrow {
  margin: 0 var(--space-xs);
  color: var(--muted, inherit);
}
</style>
