---
status: done
date: 2026-07-07
spec_file: _bmad-output/implementation-artifacts/spec-quick-help-service-labels.md
baseline_commit: 0b6189b0b4f0a5a214cac4de4e6f9a2f4201f5d1
related: docs/spec-quick-help-service-labels.md (full v2 design rationale)
deployment: el-salvador (6/7 Quick Help buttons return 0 docs; sidebar 0-docs for non-English locales)
---

# Spec: Quick Help + Sidebar Service-Label Filtering

## Intent (frozen-after-approval)

<frozen-after-approval>
When a user clicks a Quick Help button or selects from the sidebar tree, the conversation
context is forwarded to the RAG retriever as a label filter (OR strategy — a chunk must
carry at least one matching label). Today this filter silently matches zero chunks in two
cases:

1. **Quick Help** — the button's localized TITLE is sent as the service label (e.g.
   `"Grow Fruits & Veggies"`), which matches no `chunk_labels`.
2. **Sidebar (non-English locales)** — the localized service name (e.g. `"Tomate"`) is
   sent, which does not exact-match the English chunk label (`"Tomato"`).

Goal: Quick Help and sidebar selections must filter retrieval by the **correct English
knowledge-base labels** (matching `services.nameEN`), so the retriever returns the
relevant documents.
</frozen-after-approval>

## Root Causes (verified against main checkout)

| Bug | Layer | Verified location |
|-----|-------|-------------------|
| A | FE `loadQuickHelpButtons()` sets `service: title` (localized) — title becomes the filter label | `ChatBotComponent.vue:612` |
| B | FE `getCategoryLabelById()` fallback returns `` `Category ${id}` `` — sent as categoryLabel | `ChatBotComponent.vue:532` |
| C | chatqna reads `retrieval_context.get("categoryLabels")` (plural) — FE sends `categoryLabel` (singular) → category filter dead | `genieai_chatqna.py:780` |
| D | FE `handleTreeNodeSelected()` stores `service: this.safeTranslate(item.service)` (localized); query-build uses `item.service` for sidebar items → non-English 0-docs | `ChatBotComponent.vue:703-704`, query-build `:788` |
| B3 | Backend defaults `categoryLabel = 'General'` when absent — masks "no category filter" intent | `query-service.js:297, 302-304` |
| B2 | Mobile `_sendStreaming()` gates context on `_selectedCategoryId != null`; Quick Help never sets it → Quick Help sends NO context | `chatbot_component.dart:429` |

**Pre-existing field (drift from spec v2):** `serviceKey` ALREADY exists on context items
(`ChatBotComponent.vue:664, 704, 738`) but is sourced from `rawOption.id` / `item.service`
— NOT a stable English KB key. The fix repurposes it as the English stable key.

## Out of Scope

- el-salvador config migration (separate MR on `el-salvador-contextual` branch — config is deployment-specific, main has the Kenya template)
- Backend parent→leaf label expansion at query time
- Re-ingestion to add parent-category labels
- Retriever-side 0-result fallback retry
- config-validator with DB connectivity (G5 — deferred to deployment smoke test)
- Playwright E2E suite (G6 — no infra exists)
- Mobile APK delivery (new build required — known limitation)

## Design

### Data model: context item

Every entry in `selectedContextItems` carries:

| Field | Source | Purpose |
|-------|--------|---------|
| `service` | localized display name | UI chip rendering only |
| `serviceKey` | stable English KB label (`services.nameEN`) | retriever filter + i18n lookup |
| `serviceLabels` | `string[]` English KB labels, or `null` | explicit multi-label filter (Quick Help) |

**Invariants:**
- `service` is NEVER used as a filter label (display-only)
- `serviceKey` is ALWAYS an English KB label (or the raw `service` for legacy buttons without explicit labels — backward compat)
- `serviceLabels` is `null` for sidebar items, an array for Quick Help items

### Query-build (FE)

```js
const serviceLabels = this.selectedContextItems.flatMap((item) =>
  Array.isArray(item.serviceLabels) && item.serviceLabels.length > 0
    ? item.serviceLabels                       // Quick Help: explicit English labels
    : [item.serviceKey || item.service]        // Sidebar: stable English key (was: item.service)
);
```

### `checkContextConfig()` — block for all users

- Remove admin-only early-return for the BLOCKING path (warning can stay admin-only).
- Return boolean. Call site in `sendMessage()` aborts when `false`.
- Mismatch check uses array membership (label in `item.serviceLabels` OR `=== item.serviceKey`), not `find(i => i.service === label)`.
- Block conditions: (1) `categoryLabel` matches `/^Category \d+$/`, (2) `serviceLabels` empty AND `categoryLabel` null, (3) a `serviceLabels` value matches a known button title (misconfig catch).

### Mobile gating

`hasContext = _selectedCategoryId != null || _activeServiceLabels.isNotEmpty`.
New `_activeServiceLabels` field, set in `_quickHelpPressed()` from `button['serviceLabels']`,
used in `_sendStreaming()` context block, cleared after stream completes.

### Backend + chatqna

- Backend: stop defaulting `categoryLabel` to `'General'` — preserve null (means "no category filter").
- chatqna: read `categoryLabel` (singular) as well as `categoryLabels` (plural); coerce to list.

## Tasks & Acceptance

### FE — `components/gov-chat-frontend/src/components/ChatBotComponent.vue`

**T1 — `loadQuickHelpButtons()`** (currently `:598`)
- Filter out buttons where `button.hidden === true`.
- Read `button.serviceLabels` (array). When present, set `service: serviceLabels[0]` (display), `serviceKey: serviceLabels[0]` (English key), `serviceLabels` (full array). When absent, keep current behavior (`service: title`, `serviceKey: button.id || title`, `serviceLabels: null`).
- AC: Given a button with `serviceLabels: ["Tomato","Onion"]` and `hidden: false`; When loaded; Then `quickHelpButtons[0].serviceLabels === ["Tomato","Onion"]`, `.serviceKey === "Tomato"`.
- AC: Given a button with `hidden: true`; When loaded; Then it is absent from `quickHelpButtons`.
- AC: Given a button with no `serviceLabels`; When loaded; Then `.serviceLabels` is `null` and `.serviceKey === button.id` (backward compat).

**T2 — `selectQuickHelpOption(option)`** (currently `:650`)
- Before pushing, remove prior Quick Help selection: `this.selectedContextItems = this.selectedContextItems.filter((item) => !item.serviceLabels)`.
- Push item carrying `serviceLabels: rawOption.serviceLabels || null` and `serviceKey: rawOption.serviceKey || rawOption.service`.
- AC: Given two Quick Help buttons A then B clicked; When B clicked after A; Then `selectedContextItems` has exactly ONE item (B's), not two.
- AC: Given a Quick Help button with `serviceLabels: ["Tomato"]`; When selected; Then pushed item has `serviceLabels: ["Tomato"]`, `serviceKey: "Tomato"`.
- AC: Given a sidebar item already in context; When a Quick Help button is clicked; Then sidebar item REMAINS, Quick Help item is added (sidebar is additive, Quick Help replaces Quick Help).

**T3 — query-build** (currently `:788`, `const serviceLabels = this.selectedContextItems.map((item) => item.service)`)
- Replace with `flatMap` per Design. Uses `serviceLabels` array when present, else `serviceKey` fallback.
- AC: Given context = `[{service:"Tomate", serviceKey:"Tomato", serviceLabels:null}, {service:"Grow...", serviceKey:"Tomato", serviceLabels:["Tomato","Onion"]}]`; When query built; Then `queryData.context.serviceLabels === ["Tomato","Tomato","Onion"]` (sidebar contributes serviceKey, Quick Help contributes the array).

**T4 — `getCategoryLabelById()`** (currently `:532`)
- Return `null` instead of `` `Category ${id}` `` when not found.
- AC: Given an id absent from `serviceCategories`; When called; Then returns `null` (not a `Category NN` string).

**T5 — `checkContextConfig(context)`** (currently `:535`)
- Compute `isBlocked` independent of admin role. Return boolean.
- Warning emission (informational notification) stays admin-only.
- Mismatch check: `this.selectedContextItems.some((item) => (item.serviceLabels || []).includes(label) || item.serviceKey === label)`.
- Call site in `sendMessage()`: if `checkContextConfig` returns `false`, abort (do not send).
- AC: Given a non-admin user with `categoryLabel: "Category 123"`; When `checkContextConfig`; Then returns `false` (blocked).
- AC: Given an admin user with a clean config; When `checkContextConfig`; Then returns `true` and emits no warning.
- AC: Given context where `serviceLabels: ["Tomato"]` matches an item's `serviceLabels`; When `checkContextConfig`; Then returns `true`.

**T6 — `removeContextItem(index)`** (currently `:728`)
- When rebuilding from a Quick Help button, carry `serviceLabels` (use the button's `serviceLabels` if present).
- AC: Given `selectedContextItems` reduced to empty via removal and the current category matches a Quick Help button with `serviceLabels`; When `removeContextItem`; Then rebuilt item carries `serviceLabels`.

**T7 — `handleTreeNodeSelected(item)`** (currently `:692`)
- `serviceKey: item.service` (already present — confirm it stays the raw English `item.service`, NOT the translated one). The translated value goes ONLY into `service`.
- AC: Given a Spanish user selecting a node with `service: "Tomato"`; When selected; Then pushed item has `service: "Tomate"` (translated for display) and `serviceKey: "Tomato"` (English for filter).

### Mobile — `mobile/genie_ai_mobile/lib/components/chat/chatbot_component.dart`

**T8 — `_activeServiceLabels` field**
- Add `List<String> _activeServiceLabels = [];` to state.

**T9 — `_loadQuickHelpConfig()`** (currently `:179`)
- Filter out buttons where `button['hidden'] == true`.
- Read `button['serviceLabels']` into the button map (so `_quickHelpPressed` can access it).
- AC: Given a button with `hidden: true`; When config loaded; Then absent from rendered buttons.

**T10 — `_quickHelpPressed(button)`** (currently `:714`)
- Set `_activeServiceLabels = (button['serviceLabels'] as List?)?.cast<String>() ?? []` in the `setState`.
- AC: Given a button with `serviceLabels: ["Tomato","Onion"]`; When pressed; Then `_activeServiceLabels === ["Tomato","Onion"]`.

**T11 — `_sendStreaming()`** (currently `:429`)
- `final hasContext = _selectedCategoryId != null || _activeServiceLabels.isNotEmpty;`
- In the `hasContext` branch, `'serviceLabels': _activeServiceLabels` (replaces `<String>[]`).
- After stream completes (in `onDone` / completion), reset `_activeServiceLabels = []` (prevent leak into next manual message — G4 parity with web).
- AC: Given Quick Help pressed (no sidebar category) with `serviceLabels: ["Tomato"]`; When message sent; Then request body `context.serviceLabels === ["Tomato"]` and `contextOption === "conversation-with-context-labels"`.
- AC: Given a manual message after a Quick Help message; When sent; Then `_activeServiceLabels` is empty (cleared after prior stream).

### Backend — `components/gov-chat-backend/services/query-service.js`

**T12 — preserve null categoryLabel** (currently `:297, 302-304`)
- Replace `categoryLabel: 'General'` defaults with `categoryLabel: null` (both the `!queryData.context` branch at `:297` and the `!categoryLabel` branch at `:302`).
- Verify the mock path (`:204` `categoryLabel || 'General'`) — change only if it feeds the same downstream; otherwise leave the mock path alone (mock-only).
- AC: Given a request with `context.categoryLabel` absent; When processed; Then forwarded to chatqna as `categoryLabel: null` (not `"General"`).
- AC: Given a request with `context.categoryLabel: "Crops"`; When processed; Then forwarded as `"Crops"` (unchanged).

### ChatQnA — `genie-ai-overlay/chatqna/genieai_chatqna.py`

**T13 — singular/plural fix** (currently `:780`)
- Read both `categoryLabel` (singular, string) and `categoryLabels` (plural, list) from `retrieval_context`. Coerce singular to a single-element list.
- AC: Given `retrieval_context = {"categoryLabel": "Crops", "serviceLabels": ["Tomato"]}`; When filter labels built; Then `_filter_labels === ["Crops", "Tomato"]` and `search_start` is encoded with both.
- AC: Given `retrieval_context = {"categoryLabels": ["Crops","Soil"], "serviceLabels": ["Tomato"]}`; When filter labels built; Then `_filter_labels === ["Crops","Soil","Tomato"]` (plural still works — backward compat).
- AC: Given `retrieval_context = {}` (no labels); When filter labels built; Then `_filter_labels === []` and `search_start` is unchanged (no filter applied).

### Tests

**T14 — FE unit tests** (`components/gov-chat-frontend/src/__tests__/components/ChatBotComponent.test.js`, `selectQuickHelpOption` block at `:689`)
- Add/extend tests covering T1–T7 ACs. Use existing fixtures/patterns. Cover: hidden filter, serviceLabels read, serviceKey set, replace-previous-Quick-Help (G3), sidebar additive, query-build flatMap fallback, getCategoryLabelById null, checkContextConfig blocks for non-admin (G2), array-membership mismatch (R3), handleTreeNodeSelected stores serviceKey (G1).

**T15 — Python test** (`genie-ai-overlay/tests/test_chatqna.py` or a new focused test)
- Cover T13 ACs: singular `categoryLabel`, plural `categoryLabels`, mixed, empty.

**T16 — Backend test** (existing `query-service` test, or new)
- Cover T12 ACs: null preserved, valid value passes.

## Lint / Format / Test gates (before push)

```bash
# FE
cd components/gov-chat-frontend && npm run lint && npm run format:check && npm test
# Backend
cd components/gov-chat-backend && npm run lint && npm run format:check && npm test
# Python
cd genie-ai-overlay && source .venv/bin/activate && ruff check . && ruff format --check . && pytest tests/test_chatqna.py
# Dart (analyze only — no flutter build in CI lane)
cd mobile/genie_ai_mobile && flutter analyze
```

## Self-Check (step-03 exit)

- [ ] Every task T1–T16 has a corresponding code change or test
- [ ] All ACs are covered by a test or manual verification note
- [ ] No `service` (localized) used as a filter label anywhere
- [ ] `serviceKey` always English or raw fallback
- [ ] Backward compat: buttons without `serviceLabels` still work
- [ ] Lint + format + tests green for all four components

## Suggested Review Order

**Entry point — design intent (filter/display decoupling)**

- Why `service` = localized title (display) while `serviceKey`/`serviceLabels` = English KB labels (filter)
  [`ChatBotComponent.vue:622`](../../../components/gov-chat-frontend/src/components/ChatBotComponent.vue#L622)

**Quick Help lifecycle (frontend)**

- Replace-previous Quick Help + carry serviceLabels; sidebar items survive (mode switch vs additive)
  [`ChatBotComponent.vue:687`](../../../components/gov-chat-frontend/src/components/ChatBotComponent.vue#L687)

**Retriever filter construction (frontend)**

- flatMap: explicit serviceLabels array for Quick Help, serviceKey fallback for sidebar (never localized `service`)
  [`ChatBotComponent.vue:839`](../../../components/gov-chat-frontend/src/components/ChatBotComponent.vue#L839)

**Safety guards (frontend)**

- getCategoryLabelById returns null (was `Category NN` fallback → 0-docs)
  [`ChatBotComponent.vue:516`](../../../components/gov-chat-frontend/src/components/ChatBotComponent.vue#L516)

- checkContextConfig blocks ALL users (was admin-only); array-membership mismatch check
  [`ChatBotComponent.vue:535`](../../../components/gov-chat-frontend/src/components/ChatBotComponent.vue#L535)

- Call site aborts sendMessage when checkContextConfig returns false
  [`ChatBotComponent.vue:880`](../../../components/gov-chat-frontend/src/components/ChatBotComponent.vue#L880)

**ChatQnA contract fix (Python)**

- Extracted pure helper: singular/plural categoryLabel coercion + dedup + non-string guard
  [`genieai_chatqna.py:459`](../../../genie-ai-overlay/chatqna/genieai_chatqna.py#L459)

- align_inputs consumes the helper (was: plural-only → category filter was dead)
  [`genieai_chatqna.py:836`](../../../genie-ai-overlay/chatqna/genieai_chatqna.py#L836)

**Backend null-preservation**

- Preserve null categoryLabel (was `|| 'General'` → injected non-matching label)
  [`query-service.js:297`](../../../components/gov-chat-backend/services/query-service.js#L297)

**Mobile (Flutter)**

- New `_activeServiceLabels` field — English KB labels sourced from Quick Help button config
  [`chatbot_component.dart:85`](../../../mobile/genie_ai_mobile/lib/components/chat/chatbot_component.dart#L85)

- `_quickHelpPressed` sets labels + clears sidebar state (mode switch)
  [`chatbot_component.dart:735`](../../../mobile/genie_ai_mobile/lib/components/chat/chatbot_component.dart#L735)

- `hasContext` gating now includes Quick Help; context block sends `_activeServiceLabels`
  [`chatbot_component.dart:443`](../../../mobile/genie_ai_mobile/lib/components/chat/chatbot_component.dart#L443)

**Tests + i18n**

- FE unit tests: hidden filter, serviceLabels read, replace-previous, sidebar additive, block conditions
  [`ChatBotComponent.test.js`](../../../components/gov-chat-frontend/src/__tests__/components/ChatBotComponent.test.js)

- Python unit tests: singular/plural/mixed/empty/dedup/coercion for `_build_filter_labels`
  [`test_build_filter_labels.py`](../../../genie-ai-overlay/tests/test_build_filter_labels.py)

- `noFilterWarning` key added to all 14 locale files
  [`en.js`](../../../components/gov-chat-frontend/src/i18n/locales/en.js)
