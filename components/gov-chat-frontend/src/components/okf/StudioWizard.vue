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
        <component :is="stepComponents[activeStep]" v-bind="stepProps" @advance="onAdvance" @back="onBack" />
      </section>

      <footer class="okf-wizard__footer">
        <DsButton variant="secondary" :disabled="activeStep === 0" @click="onBack">
          {{ translate('okf.wizard.back', 'Back') }}
        </DsButton>
        <span class="okf-wizard__step-counter">{{ activeStep + 1 }} / 10</span>
        <DsButton variant="primary" @click="onAdvance">
          {{
            activeStep === 9
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
          {{ draft?.name || translate('okf.wizard.context.untitled', 'Untitled repository') }}
        </p>
        <p class="okf-wizard__context-domain">{{ draft?.domain || '—' }}</p>

        <DsStatusTag :variant="statusVariant">{{ statusLabel }}</DsStatusTag>

        <p class="okf-wizard__context-meta">
          {{ translate('okf.wizard.context.trust', 'Trust') }}:
          <DsPill :variant="trustVariant">{{ trustLabel }}</DsPill>
        </p>

        <p v-if="isStale" class="okf-wizard__context-stale">
          <DsPill variant="warning">{{ translate('okf.wizard.context.stale', 'stale') }}</DsPill>
        </p>

        <p class="okf-wizard__context-meta">
          {{ translate('okf.wizard.context.sources', 'Sources') }}:
          <span>{{ sourceCountLabel }}</span>
        </p>

        <p v-if="clonedFromLabel" class="okf-wizard__context-clone">
          <DsTag variant="info" :label="clonedFromLabel" />
        </p>

        <p class="okf-wizard__context-meta">
          {{ translate('okf.wizard.context.concepts', 'Concepts so far') }}:
          <span>{{ draft?.concept_count || 0 }}</span>
        </p>
      </div>
    </aside>
  </div>
</template>

<script>
import { mapGetters } from 'vuex';
import translateMixin from '../../mixins/translateMixin';
import DsStepper from '../ds/Stepper.vue';
import DsButton from '../ds/Button.vue';
import DsStatusTag from '../ds/StatusTag.vue';
import DsPill from '../ds/Pill.vue';
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
    DsPill,
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
  emits: ['reset', 'step-change'],
  data() {
    return {
      activeStep: 0,
      stepConfig: STEP_LABELS.map((label, idx) => ({
        value: String(idx),
        label: `${idx + 1}. ${label}`
      }))
    };
  },
  computed: {
    ...mapGetters('okf', ['isExpert']),
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
    },
    statusVariant() {
      if (this.activeStep === 9 && this.draft?.published) return 'success';
      if (this.activeStep >= 8) return 'pending';
      return 'info';
    },
    statusLabel() {
      if (this.activeStep === 9 && this.draft?.published)
        return this.translate('okf.wizard.status.published', 'published');
      if (this.activeStep >= 8) return this.translate('okf.wizard.status.inReview', 'in review');
      return this.translate('okf.wizard.status.draft', 'in progress');
    },
    trustVariant() {
      const t = this.draft?.trust_tier;
      if (t === 'human-reviewed') return 'success';
      if (t === 'machine-confirmed') return 'accent';
      return 'neutral';
    },
    trustLabel() {
      const t = this.draft?.trust_tier || 'unverified';
      return this.translate(`okf.trust.tier.${t}`, t);
    },
    isStale() {
      const stale = this.draft?.lifecycle?.stale_after;
      if (!stale) return false;
      return Date.parse(stale) <= Date.now();
    },
    sourceCountLabel() {
      const src = this.draft?.provenance?.sources || [];
      const counts = src.reduce((acc, s) => {
        const k = s.type || 'other';
        acc[k] = (acc[k] || 0) + 1;
        return acc;
      }, {});
      const parts = [];
      if (counts.documentation) parts.push(`${counts.documentation} docs`);
      if (counts.web) parts.push(`${counts.web} web`);
      const total = src.length;
      const prefix = total > 0 ? `${total} sources` : 'no sources';
      return parts.length ? `${prefix} (${parts.join(', ')})` : prefix;
    },
    clonedFromLabel() {
      const cf = this.draft?.cloned_from;
      if (!cf || !cf.repo_id) return null;
      return `Cloned from ${cf.name || cf.repo_id} · v${cf.version}`;
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
    if (this.draft && (this.draft.source === 'clone' || this.draft.source === 'crawl')) {
      // Clone and crawler-sourced repos skip Produce and open at Step 5
      // (Curate) per UX design (3-4 Clone amendment, 3-7 #977 crawler fix).
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
    onAdvance() {
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
    persistDraft() {
      if (!this.draft) return;
      this.$store.dispatch('okf/saveDraft', {
        repoId: this.draft.repo_id || 'pending',
        draft: {
          ...this.draft,
          studio_step: this.activeStep,
          updated_at: Date.now()
        }
      });
    },
    publishRepo() {
      if (!this.draft || !this.draft.repo_id) return;
      this.$store
        .dispatch('okf/mintVersion', {
          repoId: this.draft.repo_id,
          body: { trigger: 'publish', source_ref: 'smoke://studio/wizard' },
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
