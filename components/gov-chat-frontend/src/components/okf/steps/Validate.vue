<!-- Step 6: Validate — health ring + issue groups (Phase 6 fills in). -->
<template>
  <div class="okf-step">
    <h3 class="okf-step__title">{{ translate('okf.steps.validate.title', 'Check for issues') }}</h3>
    <p class="okf-step__hint">{{ translate('okf.steps.validate.hint', 'We run conformance checks. Blocking issues must be fixed before publishing.') }}</p>
    <div class="okf-step__placeholder">
      <p>{{ translate('okf.steps.validate.placeholder', 'Validation panel + health ring land in Phase 6 (Story 3-8). The shell + step-lock rules are wired now.') }}</p>
    </div>
  </div>
</template>

<script>
export default {
  name: 'OkfStepValidate',
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
