---
title: Notifications (Toast System)
description: The in-app toast system — a single floating notification element rendered by App.vue, fed by the eventBus + notificationService, with four severity types and auto-dismiss.
weight: 11
mode: reference
audience: developer
last_reviewed: 2026-09-18
persona: developer
owner: "docs-stewards"
---

> **For frontend developers adding a new toast, and for operators
> wondering where the "Saved" / "Upload failed" messages come from.**
> The GENIE.AI frontend does **not** use a `NotificationSystem.vue`
> component (despite legacy docs claiming so). The toast is rendered
> inline in `App.vue` as a single, shared element, fed by an
> `eventBus` event (`notification:show`) that the `notificationService`
> helper emits.

This page documents the wiring, the four severity types, the queue
semantics (only one toast at a time), and how to add a new toast from a
component.

## Prerequisites

- Familiarity with Vue 3 Options API (the project convention; not Composition API). The frontend is Vue 3 (`createApp` from `vue` in `main.js`; Vuex 4).
- The Vuex store loaded (the toast does not depend on Vuex, but the
  emitting components almost always do).
- The `eventBus` module at
  [`components/gov-chat-frontend/src/eventBus.js`](https://gitlab.com/un/itu/genie-ai/-/blob/main/components/gov-chat-frontend/src/eventBus.js).

## How a toast fires

The wiring has three layers.

### 1. The service helper

[`src/services/notificationService.js`](https://gitlab.com/un/itu/genie-ai/-/blob/main/components/gov-chat-frontend/src/services/notificationService.js)
exposes five methods (`success`, `error`, `info`, `warning`, and a
generic `show`). All five end up emitting `notification:show` on the
eventBus:

```javascript
import notificationService from '@/services/notificationService';

notificationService.success('Saved');              // green, 3000 ms
notificationService.error('Upload failed');        // red, 3000 ms
notificationService.info('Re-ingest queued', 6000);// blue, 6000 ms
notificationService.warning('Slow network');       // amber, 3000 ms
```

The default duration is `3000` ms. Pass an explicit duration as the
second argument to override.

### 2. The eventBus

[`src/eventBus.js`](https://gitlab.com/un/itu/genie-ai/-/blob/main/components/gov-chat-frontend/src/eventBus.js)
is a tiny in-process pub/sub (no Vuex, no DOM events, no sockets). It
exposes `$on`, `$off`, `$emit` — the same shape as the deprecated Vue 2
event API.

### 3. The renderer in `App.vue`

`App.vue` is the **only** listener. It registers the handler in
`mounted` (line 137) and tears it down in `beforeUnmount` (line 139):

```javascript
mounted() {
  eventBus.$on('notification:show', this.showNotification);
},
beforeUnmount() {
  eventBus.$off('notification:show', this.showNotification);
}
```

The toast element is a single div in `App.vue` (lines 37-39). CSS positions it at the **top** of the viewport (`position: fixed; top: 0; left: 0; right: 0; width: 100%`), not at the bottom.

```html
<div v-if="notification.visible" class="notification" :class="notification.type"
     @click="hideNotification">
  {{ notification.message }}
</div>
```

## Queue semantics: only one toast at a time

`showNotification` (App.vue:148) **replaces** the current toast if a new
one arrives before the previous auto-dismiss fires:

```javascript
showNotification(payload) {
  if (this.notification.timer) {
    clearTimeout(this.notification.timer);   // cancel the previous timer
  }
  this.notification = {
    visible: true,
    message: payload.message,
    type: payload.type || 'success',
    timer: null
  };
  this.notification.timer = setTimeout(() => {
    this.hideNotification();
  }, payload.duration || 3000);
}
```

Three implications:

1. **Bursty events** (e.g. SSE chunks emitting `info` on every chunk)
   collapse into the **last** message. Don't use the toast for
   high-frequency updates — use a status pill instead.
2. **Duration is reset** on each new toast. A long-running operation
   that emits progress every 2 s and a default 3 s duration will
   **never** auto-dismiss.
3. **Click anywhere on the toast** dismisses it (`@click="hideNotification"`
   on the wrapper div). This is intentional — the toast is also the
   dismiss control.

## Severity types

The four type classes match the four helper methods (and the
`notification.type` value on the wire):

| Type | Class | Colour (light theme) | Used for |
|------|-------|----------------------|----------|
| `success` | `.notification.success` | Green | Saved, uploaded, deleted. |
| `error` | `.notification.error` | Red | Backend failures, validation errors. |
| `warning` | `.notification.warning` | Amber | Recoverable problems (slow network, partial success). |
| `info` | `.notification.info` | Blue | Neutral updates (re-ingest queued, model swap starting). |

The colour values are CSS custom properties — overriding the theme
automatically retints the toast:

```css
.notification { color: var(--accent-fg); /* text color set globally */ }
.notification.success { background-color: var(--success); }
.notification.error   { background-color: var(--danger); }
.notification.warning { background-color: var(--warning); }
.notification.info    { background-color: var(--info); }
```

See [Theme System](/docs/frontend/theme-system/) for the token list.

## Adding a new toast from a component

Three lines of code:

```javascript
import notificationService from '@/services/notificationService';

// In a method:
async saveSettings() {
  try {
    await api.save(this.formData);
    notificationService.success(translate('settings.saved'));
  } catch (error) {
    notificationService.error(translate('settings.saveFailed', { reason: error.message }));
  }
}
```

Two rules:

1. **Always localise** the message via `translate(key, fallback)` — the
   toast text is user-visible and goes through i18n.
2. **Never use the toast for confirmation dialogs.** Confirmations
   (delete account, retract document) belong in `ConfirmDialog` — they
   need a typed-confirmation pattern the toast cannot provide.

## Why there is no `NotificationSystem.vue`

The legacy documentation referenced a `NotificationSystem.vue`
component that does not exist (verified in
[`components/gov-chat-frontend/src/components/`](https://gitlab.com/un/itu/genie-ai/-/tree/main/components/gov-chat-frontend/src/components)
— no such file). The notification code is intentionally inline in
`App.vue` for two reasons:

- **Single instance, single render path.** A reusable component would
  need a portal or a fixed-position container in `App.vue` anyway; the
  inline div is the simplest correct one.
- **No prop drilling.** The `notification` state lives in `App.vue`
  for the lifetime of the app, so any descendant can fire a toast
  without wiring a prop chain or store mutation.

If the team ever needs **multiple stacked toasts**, **action buttons**
("Undo"), or **per-toast keyboard focus**, refactor to a proper
`DsToast` DS primitive — keep the same `eventBus` contract so callers
do not change.

## Verifying it works

### 1. From the browser console

```javascript
// In the browser console (with the app loaded):
const { default: notificationService } = await import('/src/services/notificationService.js');
notificationService.success('It works');
```

Expected: a green toast appears top-centre for 3 s.

### 2. From the test suite

```bash
cd components/gov-chat-frontend
npm test -- notifications
```

The notification service has unit tests in
`src/__tests__/services/notificationService.test.js` (if present).

## Failure modes and troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `notificationService.success('Saved')` does nothing | The `eventBus` listener was never registered, or `App.vue` was not mounted | Confirm `App.vue` ran `eventBus.$on('notification:show', …)` in `mounted`. If `App.vue` was destroyed mid-session (route-level HMR), re-mount and re-register. |
| Toast appears but with no colour | The `.notification` class is missing the type class | Inspect the rendered div: `class="notification success"` (two classes). A common regression is `<div :class="notification.type">` instead of `:class="['notification', notification.type]"`. |
| Toast does not auto-dismiss | The duration is being reset on every emit | Pass an explicit duration once, or set a flag in the caller to stop re-emitting (e.g. `if (this.lastSavedAt < Date.now() - 5000)`). |
| Toast appears behind the chat area | Z-index conflict | The toast uses `z-index: 9000` (defined in the `App.vue` `<style>` block, comment line ~362). If the chat input is over it, raise it above `9000` or move the toast outside `<div id="app">`. |
| `notificationService.error(...)` does not show | The toast renders but is invisible (foreground/background both dark) | The CSS uses `--danger-fg` for the text. Verify the theme variable is set in `_tokens.scss` for the current mode. |
| Several toasts queue up after a code change | Someone replaced the inline `App.vue` toast with a multi-instance component but kept the `eventBus` shape | Decide single-instance vs multi-instance intentionally. For multi-instance, port to a DS primitive and keep the `notification:show` event name. |

## Related

- [Theme System](/docs/frontend/theme-system/) — the `--success`,
  `--warning`, `--danger`, `--info` tokens that colour the toast.
- [State Management](/docs/frontend/state-management-frontend/) —
  `currentLocale` is what makes `translate()` work in the toast
  messages.
- [Auth Flow](/docs/frontend/auth-flow/) — login/logout events fire
  toasts (e.g. "Signed out").