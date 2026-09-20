---
title: Accessibility Primitives
description: Accessibility support in the GENIE.AI frontend — the DS design-system primitives, the dialog and context-menu a11y patterns, screen-reader handling for the chat stream, and the i18n-driven aria-label convention.
weight: 12
mode: reference
audience: developer, accessibility-auditor
last_reviewed: 2026-09-18
persona: developer
owner: "docs-stewards"
---

> **For frontend developers wiring new components, and for accessibility
> auditors reviewing the chat experience.** GENIE.AI's accessibility
> story is built on three layers: (1) the **DS design-system primitives**
> (12 components, with the accessibility semantics baked in), (2) the
> **dialog and menu patterns** (`DsModal`, `ConfirmDialog`, `ContextMenu`)
> that all conform to the same ARIA conventions, and (3) the
> **chat-stream live region** that announces streamed tokens to screen
> readers.

This page documents the conventions, the ARIA roles used, the screen-reader
behaviour, and the known gaps.

## Prerequisites

- Familiarity with ARIA roles, `aria-label`, `aria-live`, and
  `aria-disabled`.
- A screen reader (NVDA on Windows, VoiceOver on macOS/iOS, Orca on
  Linux) for the verify steps.
- The `Ds*` design-system primitives loaded (auto-imported via the
  `components/ds/` convention in `components/gov-chat-frontend/src/main.js`).

## DS design-system primitives

The 12 DS components live in
[`components/gov-chat-frontend/src/components/ds/`](https://gitlab.com/un/itu/genie-ai/-/tree/main/components/gov-chat-frontend/src/components/ds/):

| Primitive | File | Accessibility semantics |
|-----------|------|--------------------------|
| `DsButton` | `Button.vue` | `aria-disabled` when `disabled && tag !== 'button'`. `inheritAttrs: false` so the `disabled` prop does not leak to the DOM as a plain attribute. |
| `DsInput` | `Input.vue` | `<label>` binding is delegated to the parent `DsFormGroup` (via the injected `formGroupId`). The component itself does **not** set `aria-invalid` on validation failure. |
| `DsSelect` | `Select.vue` | Native `<select>` semantics — keyboard arrow navigation works out of the box. |
| `DsCombobox` | `Combobox.vue` | Custom div-based control — does **not** implement the WAI-ARIA 1.2 combobox pattern (no `role="combobox"`, `aria-expanded`, `aria-controls`, or `aria-activedescendant` in source). |
| `DsTabs` | `Tabs.vue` | Button-based tab control — uses plain `<button>` elements; no `role="tablist"` / `role="tab"` / `role="tabpanel"`, no `aria-selected`, no arrow-key navigation in source. |
| `DsModal` | `Modal.vue` | `role="dialog"` + `aria-modal="true"`, focus trap, `Esc` to close. |
| `DsCard` | `Card.vue` | Plain `<div class="ds-card">` wrapper with optional `header` named slot; no `aria-labelledby` in source. |
| `DsFormGroup` | `FormGroup.vue` | `<div>` wrapper with a `<label>` element bound to the child input via `provide`/`inject` `formGroupId`; no `<fieldset>` / `<legend>`. |
| `DsPill` | `Pill.vue` | Class-based styling only — no `role="status"` attribute in source. |
| `DsSpinner` | `Spinner.vue` | Class-based styling only — no `role="status"` or `aria-live` in source. |
| `DsStateDisplay` | `StateDisplay.vue` | Empty/error/success state — no `aria-live` attribute in source. |
| `DsStatusTag` | `StatusTag.vue` | Class-based styling only — no `role="status"` attribute in source. |

> **Rule:** application components reach for `Ds*` primitives, not raw
> `<button>` / `<input>`. The DS layer is where the ARIA wiring lives;
> rolling your own is the most common cause of accessibility bugs.

### `DsButton` — the most-used primitive

```html
<DsButton variant="primary" @click="save">Save</DsButton>
<DsButton variant="secondary" disabled>Disabled</DsButton>
<DsButton variant="ghost" tag="a" href="https://example.com">Link</DsButton>
```

`tag` lets the same primitive be a `<button>`, `<a>`, or `<router-link>`
(`tag="router-link"`). When the tag is **not** `<button>`, the disabled
state uses `aria-disabled="true"` instead of the `disabled` attribute
(disabling an `<a>` would break navigation). See
[`DsButton.vue:6-7`](https://gitlab.com/un/itu/genie-ai/-/blob/main/components/gov-chat-frontend/src/components/ds/Button.vue#L6).

## Dialog patterns

### `DsModal` — the standard modal

```html
<DsModal :open="showDialog" title="Confirm action" @close="showDialog = false">
  <p>Are you sure?</p>
  <template #footer>
    <DsButton variant="secondary" @click="showDialog = false">Cancel</DsButton>
    <DsButton variant="danger" @click="confirmDelete">Delete</DsButton>
  </template>
</DsModal>
```

- Renders as `<div role="dialog" aria-modal="true">` — see
  [`DsModal.vue:4`](https://gitlab.com/un/itu/genie-ai/-/blob/main/components/gov-chat-frontend/src/components/ds/Modal.vue#L4).
- **Focus trap** — focus moves into the modal on open and stays there
  until close. The close button (`DsButton ghost aria-label="Close"`)
  is the only way out via keyboard.
- **`Esc` closes** the modal and emits `close`.
- `DsModal.vue` does **not** bind `aria-labelledby` or `aria-describedby` — it only sets `role="dialog" aria-modal="true"` on the dialog div (line 4). Labelling/description IDs are not wired in the source.

### `ConfirmDialog` — typed confirmation

For destructive flows (delete account, reset data, retract document),
`ConfirmDialog` is a basic confirm/cancel modal built on top of `DsModal`. It does **not** implement typed-confirmation:

```html
<ConfirmDialog
  :visible="showConfirm"
  title="Delete account"
  message="This action is permanent."
  confirm-text="Delete"
  cancel-text="Cancel"
  @confirm="onConfirm"
  @cancel="showConfirm = false"
/>
```

Behaviour:

- Props: `visible`, `title`, `message`, `confirmText`, `cancelText`, `secondaryText`, `danger`. The dialog has **no** `confirm-phrase` prop and no input field — the Confirm button is enabled as soon as the modal opens. There is no typed-confirmation requirement (no DELETE/RESET challenge).

### `ContextMenu` — right-click menu

```html
<ContextMenu :items="menuItems" :position="clickPos" @select="onMenuSelect" />
```

- Renders as a bare `<div class="context-menu">` with a `<slot>` — the ARIA
  roles (`<ul role="menu">` + `<li role="menuitem">`) must be added by the
  caller in the slot content, not by the component itself.
- The component does **not** handle keyboard navigation. Arrow keys, `Enter`,
  and `Esc` must be wired by the caller on the menu items rendered in the slot.
- The trigger (right-click `contextmenu` event or long-press fallback on touch)
  is implemented by the caller, not by `ContextMenu`. The component only
  manages position adjustment (off-screen clamping) and outside-click
  dismissal.

## Chat-stream live region

The chat message list is a live region
([`ChatBotComponent.vue`](https://gitlab.com/un/itu/genie-ai/-/blob/main/components/gov-chat-frontend/src/components/ChatBotComponent.vue)):

```html
<div class="messages" aria-live="polite">
  <div v-for="msg in messages" :key="msg.id"
       class="message" :class="{ 'message--streaming': msg.isStreaming }">
    <!-- … -->
  </div>
</div>
```

`aria-live="polite"` announces new bot tokens as they stream in —
NVDA/VoiceOver/Orca will read the answer aloud as it is generated.
`polite` is intentional: `assertive` would interrupt the user reading
the previous frame.

The streaming indicator carries `aria-busy="true"` while
`msg.isStreaming && !msg.content`. The indicator clears once the first
chunk arrives.

### Keyboard navigation inside the chat

| Key | Action |
|-----|--------|
| `Enter` | Send the message (in the input area). |
| `Shift+Enter` | Same as Enter — sends the message. The input has no shiftKey check. |
| `Esc` (during a stream) | Cancel the in-flight stream via `AbortController`. |
| `Tab` | Move focus through context pills, feedback button, send button. |

## Aria-label convention

Every interactive component **without** visible text uses
`aria-label="..."` drawn from a translation key:

| Element | Aria-label source |
|---------|-------------------|
| `DsButton` with no slot text (icon-only) | Caller-provided, typically `translate('button.save', 'Save')` |
| Sidebar collapse toggle | `translate('sidebar.toggle', 'Toggle sidebar')` |
| Chat feedback button | `translate('feedback.button', 'Send feedback')` |
| File upload remove button | `translate('upload.remove', 'Remove file')` |

**Rule:** never hard-code the English fallback for production — always
go through `translate(key, fallback)`. The fallback is the developer
ergonomic; the runtime value is the translation.

## Skip-to-content link

`App.vue` does **not** contain a skip-to-content link. There is no `<a href="#main-content" class="skip-link">` element, and the `<main class="content-area">` element on line 30 has no `id="main-content"` attribute. (Verified by grepping `App.vue` for `skip-link`, `skipLink`, `main-content`, and `Skip to` — zero matches.)

## Known gaps and trade-offs

| Gap | Why | Workaround |
|-----|-----|------------|
| No full WCAG 2.2 AA audit | The project ships accessibility-by-construction but has not commissioned a third-party audit | axe-core is not currently integrated into the e2e or jest suites (no `axe-core` in `gov-chat-frontend/package.json`). Manual verification per Section 1-2 is the current path; track follow-ups in the backlog. |
| Right-click `ContextMenu` not announced by VoiceOver on Safari | Safari does not consistently trigger the menu announcement on right-click | The component also opens on `Enter` when the trigger has focus, which IS announced. |
| `DsSpinner` does not pause screen readers during a long stream | `role="status"` + `aria-live="polite"` is correct for the spinner itself but does not throttle the chat live region | The chat live region uses `aria-busy="true"` on the streaming indicator; this is the conventional mitigation. |
| No high-contrast theme | The dark/light themes are AA-contrast but not AAA; a Windows High Contrast Mode override is not in `App.vue` | If you need AAA contrast, add `@media (forced-colors: active)` overrides to `_tokens.scss`. |
| `aria-describedby` for `DsModal` not always set | Some legacy callers do not pass a description | The DS layer always renders `aria-labelledby`; the description is optional and falls back to no `aria-describedby`. |
| No reduced-motion handling on the chat stream | Streamed tokens do not animate by default (no jank), but page transitions and splash fade do | If `prefers-reduced-motion: reduce` is a requirement, add `@media (prefers-reduced-motion: reduce) { ... }` overrides in `_custom.scss`. |

## Verifying it works

### 1. Keyboard-only navigation

Open the app and do not touch the mouse. You should be able to:

- Log in (Tab → Enter on "Sign in").
- Compose a chat (Tab to the input area, type, Tab → Enter on "Send").
- Rate a bot response (Tab → Enter on the feedback button, Tab → Enter
  on a thumb, Tab → type a comment, Tab → Enter on "Submit").
- Open the sidebar (Tab → Enter on the collapse toggle).
- Open the settings page (Tab → Enter on the gear icon).
- Reach the chat input area from anywhere via the **Skip to main
  content** link (first Tab on every page).

### 2. Screen-reader smoke test

VoiceOver (Cmd+F5) or NVDA (Ctrl+Alt+N):

- Open a chat. The conversation history should be readable.
- Send a message. The bot reply should be announced token-by-token as
  it streams.
- The **Online / Offline** status pill at the top should announce on
  change.
- The sidebar collapse toggle should announce "Toggle sidebar,
  collapsed" / "Toggle sidebar, expanded".

### 3. Automated checks

```bash
cd components/gov-chat-frontend
npm run test:contract  # jest component contract tests (axe-core is NOT currently integrated)
npm run test:e2e       # Playwright e2e suite (axe-core is NOT currently integrated; manual verification per Section 1-2 is required)
```

> Note: `axe-core` does not appear as a direct dependency of `gov-chat-frontend/package.json` (verified by grepping the workspace). The references to axe-core in this doc are aspirational — the e2e suite runs Playwright only, not axe-core. Track follow-ups in the backlog.

## Failure modes and troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Button stays focusable when disabled | The button is an `<a>` or `<router-link>` and `disabled` was used instead of `aria-disabled` | Use `DsButton` and pass `:disabled="true"` — the primitive swaps to `aria-disabled` when the tag is not `<button>`. |
| Screen reader does not announce a toast | The toast does not have `role="status"` or `aria-live` | Add `aria-live="polite"` to the toast element in `App.vue` (the legacy code intentionally lacks it — see [Notifications](/docs/frontend/notifications/)). |
| Modal traps focus but `Esc` does nothing | The `keydown` listener was registered on the wrong element | `DsModal` binds `Esc` on the dialog ref; ensure `ref="dialog"` is on the modal div. |
| Tab order skips a button | The button has `tabindex="-1"` or is inside an element with `inert` | Inspect the rendered HTML. The most common cause is a wrong `v-if` that briefly sets `tabindex`. |
| Combobox announces but does not show options | `aria-expanded` is `false` when the listbox is open | Check the binding: `:aria-expanded="isOpen"` — not just `:aria-expanded` (boolean attribute omission). |

## Related

- [Theme System](/docs/frontend/theme-system/) — the colour tokens that
  drive the contrast ratios.
- [Notifications](/docs/frontend/notifications/) — the toast element
  does not currently use `aria-live`; a known follow-up.
- [State Management](/docs/frontend/state-management-frontend/) —
  `currentLocale` is what makes `translate('button.aria.save')` resolve
  to the right language.