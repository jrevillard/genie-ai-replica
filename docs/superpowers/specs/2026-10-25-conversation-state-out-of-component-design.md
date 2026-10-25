# Conversation State Out of the Component — Design

Date: 2026-10-25
Status: proposed
Research basis: deep-research run `wf_13009bfb-166` (103 agents, claims
verified 3-vote; sources: Vue docs, Vue Router, Pinia, Vercel AI SDK
persistence/resume docs, USWDS, WAI-ARIA APG, NN/g)

## Problem

The open conversation (`chatMessages`, `selectedContextItems`,
`lastSavedState`, the in-flight stream) lives in `ChatBotComponent`'s
local `data()`. Vue destroys a routed component on navigation, so
leaving the chat for Settings/Analytics/... loses the conversation.
The round-2 route-leave dialog is a band-aid over this defect.

Research verdict: dedicated routes were correct; the defect is state
ownership. The reference chat architecture keeps each conversation's
state outside the component and treats navigation as non-destructive.

## Decision

Move the open conversation into a Vuex module. The component becomes a
renderer. Navigation keeps the conversation alive; a full page reload
keeps it too (sessionStorage); a generation in flight continues in the
background while the user is on another page.

## Architecture

### New Vuex module `src/store/modules/conversation.js`

Single owner of the open conversation:

```js
state: {
  messages: [],              // the open conversation's turns
  selectedContextItems: [],  // QuickHelp / tree context
  lastSavedState: { messages: [], contextItems: [] },
  conversationId: null,      // set once saved to history
  title: '',
  isStreaming: false,
  streamingQueryId: null,
  streamInterrupted: false   // page reloaded mid-generation
}
```

Actions own the side effects that belong to the conversation, not to
the view:

- `sendStream` — holds the AbortController, calls
  `chatbotService.submitQueryStream`, writes frames via mutations
  (`appendChunk`, `setMetadata`, `setTranslation`, `finishStream`,
  `failStream`). The component dispatches and renders.
- `loadConversation(id)` / `resetForNewConversation()` / `saveToHistory()`
  mirror the component's current methods, minus the local state.

Persistence: a module-level `store.subscribe` writes the module's state
to sessionStorage (`genie.conversation`) debounced (~300 ms); the store
bootstrap rehydrates it before the app mounts. If `isStreaming` was
true at rehydration, the fetch died with the page: the module sets
`streamInterrupted` on the last bot message, which renders through the
existing retry affordance.

### Component changes (`ChatBotComponent.vue`)

- `chatMessages`, `selectedContextItems`, `lastSavedState`,
  `isStreaming`, `streamingQueryId` become mapped store state. The
  render code (markdown, avatars, sources, actions, dialogs) is
  untouched — it reads the same shapes.
- `sendMessage` dispatches `conversation/sendStream`; local
  `streamController` bookkeeping moves into the action.
- `beforeUnmount` no longer aborts the stream (it now belongs to the
  store and outlives the component). The component-scoped event-bus and
  resize listeners are unchanged.
- The route-leave `beforeEach` guard and the round-2 unsaved-changes
  dialog on navigation are removed. Navigation is never blocked.
- The header × (close conversation) KEEPS its confirm dialog: closing
  resets the open conversation, which is the one remaining destructive
  action. Its texts stay save/discard ("Save and Start New" ...).

### Unchanged

- Save flow (button → title/folders dialog → chatHistory), export,
  feedback, sources, welcome screen, QuickHelp, load-from-history (its
  confirm remains: loading replaces the open conversation).
- Backend: no API change. The stream still runs through
  `/queries/stream`; navigating away does not cancel it because the
  fetch now belongs to the store.

### Explicitly out of scope

- Server-side draft persistence (drafts live in sessionStorage only —
  per-tab, per-device).
- Stream resume across reloads (requires backend stream store; revisit
  only if navigating away mid-generation becomes common).

## Error handling

- Reload mid-generation → `streamInterrupted` → existing
  `answer-error` + retry render on the last turn.
- Stream error while backgrounded → stored in the message; visible
  when the user returns.
- sessionStorage full/unavailable → persistence degrades to
  navigation-only survival (Vuex still holds state); a console warning,
  no user-facing error.
- Store rehydration shape mismatch (schema drift) → discard stored
  state, start clean (version key `genie.conversation.v1`).

## Testing

- Unit (store): mutations, `sendStream` frame writing (mocked service),
  abort semantics, debounce persistence, rehydration including the
  interrupted-stream flag, version-mismatch discard.
- Unit (component): existing ChatBotComponent suite adjusted to the
  mapped state; behavior contracts unchanged.
- E2E (`chat-conversation.spec.js`):
  1. navigate to Settings mid-generation → return → the answer is
     complete;
  2. navigate away and back with an open conversation → turns still
     there, no dialog;
  3. reload mid-generation → partial answer + retry affordance;
  4. × keeps its confirm; navigation has none;
  5. save flow unchanged (title/folders).
- Mutation checks: each new e2e assertion written against a deliberate
  break first (per test-audit authoring gate).

## Migration notes

- `hasUnsavedChanges` semantics keep their meaning (drives the ×
  confirm), but no longer gate navigation.
- The round-2 e2e "navigating away prompts to save" test is replaced by
  "navigating away never prompts and never loses the conversation".
