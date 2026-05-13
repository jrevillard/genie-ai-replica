# CLAUDE.md — gov-chat-frontend

## Design System

This frontend is governed by the **GENIE.AI Design System (DS)**. The DS is the single source of truth for all component styling.

### Architecture

```
src/
├── theme-variables.css    # Token definitions (OKLch CSS custom properties)
├── theme-components.css   # Global component selectors using DS tokens
└── components/
    └── ds/                # DS primitive components (the building blocks)
        ├── Button.vue
        ├── Card.vue
        ├── Modal.vue
        ├── Pill.vue
        ├── Spinner.vue
        └── StatusTag.vue
```

### Rules

1. **Always use DS primitives** — If a DS component exists for a pattern (button, card, modal, pill, spinner, status tag), use it. Do not create ad-hoc implementations.
2. **Always use DS tokens** — All colors, spacing, radii, shadows, and typography must reference CSS custom properties (`var(--fg)`, `var(--surface)`, `var(--accent)`, etc.). Never hardcode values.
3. **No `!important`** — Indicates the wrong component is being used or a missing DS extension point. Use CSS custom properties on the parent element instead (e.g., `--ds-card-border-color`). Exception: ApexCharts tooltip overrides and genuine parent-child scoped style conflicts.
4. **Remove legacy CSS after migration** — When a component is migrated to a DS primitive, delete the old CSS rules. No orphaned styles.
5. **Options API** — All components use Vue 3 Options API. Follow existing conventions.

### Creating a New DS Component

Before creating a new DS component:

1. **Search for existing patterns** — Grep across all `.vue` files. If the pattern exists in 3+ components, extraction is warranted.
2. **Check `theme-components.css`** — Global token-based styles may already cover the visual layer. A DS component adds structure (props, slots, behavior), not just styling.
3. **Design the API** — Props with validators, named slots, emitted events. Keep it minimal — YAGNI.
4. **Use DS tokens exclusively** — No hardcoded colors, spacing, or typography in DS components.
5. **Add CSS custom property escape hatches** — For consumers that need to override a specific visual aspect (e.g., `--ds-card-border-color`), expose a CSS custom property with a sensible default.

### DS Token Reference

| Category | Tokens |
|----------|--------|
| Colors | `--brand`, `--fg`, `--surface`, `--bg`, `--accent`, `--accent-hover`, `--accent-muted`, `--accent-fg`, `--accent-secondary`, `--navbar-bg`, `navbar-fg`, `--muted`, `muted-soft`, `--border`, `--border-light`, `--overlay-bg`, `--danger`, `--success`, `--warning`, `--info`, `--danger-bg`, `--success-bg`, `--warning-bg`, `--info-bg`, `--btn-secondary-bg`, `--btn-secondary-hover`, `--btn-secondary-fg` |
| Spacing | `--space-xs`, `--space-sm`, `--space-md`, `--space-lg`, `--space-xl`, `--space-2xl` |
| Typography | `--text-xs`, `--text-sm`, `--text-base`, `--text-md`, `--text-lg`, `--text-xl`, `--text-2xl`, `--text-3xl`, `--font-scale`, `--font-body`, `--font-display`, `--font-mono` |
| Radii | `--radius-sm`, `--radius-md`, `--radius-lg`, `--radius-xl` |
| Shadows | `--shadow-sm`, `--shadow-md`, `--shadow-lg` |

### DS Component Inventory

| Component | Variants | Usage | Props |
|-----------|----------|-------|-------|
| **DsButton** | primary, secondary, ghost, danger | All buttons, links (`tag="a"`) | `variant`, `small`, `disabled`, `tag` |
| **DsCard** | default, flat, elevated, outline | Panels, metric cards, list items | `variant`, `padding`, `radius`, `hoverable` |
| **DsFormGroup** | default | Label + input grouping, works with DsInput | `label`, `inputId` |
| **DsInput** | sm, md, lg + textarea | All text inputs, search, textareas | `modelValue`, `type`, `placeholder`, `disabled`, `readonly`, `inputId`, `size`, `rows` |
| **DsModal** | sm, md, lg, xl | Dialogs, confirmations | `visible`, `title`, `size`, `scrollable` |
| **DsSelect** | sm, md, lg | All select dropdowns | `modelValue`, `placeholder`, `disabled`, `inputId`, `size` |
| **DsCombobox** | sm, md, lg | Searchable dropdowns, country picker, filtered selects | `modelValue`, `options`, `optionLabel`, `optionValue`, `placeholder`, `searchPlaceholder`, `noResultsText`, `disabled`, `size` |
| **DsPill** | accent, success, warning, danger, info | Status indicators, labels | `variant` |
| **DsSpinner** | sm, md, lg + overlay mode | Loading states | `size`, `overlay` |
| **DsStatusTag** | success, error, warning, info, pending | Document/crawl status | `variant` |
| **DsTabs** | default, fill | Tab navigation, flex-fill layouts | `tabs`, `modelValue`, `fill` |

### Extension Points (CSS Custom Properties)

DsCard flat variant supports `--ds-card-border-color` for border color overrides without `!important`.
DsButton ghost variant supports `--ds-btn-ghost-color`, `--ds-btn-ghost-hover-color`, `--ds-btn-ghost-hover-bg`.
DsSelect supports `--ds-select-bg`, `--ds-select-color`, `--ds-select-border-color`.
DsCombobox supports `--ds-combobox-bg`, `--ds-combobox-color`, `--ds-combobox-border-color`, `--ds-combobox-list-max-height`.
DsTabs supports `--ds-tabs-active-color`, `--ds-tabs-active-border-color`.

### Patterns That Do NOT Need DS Components

- **Specialized interactive widgets** (thumb buttons, skin tone selectors) — Use native `<button>` with scoped CSS
- **Raw HTML strings** (print views, new-window content) — Cannot use Vue components
- **ECharts/ApexCharts tooltips** — Library-specific, use `!important` overrides
- **Layout panels** (sidebar, navbar) — Too tightly coupled to app layout
- **AdminDashboard specialized sections** — Too domain-specific
- **Large complex dialogs** (FileDetailsDialog, UserProfileComponent) — Hand-rolled modal structure is too intertwined with domain logic to safely refactor to DsModal delegation

### i18n

Use `this.$t('key')` or the component's `translate()` helper. All user-facing strings must go through i18n. DS components do not handle translation internally — consumers pass translated text via props or slots.
