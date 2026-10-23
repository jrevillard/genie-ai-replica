# Chat Conversation View V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the UX's frozen V1 arbitration to the conversation view: the dashboard's visual identity (wave, DS tokens, unified answer card) applied to the existing Vue components.

**Architecture:** No new global components. `ChatBotComponent.vue`'s conversation branch gains a header strip, a unified answer card (sources, actions, confidence, warnings inside one elevated card), and the layer paints a fixed wave behind the conversation. The shared `ChatComposer` gains prop-driven button visibility and a multiline cap. The `genie-visual-effects.css` layer stays additive; the app with the layer off keeps today's layout and the base theme's paint.

**Tech Stack:** Vue 3 Options API, Vuex, vue-i18n, DS primitives (`DsPill`, `DsButton`, `DsSpinner`), lucide icons, Playwright (single worker).

**Spec:** `docs/superpowers/specs/2026-10-23-chat-conversation-v1-design.md` — read it first; every D-code below (D1–D17) is defined there.

## Global Constraints

- **No new visual language.** Colours, radii, spacing, shadows come from the DS tokens only (`var(--surface)`, `var(--border)`, `var(--shadow-sm)`, `var(--space-*)`, `var(--radius-*)`). No hardcoded hex.
- **The Living Intelligence layer stays additive.** Everything painted in `genie-visual-effects.css` is gated on `html[data-visual='on']`. With the layer off, the app's layout is unchanged and the paint is the base theme's. Never out-specify the layer from the app or vice versa (see `components/gov-chat-frontend/CLAUDE.md` § Visual Fidelity).
- **No dead controls.** Attach/mic disappear from the conversation composer (D6).
- **All 14 locales** carry every new i18n key (`ar, bn, de, en, es, fr, id, man, pt, ru, st, sw, th, zh`). The Jest locale-parity test fails otherwise.
- **Comments describe the current code** — no historical narrative, no story/issue numbers.
- **Never busy-wait**: long commands (test suites, image builds) run with the Bash tool's `run_in_background: true` and a redirected log file.
- **Never rebuild/restart the `living-intelligence` shared stack** (the user watches 9443) except the explicit frontend swap the coordinator performs. Agents use their own slot: `bash .superpowers/sdd/2026-10-20-living-intelligence-theme/agent-stack.sh build|up <slot>` → slot a = 9444, slot b = 9445.
- **No `-c user.email=`/`-c user.name=` on git commit. Do not push.** The coordinator pushes.
- The e2e suite logs in through the browser (`tests/e2e/helpers/chatbot.js` → `loginViaUI`); the shared Keycloak is one instance — a `loginViaUI` timeout is load, not your regression; re-run the spec alone.

## Environment (every task)

- Worktree: `/home/jerome/git_projects/ITU/genie-ai/.claude/worktrees/living-intelligence` (branch `feat/living-intelligence-theme`, MR !582).
- Dev loop: build your slot from the working tree, then run the affected Playwright spec against it. Verify the built content, never timestamps: `docker exec <slot>-frontend sh -c 'grep <marker> /app/dist/css/*.css /app/dist/js/*.js'`.
- Unit tests: `cd components/gov-chat-frontend && npm test`. Format: `npx prettier --check` on touched files.
- Playwright: `BASE_URL=https://localhost:944<4|5> npx playwright test tests/e2e/<file>.spec.js --project=chromium --workers=1` from the worktree root.
- The V1 reference sheet for the visual loop: copy `/tmp/claude-1000/-home-jerome-git-projects-ITU-genie-ai/62d55518-0dd4-4ab5-a41b-f15d0d3d9619/images/24.png` to `/tmp/mockups/genie-chat-v1-spec.png` once (top: full conversation light+dark; bottom row: the 7 states and the B1–B7 tiles).

---

### Task 1: The conversation header strip (D13)

**Files:**
- Modify: `components/gov-chat-frontend/src/components/ChatBotComponent.vue` (template: insert before the system-status panel; script: computed; styles)
- Test: `tests/e2e/chat-conversation.spec.js` (new file, this task creates it)

**Interfaces:**
- Consumes: `currentChatTitle` (data, `ChatBotComponent.vue:478`, set at `:1408`/`:1646`), `startNewChat()` (`:1757` — shows the unsaved-changes confirm when needed, then returns to the welcome screen; never deletes history).
- Produces: `.conversation-header` with `[data-testid="conversation-header-title"]` (the title text) and `[data-testid="conversation-header-close"]` (the × button). Later tasks read nothing from it; the e2e specs assert on the testids.

- [ ] **Step 1: Write the failing e2e test**

In the new `tests/e2e/chat-conversation.spec.js`:

```js
const { test, expect } = require('@playwright/test');
const { openWelcomeScreen } = require('./helpers/welcome');

const BASE_URL = process.env.BASE_URL || 'https://localhost';

test.describe('Conversation V1', () => {
  test('the header names the conversation and × returns to the welcome screen, keeping history', async ({ browser }) => {
    const { ctx, page } = await openWelcomeScreen(browser, { viewport: { width: 1440, height: 900 }, theme: 'light' });
    // Ask something so a conversation exists, then save it.
    await page.locator('[data-testid="welcome-composer"] textarea').fill('What is GENIE.AI?');
    await page.locator('[data-testid="welcome-composer"] textarea').press('Enter');
    await page.waitForSelector('.chat-message.bot', { timeout: 30000 });
    // The header must be present with a non-empty title.
    const title = page.locator('[data-testid="conversation-header-title"]');
    await expect(title).toBeVisible();
    await expect(title).not.toBeEmpty();
    // × closes the conversation: the welcome overlay returns, history is kept.
    await page.locator('[data-testid="conversation-header-close"]').click();
    // The unsaved-changes confirm may appear — accept the default action (save or discard is the dialog's default button).
    const confirm = page.locator('.confirm-dialog, [role="dialog"]');
    if (await confirm.isVisible({ timeout: 2000 }).catch(() => false)) {
      await page.keyboard.press('Enter');
    }
    await expect(page.locator('.quick-help-overlay')).toBeVisible({ timeout: 15000 });
    await ctx.close();
  });
});
```

- [ ] **Step 2: Run it — expect FAIL (no header testids)**

`BASE_URL=https://localhost:9445 npx playwright test tests/e2e/chat-conversation.spec.js --project=chromium --workers=1`

- [ ] **Step 3: Implement the header**

In the template, directly before `<div class="system-status-panel">`, add:

```html
<!-- The conversation header: names the open conversation and closes it.
     × runs startNewChat, whose confirm guards unsaved changes; saved
     history is never removed by closing. -->
<div class="conversation-header">
  <span class="conversation-header__title" data-testid="conversation-header-title">
    {{ currentChatTitle || translate('chatbot.justChat') }}
  </span>
  <button
    type="button"
    class="conversation-header__close"
    :title="translate('chatbot.closeConversation')"
    :aria-label="translate('chatbot.closeConversation')"
    data-testid="conversation-header-close"
    @click="startNewChat"
  >
    <X :size="16" aria-hidden="true" />
  </button>
</div>
```

Import `X` from `@lucide/vue` in the component's `components:` map (follow the existing lucide imports). `chatbot.justChat` and `chatbot.closeConversation` are added in Task 11's i18n batch — for this task register them with `translate('chatbot.justChat', 'Just Chat')` and `translate('chatbot.closeConversation', 'Close conversation')` fallbacks so the test passes before the locales land.

Styles (scoped, DS tokens only):

```css
.conversation-header {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-xs) var(--space-md);
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}
.conversation-header__title {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--fg);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.conversation-header__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  flex: 0 0 auto;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}
.conversation-header__close:hover { background: var(--accent-muted); color: var(--fg); }
```

- [ ] **Step 4: Run the test — expect PASS**

- [ ] **Step 5: Mutation check.** Delete the `@click="startNewChat"` binding → the test must go RED (the welcome overlay never returns). Revert → GREEN. Record both.

- [ ] **Step 6: Commit** `feat(theme): the conversation header names and closes the conversation`

---

### Task 2: The wave behind the conversation (D7)

**Files:**
- Modify: `components/gov-chat-frontend/src/styles/genie-visual-effects.css` (new rule block at the end of the layer section)
- Test: `tests/e2e/chat-conversation.spec.js`

**Interfaces:**
- Consumes: `--visual-waves` (the wave asset variable the layer already declares), `.chatbot-container` (the centre column — the layer already sets `min-width: 0` on it).
- Produces: a fixed, bottom-anchored wave painting on `.chatbot-container::after`, plus `.chat-input` restyled to float (transparent band) — **the `.chat-input` restyle is the APP's** (this file's companion change is in ChatBotComponent.vue, Step 3).

- [ ] **Step 1: Write the failing test** (append to `chat-conversation.spec.js`)

```js
test('the wave is fixed behind the conversation and does not scroll with the messages', async ({ browser }) => {
  const { ctx, page } = await openWelcomeScreen(browser, { viewport: { width: 1440, height: 900 }, theme: 'light' });
  await page.locator('[data-testid="welcome-composer"] textarea').fill('What is GENIE.AI?');
  await page.locator('[data-testid="welcome-composer"] textarea').press('Enter');
  await page.waitForSelector('.chat-message.bot', { timeout: 30000 });
  await page.waitForTimeout(500);
  const waveBox = async () => page.evaluate(() => {
    const el = document.querySelector('.chatbot-container');
    return el ? el.getBoundingClientRect().bottom : null;
  });
  // The wave paints as a fixed pseudo-element: its visual band is the
  // container's bottom. Scroll the messages; the band must not move.
  const before = await page.evaluate(() => {
    const cs = getComputedStyle(document.querySelector('.chatbot-container'), '::after');
    return { content: cs.content, position: cs.position, bottom: cs.bottom };
  });
  await page.evaluate(() => { document.querySelector('.chat-window').scrollTop = 400; });
  await page.waitForTimeout(200);
  const after = await page.evaluate(() => {
    const cs = getComputedStyle(document.querySelector('.chatbot-container'), '::after');
    return { bottom: cs.bottom };
  });
  expect(before.content, 'the wave pseudo must paint').not.toBe('none');
  expect(before.position, 'the wave must be fixed within the container').toBe('fixed');
  expect(after.bottom, 'the wave must not scroll with the messages').toBe(before.bottom);
  await ctx.close();
});
```

- [ ] **Step 2: Run — expect FAIL** (no `::after` on `.chatbot-container`).

- [ ] **Step 3: Implement.** In `genie-visual-effects.css`, after the welcome overlay's `::after` block, add:

```css
/*
 * The conversation's wave: the same asset as the welcome screen's,
 * anchored to the bottom of the centre column and fixed within it —
 * it never scrolls with the messages. Slightly dimmer than the
 * welcome's band to favour the text over it; it shows behind the
 * composer and rises a little on the sides only.
 */
html[data-visual='on'] .genie-living-intelligence .chatbot-container::after {
  content: '';
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  height: clamp(120px, 22vh, 260px);
  background: var(--visual-waves) bottom / 100% auto no-repeat;
  opacity: 0.72;
  pointer-events: none;
  z-index: 0;
}
```

And in `ChatBotComponent.vue`'s scoped styles, `.chat-input` (`:2694`) loses its band so the pill floats over the wave:

```css
.chat-input {
  background: transparent;
  border-top: none;
  padding: var(--space-sm) var(--space-md);
  position: relative;
  z-index: 1;
}
```

(The `.chat-window` already paints `var(--surface)`; give it `position: relative; z-index: 1;` too so messages sit above the wave, and `.system-status-panel`/`.conversation-header` `z-index: 1` likewise — same pattern, three one-line additions.)

- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Mutation.** Change `position: fixed` → `absolute` on the pseudo → the test must go RED (`the wave must be fixed`); revert → GREEN. Also verify the layer-off state: set `data-visual='off'` in the probe — `content` reads `none` and the layout boxes are unchanged (assert in the same test: `.chat-window`'s rect equals across states).
- [ ] **Step 6: Commit** `feat(theme): the dashboard's wave sits fixed behind the conversation`

---

### Task 3: The composer — dead buttons out of the conversation, multiline cap (D6, D17)

**Files:**
- Modify: `components/gov-chat-frontend/src/components/ChatComposer.vue` (props, template conditionals, styles)
- Modify: `components/gov-chat-frontend/src/components/ChatBotComponent.vue` (the chat-input usage passes the new props; the welcome usage passes `true` explicitly)
- Test: `tests/e2e/chat-conversation.spec.js` + keep `tests/e2e/chat-composer.spec.js` green

**Interfaces:**
- Consumes: the composer's existing props (`attachTitle`, `micTitle` — currently `required: true`).
- Produces: `showAttach` / `showMic` (Boolean, default `true` — the welcome's reference keeps them); a `maxLines` (Number, default `0` = uncapped) driving the field's `max-height`. `attachTitle`/`micTitle` become optional (default `''`).

- [ ] **Step 1: Failing tests**

```js
test('the conversation composer has no attach or mic buttons and grows to five lines', async ({ browser }) => {
  const { ctx, page } = await openWelcomeScreen(browser, { viewport: { width: 1440, height: 900 }, theme: 'light' });
  await page.locator('[data-testid="welcome-composer"] textarea').fill('What is GENIE.AI?');
  await page.locator('[data-testid="welcome-composer"] textarea').press('Enter');
  await page.waitForSelector('[data-testid="chat-composer"] textarea', { timeout: 30000 });
  await expect(page.locator('[data-testid="composer-attach-btn"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="composer-mic-btn"]')).toHaveCount(0);
  // Multiline: type 8 newlines; the field must stop at 5 lines and scroll.
  const lines = Array(8).fill('line').join('\n');
  await page.locator('[data-testid="chat-composer"] textarea').fill(lines);
  await page.waitForTimeout(300);
  const m = await page.evaluate(() => {
    const ta = document.querySelector('[data-testid="chat-composer"] textarea');
    const cs = getComputedStyle(ta);
    return { scrollH: ta.scrollHeight, clientH: ta.clientHeight, maxH: cs.maxHeight, overflowY: cs.overflowY };
  });
  expect(parseFloat(m.maxH), 'the field caps at five lines').toBeLessThan(m.scrollH);
  expect(m.overflowY, 'beyond five lines the field scrolls internally').toBe('auto');
  await ctx.close();
});
```

- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement.** In `ChatComposer.vue`: `attachTitle`/`micTitle` lose `required: true` (default `''`); add `showAttach: { type: Boolean, default: true }`, `showMic: { type: Boolean, default: true }`, `maxLines: { type: Number, default: 0 }`; wrap each dead button in `v-if="showAttach"` / `v-if="showMic"`. On the root div add `:style="[tintStyle, fieldCapStyle]"` where:

```js
fieldCapStyle() {
  if (!this.maxLines) return null;
  // 5 lines x 27px line box + the field's own vertical padding (2 x 8px).
  return { '--composer-field-max-height': `${this.maxLines * 27 + 16}px` };
}
```

In the composer's styles, on `.chat-composer__field` add:

```css
.chat-composer__field {
  max-height: var(--composer-field-max-height, none);
  overflow-y: auto;
}
```

(`field-sizing: content` + `min-height: 0` are already on that selector from the welcome round; the cap layers on top.) In `ChatBotComponent.vue`'s **chat-input** usage add `:show-attach="false" :show-mic="false" :max-lines="5"`; the **welcome** usage adds `:show-attach="true" :show-mic="true"` explicitly (its reference keeps them).

- [ ] **Step 4: Run — expect PASS;** also run `tests/e2e/chat-composer.spec.js` (welcome behaviour unchanged, the dead-button assertions there target the welcome composer and must stay green).
- [ ] **Step 5: Mutation.** Re-enable attach in the chat (`:show-attach="true"`) → RED (`toHaveCount(0)` fails); revert → GREEN. Change `maxLines` to `50` → RED (the cap assertion); revert → GREEN.
- [ ] **Step 6: Commit** `feat(theme): the conversation composer drops the dead buttons and caps at five lines`

---

### Task 4: The avatars (D11)

**Files:**
- Modify: `components/gov-chat-frontend/src/components/ChatBotComponent.vue` (template: avatar elements in the message loop; script: computed `assistantIcon`, methods `userInitials`, `userAvatarHue`; styles)
- Test: `tests/e2e/chat-conversation.spec.js`

**Interfaces:**
- Consumes: `this.config.app.icon` (`{type:'file', value}` — the navbar already renders it), `this.$store.getters['auth/currentUser']` (`{name, preferred_username, avatarUrl?}` — `store/modules/auth.js:29`).
- Produces: `.message-avatar--assistant` (36×36 rounded tile, the product icon, identical in both themes) and `.message-avatar--user` (photo | initials circle | silhouette, in that order) rendered once per message row.

- [ ] **Step 1: Failing test**

```js
test('each turn carries its avatar: the product tile for the assistant, initials for the user', async ({ browser }) => {
  const { ctx, page } = await openWelcomeScreen(browser, { viewport: { width: 1440, height: 900 }, theme: 'light' });
  await page.locator('[data-testid="welcome-composer"] textarea').fill('What is GENIE.AI?');
  await page.locator('[data-testid="welcome-composer"] textarea').press('Enter');
  await page.waitForSelector('.chat-message.bot', { timeout: 30000 });
  const a = await page.evaluate(() => {
    const el = document.querySelector('.message-avatar--assistant');
    const cs = el ? getComputedStyle(el) : null;
    return el ? { w: el.getBoundingClientRect().width, h: el.getBoundingClientRect().height, radius: cs.borderRadius } : null;
  });
  expect(a, 'the assistant tile renders').not.toBeNull();
  expect(a.w, 'the assistant tile is 36px wide').toBe(36);
  expect(a.h, 'the assistant tile is 36px tall').toBe(36);
  const u = await page.evaluate(() => {
    const el = document.querySelector('.message-avatar--user');
    return el ? { text: el.textContent.trim(), hasPhoto: !!el.querySelector('img') } : null;
  });
  expect(u, 'the user avatar renders').not.toBeNull();
  expect(u.text.length > 0 || u.hasPhoto, 'initials or a photo, never empty').toBe(true);
  await ctx.close();
});
```

- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement.** In the message loop, before `.message-wrapper`, add:

```html
<div v-if="msg.sender === 'bot'" class="message-avatar message-avatar--assistant" data-testid="assistant-avatar">
  <img v-if="config.app.icon.type === 'file'" :src="config.app.icon.value" alt="" />
  <span v-else class="message-avatar__glyph" v-html="config.app.icon.value"></span>
</div>
<div v-else class="message-avatar message-avatar--user" data-testid="user-avatar">
  <img v-if="userAvatarUrl" :src="userAvatarUrl" alt="" />
  <span v-else-if="userInitials" class="message-avatar__initials" :style="userAvatarStyle">{{ userInitials }}</span>
  <span v-else class="message-avatar__silhouette" aria-hidden="true"><User :size="18" /></span>
</div>
```

Script:

```js
computed: {
  assistantIcon() { return this.config && this.config.app ? this.config.app.icon : null; },
  authUser() { return this.$store.getters['auth/currentUser'] || {}; },
  userAvatarUrl() { return this.authUser.avatarUrl || ''; },
  userInitials() {
    const n = this.authUser.name || this.authUser.preferred_username || '';
    const parts = n.trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '';
    return parts.slice(0, 2).map((p) => p[0].toUpperCase()).join('');
  },
  userAvatarStyle() {
    // A stable hue per name, drawn from the DS accents — never a raw hex.
    const n = this.authUser.name || this.authUser.preferred_username || '';
    const palette = ['var(--accent)', 'var(--accent-secondary)', 'var(--info)', 'var(--success)'];
    let h = 0;
    for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) >>> 0;
    return { background: palette[h % palette.length] };
  }
}
```

Import `User` from `@lucide/vue`. Styles:

```css
.message-avatar {
  flex: 0 0 auto;
  width: 36px;
  height: 36px;
  border-radius: var(--radius-md);
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}
.message-avatar--assistant { box-shadow: none; border: 1px solid var(--border-light); background: var(--surface); }
.message-avatar--assistant img, .message-avatar--user img { width: 100%; height: 100%; object-fit: cover; }
.message-avatar--user { border-radius: var(--radius-pill, 999px); }
.message-avatar__initials { font-size: var(--text-xs); font-weight: 600; color: var(--accent-fg); }
```

Note: the user row must place the avatar on the right (`.chat-message.user` already flips the wrapper; place the avatar element after the wrapper in the template and let the row's existing `flex-direction: row-reverse` handle the side).

- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Mutation.** Change the tile width to `40px` → RED; revert → GREEN. Remove the initials fallback (`return ''`) → RED (`never empty`); revert → GREEN.
- [ ] **Step 6: Commit** `feat(theme): every turn carries its avatar`

---

### Task 5: The unified answer card (D9, D14)

**Files:**
- Modify: `components/gov-chat-frontend/src/components/ChatBotComponent.vue` (template restructure of the message loop; styles)
- Test: `tests/e2e/chat-conversation.spec.js`

**Interfaces:**
- Consumes: the existing message shape (`content`, `sender`, `isStreaming`, `confidenceScore`, `isGrounded`, `timestamp`).
- Produces: `.answer-card` wrapping every assistant answer (`.message-bubble` moves inside it, loses its own border/shadow), `[data-testid="answer-card"]`; the thinking indicator lives inside the card; the confidence block and (later tasks) the sources and actions render inside it too.

- [ ] **Step 1: Failing test**

```js
test('the assistant answer renders inside one elevated card, from the first frame', async ({ browser }) => {
  const { ctx, page } = await openWelcomeScreen(browser, { viewport: { width: 1440, height: 900 }, theme: 'light' });
  await page.locator('[data-testid="welcome-composer"] textarea').fill('What is GENIE.AI?');
  await page.locator('[data-testid="welcome-composer"] textarea').press('Enter');
  // The card exists immediately (the thinking frame), before the answer text.
  await page.waitForSelector('[data-testid="answer-card"]', { timeout: 15000 });
  const early = await page.evaluate(() => {
    const card = document.querySelector('[data-testid="answer-card"]');
    const cs = getComputedStyle(card);
    return { shadow: cs.boxShadow !== 'none', hasThinking: !!card.querySelector('.streaming-indicator') };
  });
  expect(early.shadow, 'the card is elevated').toBe(true);
  await page.waitForSelector('.chat-message.bot .message-bubble', { timeout: 30000 });
  const late = await page.evaluate(() => {
    const card = document.querySelector('[data-testid="answer-card"]');
    const bubble = card.querySelector('.message-bubble');
    return { bubbleInside: !!bubble, text: (bubble.textContent || '').length };
  });
  expect(late.bubbleInside, 'the bubble lives inside the card').toBe(true);
  expect(late.text, 'the answer text arrives in the card').toBeGreaterThan(0);
  await ctx.close();
});
```

- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement.** Restructure the bot branch of the message loop:

```html
<div v-else class="answer-card" data-testid="answer-card">
  <div class="message-bubble">
    <div v-if="msg.isStreaming && !msg.content" class="streaming-indicator">
      <DsSpinner size="sm" />
      <span>{{ translate('chatbot.thinking', 'Thinking...') }}</span>
    </div>
    <!-- eslint-disable-next-line vue/no-v-html -->
    <div v-else v-html="renderMarkdown(msg.content)"></div>
  </div>
  <!-- sources (Task 6), actions (Task 7), confidence + grounding (below) -->
</div>
```

The user branch keeps the bare `.message-bubble` (no card). Styles: `.answer-card { background: var(--surface); border: 1px solid var(--border-light); border-radius: var(--radius-md); box-shadow: var(--shadow-sm); padding: var(--space-md); max-width: 85%; }` and `.message-bubble` inside the card loses `border` and `background` (transparent, padding 0) — scope the reset as `.answer-card .message-bubble { ... }`. Move the existing `.bot-message-meta` (confidence + grounding) **inside** the card as its last block (Task 8 restyles the grounding flag; the confidence stays D1's percentage).

- [ ] **Step 4: Run — expect PASS** (plus the whole `welcome-banner`/`chat-composer` suites — the welcome screen must not move).
- [ ] **Step 5: Mutation.** Remove `box-shadow: var(--shadow-sm)` → RED (`the card is elevated`); revert → GREEN.
- [ ] **Step 6: Commit** `feat(theme): the answer becomes one elevated card`

---

### Task 6: Sources per answer (D2)

**Files:**
- Modify: `components/gov-chat-frontend/src/components/ChatBotComponent.vue` (onMetadata: keep per-message sources; template: the collapsible block; script: `toggleSources`, `sourceDocs(msg)`; styles)
- Modify: `components/gov-chat-frontend/src/services/chatbotService.js` **only if** the metadata frame needs no change (it does not — verify, don't edit)
- Test: `tests/e2e/chat-conversation.spec.js`

**Interfaces:**
- Consumes: `metadata.source_documents` per turn (`document_id`, `document_name`, `file_name`, `url`, `score`); `formatFileSize` (`RightSideBarComponent.vue` imports it — re-export from a shared util or import the same module); `GET /api/files/:fileId` (`authenticateToken`-only) returning `file_size`/`file_type`.
- Produces: `msg.sources` (array, per message — the panel's `relatedDocuments` accumulation stays untouched); `msg.sourcesOpen` (Boolean, default `true`); each doc gains `_size`/`_type` once fetched. `[data-testid="answer-sources"]`, `[data-testid="answer-sources-toggle"]`, `[data-testid^="answer-source-card-"]`.

- [ ] **Step 1: Failing test**

```js
test('the answer card carries its own collapsible sources', async ({ browser }) => {
  const { ctx, page } = await openWelcomeScreen(browser, { viewport: { width: 1440, height: 900 }, theme: 'light' });
  await page.locator('[data-testid="welcome-composer"] textarea').fill('How do I apply for a national ID?');
  await page.locator('[data-testid="welcome-composer"] textarea').press('Enter');
  await page.waitForSelector('[data-testid="answer-sources"]', { timeout: 45000 });
  const state = async () => page.evaluate(() => {
    const s = document.querySelector('[data-testid="answer-sources"]');
    const cards = s.querySelectorAll('[data-testid^="answer-source-card-"]');
    return { n: cards.length, open: getComputedStyle(s.querySelector('.answer-sources__list')).display !== 'none' };
  });
  const open = await state();
  expect(open.n, 'sources render as cards').toBeGreaterThan(0);
  expect(open.open, 'open by default').toBe(true);
  await page.locator('[data-testid="answer-sources-toggle"]').click();
  expect((await state()).open, 'the section collapses').toBe(false);
  await ctx.close();
});
```

- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement.** In `onMetadata`, where the docs are mapped for the panel, also set `this.chatMessages[lastMessageIndex].sources = newDocs;` and `this.chatMessages[lastMessageIndex].sourcesOpen = true;`. In the card (after `.message-bubble`, before `.bot-message-meta`):

```html
<div v-if="msg.sources && msg.sources.length" class="answer-sources" data-testid="answer-sources">
  <button type="button" class="answer-sources__toggle" data-testid="answer-sources-toggle"
          :aria-expanded="msg.sourcesOpen ? 'true' : 'false'"
          @click="msg.sourcesOpen = !msg.sourcesOpen">
    <span>{{ translate('chatbot.relatedSources', { n: msg.sources.length }) }}</span>
    <ChevronUp v-if="msg.sourcesOpen" :size="16" aria-hidden="true" />
    <ChevronDown v-else :size="16" aria-hidden="true" />
  </button>
  <div v-show="msg.sourcesOpen" class="answer-sources__list">
    <a v-for="(d, di) in msg.sources" :key="d.id" class="answer-source-card"
       :data-testid="`answer-source-card-${di}`" :href="d.url" target="_blank" rel="noopener">
      <span class="answer-source-card__icon"><FileText :size="16" aria-hidden="true" /></span>
      <span class="answer-source-card__body">
        <span class="answer-source-card__title">{{ d.title }}</span>
        <span class="answer-source-card__meta">{{ docMeta(d) }}</span>
      </span>
      <ExternalLink :size="14" class="answer-source-card__open" aria-hidden="true" />
    </a>
  </div>
</div>
```

Script — `docMeta(d)` lazily fetches type+size per document and caches on the doc object:

```js
methods: {
  docMeta(d) {
    const type = d._type || (d.url ? d.url.split('.').pop().toUpperCase() : 'LINK');
    const size = d._size ? this.formatFileSize(d._size) : '';
    if (!d._fetched && d.id) {
      d._fetched = true;
      this.$http.get(`/api/files/${d.id}`).then((r) => {
        d._size = r.data?.file_size || 0;
        d._type = (r.data?.file_type || type).toUpperCase();
        this.$forceUpdate();
      }).catch(() => { /* the meta line degrades to the type alone */ });
    }
    return size ? `${type} · ${size}` : type;
  }
}
```

(`this.$http` is the app's axios instance — use the same import the component already uses for API calls; check its existing imports and follow them.) Import `formatFileSize` from the module `RightSideBarComponent.vue:105` imports it from. Import `ChevronUp`, `ChevronDown`, `ExternalLink`, `FileText` from `@lucide/vue`. The i18n key `chatbot.relatedSources` takes `{n}` (vue-i18n pluralisation: add `.one`/`.other` forms — see Task 11).

- [ ] **Step 4: Run — expect PASS.** (If the test environment's answer is ungrounded — no sources — the test's `waitForSelector` times out: in that case assert the NEGATIVE instead, per C2: the card shows no sources section. Prefer a knowledge-area query that grounds; verify manually once on the slot.)
- [ ] **Step 5: Mutation.** Remove `v-show="msg.sourcesOpen"` → the collapse assertion REDs; revert → GREEN. Point `msg.sourcesOpen` initial to `false` → the open-by-default assertion REDs; revert → GREEN.
- [ ] **Step 6: Commit** `feat(theme): every answer carries its own collapsible sources`

---

### Task 7: The actions row — inline thumbs, already-rated, copy (D3)

**Files:**
- Modify: `components/gov-chat-frontend/src/components/ChatBotComponent.vue` (template: the actions row inside the card; script: `rateAnswer`, `copyAnswer`; styles)
- Test: `tests/e2e/chat-conversation.spec.js`

**Interfaces:**
- Consumes: the existing feedback submission path (the method `handleFeedbackSubmit` calls — reuse its service call verbatim, with `rating: 5` for up / `1` for down and the same payload shape); `msg.userFeedback` (persisted by `query-service.js:772` — read it back onto the message in Task 11's reload fix); the existing `openFeedbackDialog(index)` for the "details" affordance.
- Produces: `[data-testid="answer-actions"]` with `answer-thumb-up`, `answer-thumb-down`, `answer-details`, `answer-copy`; `msg.userFeedback` in `{'up','down'}` drives the selected state.

- [ ] **Step 1: Failing test**

```js
test('the answer carries thumbs that record a rating and a copy that fills the clipboard', async ({ browser, contextName }) => {
  const { ctx, page } = await openWelcomeScreen(browser, { viewport: { width: 1440, height: 900 }, theme: 'light' });
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.locator('[data-testid="welcome-composer"] textarea').fill('What is GENIE.AI?');
  await page.locator('[data-testid="welcome-composer"] textarea').press('Enter');
  await page.waitForSelector('[data-testid="answer-actions"]', { timeout: 45000 });
  await page.locator('[data-testid="answer-thumb-up"]').click();
  await page.waitForTimeout(500);
  const rated = await page.evaluate(() => document.querySelector('[data-testid="answer-thumb-up"]').getAttribute('data-rated'));
  expect(rated, 'the thumb shows its selected state').toBe('true');
  await page.locator('[data-testid="answer-copy"]').click();
  await page.waitForTimeout(300);
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip.length, 'the clipboard holds the answer text').toBeGreaterThan(0);
  await ctx.close();
});
```

- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement.** Inside the card, after the sources block:

```html
<div class="answer-actions" data-testid="answer-actions">
  <button type="button" class="answer-action" data-testid="answer-thumb-up"
          :data-rated="msg.userFeedback === 'up' ? 'true' : 'false'"
          :aria-pressed="msg.userFeedback === 'up'"
          :title="translate('feedback.helpful')"
          @click="rateAnswer(index, 'up')"><ThumbsUp :size="15" aria-hidden="true" /></button>
  <button type="button" class="answer-action" data-testid="answer-thumb-down"
          :data-rated="msg.userFeedback === 'down' ? 'true' : 'false'"
          :aria-pressed="msg.userFeedback === 'down'"
          :title="translate('feedback.notHelpful')"
          @click="rateAnswer(index, 'down')"><ThumbsDown :size="15" aria-hidden="true" /></button>
  <button type="button" class="answer-action" data-testid="answer-details"
          :title="translate('feedback.button')"
          @click="openFeedbackDialog(index)"><MessageSquareQuote :size="15" aria-hidden="true" /></button>
  <button type="button" class="answer-action" data-testid="answer-copy"
          :title="translate('chatbot.copyAnswer')"
          @click="copyAnswer(msg)"><Copy :size="15" aria-hidden="true" /></button>
  <span v-if="msg.confidenceScore != null && msg.isGrounded !== false" class="confidence-score">
    <Brain :size="14" aria-hidden="true" />
    <span>{{ translate('chatbot.confidence') }}: {{ (msg.confidenceScore * 100).toFixed(0) }}%</span>
  </span>
</div>
```

(The confidence block moves here from `.bot-message-meta` — D1's percentage, unchanged format. The grounding flag joins the card in Task 8.)

Script:

```js
methods: {
  async rateAnswer(index, value) {
    const msg = this.chatMessages[index];
    const rating = value === 'up' ? 5 : 1;
    // Reuse the exact service call handleFeedbackSubmit makes — same
    // payload shape, so analytics keeps its 1-5 scale.
    await this.submitFeedbackPayload(msg, rating, '');   // extract the submit body of handleFeedbackSubmit into this helper
    msg.userFeedback = value;
  },
  async copyAnswer(msg) {
    const holder = document.createElement('div');
    holder.innerHTML = this.renderMarkdown(msg.content);
    const text = holder.textContent || '';
    try { await navigator.clipboard.writeText(text); } catch { /* clipboard denied — the button simply does nothing */ }
  }
}
```

Refactor `handleFeedbackSubmit` so its service call becomes the reusable `submitFeedbackPayload(msg, rating, comment)` (the dialog path passes the comment; the thumbs pass an empty one). Move `.bot-message-meta`'s remaining block (grounding flag → Task 8) inside the card. Styles: `.answer-actions { display:flex; gap: var(--space-sm); align-items:center; margin-top: var(--space-sm); padding-top: var(--space-sm); border-top: 1px solid var(--border-light); }`, `.answer-action { border:none; background:transparent; color: var(--muted); cursor:pointer; display:inline-flex; padding:4px; border-radius: var(--radius-sm); }`, `.answer-action:hover { color: var(--fg); background: var(--accent-muted); }`, `.answer-action[data-rated='true'] { color: var(--accent); }`.

- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Mutation.** Remove the `data-rated` binding → the selected-state assertion REDs; revert → GREEN. Break `copyAnswer` (write `'x'`) → the clipboard assertion REDs; revert → GREEN.
- [ ] **Step 6: Commit** `feat(theme): the answer carries its actions — thumbs, details, copy — and its confidence`

---

### Task 8: Ungrounded amber + the error state with Retry (D15, C2, D4-grounding)

**Files:**
- Modify: `components/gov-chat-frontend/src/components/ChatBotComponent.vue` (the grounding flag restyles inside the card; the error message renders as a card state; script: `retryAnswer`; styles)
- Test: `tests/e2e/chat-conversation.spec.js`

**Interfaces:**
- Consumes: `msg.isGrounded === false` (already set from metadata); the existing streaming-error path (`systemStatus.errorMessage`, the `chatbot.streamingError` key) and the send pathway (`sendMessage` → the query payload) for Retry.
- Produces: the grounding flag as `.answer-warning` (amber, inside the card, after the bubble, before the actions); `[data-testid="answer-error"]` with `[data-testid="answer-retry"]` on failed answers; `msg._query` (the outgoing query text, stored when the message is created) powering the retry.

- [ ] **Step 1: Failing tests**

```js
test('an ungrounded answer shows the amber warning inside the card and no empty sources', async ({ browser }) => {
  const { ctx, page } = await openWelcomeScreen(browser, { viewport: { width: 1440, height: 900 }, theme: 'light' });
  // A chit-chat prompt the retriever cannot ground; if it grounds, the
  // test self-skips (the state needs an ungrounded answer to exist).
  await page.locator('[data-testid="welcome-composer"] textarea').fill('Tell me a joke about clouds');
  await page.locator('[data-testid="welcome-composer"] textarea').press('Enter');
  await page.waitForSelector('.chat-message.bot .answer-card', { timeout: 45000 });
  const s = await page.evaluate(() => {
    const card = document.querySelector('.chat-message.bot .answer-card');
    const warn = card.querySelector('.answer-warning');
    return {
      warn: warn ? getComputedStyle(warn).color : null,
      sources: !!card.querySelector('[data-testid="answer-sources"]')
    };
  });
  if (!s.warn) { test.skip(true, 'the answer grounded — the state needs an ungrounded one'); return; }
  expect(s.sources, 'no empty sources section on an ungrounded answer').toBe(false);
  await ctx.close();
});

test('a failed turn shows a retry that re-sends the same query', async ({ browser }) => {
  const { ctx, page } = await openWelcomeScreen(browser, { viewport: { width: 1440, height: 900 }, theme: 'light' });
  // Sabotage the backend call for the first attempt only: abort the SSE
  // route once, then let it through.
  let aborted = false;
  await page.route('**/api/chat/**', async (route) => {
    if (!aborted) { aborted = true; return route.abort(); }
    return route.continue();
  });
  await page.locator('[data-testid="welcome-composer"] textarea').fill('What is GENIE.AI?');
  await page.locator('[data-testid="welcome-composer"] textarea').press('Enter');
  await page.waitForSelector('[data-testid="answer-error"]', { timeout: 30000 });
  await page.locator('[data-testid="answer-retry"]').click();
  await page.waitForSelector('.chat-message.bot .message-bubble', { timeout: 45000 });
  const n = await page.locator('.chat-message.user').count();
  expect(n, 'the retry does not duplicate the user turn').toBe(1);
  await ctx.close();
});
```

- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement.**

Grounding (the existing `v-else-if="msg.isGrounded === false"` block moves inside the card, restyled):

```html
<div v-else-if="msg.isGrounded === false" class="answer-warning" role="note">
  <AlertTriangle :size="15" aria-hidden="true" />
  <span>{{ translate('chatbot.aiGeneratedNoDocs', 'AI-generated — not based on library documents') }}</span>
</div>
```

```css
.answer-warning {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  margin-top: var(--space-sm);
  padding: var(--space-xs) var(--space-sm);
  border-radius: var(--radius-sm);
  background: var(--warning-bg);
  color: var(--warning);
  font-size: var(--text-xs);
}
```

(Delete the old `.grounding-flag` styles — the class is gone, no orphan CSS. `--warning-bg`/`--warning` are DS tokens; verify the exact names in `theme-variables.css` and use what exists.)

Error + Retry: where the send pathway catches a failure and currently writes `systemStatus.errorMessage`, also finalise the assistant message as a failed turn:

```js
msg.isError = true;
msg._query = queryText;   // set when the message is created, before the request
```

Template (inside the card, instead of the bubble when failed):

```html
<div v-if="msg.isError" class="answer-error" data-testid="answer-error">
  <AlertTriangle :size="16" aria-hidden="true" />
  <span>{{ translate('chatbot.errorUnableToComplete', 'Unable to complete the response.') }}</span>
  <button type="button" class="answer-retry" data-testid="answer-retry"
          @click="retryAnswer(index)">
    <RotateCcw :size="14" aria-hidden="true" />
    <span>{{ translate('chatbot.retry', 'Retry') }}</span>
  </button>
</div>
```

```js
methods: {
  retryAnswer(index) {
    const msg = this.chatMessages[index];
    const q = msg._query;
    this.chatMessages.splice(index, 1);   // the failed turn is replaced, not stacked
    this.sendMessageFromText(q);          // extract the body of the send pathway that takes a text and runs it
  }
}
```

(The send pathway currently reads `this.newMessage`; extract its body into `sendMessageFromText(text)` and have the UI path call it after setting `this.newMessage = text` — one seam, both entries keep working.) Never colour the card red: the error block uses `--warning-bg` like the grounding flag; only the pictogram differs.

- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Mutation.** Replace `--warning-bg` with `var(--danger)` on `.answer-warning` → the colour assertion you added for the amber (`expect(s.warn)` against the resolved amber token — assert the resolved RGB equals the token's) REDs; revert → GREEN. Remove the `splice` in `retryAnswer` → the no-duplicate assertion REDs; revert → GREEN.
- [ ] **Step 6: Commit** `feat(theme): the ungrounded warning and the retryable error live in the card`

---

### Task 9: The compact offline indicator (D4-offline)

**Files:**
- Modify: `components/gov-chat-frontend/src/components/ChatBotComponent.vue` (the system-status panel restyles compact; the offline case gains the accessible explanation)
- Test: `tests/e2e/chat-conversation.spec.js`

**Interfaces:**
- Consumes: `systemStatus` (`online`, `errorMessage`, `lastResponseTime`) — unchanged shape.
- Produces: `.system-status-panel--compact`; online = one small pill (the response time moves to `title`); offline = pill + `role="status"` explanation.

- [ ] **Step 1: Failing test**

```js
test('the status indicator is one compact strip; offline carries an accessible explanation', async ({ browser }) => {
  const { ctx, page } = await openWelcomeScreen(browser, { viewport: { width: 1440, height: 900 }, theme: 'light' });
  await page.locator('[data-testid="welcome-composer"] textarea').fill('What is GENIE.AI?');
  await page.locator('[data-testid="welcome-composer"] textarea').press('Enter');
  await page.waitForSelector('.system-status-panel', { timeout: 15000 });
  const s = await page.evaluate(() => {
    const p = document.querySelector('.system-status-panel');
    return { h: p.getBoundingClientRect().height, role: p.getAttribute('data-status') };
  });
  expect(s.h, 'the strip is compact').toBeLessThan(40);
  expect(['online', 'offline'], 'the strip carries its state').toContain(s.role);
  await ctx.close();
});
```

- [ ] **Step 2: Run — expect FAIL** (the current panel is taller than 40 px and carries no `data-status`).
- [ ] **Step 3: Implement.** `<div class="system-status-panel" :data-status="systemStatus.online ? 'online' : 'offline'">`; the metrics block renders only when `!systemStatus.online` (the explanation — the pill + `status-error-message` — is the offline case, with `role="status"` on the wrapper); the response time moves to the pill's `:title`. Styles: the panel collapses to `display:flex; align-items:center; gap: var(--space-sm); padding: 4px var(--space-md); font-size: var(--text-xs);` and hides the metrics in the online case. Keep every existing class the specs already read (`system-status-panel` itself stays).
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Mutation.** Raise the compact threshold — remove the padding rule → RED (`the strip is compact`); revert → GREEN.
- [ ] **Step 6: Commit** `feat(theme): the status strip is compact and explains itself when offline`

---

### Task 10: The empty documents panel (D16)

**Files:**
- Modify: `components/gov-chat-frontend/src/components/RightSideBarComponent.vue` (the empty state: pictogram, short message, explanation; the FAQs stay)
- Test: `tests/e2e/chat-conversation.spec.js`

**Interfaces:**
- Consumes: the existing empty branch (`relatedDocuments.length === 0`), the existing `documents`/`faq` i18n keys.
- Produces: `[data-testid="documents-empty"]` with pictogram + `documents-empty-title` + `documents-empty-hint`; the FAQ section unchanged below it.

- [ ] **Step 1: Failing test**

```js
test('the documents panel shows a neutral empty state and keeps the FAQs', async ({ browser }) => {
  const { ctx, page } = await openWelcomeScreen(browser, { viewport: { width: 1440, height: 900 }, theme: 'light' });
  await page.locator('[data-testid="welcome-composer"] textarea').fill('What is GENIE.AI?');
  await page.locator('[data-testid="welcome-composer"] textarea').press('Enter');
  await page.waitForSelector('.chat-message.bot', { timeout: 45000 });
  await page.waitForSelector('[data-testid="documents-empty"]', { timeout: 15000 });
  const s = await page.evaluate(() => {
    const panel = document.querySelector('.right-sidebar, [class*="right"]');
    const empty = document.querySelector('[data-testid="documents-empty"]');
    const faq = document.body.querySelector('[class*="faq"], [class*="Faq"]');
    return { emptyText: empty ? empty.textContent : '', faqVisible: !!faq };
  });
  expect(s.emptyText.length, 'the empty state explains itself').toBeGreaterThan(0);
  expect(s.faqVisible, 'the FAQs stay accessible').toBe(true);
  await ctx.close();
});
```

- [ ] **Step 2: Run — expect FAIL** (the empty branch exists but carries no pictogram/testid pair).
- [ ] **Step 3: Implement.** Replace the empty branch's content:

```html
<div v-else class="documents-empty" data-testid="documents-empty">
  <Files :size="28" class="documents-empty__icon" aria-hidden="true" />
  <p class="documents-empty__title">{{ translate('documents.noneYet') }}</p>
  <p class="documents-empty__hint">{{ translate('documents.willAppearHere') }}</p>
</div>
```

(Import `Files` from `@lucide/vue`; the two keys are new — Task 11's batch, with English fallbacks here.) Styles: centred column, `color: var(--muted)`, the icon at `opacity: 0.5`, gaps `var(--space-sm)`. The FAQs render after it unchanged. Also fix the **singular/plural label mismatch** at `RightSideBarComponent.vue:377` while here (read the line; make the label follow `relatedDocuments.length` — the exact fix is a one-line ternary on the existing key pair, and the Task 11 batch adds the missing singular key if absent).
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Mutation.** Remove the hint `<p>` → RED (`explains itself` needs both texts — assert on the two children); revert → GREEN.
- [ ] **Step 6: Commit** `feat(theme): the documents panel explains its empty state`

---

### Task 11: Data integrity + the i18n batch (the fixes the states exposed, all 14 locales)

**Files:**
- Modify: `components/gov-chat-frontend/src/components/ChatBotComponent.vue` (the reload path restores metadata; `formatMessageTime` takes the app locale)
- Modify: `components/gov-chat-frontend/src/i18n/locales/{ar,bn,de,en,es,fr,id,man,pt,ru,st,sw,th,zh}.js` (the new keys)
- Test: `components/gov-chat-frontend/src/__tests__/components/ChatBotComponent.test.js` + the Jest locale-parity suite (already runs in `npm test`)

**Interfaces:**
- Consumes: the conversation payload's persisted per-message metadata (`chat-history-service.js:189-197/:321` — verify the exact field names when implementing); `i18n.global.locale` for the timestamp.
- Produces: after a reload, each restored message carries `metadata`, `confidenceScore`, `isGrounded`, `userFeedback` (when present); timestamps follow the app locale.

- [ ] **Step 1: Failing unit test** (in `ChatBotComponent.test.js`, the existing reload/load-conversation describe):

```js
it('restores per-message metadata (confidence, groundedness, feedback) from the conversation payload', () => {
  const conversation = makeConversationFixture({  // the existing fixture helper; extend it with
    messages: [{ sender: 'bot', content: 'answer', metadata: { confidence_score: 0.87, is_grounded: true, userFeedback: 'up' } }]
  });
  /* mount, call the load path with the fixture, assert */
  const msg = wrapper.vm.chatMessages.find((m) => m.sender === 'bot');
  expect(msg.confidenceScore).toBe(0.87);
  expect(msg.isGrounded).toBe(true);
  expect(msg.userFeedback).toBe('up');
});
```

- [ ] **Step 2: Run — expect FAIL** (the reload path drops metadata today, `ChatBotComponent.vue:1434-1441`).
- [ ] **Step 3: Implement.** In the reload mapping, carry `metadata` onto the message exactly as `onMetadata` does:

```js
messages: conversation.messages.map((m) => ({
  ...m,
  metadata: m.metadata || null,
  confidenceScore: m.metadata?.confidence_score ?? null,
  isGrounded: m.metadata?.is_grounded,
  userFeedback: m.metadata?.userFeedback || null
}))
```

(Read `chat-history-service.js`'s return shape first and map the real field names — the principle: whatever `onMetadata` sets on a live message, the reload path sets too.) Timestamps: `formatMessageTime` currently calls `toLocaleTimeString([], ...)` (`:794-798`) — pass the app locale:

```js
const locale = this.$i18n?.global?.locale || undefined;
return new Date(ts).toLocaleTimeString([locale], { hour: '2-digit', minute: '2-digit' });
```

- [ ] **Step 4: The i18n batch.** New keys (English values; every locale file gets a real translation — the parity test enforces presence):

| key | en |
|---|---|
| `chatbot.justChat` | `Just Chat` |
| `chatbot.closeConversation` | `Close conversation` |
| `chatbot.relatedSources` | `Related sources ({n})` (with `.one`: `Related source ({n})`) |
| `chatbot.copyAnswer` | `Copy answer` |
| `chatbot.confidence` | `Confidence` |
| `chatbot.errorUnableToComplete` | `Unable to complete the response.` |
| `chatbot.retry` | `Retry` |
| `documents.noneYet` | `No related documents yet` |
| `documents.willAppearHere` | `Documents referenced during the conversation will appear here.` |
| `feedback.helpful` | `Helpful` |
| `feedback.notHelpful` | `Not helpful` |

Then remove now-unused keys (`composerAttachTitle`/`composerMicTitle` stay — the welcome still passes them; verify nothing else orphaned) and run `npx prettier --check src/i18n/locales/*.js`.
- [ ] **Step 5: Run — expect PASS** (`npm test` full suite; the parity test is the gate).
- [ ] **Step 6: Mutation.** Drop `confidenceScore` from the reload mapping → the unit test REDs; revert → GREEN. Delete one locale's `chatbot.retry` → the parity test REDs; revert → GREEN.
- [ ] **Step 7: Commit** `fix(theme): the conversation restores its metadata and speaks every locale`

---

### Task 12: The e2e invariant set + the visual fidelity gate

**Files:**
- Modify: `tests/e2e/chat-conversation.spec.js` (the accumulated tests get their final assertions)
- Modify: `tests/e2e/welcome-banner.spec.js`, `tests/e2e/chat-composer.spec.js` — **only** to add the "the welcome render did not move" cross-checks (a single before/after session is enough; no assertion changes)

**Interfaces:**
- Consumes: `tests/e2e/helpers/welcome.js` (`openWelcomeScreen`, `readVisualLayerState`, `capturePixels`, `lum`, `contrastRatio`).

- [ ] **Step 1: The cross-cutting invariants** (append to `chat-conversation.spec.js`):

```js
test('the layer-off conversation keeps the same layout boxes', async ({ browser }) => {
  const { ctx, page } = await openWelcomeScreen(browser, { viewport: { width: 1440, height: 900 }, theme: 'light' });
  await page.locator('[data-testid="welcome-composer"] textarea').fill('What is GENIE.AI?');
  await page.locator('[data-testid="welcome-composer"] textarea').press('Enter');
  await page.waitForSelector('.chat-message.bot', { timeout: 30000 });
  const boxes = () => page.evaluate(() => {
    const r = (sel) => { const el = document.querySelector(sel); if (!el) return null; const b = el.getBoundingClientRect(); return [b.x, b.y, b.width, b.height].map((v) => Math.round(v)); };
    return { header: r('.conversation-header'), input: r('.chat-input'), window: r('.chat-window') };
  });
  const on = await boxes();
  await page.evaluate(() => document.documentElement.setAttribute('data-visual', 'off'));
  await page.waitForTimeout(300);
  const off = await boxes();
  expect(off.header, 'the header box does not move with the layer off').toEqual(on.header);
  expect(off.input, 'the composer box does not move with the layer off').toEqual(on.input);
  expect(off.window, 'the message window box does not move with the layer off').toEqual(on.window);
  await ctx.close();
});
```

- [ ] **Step 2: The contrast check on the new inks** (the amber warning and the initials circle must clear 4.5:1 — reuse `lum`/`contrastRatio` from the helper over `capturePixels` of the card, the same recipe `welcome-banner.spec.js`'s subtitle assertion uses).
- [ ] **Step 3: The visual fidelity loop.** Capture the full conversation (light + dark, 1440 and 1920) with `tests/e2e/capture-dashboard.js` (it already saves PNG + audit JSON pairs; extend its state list with a "conversation" state if missing — it aborts on a state it claims but did not reach, keep that). Compare against `/tmp/mockups/genie-chat-v1-spec.png`: the wave's position and height band, the card's elevation, the header strip, the composer's float. **The audit JSON wins over the PNG** wherever they disagree. Iterate fix → capture → compare until the sheet and the render agree.
- [ ] **Step 4: Mutation.** One mutation per invariant group (the layer-off equality, the contrast floor) — break it, watch RED, revert, watch GREEN.
- [ ] **Step 5: The full local gate** — from the worktree root:

```bash
cd components/gov-chat-frontend && npm test && npx prettier --check src/i18n/locales/*.js src/components/ChatBotComponent.vue src/components/ChatComposer.vue src/components/RightSideBarComponent.vue
BASE_URL=https://localhost:9445 npx playwright test tests/e2e/chat-conversation.spec.js tests/e2e/welcome-banner.spec.js tests/e2e/chat-composer.spec.js --project=chromium --workers=1
```

- [ ] **Step 6: Commit** `test(e2e): the conversation V1 invariants, mutation-tested`

---

### Task 13: The whole-suite gate + the final report

**Files:** none (verification only)

- [ ] **Step 1:** the FULL Playwright suite on one slot: `BASE_URL=https://localhost:9445 npx playwright test --project=chromium --workers=1` (pre-existing port-443 failures in `chatbot/`, `documents/`, `epic1-3/` are known and out of scope — everything else must be green).
- [ ] **Step 2:** `cd components/gov-chat-frontend && npm test` (1421+ tests) and the root `npx prettier --check` on every touched file.
- [ ] **Step 3:** the coordinator rebuilds the shared 9443 frontend (the user's check) and the visual loop closes against the designer's sheet **in the user's browser**.
- [ ] **Step 4:** the report to `.superpowers/sdd/2026-10-20-living-intelligence-theme/chat-v1-report.md`: the screenshots (both themes × 2 widths), the mutation table, the suite counts.

---

## Self-Review (done by the coordinator at plan-writing time)

- **Spec coverage:** D1 (Task 7 confidence block) · D2 (Task 6) · D3 (Task 7) · D4 (Tasks 8, 9) · D5/D17 (Task 3) · D6 (Task 3) · D7 (Task 2) · D8 (nothing — status quo, asserted in Task 12's layer-off equality) · D9 (Task 5) · D10 (already true — the bubble uses `--accent`; asserted in Task 12's contrast pass) · D11 (Task 4) · D12 (already true from the dashboard round — no work) · D13 (Task 1) · D14 (Task 5) · D15 (Task 8) · D16 (Task 10) · the data-fixes table (Task 11). No gap.
- **Placeholders:** none — every step carries its code or its exact command.
- **Type consistency:** `msg.sources`/`msg.sourcesOpen`/`msg.userFeedback`/`msg._query`/`msg.isError` are named identically in Tasks 5–8 and 11; `submitFeedbackPayload(msg, rating, comment)` is defined in Task 7 and consumed nowhere else; `sendMessageFromText(text)` is defined in Task 8 and consumed by the Retry only.
