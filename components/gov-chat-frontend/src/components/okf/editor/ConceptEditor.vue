<!--
  OkfConceptEditor.vue — Story #978 Studio editor center pane.

  Loads the selected concept's full meta row (frontmatter + body), composes it
  into markdown, and edits it in a DsOkfMarkdownEditor with a Source | Rendered
  toggle (Source default). Save is debounced (1.5s after the last keystroke);
  the Save button forces it. Emits 'saved' with the server result so the
  parent can refresh the row.
-->
<template>
  <div class="okf-ce">
    <div class="okf-ce__toolbar">
      <div class="okf-ce__view-toggle" role="tablist" :aria-label="translate('okf.editor.viewToggle', 'Editor view')">
        <DsButton :variant="view === 'source' ? 'primary' : 'secondary'" small @click="view = 'source'">
          {{ translate('okf.editor.view.source', 'Source') }}
        </DsButton>
        <!-- THREE real modes (David, 2026-09-06): the old Source|Rendered
             pair left the DsOkfMarkdownEditor's Split dead. -->
        <DsButton :variant="view === 'split' ? 'primary' : 'secondary'" small @click="view = 'split'">
          {{ translate('okf.md.split', 'Split') }}
        </DsButton>
        <DsButton :variant="view === 'rendered' ? 'primary' : 'secondary'" small @click="view = 'rendered'">
          {{ translate('okf.editor.view.rendered', 'Rendered') }}
        </DsButton>
      </div>

      <span class="okf-ce__path">{{ pathLabel }}</span>

      <span class="okf-ce__save-status" :class="{ 'okf-ce__save-status--dirty': dirty }">
        {{ saveStatusLabel }}
      </span>

      <DsButton variant="primary" small :disabled="readOnly || !dirty || saving" @click="saveNow">
        {{ translate('okf.editor.save', 'Save') }}
      </DsButton>
    </div>

    <p v-if="loadError" class="okf-ce__error">
      {{ loadError }}
      <DsButton small variant="secondary" @click="loadConcept(loadedConceptId || conceptId)">{{
        translate('common.retry', 'Retry')
      }}</DsButton>
    </p>
    <div v-else-if="!markdownLoaded" class="okf-ce__loading">
      <DsSpinner size="md" /> {{ translate('okf.editor.loadingConcept', 'Loading concept…') }}
    </div>
    <template v-else>
      <!-- FRONTMATTER BAR: display is the PRIMARY job (parsed fields at a
           glance); the per-field edit form is secondary behind Expand.
           Saves go through the {frontmatter} PATCH mode — the server merges
           onto the stored fm and the source pane recomposes via
           matter.stringify, so form and source never diverge. -->
      <div class="okf-ce__fm">
        <header class="okf-ce__fm-head">
          <span class="okf-ce__fm-term">
            {{ translate('okf.fm.label', 'Frontmatter') }}
            <DsInfoTip
              :text="
                translate(
                  'okf.glossary.frontmatter',
                  'The structured information at the top of each file — type, title, labels. The assistant uses it to know what each concept is about.'
                )
              "
              :label="translate('okf.fm.tipLabel', 'What is Frontmatter?')"
            />
          </span>
          <DsButton variant="secondary" small :disabled="readOnly" @click="fmOpen ? cancelFm() : openFm()">
            {{ fmOpen ? translate('common.close', 'Close') : translate('okf.fm.edit', 'Edit') }}
          </DsButton>
        </header>
        <dl v-if="!fmOpen" class="okf-ce__fm-rows">
          <div v-for="row in fmRows" :key="row.k" class="okf-ce__fm-row">
            <dt>{{ row.k }}</dt>
            <dd>{{ row.v }}</dd>
          </div>
          <div v-if="!fmRows.length" class="okf-ce__fm-row">
            <dd>{{ translate('okf.fm.empty', 'No frontmatter yet — Edit adds type, title and labels.') }}</dd>
          </div>
        </dl>
        <div v-else class="okf-ce__fm-form">
          <div class="okf-ce__fm-grid">
            <DsFormGroup :label="translate('okf.fm.type', 'Type')" input-id="okf-fm-type">
              <DsSelect id="okf-fm-type" v-model="fmDraft.type" size="sm">
                <option value="">{{ translate('okf.fm.noType', 'No type') }}</option>
                <option v-for="opt in fmTypeOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
              </DsSelect>
            </DsFormGroup>
            <DsFormGroup :label="translate('okf.fm.titleLabel', 'Title')" input-id="okf-fm-title">
              <DsInput id="okf-fm-title" v-model="fmDraft.title" size="sm" />
            </DsFormGroup>
            <DsFormGroup input-id="okf-fm-labels">
              <template #label>
                {{ translate('okf.fm.labelsLabel', 'Label (Knowledge Hierarchy)') }}
                <DsInfoTip
                  :text="
                    translate(
                      'okf.glossary.label',
                      'A category from the Knowledge Hierarchy that tells the assistant what kind of thing this concept is. Labels are how answers find the right content.'
                    )
                  "
                />
              </template>
              <DsSelect id="okf-fm-labels" v-model="fmDraft.labels" size="sm">
                <option value="">{{ translate('okf.fm.noLabel', 'No label') }}</option>
                <option v-for="opt in labelOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
              </DsSelect>
            </DsFormGroup>
            <DsFormGroup :label="translate('okf.fm.descriptionLabel', 'Description')" input-id="okf-fm-desc">
              <DsInput id="okf-fm-desc" v-model="fmDraft.description" size="sm" />
            </DsFormGroup>
          </div>
          <!-- D-F (David, 2026-09-07): ALL of the frontmatter is editable —
               generic typed rows for every non-curated key, add/remove
               freely. ONE save path: the {frontmatter} PATCH (server merge);
               removals send null per RFC 7386 (gated until 65's
               null-deletes contract lands). -->
          <p class="okf-ce__fm-fullhint">
            {{ translate('okf.fm.fullHint', 'Every frontmatter field is editable. Add or remove keys freely.') }}
          </p>
          <div v-for="row in fmDraft.extras" :key="row.id" class="okf-ce__fm-extra">
            <DsInput
              v-model="row.key"
              size="sm"
              class="okf-ce__fm-extra-key"
              :disabled="!row.isNew"
              :placeholder="translate('okf.fm.keyPh', 'field name')"
              :aria-label="translate('okf.fm.keyPh', 'field name')"
            />
            <DsSelect
              v-model="row.kind"
              size="sm"
              class="okf-ce__fm-extra-kind"
              :aria-label="translate('okf.fm.kindLabel', 'Value type')"
            >
              <option v-for="k in fmKinds" :key="k" :value="k">{{ translate('okf.fm.kind.' + k, k) }}</option>
            </DsSelect>
            <input
              v-if="row.kind === 'boolean'"
              v-model="row.value"
              type="checkbox"
              class="okf-ce__fm-extra-check"
              :aria-label="row.key || 'value'"
            />
            <DsInput
              v-else-if="row.kind === 'json'"
              v-model="row.value"
              type="textarea"
              :rows="3"
              size="sm"
              class="okf-ce__fm-extra-value okf-ce__fm-extra-value--json"
              placeholder="{ }"
            />
            <DsInput
              v-else
              v-model="row.value"
              size="sm"
              class="okf-ce__fm-extra-value"
              :placeholder="row.kind === 'array' ? translate('okf.fm.arrayPh', 'comma-separated values') : ''"
            />
            <DsButton
              variant="ghost"
              small
              :aria-label="translate('okf.fm.removeKey', 'Remove field')"
              @click="removeExtra(row)"
            >
              ✕
            </DsButton>
          </div>
          <p v-if="fmExtraError" class="okf-ce__fm-error">{{ fmExtraError }}</p>
          <DsButton variant="secondary" small @click="addExtra">
            {{ translate('okf.fm.addKey', 'Add field') }}
          </DsButton>
          <p v-if="fmError" class="okf-ce__fm-error">{{ fmError }}</p>
          <p v-if="fmSaved" class="okf-ce__fm-saved">{{ translate('okf.fm.saved', 'Frontmatter saved') }}</p>
          <div class="okf-ce__fm-actions">
            <DsButton variant="primary" small :disabled="fmBusy || readOnly" @click="saveFm">
              {{ translate('okf.fm.save', 'Save frontmatter') }}
            </DsButton>
          </div>
        </div>
      </div>
      <OkfPiiOccurrences
        v-if="piiVisible"
        ref="piiPanel"
        :repo-id="repoId"
        :concept-id="loadedConceptId || conceptId"
        :revision="piiRevision"
        :read-only="readOnly"
        :before-apply="flushForPii"
        :initial-state="piiInitial"
        class="okf-ce__pii"
        @applied="onPiiApplied"
        @scanned="onPiiScanned"
        @locate="onPiiLocate"
      />
      <DsOkfMarkdownEditor
        ref="mdEditor"
        :value="markdown"
        :mode="view === 'rendered' ? 'preview' : view"
        :readonly="view === 'rendered' || readOnly"
        :enable-frontmatter="false"
        :aria-label="conceptTitle"
        @update:mode="view = $event"
        @update:value="onEdit"
      />
    </template>
  </div>
</template>

<script>
import translateMixin from '../../../mixins/translateMixin';
import DsButton from '../../ds/Button.vue';
import DsSpinner from '../../ds/Spinner.vue';
import DsOkfMarkdownEditor from '../../ds/OkfMarkdownEditor.vue';
import DsInfoTip from '../../ds/InfoTip.vue';
import DsSelect from '../../ds/Select.vue';
import DsInput from '../../ds/Input.vue';
import DsFormGroup from '../../ds/FormGroup.vue';
import conceptService from '../../../services/conceptService';
import OkfPiiOccurrences from './PiiOccurrences.vue';

const AUTOSAVE_DEBOUNCE_MS = 1500;
const FM_TYPE_OPTIONS = ['topic', 'entity', 'process', 'event', 'source'];
// D-F: the generic typed rows. 'json' covers nested shapes (objects,
// arrays-of-objects) via a JSON textarea.
const FM_KINDS = ['string', 'number', 'boolean', 'array', 'json'];
// RFC 7386 null-deletes (coordinator, 2026-09-07): the {frontmatter} PATCH
// removes a key when the patch value is null — server contract landed in
// 273c306a9; LIVE as of the combined rebuild that serves this build.
const FM_NULL_DELETE_LIVE = true;

export default {
  name: 'OkfConceptEditor',
  components: {
    DsButton,
    DsSpinner,
    DsOkfMarkdownEditor,
    DsInfoTip,
    DsSelect,
    DsInput,
    DsFormGroup,
    OkfPiiOccurrences
  },
  mixins: [translateMixin],
  props: {
    repoId: { type: String, default: null },
    conceptId: { type: String, default: null },
    // READ ONLY (serving repo): the steward must retract before editing.
    readOnly: { type: Boolean, default: false },
    // Bounded Knowledge-Hierarchy label options (services under the repo's
    // Subject Area) — threaded from RepoEditor for the fm-bar labels field.
    labelOptions: { type: Array, default: () => [] }
  },
  emits: ['saved'],
  data() {
    return {
      view: 'source', // Source default per the UX design
      markdown: '',
      markdownLoaded: false,
      savedMarkdown: '',
      // The conceptId the current markdown was LOADED for. Saves always
      // target this id — the conceptId watcher fires AFTER props have been
      // updated, so using the prop there would save the OLD markdown under
      // the NEW concept's id (cross-concept clobber).
      loadedConceptId: null,
      // The frontmatter snapshot as LOADED (labels write-through, 2026-09-05).
      // Saves compare the edited markdown's fm against it: unchanged →
      // body-only PATCH (server keeps the stored fm), so a label written
      // from the rail/tree mid-edit is never clobbered by the autosave.
      loadedFm: {},
      loadError: '',
      saving: false,
      lastSavedAt: null,
      saveTimer: null,
      // PII REVIEW (David, 2026-09-09): the loaded row's flag + a revision
      // counter the occurrences panel watches (bumped on every successful
      // save — the save already re-scanned server-side).
      piiState: null,
      piiRevision: 0,
      // The loaded row's persisted remediation ledger — keeps the panel
      // pinned for ALREADY-PROCESSED files (their green list must show on
      // revisit even though pii_state is now clean; David, 2026-09-09).
      piiResolutions: [],
      // Per-concept PII findings cache: revisiting a recently-scanned file
      // renders instantly instead of re-queuing a live Presidio scan.
      piiCache: {},
      // Stays true once a concept is flagged or has a processed history —
      // the panel keeps showing the green list after the state clears.
      piiPanelPinned: false,
      saveError: false,
      // FRONTMATTER BAR (David, 2026-09-06): display is the PRIMARY job —
      // the collapsed bar shows the parsed fields at a glance; the per-field
      // edit form is secondary behind Expand.
      fmOpen: false,
      fmBusy: false,
      fmError: '',
      fmSaved: false,
      // D-F: full frontmatter editing — curated fields + generic typed rows
      // for every other key (add/remove freely; one save path).
      fmExtraError: '',
      fmExtraSeq: 0,
      fmDraft: { type: '', title: '', labels: '', description: '', extras: [] }
    };
  },
  computed: {
    dirty() {
      return this.markdown !== this.savedMarkdown;
    },
    // PII REVIEW: the occurrences panel mounts for flagged (or scan-error)
    // concepts — a clean concept never pays the Presidio inspection cost.
    // PINNED (remediation, 2026-09-09): once flagged, it stays mounted for
    // the session so the green processed list remains visible after a fix.
    piiVisible() {
      return this.piiPanelPinned;
    },
    // Pre-warmed panel state for the CURRENT concept (2026-09-09 lockup fix):
    // clean files adopt instantly (no scan at all); flagged files adopt from
    // the cache when a scan already ran for this content. Null → live scan.
    piiInitial() {
      const key = this.loadedConceptId;
      if (!key) return null;
      if (this.piiState === 'clean') {
        return { key, state: 'clean', occurrences: [], resolutions: this.piiResolutions };
      }
      const cached = this.piiCache[key];
      if (cached && cached.pii_state === this.piiState && Array.isArray(cached.occurrences)) {
        return { key, state: cached.pii_state, occurrences: cached.occurrences, resolutions: cached.resolutions };
      }
      return null;
    },
    conceptTitle() {
      return this.conceptId || '';
    },
    pathLabel() {
      return this.conceptId ? `concepts/${this.conceptId}.md` : '';
    },
    saveStatusLabel() {
      if (this.saving) return this.translate('okf.editor.saving', 'Saving…');
      if (this.saveError) return this.translate('okf.editor.saveFailed', 'Save failed — retry');
      if (this.dirty) return this.translate('okf.editor.unsaved', 'Unsaved changes');
      if (this.lastSavedAt) return this.translate('okf.editor.saved', 'Saved');
      return '';
    },
    parsedFm() {
      const parsed = this.parseMarkdown(this.markdown);
      return (parsed && parsed.data) || {};
    },
    // Collapsed bar rows — whatever the concept actually carries, in a
    // stable order, rendered as the RAW field names for at-a-glance
    // fidelity with the file itself.
    fmRows() {
      const fm = this.parsedFm || {};
      const rows = [];
      const show = (k, v) => {
        if (v === undefined || v === null || v === '') return;
        rows.push({ k, v: Array.isArray(v) ? v.join(', ') : String(v) });
      };
      show('type', fm.type);
      show('title', fm.title);
      show('labels', fm.labels);
      show('description', fm.description);
      show('tags', fm.tags);
      if (Array.isArray(fm.sources)) show('sources', `${fm.sources.length} source(s)`);
      for (const k of Object.keys(fm)) {
        if (!['type', 'title', 'labels', 'description', 'tags', 'sources'].includes(k)) show(k, fm[k]);
      }
      return rows;
    },
    fmTypeOptions() {
      return FM_TYPE_OPTIONS.map((t) => ({ value: t, label: t }));
    },
    // expose the kind list to the template (module constants are invisible
    // to render scope)
    fmKinds() {
      return FM_KINDS;
    }
  },
  watch: {
    conceptId: {
      immediate: true,
      handler(next, prev) {
        if (next === prev) return;
        this.flushPendingSave();
        this.loadConcept(next);
      }
    }
  },
  beforeUnmount() {
    this.flushPendingSave();
    if (this.saveTimer) clearTimeout(this.saveTimer);
  },
  methods: {
    async loadConcept(conceptId) {
      // STALE-RESPONSE GUARD (2026-09-09 lockup fix): rapid file clicks fire
      // overlapping fetches — a slow OLD response must never win.
      this._loadSeq = (this._loadSeq || 0) + 1;
      const seq = this._loadSeq;
      this.markdownLoaded = false;
      this.loadError = '';
      this.saveError = false;
      this.loadedConceptId = null;
      if (!conceptId || !this.repoId) {
        this.markdown = '';
        this.savedMarkdown = '';
        this.loadedFm = {};
        this.piiState = null;
        this.piiResolutions = [];
        this.piiPanelPinned = false;
        return;
      }
      const result = await this.$store.dispatch('okf/getConcept', { repoId: this.repoId, conceptId });
      if (seq !== this._loadSeq) return; // superseded by a newer selection
      if (!result.ok || !result.concept) {
        this.loadError = this.translate('okf.editor.loadFailed', 'Could not load this concept.');
        return;
      }
      const row = result.concept;
      this.piiState = row.pii_state || null;
      // The persisted remediation ledger rides the meta row — a PROCESSED
      // file (pii_state now clean) must still show its green history.
      this.piiResolutions = Array.isArray(row.pii_resolutions) ? row.pii_resolutions : [];
      // PII REVIEW (David, 2026-09-09): the panel mounts for flagged concepts
      // AND stays mounted for processed ones (the green before/after list).
      this.piiPanelPinned = this.piiState === 'hit' || this.piiState === 'error' || this.piiResolutions.length > 0;
      // Compose editable markdown: frontmatter (may be empty) + body.
      const fm = row.frontmatter || {};
      const body = row.body || '';
      let md;
      if (Object.keys(fm).length > 0) {
        md = this.stringifyMarkdown(body, fm);
      } else {
        md = body;
      }
      this.loadedFm = JSON.parse(JSON.stringify(fm)); // detach from the row
      this.markdown = md;
      this.savedMarkdown = md;
      this.loadedConceptId = conceptId;
      this.markdownLoaded = true;
    },
    stringifyMarkdown(body, frontmatter) {
      // gray-matter round-trip — same serializer the PATCH endpoint parses
      // with (parser-service), so no fidelity loss.
      const matter = require('gray-matter');
      return matter.stringify(body || '', frontmatter || {});
    },
    onEdit(value) {
      this.markdown = value;
      this.saveError = false; // editing clears a failed save — it will retry
      if (this.saveTimer) clearTimeout(this.saveTimer);
      this.saveTimer = setTimeout(() => this.saveNow(), AUTOSAVE_DEBOUNCE_MS);
    },
    flushPendingSave() {
      if (this.saveTimer) {
        clearTimeout(this.saveTimer);
        this.saveTimer = null;
      }
      if (this.dirty && !this.saving) this.saveNow();
    },
    async saveNow() {
      if (this.saveTimer) {
        clearTimeout(this.saveTimer);
        this.saveTimer = null;
      }
      // Save against the LOADED concept id — never the (already-updated) prop.
      const conceptId = this.loadedConceptId;
      const savedText = this.markdown;
      if (!this.dirty || this.saving || !conceptId || !this.repoId) return;
      this.saving = true;
      this.saveError = false;
      try {
        // Labels write-through (2026-09-05): when the edited frontmatter is
        // unchanged from what was loaded, save BODY-ONLY — the server keeps
        // the stored fm, so a label written from the rail/tree while the
        // steward was typing is not erased by a stale fm snapshot. An fm
        // edit in the textarea still sends full markdown (it owns fm).
        let payload = { repoId: this.repoId, conceptId, markdown: this.markdown };
        const parsed = this.parseMarkdown(this.markdown);
        if (parsed && this.fmEqual(parsed.data || {}, this.loadedFm)) {
          payload = { repoId: this.repoId, conceptId, body: parsed.content };
        }
        const result = await this.$store.dispatch('okf/patchConcept', payload);
        if (result && result.ok) {
          // STALE-SAVE GUARD: the user may have switched concepts while the
          // save was in flight — never stamp the OLD text onto the NEW one.
          if (this.loadedConceptId === conceptId) {
            this.savedMarkdown = savedText;
            this.lastSavedAt = Date.now();
            // PII REVIEW: the save re-scanned server-side and the response
            // CARRIES the fresh occurrences — adopt directly (no second
            // pii-inspect round-trip; that redundancy saturated the scanner).
            if (result.pii_state) {
              this.piiState = result.pii_state;
              this.updatePiiCache(conceptId, {
                pii_state: result.pii_state,
                occurrences: Array.isArray(result.pii_occurrences) ? result.pii_occurrences : []
              });
              if (this.$refs.piiPanel) {
                this.$refs.piiPanel.adopt({ occurrences: result.pii_occurrences || [] });
              } else {
                this.piiRevision += 1; // panel not mounted — fallback
              }
            }
          }
          this.$emit('saved', { conceptId, result });
        } else {
          this.saveError = true;
        }
      } catch {
        // Timeout/network failure — surface it; the dirty state stays so the
        // user can retry (the old silent failure re-armed autosave forever).
        this.saveError = true;
      } finally {
        this.saving = false;
      }
    },
    // ── PII CACHE helpers (2026-09-09 lockup fix) ──────────────────────────
    updatePiiCache(conceptId, patch) {
      if (!conceptId || !patch) return;
      const cur = this.piiCache[conceptId] || {};
      const next = { ...this.piiCache, [conceptId]: { ...cur, ...patch } };
      const ids = Object.keys(next);
      if (ids.length > 40) delete next[ids[0]]; // bounded — oldest drops
      this.piiCache = next;
    },
    onPiiScanned(e) {
      const id = this.loadedConceptId;
      if (!id || !e) return;
      const state = e.state === 'error' ? 'error' : e.total > 0 ? 'hit' : 'clean';
      this.updatePiiCache(id, { pii_state: state, occurrences: e.occurrences || [], resolutions: e.resolutions || [] });
      if (Array.isArray(e.resolutions) && e.resolutions.length) this.piiResolutions = e.resolutions;
    },
    // ── PII REMEDIATION (David, 2026-09-09) ─────────────────────────────────
    // The panel applies fixes server-side; before each action we flush a
    // pending save so the server splices the freshest saved content, and
    // after it we recompose the editor text from the updated document — the
    // fix is VISIBLE in the editor pane immediately.
    async flushForPii() {
      if (this.dirty) await this.saveNow();
    },
    onPiiApplied(out) {
      if (!out || typeof out !== 'object') return;
      if (out.frontmatter !== undefined && out.body !== undefined) {
        const fm = out.frontmatter || {};
        const md = Object.keys(fm).length > 0 ? this.stringifyMarkdown(out.body || '', fm) : String(out.body || '');
        this.markdown = md;
        this.savedMarkdown = md; // clean — the server already persisted it
        this.loadedFm = JSON.parse(JSON.stringify(fm));
      }
      if (out.pii_state) this.piiState = out.pii_state;
      if (Array.isArray(out.resolutions)) this.piiResolutions = out.resolutions;
      this.updatePiiCache(this.loadedConceptId, {
        pii_state: out.pii_state,
        occurrences: Array.isArray(out.occurrences) ? out.occurrences : [],
        resolutions: out.resolutions || []
      });
      // Pinned stays true once set (loadConcept) — a fully-processed file
      // keeps the panel mounted so the green before/after list stays visible.
      this.$emit('saved', { conceptId: this.loadedConceptId, result: out });
    },
    // ── PII LOCATE (David, 2026-09-09, issue 3): click an occurrence's
    // excerpt and the editor shows the exact text — preview → highlight +
    // scroll; source/split → textarea selection. Frontmatter values are not
    // rendered in the preview, so those jumps land in the source pane.
    onPiiLocate(o) {
      if (!o || !this.$refs.mdEditor) return;
      const md = this.$refs.mdEditor;
      const ta = md.$refs && md.$refs.textarea;
      const inFm = o.where === 'frontmatter';
      if (inFm && this.view === 'rendered') this.view = 'source';
      this.$nextTick(() => {
        if (!inFm && (this.view === 'rendered' || this.view === 'split')) {
          this.highlightInPreview(md, o);
        }
        if (ta && (this.view === 'source' || this.view === 'split' || inFm)) {
          this.selectInTextarea(ta, o);
        }
      });
    },
    selectInTextarea(ta, o) {
      const value = ta.value || '';
      const hit = (o.excerpt && o.excerpt.hit) || '';
      if (!hit) return;
      let a = -1;
      if (o.where === 'body') {
        // Body offsets index the content AFTER the frontmatter prefix.
        const prefix = this.stringifyMarkdown('', this.loadedFm || {});
        const off = this.markdown.startsWith(prefix) ? prefix.length : 0;
        a = off + o.start;
      }
      // Verify the text is still exactly there; fall back to a text search.
      if (a < 0 || value.slice(a, a + hit.length) !== hit) a = value.indexOf(hit);
      if (a < 0) return;
      const b = a + hit.length;
      ta.focus();
      ta.setSelectionRange(a, b);
      const cs = getComputedStyle(ta);
      const lineH = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.5 || 20;
      const line = value.slice(0, a).split('\n').length - 1;
      ta.scrollTop = Math.max(0, line * lineH - ta.clientHeight / 2);
    },
    highlightInPreview(md, o) {
      const root = md.$el;
      const container = root && root.querySelector ? root.querySelector('.ds-okf-md__preview') : null;
      if (!container) return;
      // Clear a previous flash (unwrap the span, merge the text back).
      container.querySelectorAll('.okf-pii-flash').forEach((n) => {
        const parent = n.parentNode;
        if (!parent) return;
        while (n.firstChild) parent.insertBefore(n.firstChild, n);
        parent.removeChild(n);
        parent.normalize();
      });
      const hit = (o.excerpt && o.excerpt.hit) || '';
      if (!hit) return;
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const idx = node.data.indexOf(hit);
        if (idx >= 0) {
          const range = document.createRange();
          range.setStart(node, idx);
          range.setEnd(node, idx + hit.length);
          const span = document.createElement('span');
          span.className = 'okf-pii-flash';
          try {
            range.surroundContents(span);
          } catch {
            return; // match spans styled nodes — skip rather than corrupt
          }
          span.style.background = 'var(--warning, #f59e0b)';
          span.style.borderRadius = '3px';
          span.style.color = '#111';
          span.scrollIntoView({ block: 'center', behavior: 'smooth' });
          return;
        }
      }
    },
    // ── FRONTMATTER BAR (display primary, edit secondary) ──────────────────
    // D-F helpers: the generic typed rows. Edit representation per kind:
    // number → text, boolean → checkbox state, array → comma-separated,
    // json → raw JSON text; anything else parses as json.
    kindFor(v) {
      if (typeof v === 'number') return 'number';
      if (typeof v === 'boolean') return 'boolean';
      if (Array.isArray(v)) return v.every((x) => typeof x === 'string' || typeof x === 'number') ? 'array' : 'json';
      if (typeof v === 'string') return 'string';
      return 'json';
    },
    toEditValue(kind, v) {
      if (kind === 'number') return v === undefined || v === null ? '' : String(v);
      if (kind === 'boolean') return !!v;
      if (kind === 'array') return Array.isArray(v) ? v.join(', ') : '';
      if (kind === 'json') return JSON.stringify(v, null, 2);
      return v === undefined || v === null ? '' : String(v);
    },
    // Parse a row's edit value back to frontmatter shape; { ok, value, error }.
    parseExtraValue(row) {
      if (row.kind === 'boolean') return { ok: true, value: !!row.value };
      const text = typeof row.value === 'string' ? row.value : String(row.value ?? '');
      if (row.kind === 'number') {
        if (text.trim() === '' || isNaN(Number(text))) return { ok: false, error: 'okf.fm.errNumber' };
        return { ok: true, value: Number(text) };
      }
      if (row.kind === 'array') {
        return {
          ok: true,
          value: text
            .split(',')
            .map((s) => s.trim())
            .filter((s) => s !== '')
        };
      }
      if (row.kind === 'json') {
        try {
          return { ok: true, value: JSON.parse(text === '' ? 'null' : text) };
        } catch {
          return { ok: false, error: 'okf.fm.errJson' };
        }
      }
      return { ok: true, value: text };
    },
    openFm() {
      const fm = this.parsedFm || {};
      this.fmDraft = {
        type: fm.type || '',
        title: fm.title || '',
        labels: (Array.isArray(fm.labels) && fm.labels[0]) || '',
        description: fm.description || '',
        // D-F: every non-curated key becomes a typed, editable row.
        extras: Object.keys(fm)
          .filter((k) => !['type', 'title', 'labels', 'description'].includes(k))
          .map((k) => {
            const kind = this.kindFor(fm[k]);
            return {
              id: ++this.fmExtraSeq,
              key: k,
              isNew: false,
              kind,
              value: this.toEditValue(kind, fm[k])
            };
          })
      };
      this.fmOpen = true;
      this.fmError = '';
      this.fmExtraError = '';
      this.fmSaved = false;
    },
    addExtra() {
      this.fmDraft.extras.push({ id: ++this.fmExtraSeq, key: '', isNew: true, kind: 'string', value: '' });
    },
    removeExtra(row) {
      this.fmDraft.extras = this.fmDraft.extras.filter((r) => r.id !== row.id);
    },
    cancelFm() {
      this.fmOpen = false;
      this.fmError = '';
      this.fmExtraError = '';
    },
    async saveFm() {
      if (this.fmBusy || !this.loadedConceptId || !this.repoId) return;
      this.fmBusy = true;
      this.fmError = '';
      this.fmExtraError = '';
      this.fmSaved = false;
      try {
        const patch = {};
        if (this.fmDraft.type) patch.type = this.fmDraft.type;
        if (this.fmDraft.title) patch.title = this.fmDraft.title;
        patch.labels = this.fmDraft.labels ? [this.fmDraft.labels] : [];
        if (this.fmDraft.description) patch.description = this.fmDraft.description;
        // D-F: validate + parse the generic rows into the SAME patch.
        const seen = new Set();
        for (const row of this.fmDraft.extras) {
          const key = (row.key || '').trim();
          if (!key) {
            this.fmExtraError = this.translate('okf.fm.errKeyRequired', 'Every field needs a name.');
            return;
          }
          if (seen.has(key)) {
            this.fmExtraError = this.translate('okf.fm.errKeyDuplicate', `Field name "${key}" is used twice.`);
            return;
          }
          if (['type', 'title', 'labels', 'description'].includes(key)) {
            this.fmExtraError = this.translate('okf.fm.errKeyCurated', `"${key}" is a reserved field name.`);
            return;
          }
          seen.add(key);
          const parsedRow = this.parseExtraValue(row);
          if (!parsedRow.ok) {
            this.fmExtraError = `${key}: ${this.translate(parsedRow.error, 'Invalid value')}`;
            return;
          }
          patch[key] = parsedRow.value;
        }
        // Removals (RFC 7386): a null patch value deletes the key server-side.
        const fm = this.parsedFm || {};
        const removals = Object.keys(fm)
          .filter((k) => !['type', 'title', 'labels', 'description'].includes(k))
          .filter((k) => !(k in patch));
        if (removals.length) {
          if (!FM_NULL_DELETE_LIVE) {
            this.fmExtraError = this.translate(
              'okf.fm.errRemovalPending',
              'Removing fields needs the merge-delete server contract (landing shortly).'
            );
            return;
          }
          for (const k of removals) patch[k] = null;
        }
        // {frontmatter} PATCH mode: the server merges onto the STORED fm —
        // no snapshot round-trip, no clobber of concurrent edits.
        await conceptService.update(this.repoId, this.loadedConceptId, patch);
        // Mirror the merge locally so the source pane never diverges (null
        // keys drop out of the mirror too).
        const parsed = this.parseMarkdown(this.markdown);
        const body = parsed ? parsed.content : this.markdown;
        const mergedFm = { ...(parsed ? parsed.data : {}), ...patch };
        for (const k of Object.keys(mergedFm)) {
          if (mergedFm[k] === null) delete mergedFm[k];
        }
        const next = this.stringifyMarkdown(body, mergedFm);
        this.loadedFm = JSON.parse(JSON.stringify(mergedFm)); // the new snapshot
        this.onEdit(next);
        this.savedMarkdown = next; // fm edits don't dirty the body editor
        this.fmSaved = true;
        this.$emit('saved', { conceptId: this.loadedConceptId, result: { ok: true } });
      } catch (err) {
        // The 400 VALIDATION_ERROR details array IS the validation surface.
        const details = err && err.data && Array.isArray(err.data.details) ? err.data.details : null;
        this.fmError = details
          ? details.join(' · ')
          : err && err.message
            ? err.message
            : this.translate('okf.fm.saveFailed', 'Frontmatter save failed');
      } finally {
        this.fmBusy = false;
      }
    },
    parseMarkdown(md) {
      try {
        return require('gray-matter')(md || '');
      } catch {
        return null; // malformed fm — fall back to the full-markdown PATCH
      }
    },
    fmEqual(a, b) {
      const ka = Object.keys(a);
      const kb = Object.keys(b);
      if (ka.length !== kb.length) return false;
      return ka.every((k) => JSON.stringify(a[k]) === JSON.stringify(b[k]));
    }
  }
};
</script>

<style scoped>
.okf-ce {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  min-width: 0;
  min-height: 0;
}
.okf-ce__toolbar {
  display: flex;
  align-items: center;
  gap: var(--space-md);
}
.okf-ce__view-toggle {
  display: inline-flex;
  gap: var(--space-xs);
}
.okf-ce__path {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.okf-ce__save-status {
  margin-left: auto;
  font-size: var(--text-xs);
  color: var(--muted);
  white-space: nowrap;
}
.okf-ce__save-status--dirty {
  color: var(--warning);
}
.okf-ce__fm {
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: var(--space-sm) var(--space-md);
  margin-bottom: var(--space-md);
  background: var(--bg);
}
.okf-ce__fm-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
}
.okf-ce__fm-term {
  display: inline-flex;
  align-items: center;
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--fg);
}
.okf-ce__fm-rows {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-xs) var(--space-lg);
  margin: var(--space-sm) 0 0;
}
.okf-ce__fm-row {
  display: flex;
  align-items: baseline;
  gap: var(--space-xs);
}
.okf-ce__fm-row dt {
  color: var(--muted);
  font-size: var(--text-xs);
}
.okf-ce__fm-row dd {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--fg);
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.okf-ce__fm-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-sm) var(--space-md);
}
.okf-ce__fm-error {
  margin: var(--space-sm) 0 0;
  color: var(--danger);
  font-size: var(--text-sm);
}
.okf-ce__fm-saved {
  margin: var(--space-sm) 0 0;
  color: var(--success);
  font-size: var(--text-sm);
}
.okf-ce__fm-actions {
  margin-top: var(--space-sm);
}
.okf-ce__fm-fullhint {
  margin: var(--space-sm) 0 0;
  color: var(--muted);
  font-size: var(--text-xs);
}
.okf-ce__fm-extra {
  display: flex;
  align-items: flex-start;
  gap: var(--space-xs);
  margin-top: var(--space-sm);
}
.okf-ce__fm-extra-key {
  flex: 0 0 160px;
  font-family: var(--font-mono);
}
.okf-ce__fm-extra-kind {
  flex: 0 0 120px;
}
.okf-ce__fm-extra-check {
  margin-top: var(--space-sm);
}
.okf-ce__fm-extra-value {
  flex: 1 1 auto;
  min-width: 0;
}
.okf-ce__fm-extra-value--json {
  font-family: var(--font-mono);
}
.okf-ce__loading,
.okf-ce__error {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  color: var(--muted);
  padding: var(--space-lg) 0;
  margin: 0;
}
.okf-ce__error {
  color: var(--danger);
}
</style>
