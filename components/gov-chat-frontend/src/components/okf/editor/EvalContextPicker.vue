<!--
  EvalContextPicker.vue — WHICH evaluation context a suite or benchmark is
  minted FOR (OKF Testing Lab, #2061 phase 4 / E-5).

  WHY THIS EXISTS (2026-11-24): the Lab's generate actions had no context
  affordance, so every suite was minted against the whole deployment — the
  numbers answered "does routing work here", never "does this group's scope
  hold". The evaluation-context engine (phase 1-3) was live and unreachable
  from the dialog; this is the control that reaches it.

  WHAT IT IS NOT: it does not decide anything. It names a context; the
  server resolves the carrier, mints the suite for it, and pairs the run
  with it. The empty choice is the OPEN context — the deployment's default
  posture — which is what the Lab did before contexts existed, and it stays
  the default so nothing changes silently.

  THE LABEL says what the operator is about to measure: the context's name,
  its VERSION and how many repositories it reaches. A name alone ("scope-a")
  says nothing about what the run will cover.
-->
<template>
  <div class="okf-evalctx-picker">
    <label class="okf-evalctx-picker__label" :for="inputId">
      {{ translate('okf.testingLab.contexts.pickerLabel', 'Evaluation context') }}
    </label>
    <DsSelect
      :id="inputId"
      :model-value="modelValue"
      size="sm"
      :disabled="disabled"
      :placeholder="translate('okf.testingLab.contexts.pickerNone', 'No context — the whole deployment')"
      @update:model-value="$emit('update:modelValue', $event)"
    >
      <option v-for="c in contexts" :key="c._key" :value="c._key">{{ label(c) }}</option>
    </DsSelect>
    <p v-if="error" class="okf-evalctx-picker__error" role="alert">{{ error }}</p>
  </div>
</template>

<script>
import DsSelect from '@/components/ds/Select.vue';
import evalContextSurfaceMixin from '@/mixins/evalContextSurfaceMixin';
import evalContextService from '@/services/evalContextService';

export default {
  name: 'EvalContextPicker',
  components: { DsSelect },
  mixins: [evalContextSurfaceMixin],
  props: {
    modelValue: {
      type: String,
      default: ''
    },
    disabled: {
      type: Boolean,
      default: false
    },
    inputId: {
      type: String,
      default: 'okf-evalctx-picker'
    }
  },
  emits: ['update:modelValue'],
  data() {
    return {
      contexts: [],
      error: ''
    };
  },
  async mounted() {
    await this.load();
  },
  methods: {
    async load() {
      this.error = '';
      try {
        this.contexts = await evalContextService.listContexts();
      } catch (err) {
        this.error = this.errorText(err, 'the contexts could not be read');
      }
    },

    /** "ministry-a readers — v2 · 13 repositories": the name, the version
     *  and the reach — the SAME derivation the binding badge uses, so the
     *  two surfaces cannot disagree. */
    label(c) {
      const reach = this.contextReach(c);
      return `${c.name} — v${reach.version} · ${reach.repos} ${this.translate('okf.testingLab.contexts.reposShort', 'repos')}`;
    }
  }
};
</script>

<style scoped>
.okf-evalctx-picker {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.okf-evalctx-picker__label {
  font-size: 0.78rem;
  font-weight: 600;
}

.okf-evalctx-picker__error {
  margin: 0;
  font-size: 0.75rem;
  color: var(--danger);
}
</style>
