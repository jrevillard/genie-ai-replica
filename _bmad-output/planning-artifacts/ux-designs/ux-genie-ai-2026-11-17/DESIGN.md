---
name: GENIE.AI Agent Activity Line
description: One transient line in the existing GENIE.AI chat surfaces (web + mobile) reporting the agent's current operation while it works. Iteration 1 of the agentic-foundations UX — the visual layer is inherited from the GENIE.AI design system, not new.
status: final
created: '2026-11-17'
updated: '2026-11-17'
topic: genie-ai agent activity line
sources:
  - '{planning_artifacts}/prds/prd-genie-ai-2026-11-16/prd.md'
  - '{planning_artifacts}/architecture/architecture-genie-ai-2026-11-16/ARCHITECTURE-SPINE.md'
colors:
  # Inherited wholesale from the runtime theme —
  # components/gov-chat-frontend/public/config/theme-variables.css (:root at :14,
  # dark override at :149). The file is served at runtime and is
  # deployment-overridable, so the tokens are referenced by name: restating hex
  # here would fork the source of truth and drift on the first theme change.
  muted: 'var(--muted)'
  accent: 'var(--accent)'
  warning: 'var(--warning)'
  warning-bg: 'var(--warning-bg)'
  warning-ink: 'var(--warning-ink)'
typography:
  meta:
    note: 'Inherited — web var(--text-sm) (12px, scales with --font-scale); mobile tokens.textSm (12 x fontScale)'
rounded:
  sm: 'var(--radius-sm)'
spacing:
  xs: 'var(--space-xs)'
  sm: 'var(--space-sm)'
components:
  agent-activity-line:
    color: '{colors.muted}'
    font-size: 'var(--text-sm)'
    gap: '{spacing.sm}'
    spinner: '{colors.accent}'
    state-running-color: '{colors.muted}'
    state-completed-color: '{colors.muted}'
    # A failed tool call is a STATE, not an accusation — the chat's own rule
    # (.answer-error and .answer-warning are both amber, ChatBotComponent.vue:3886-3918).
    state-failed-color: '{colors.warning-ink}'
    state-failed-background: '{colors.warning-bg}'
    radius: '{rounded.sm}'
---

## Brand & Style

The activity line is **invisible chrome**: quiet, functional, state-not-accusation. It exists so a wait is legible — the user can see that work is happening and, if one step fails, that it failed — and then it leaves the reading surface alone. It inherits the chat's existing posture without adding to it: no personality is injected, no progress is celebrated, no colour drama competes with the answer. The answer is the content; the line is a footnote with a short life.

Iteration 1 introduces **no brand delta**. Every token below already exists in the shipped design system, and the line is specified as the delta the existing system receives — one component, three states.

## Colors

The line inherits the GENIE.AI runtime theme (`components/gov-chat-frontend/public/config/theme-variables.css`); mobile inherits the matching mobile token set (`mobile/genie_ai_mobile/lib/design_system/tokens/app_tokens.dart`). No new colour is introduced.

- **Running / completed** — `{colors.muted}`, the same quiet ink the chat's saving indicator uses (`ChatBotComponent.vue:4660-4671`: `--muted` text, `--accent` spinner). The line is a footnote; it does not compete with the answer text for attention.
- **Failure** — the **warning** family: `{colors.warning-bg}` background, `{colors.warning-ink}` ink, exactly the recipe the existing `.answer-warning` uses (`ChatBotComponent.vue:3888-3898`). The chat's rule is written in the stylesheet: *"The ungrounded warning and the retryable error — both amber, never red: an error is a state, not an accusation."* A failed tool call is the same class of event, so it gets the same amber.
- **`--danger` is reserved and is NOT used here.** No red anywhere in this component.
- **Spinner** — `{colors.accent}`, the colour the DS spinner already paints its arc with (`ds/Spinner.vue`, `.ds-spinner--sm { border-top-color: var(--accent) }`).
- **Light and dark** — one token set, no separate pairs: the referenced custom properties resolve per mode inside the theme file (light `:root` at :14, dark override at :149). Mobile resolves per mode through `ThemeManager().tokens` (`isDark`).
- **Contrast** — no new obligation: the running state inherits `--muted` on the card surface, the failed state inherits the `--warning-ink` / `--warning-bg` pair already in production use on `.answer-warning`.

## Typography

One size for the whole line: `{typography.meta}` — web `var(--text-sm)` (12px, scales with `--font-scale`), mobile `tokens.textSm` (12 × `fontScale`). The two platforms land on the same rendered size.

No bold, no uppercase, no second type size for the state — the state is carried by the **word** ("failed"), never by weight or colour alone. The ellipsis is part of the translated string, not a CSS truncation.

## Layout & Spacing

- **Web** — a new row inside `.answer-card` (`ChatBotComponent.vue:148`), a **sibling of `.message-bubble`** (`:157`), so it inherits the card's own `gap: var(--space-sm)` (`:3875`) and sits above the answer. The line owns no margin. **Insertion point pinned:** the row is the **first child of `.answer-card`** — before the template's in-flight/bubble pair, so it renders in the SAME slot the legacy typing indicator occupies (the two never render together: the line takes over from the first activity frame). The bubble's `v-else` (`:157`) therefore stays adjacent to its own `v-if` (`:149`) and needs **no** conversion to `v-if`: the conversion belongs to the OTHER placement (inserting the row BETWEEN `:149` and `:157`), which this pin does not choose.
- **Mobile** — the slot of the in-flight row (`mobile/genie_ai_mobile/lib/components/chat/chatbot_component.dart:2468-2492`), the **trailing** ListView item (renders after the streaming assistant message, at `index == _messages.length`) — the same turn-relative position as web, at the bottom of the turn rather than above the answer bubble.
- **Inside the row** — spinner (16px / `DsSpinner` size `sm`) + `{spacing.sm}` gap + label. One line, no wrap in iteration 1; an over-long label truncates with an ellipsis — **except the `failed` state, which wraps instead of truncating** (the state word must survive every locale's label length at every font scale and viewport width; wrapping preserves it where truncation would cut it; narrow-viewport and enlarged-text cases are acceptance criteria).
- **No fill in the running state.** The line is text on the card's own surface — a chip would read as a message.

## Components

### Agent activity line

**Anatomy.** One row: `[state marker] [operation label]`.

- **State marker** — the DS spinner (`components/gov-chat-frontend/src/components/ds/Spinner.vue`, size `sm`) while running; a static glyph (the dot of the nav-status pill, `NavBarComponent.vue:190`) once completed or failed.
- **Operation label** — the localized template for the operation the server reported (`chatbot.agentActivity.operations.<operation>.running|completed|failed`; naming and copy rules live in `EXPERIENCE.md`).

**States.**

| State | Marker | Label | Color |
|---|---|---|---|
| `running` | spinner, `{colors.accent}` | present progressive, ellipsis | `{colors.muted}` |
| `completed` | static dot | past tense, no ellipsis | `{colors.muted}` |
| `failed` | static warning glyph | states that the step failed | `{colors.warning-ink}` on `{colors.warning-bg}` |
| `collapsed` | — | — | not rendered |

**Failed treatment.** The failed row is a filled chip in the warning family, the same shape and padding as the existing `.answer-warning` (`padding: var(--space-xs) var(--space-sm)`, `{rounded.sm}` radius). Mobile has no `--warning-bg` / `--warning-ink` pair — there, the failed state is the label in `tokens.warning` plus the warning marker glyph, with no fill. The **state and the word are identical on both platforms**; only the surface treatment differs, because the two token systems differ.

**Reduced motion.** Under `prefers-reduced-motion: reduce` the spinner stops rotating (`animation: none` — the idiom already used by `ds/Progress.vue:128-133`), keeping its static ring as the marker; on mobile the line renders the static marker instead of the `DsSpinner` when `MediaQuery.disableAnimationsOf(context)` is true. The rule lives in the line's own scoped style — `DsSpinner` is not modified globally, because that would change every surface in the product. **The selector must cross the component boundary:** the rotation lives on `DsSpinner`'s INNER `.ds-spinner` element, so a scoped rule that names it plainly never matches (scoped styles do not reach a child component's internals) and the spinner would keep turning under `prefers-reduced-motion`. The line's scoped style therefore uses the deep selector — `::v-deep .ds-spinner { animation: none; }` (Vue 3: `:deep(.ds-spinner)`) — targeting the spinner's inner element from the line's own scope.

**Handles.** Web `data-testid="agent-activity-line"`, per-operation row `data-testid="agent-activity-op-<operation>"` (the chat surface's `data-testid` spelling). Mobile `ValueKey('agent-activity-line')`, `ValueKey('agent-activity-op-<operation>')` — the mobile key mirrors the web name, with the operation name as the discriminator.

**Inherited, unchanged.** `DsStatusTag` (`ds/StatusTag.vue`, variants success/error/warning/info/pending) exists but is **not** used in chat and is not used here: the line is text with a marker, not a badge. The nav-status pill (`role="status"` + `data-status`, `NavBarComponent.vue:178-191`) is the precedent for the live-region pattern, not a visual one.

## Do's and Don'ts

| Do | Don't |
|---|---|
| Use the warning family for a failed operation | Use `--danger` / `tokens.danger` — an error is a state, not an accusation |
| Animate nothing beyond the existing spinner | Add a progress bar, a percentage, a pulsing dot, a skeleton, or a count-up timer |
| Keep the line to one size, one weight, one line of text | Bold the operation, uppercase it, or colour the label by state |
| Localize the **template** client-side, keyed by the server's operation name | Send a localized operation string from the server, or show the raw operation id (`search_knowledge`) to the user |
| Keep the line transient — it collapses when the answer starts | Persist activity as a message, keep it in the transcript, or scroll it into history |
| Reuse `DsSpinner` on web and `DsSpinner` on mobile | Hand-roll a spinner, or keep mobile's raw `CircularProgressIndicator` (the chat row at `chatbot_component.dart:2483` does today — the line supersedes that) |
| Let the existing `.answer-card` gap separate the line from the answer | Add the line's own margin, a divider, a border, or a background fill in the running state |
