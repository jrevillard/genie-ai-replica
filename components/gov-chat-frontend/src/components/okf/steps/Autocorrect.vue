<!-- Step 7: Auto-correct — apply available fixes (Story 10.2 backend). -->
<template>
  <div class="okf-step">
    <h3 class="okf-step__title">{{ translate('okf.steps.autocorrect.title', 'Auto-fix') }}</h3>
    <p class="okf-step__hint">{{ translate('okf.steps.autocorrect.hint', 'Some warnings can be auto-fixed. Apply the fixes you agree with, then go back to the curator to review.') }}</p>
    <p class="okf-step__placeholder">{{ translate('okf.steps.autocorrect.placeholder', 'Auto-correct service lands in Story 10.2; this step is a placeholder for now.') }}</p>
  </div>
</template>

<script>
export default {
  name: 'OkfStepAutocorrect',
  props: { draft: { type: Object, default: null }, expert: { type: Boolean, default: false } }
};
</script>

<style scoped>
.okf-step { display: flex; flex-direction: column; gap: var(--space-md); }
.okf-step__title { margin: 0; font-size: var(--text-md); font-weight: 600; }
.okf-step__hint { margin: 0; color: var(--muted); font-size: var(--text-sm); }
.okf-step__placeholder {
  margin: 0;
  padding: var(--space-md);
  background: var(--bg);
  border: 1px dashed var(--border);
  border-radius: var(--radius-sm);
  color: var(--muted);
  font-size: var(--text-sm);
}
</style>
