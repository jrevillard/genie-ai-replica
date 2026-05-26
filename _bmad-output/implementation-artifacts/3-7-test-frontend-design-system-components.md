# Story 3-7: Test Frontend Design System Components

Status: done

## Story

As a developer,
I want unit tests for all DS primitive components,
So that the foundation UI layer is regression-safe before extending it.

## Acceptance Criteria

1. **AC1: DsButton** — test variants (primary, secondary, ghost, danger), props (small, disabled, tag="a"), click emission, slot rendering
2. **AC2: DsCard** — test variants (default, flat, elevated, outline), props (padding, radius, hoverable), slot rendering
3. **AC3: DsModal** — test sizes (sm, md, lg, xl), props (visible, title, scrollable), close emission, body slot
4. **AC4: DsInput** — test sizes (sm, md, lg), textarea mode, modelValue binding, disabled/readonly, input emission
5. **AC5: DsSelect** — test sizes, modelValue binding, placeholder, disabled state, option rendering
6. **AC6: DsCombobox** — test searchable dropdown, options rendering, selection, search filtering
7. **AC7: DsFormGroup** — test label rendering, inputId association
8. **AC8: DsPill** — test variants (accent, success, warning, danger, info), slot rendering
9. **AC9: DsSpinner** — test sizes (sm, md, lg), overlay mode
10. **AC10: DsStatusTag** — test variants (success, error, warning, info, pending)
11. **AC11: DsTabs** — test default and fill modes, tab switching, modelValue binding
12. **AC12: DsStateDisplay** — test empty, loading, error state rendering
13. **AC13: Regression safety** — all existing tests pass, zero lint errors

## Tasks / Subtasks

- [x] Task 1: Create `src/__tests__/components/ds/` directory
- [x] Task 2: Create DsButton.test.js (AC1)
- [x] Task 3: Create DsCard.test.js (AC2)
- [x] Task 4: Create DsModal.test.js (AC3)
- [x] Task 5: Create DsInput.test.js (AC4)
- [x] Task 6: Create DsSelect.test.js (AC5)
- [x] Task 7: Create DsCombobox.test.js (AC6)
- [x] Task 8: Create DsFormGroup.test.js, DsPill.test.js, DsSpinner.test.js, DsStatusTag.test.js, DsTabs.test.js, DsStateDisplay.test.js (AC7-12)
- [x] Task 9: Run full regression suite and lint

## Dev Notes

### DS Component Test Pattern

DS components are simple Vue 3 SFCs with props, slots, and CSS custom properties. Tests focus on:
- **Props rendering**: verify variant-specific CSS classes and attributes
- **Slot content**: verify default and named slots render correctly
- **Events**: verify emitted events on user interaction
- **Edge cases**: disabled state, empty state, boundary values

```javascript
import { mount } from '@vue/test-utils';
import DsButton from '@/components/ds/Button.vue';

it('renders primary variant', () => {
  const wrapper = mount(DsButton, { props: { variant: 'primary' } });
  expect(wrapper.classes()).toContain('ds-button--primary');
});

it('emits click when not disabled', async () => {
  const wrapper = mount(DsButton);
  await wrapper.trigger('click');
  expect(wrapper.emitted('click')).toHaveLength(1);
});

it('does not emit click when disabled', async () => {
  const wrapper = mount(DsButton, { props: { disabled: true } });
  await wrapper.trigger('click');
  expect(wrapper.emitted('click')).toBeUndefined();
});
```

### CSS Custom Properties

DS components use CSS custom properties for theming. Tests should NOT assert CSS values (JSDOM doesn't compute styles). Instead, verify that the correct CSS class is applied based on variant/prop.

### Coverage Impact

Current: functions ~34%
After: estimated functions ~45% (12 components with 3-5 functions each)

### Review Findings

- [x] [Review][Patch] DsButton: disabled anchor click not blocked — added @click guard + emits declaration
- [x] [Review][Patch] DsCombobox: missing afterEach cleanup for Teleport DOM
- [x] [Review][Patch] DsCombobox: setValue replaces direct $emit for realistic user input
- [x] [Review][Patch] DsCombobox: missing case-insensitive filter test
- [x] [Review][Patch] DsCombobox: missing custom noResultsText test
- [x] [Review][Patch] DsModal: missing afterEach body cleanup (innerHTML)
- [x] [Review][Patch] DsModal: missing body overflow restoration test
- [x] [Review][Patch] DsSelect: formGroupId should be realistic string, not null
- [x] [Review][Patch] DsTabs: split modelValue default test into index-based and value-based
- [x] [Review][Patch] DsFormGroup: use exact formGroupId match instead of regex
- [x] [Review][Patch] DsButton: missing disabled anchor click test
- [x] [Review][Defer] DsCombobox: keyboard navigation tests (ArrowUp/Down, Enter, Escape) — deferred, complex interaction testing
- [x] [Review][Defer] DsCombobox: click-outside close behavior — deferred, requires attachTo + event simulation
- [x] [Review][Defer] DsModal: focus trap test — deferred, JSDOM lacks focus management
- [x] [Review][Defer] DsModal: scrollable body overflow-y test — deferred, JSDOM CSS limitation
- [x] [Review][Defer] DsModal: close-on-Escape keydown test — deferred, event listener lifecycle complexity

## Change Log
