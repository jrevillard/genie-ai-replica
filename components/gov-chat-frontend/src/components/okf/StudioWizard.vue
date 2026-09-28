<!--
  OkfStudioWizard.vue — 10-step wizard shell (Story 3-4).

  Steps (per okf-studio-ux-design-2026-08-13.md):
    0  Entry/metadata
    1  Choose workflow   (Crawl | Documents | Manual | Clone 4th card)
    2  Input (variant)
    3  Produce
    4  Label Onboard
    5  Curate
    6  Validate
    7  Auto-correct
    8  Review
    9  Publish

  Step-lock rule:
    locked = (draft?.studio_step ?? 0) <= i ? false : true
    every step AFTER the saved step is locked, every step UP TO AND INCLUDING
    is unlocked — back-nav non-destructive.

  Narrative cards (rule 8) mount via OkfNarrative pinned above each step body.
  Context rail (right) shows name + subject + trust_tier pill + stale badge +
  provenance source count + clone badge.

  This shell ships step bodies as small composable components; Step 5 (curator)
  and Step 6 (validation) are wired in Phase 6.
-->
<template>
  <div class="okf-wizard" role="region" :aria-label="translate('okf.wizard.label', 'OKF Studio wizard')">
    <aside class="okf-wizard__rail okf-wizard__rail--left" aria-label="Steps">
      <DsStepper
        :steps="stepConfig"
        :model-value="activeStep"
        :locked="lockedIndices"
        :allow-jump-back="true"
        orientation="vertical"
        size="md"
        @update:model-value="onStepClick"
      />
    </aside>

    <main class="okf-wizard__center">
      <OkfNarrative :kind="'step' + activeStep" />

      <section class="okf-wizard__step" :aria-label="stepLabel(activeStep)">
        <component
          :is="stepComponents[activeStep]"
          ref="activeStep"
          :key="activeStep"
          v-bind="stepProps"
          @advance="onAdvance"
          @back="onBack"
          @update="onDraftUpdate"
          @gate="onGate"
          @dashboard="$emit('dashboard')"
        />
      </section>

      <footer class="okf-wizard__footer">
        <DsButton variant="ghost" @click="$emit('reset')">
          {{ translate('okf.wizard.exit', 'Back to dashboard') }}
        </DsButton>
        <DsButton variant="secondary" :disabled="activeStep === 0" @click="onBack">
          {{ translate('okf.wizard.back', 'Back') }}
        </DsButton>
        <span class="okf-wizard__step-counter">{{ activeStep + 1 }} / 10</span>
        <DsButton variant="primary" :disabled="!gateOpen || advancing" @click="onAdvance">
          {{
            advancing
              ? translate('okf.wizard.working', 'Working…')
              : activeStep === 9
                ? translate('okf.wizard.finish', 'Open the Editor')
                : translate('okf.wizard.continue', 'Continue')
          }}
        </DsButton>
      </footer>
    </main>

    <aside class="okf-wizard__rail okf-wizard__rail--right" aria-label="Repository context">
      <div class="okf-wizard__context-card">
        <header class="okf-wizard__context-header">{{ translate('okf.wizard.context.title', 'Repository') }}</header>
        <p class="okf-wizard__context-name">
          {{ repoName || translate('okf.wizard.context.untitled', 'Untitled repository') }}
        </p>
        <p class="okf-wizard__context-domain">{{ repoDomain || '—' }}</p>

        <DsStatusTag :variant="statusVariant">{{ statusLabel }}</DsStatusTag>

        <p v-if="repoVersion" class="okf-wizard__context-meta">
          {{ translate('okf.wizard.context.version', 'Version') }}:
          <span>v{{ repoVersion }}</span>
        </p>

        <p class="okf-wizard__context-meta">
          {{ translate('okf.wizard.context.concepts', 'Concepts so far') }}:
          <span>{{ conceptCount }}</span>
        </p>

        <p class="okf-wizard__context-meta">
          {{ translate('okf.wizard.context.sources', 'Sources') }}:
          <span>{{ sourceCountLabel }}</span>
        </p>

        <p v-if="clonedFromLabel" class="okf-wizard__context-clone">
          <DsTag variant="info" :label="clonedFromLabel" />
        </p>
      </div>
    </aside>
  </div>
</template>

<script>
import { mapGetters } from 'vuex';
import translateMixin from '../../mixins/translateMixin';
import repoOkfService from '../../services/repoOkfService';
import DsStepper from '../ds/Stepper.vue';
import DsButton from '../ds/Button.vue';
import DsStatusTag from '../ds/StatusTag.vue';
import DsTag from '../ds/Tag.vue';
import OkfNarrative from './Narrative.vue';
import OkfStepEntry from './steps/Entry.vue';
import OkfStepChoose from './steps/Choose.vue';
import OkfStepInput from './steps/Input.vue';
import OkfStepProduce from './steps/Produce.vue';
import OkfStepLabel from './steps/LabelOnboard.vue';
import OkfStepCurate from './steps/Curate.vue';
import OkfStepValidate from './steps/Validate.vue';
import OkfStepAutocorrect from './steps/Autocorrect.vue';
import OkfStepReview from './steps/Review.vue';
import OkfStepPublish from './steps/Publish.vue';

const STEP_LABELS = [
  'Entry',
  'Choose workflow',
  'Input',
  'Produce',
  'Label onboard',
  'Curate',
  'Validate',
  'Auto-correct',
  'Review',
  'Finish'
];

export default {
  name: 'OkfStudioWizard',
  components: {
    DsStepper,
    DsButton,
    DsStatusTag,
    DsTag,
    OkfNarrative,
    OkfStepEntry,
    OkfStepChoose,
    OkfStepInput,
    OkfStepProduce,
    OkfStepLabel,
    OkfStepCurate,
    OkfStepValidate,
    OkfStepAutocorrect,
    OkfStepReview,
    OkfStepPublish
  },
  mixins: [translateMixin],
  props: {
    draft: { type: Object, default: null }
  },
  emits: ['reset', 'step-change', 'update-draft', 'finish', 'dashboard'],
  data() {
    return {
      activeStep: 0,
      // A2 gate contract: the ACTIVE step owns the Continue. A step that
      // emits no gate event (the not-yet-wired panels) defaults to open.
      gateOpen: true,
      advancing: false,
      stepConfig: STEP_LABELS.map((label, idx) => ({
        value: String(idx),
        label: `${idx + 1}. ${label}`
      }))
    };
  },
  computed: {
    ...mapGetters('okf', ['isExpert', 'repoById']),
    // A5 context rail: the REAL repo doc is the source of truth — never a
    // phantom draft shape. Falls back to the draft while the repo is not yet
    // created (Entry's create-on-advance).
    repo() {
      return (this.draft && this.draft.repo_id && this.repoById(this.draft.repo_id)) || null;
    },
    repoName() {
      return (this.repo && this.repo.name) || (this.draft && this.draft.name) || '';
    },
    repoDomain() {
      return (this.repo && this.repo.domain) || (this.draft && this.draft.domain) || '';
    },
    repoVersion() {
      return (this.repo && this.repo.version) || null;
    },
    conceptCount() {
      return (this.repo && this.repo.concept_count) || (this.draft && this.draft.concept_count) || 0;
    },
    sourceCountLabel() {
      const sources = (this.repo && this.repo.source_documents) || [];
      return sources.length ? `${sources.length}` : '0';
    },
    clonedFromLabel() {
      const cf = (this.repo && this.repo.cloned_from) || (this.draft && this.draft.cloned_from);
      if (!cf || !cf.repo_id) return null;
      return `Cloned from ${cf.name || cf.repo_id} · v${cf.version}`;
    },
    // REAL lifecycle state, not the step counter. Missing locale keys fall
    // back to the raw state string (honest over pretty — i18n pass later).
    statusVariant() {
      if (this.repo && this.repo.ingested_at) return 'success';
      if (this.repo && this.repo.lifecycle_state === 'retracted') return 'warning';
      if (this.repo && ['review', 'approve', 'publish'].includes(this.repo.lifecycle_state)) return 'pending';
      return 'info';
    },
    statusLabel() {
      if (!this.repo) return this.translate('okf.wizard.status.draft', 'in progress');
      if (this.repo.ingested_at) return this.translate('okf.wizard.status.published', 'published');
      const state = this.repo.lifecycle_state || 'draft';
      return this.translate(`okf.wizard.state.${state}`, state);
    },
    stepComponents() {
      return [
        OkfStepEntry,
        OkfStepChoose,
        OkfStepInput,
        OkfStepProduce,
        OkfStepLabel,
        OkfStepCurate,
        OkfStepValidate,
        OkfStepAutocorrect,
        OkfStepReview,
        OkfStepPublish
      ];
    },
    stepProps() {
      return { draft: this.draft, expert: this.isExpert };
    },
    lockedIndices() {
      const saved = this.draft?.studio_step || 0;
      const out = [];
      for (let i = saved + 1; i < 10; i++) out.push(i);
      return out;
    }
  },
  watch: {
    'draft.studio_step'(v) {
      if (typeof v === 'number' && v !== this.activeStep) {
        this.activeStep = Math.min(v, 9);
      }
    }
  },
  mounted() {
    if (this.draft && typeof this.draft.studio_step === 'number') {
      this.activeStep = Math.min(this.draft.studio_step, 9);
    }
    // NO source-based step jump here (max-review F14/G2): the old
    // clone/crawl/editor → Curate bump was written for EXTERNAL drafts,
    // which carry their landing step explicitly (crawler-created = 5,
    // editor-opened = 9, both seeded by StudioTab). With wizard-NATIVE
    // crawl/clone flows now setting the same sources at Choose, the bump
    // teleported every remount past Produce mid-conversion. The saved
    // studio_step alone decides the landing step.
  },
  methods: {
    stepLabel(i) {
      return `${i + 1}. ${STEP_LABELS[i]}`;
    },
    onStepClick(idx) {
      if (idx === this.activeStep) return;
      // F9: steps that never emit a gate (Validate, Auto-correct) would
      // inherit the PREVIOUS step's closed gate — a permanent dead Continue.
      // Optimistically open; a gate-emitting step re-emits on mount.
      this.gateOpen = true;
      this.activeStep = idx;
      this.$emit('step-change', idx);
      this.persistDraft();
    },
    // A2 + A3: advance consults the ACTIVE step — its beforeAdvance hook may
    // do async work (Entry's create) and refuse the advance (duplicate name,
    // missing input). The footer's disabled state is the step's own gate.
    activeStepVm() {
      return this.$refs.activeStep || null;
    },
    async onAdvance() {
      if (this.advancing) return;
      const step = this.activeStepVm();
      if (this.gateOpen === false) return;
      if (step && typeof step.beforeAdvance === 'function') {
        this.advancing = true;
        let ok;
        try {
          ok = (await step.beforeAdvance()) !== false;
        } catch {
          ok = false;
        }
        this.advancing = false;
        if (!ok) return;
      }
      if (this.activeStep < 9) {
        this.gateOpen = true; // F9: same rationale as onStepClick
        this.activeStep += 1;
        this.$emit('step-change', this.activeStep);
        this.persistDraft();
      } else {
        // Amendment A decision (David, 2026-09-27): the lifecycle ritual —
        // submit → approve → publish — lives OUTSIDE the wizard. Finishing
        // hands off to StudioTab, which opens the repo's Editor shell with
        // the Editor sub-tab active. The wizard never publishes.
        this.$emit('finish', { repo_id: this.draft && this.draft.repo_id });
      }
    },
    onBack() {
      if (this.activeStep === 0) return;
      this.activeStep -= 1;
      this.$emit('step-change', this.activeStep);
      this.persistDraft();
    },
    // A1 write-back: a step's selections flow UP to the draft's owner
    // (StudioTab applies them to its own data — the wizard never mutates a
    // prop) and persist immediately; re-entering a step re-seeds its local
    // state from the refreshed draft (the :key remount), so every step is
    // idempotent re-entrant.
    onDraftUpdate(patch) {
      if (!this.draft || !patch) return;
      const merged = { ...this.draft, ...patch };
      this.$emit('update-draft', patch);
      this.persistMerged(merged);
    },
    onGate(open) {
      this.gateOpen = open !== false;
    },
    persistMerged(merged) {
      const step = this.activeStep;
      this.$store.dispatch('okf/saveDraft', {
        repoId: merged.repo_id || 'pending',
        draft: {
          ...merged,
          studio_step: step,
          updated_at: Date.now()
        }
      });
      // A4 server resume: the cheap okf_repositories.studio_step pointer.
      // Best-effort + silent; skipped for frozen repos (R-C parity — the
      // backend 409s serving repos anyway). G4 (max-review): ONLY when the
      // step actually changed — every PATCH writes an audit row
      // ('Updated repository fields: studio_step'), and one-per-interaction
      // was drowning the Review step's own Action log.
      if (merged.repo_id && step !== this._lastPersistedStep) {
        const repo = this.repo;
        const frozen = repo && (repo.ingested_at || repo.lifecycle_state === 'publish');
        if (!frozen) {
          repoOkfService.saveStudioStep(merged.repo_id, step);
          this._lastPersistedStep = step;
        }
      }
    },
    persistDraft() {
      if (!this.draft) return;
      this.persistMerged({ ...this.draft });
    }
  }
};
</script>

<style scoped>
.okf-wizard {
  display: grid;
  grid-template-columns: 240px 1fr 280px;
  gap: var(--space-md);
  min-height: 600px;
  font-family: var(--font-body);
}
.okf-wizard__rail {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: var(--space-md);
}
.okf-wizard__center {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: var(--space-md);
}
.okf-wizard__step {
  flex: 1 1 auto;
  min-height: 320px;
}
.okf-wizard__footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-top: 1px solid var(--border);
  padding-top: var(--space-md);
}
.okf-wizard__step-counter {
  color: var(--muted);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
}
.okf-wizard__context-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}
.okf-wizard__context-header {
  font-size: var(--text-xs);
  text-transform: uppercase;
  color: var(--muted);
  letter-spacing: 0.04em;
}
.okf-wizard__context-name {
  margin: 0;
  font-size: var(--text-md);
  font-weight: 600;
}
.okf-wizard__context-domain {
  margin: 0;
  color: var(--muted);
  font-size: var(--text-sm);
}
.okf-wizard__context-meta {
  margin: 0;
  display: flex;
  gap: var(--space-xs);
  align-items: center;
  font-size: var(--text-sm);
  color: var(--muted);
}
.okf-wizard__context-stale {
  margin: 0;
}
.okf-wizard__context-clone {
  margin: 0;
}
</style>
