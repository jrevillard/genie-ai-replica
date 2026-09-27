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
                ? translate('okf.wizard.publish', 'Publish repository')
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
  'Publish'
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
  emits: ['reset', 'step-change', 'update-draft'],
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
    if (
      this.draft &&
      (this.draft.source === 'clone' || this.draft.source === 'crawl' || this.draft.source === 'editor')
    ) {
      // Clone/crawler-sourced repos skip Produce and open at Step 5 (Curate)
      // per UX design (3-4 Clone amendment, 3-7 #977). 'editor'-sourced drafts
      // (Story #978 — a repo opened from the Editor shell) start at Curate
      // too, with all steps unlocked (studio_step 9 set by StudioTab).
      this.activeStep = Math.max(this.activeStep, 5);
    }
  },
  methods: {
    stepLabel(i) {
      return `${i + 1}. ${STEP_LABELS[i]}`;
    },
    onStepClick(idx) {
      if (idx === this.activeStep) return;
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
        this.activeStep += 1;
        this.$emit('step-change', this.activeStep);
        this.persistDraft();
      } else {
        this.publishRepo();
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
      // backend 409s serving repos anyway).
      if (merged.repo_id) {
        const repo = this.repo;
        const frozen = repo && (repo.ingested_at || repo.lifecycle_state === 'publish');
        if (!frozen) repoOkfService.saveStudioStep(merged.repo_id, step);
      }
    },
    persistDraft() {
      if (!this.draft) return;
      this.persistMerged({ ...this.draft });
    },
    publishRepo() {
      // Story #978 lifecycle (David, 2026-08-28): the wizard publishes through
      // the SAME transition as the editor/dashboard (mint + bundle zip export
      // + state flip) — equal features via one shared path. On success the
      // dashboard shows the repo in the Published lane with its version.
      if (!this.draft || !this.draft.repo_id) return;
      // WIZARD IDEMPOTENCY R-C (David, 2026-09-04): the final step offers
      // only transitions VALID for the current state — never a doomed
      // publish on a serving repo (409 REPO_READ_ONLY). Serving = view-only
      // no-op; published-not-serving advances with 'ingest'; a RETRACTED
      // repo re-enters the loop via 'submit' (its only legal exit — David,
      // 2026-09-11); everything else publishes.
      const repo = this.$store.getters['okf/repoById'](this.draft.repo_id);
      if (repo && repo.ingested_at) return; // serving — nothing to mutate
      const s = repo && repo.lifecycle_state;
      const action = s === 'publish' ? 'ingest' : s === 'retracted' ? 'submit' : 'publish';
      this.$store
        .dispatch('okf/lifecycleTransition', {
          repoId: this.draft.repo_id,
          action,
          actor: { sub: 'studio-wizard' }
        })
        .then((result) => {
          if (result && result.ok) {
            this.$emit('reset');
          }
        });
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
