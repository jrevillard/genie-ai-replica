# Quick Help: Explicit Service Labels for RAG Filtering (v2 — revised)

**Status:** Draft for review (v2 — addresses all review BLOCKERs/GAPs)
**Date:** 2026-07-07
**Scope:** Frontend (Vue 3), Mobile (Flutter), Backend (Node.js), el-salvador config
**Related:** El Salvador deployment — 6 of 7 Quick Help buttons return 0 documents

> **v2 revisions** (from adversarial review):
> - All line-number references replaced with **symbol names** (line numbers drift; verified at review time but not stable)
> - B2 fixed: mobile `_sendStreaming` gating refactored (was: Quick Help bypassed context entirely)
> - B3 fixed: backend `categoryLabel || 'General'` patched to preserve null
> - B4 resolved: §3.4 (getCategoryLabelById null return) paired with chatqna plural/singular fix (both or neither)
> - G1 fixed: sidebar i18n bug folded into the same fix (use `serviceKey`, not localized `service`)
> - G2 addressed: `checkContextConfig` admin guard removed for the blocking path
> - G3/G4 addressed: multiple Quick Help clicks + context persistence defined
> - G5/G6 scoped: config-validator + E2E deferred (no infra exists)
> - R1 verified: exact `services.nameEN` strings confirmed against ArangoDB
> - R2/R3 addressed: serviceKey + checkContextConfig update

---

## 1. Intent

### What is broken

When a user clicks a Quick Help button (or selects from the sidebar tree), the conversation context is forwarded to the RAG retriever as a label filter. The retriever uses an OR strategy (exact match): a chunk must carry at least one matching label. **Six of seven Quick Help buttons return zero documents** because the labels sent don't match any `chunk_labels`. **Sidebar tree selections by non-English users also fail** — the localized label ("Tomate") doesn't match the English chunk label ("Tomato").

### Root causes (four compounding bugs)

**Bug A — `serviceLabels` populated from button title (PRIMARY CAUSE for Quick Help).**

`loadQuickHelpButtons()` maps the button's localized title to the `service` field. At query-build time, `selectedContextItems.map(item => item.service)` produces `serviceLabels: ["Grow Fruits & Veggies"]`. No chunk has this label → 0 docs.

**Bug B — `getCategoryLabelById` fallback sends raw ID string.**

Falls back to `` `Category ${id}` `` when the category ID isn't in `serviceCategories`. This string is sent as `categoryLabel`. However — see Bug D — it's silently dropped downstream. Still broken behavior; fix for correctness.

**Bug C — `categoryLabel` (singular) vs `categoryLabels` (plural) mismatch in chatqna.**

`genieai_chatqna.py` reads `retrieval_context.get("categoryLabels")` (plural). Frontend sends `categoryLabel` (singular). Category-level filtering is completely non-functional — only `serviceLabels` reaches the retriever filter.

**Bug D (NEW, from review) — Sidebar tree stores LOCALIZED service name.**

`handleTreeNodeSelected` stores `service: this.safeTranslate(item.service)`. For a Spanish user, this becomes "Tomate". At query-build, `serviceLabels: ["Tomate"]` → retriever exact-matches against English "Tomato" → 0 docs. This affects ALL sidebar users in non-English locales, not just Quick Help.

### High-level approach

1. Add optional `serviceLabels` array to Quick Help config (explicit, English, KB-matching labels)
2. Carry `serviceKey` (stable English identifier) through ALL context items (Quick Help + sidebar)
3. At query-build time, use `serviceKey` (not the localized `service`) for the retriever filter
4. Fix the mobile gating so Quick Help context is actually sent
5. Fix backend to preserve null categoryLabel
6. Fix chatqna singular/plural mismatch (paired with getCategoryLabelById null return)

---

## 2. Proposed Config Schema Change

### New fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `serviceLabels` | `string[]` | No | Explicit English label(s) matching `services.nameEN`. Sent as the retriever filter. When absent, falls back to `[service]` for backward compat. |
| `hidden` | `boolean` | No (default `false`) | When `true`, button is not rendered (no matching corpus content). |

### Config example (patched)

```json
{
  "id": "grow-fruits-veggies",
  "title": {"en": "Grow Fruits & Veggies", "es": "Cultivar Frutas y Verduras"},
  "icon": {"type": "file", "value": "/config/quickhelp/grow-fruits-veggies.svg"},
  "category": "28486647",
  "serviceLabels": ["Tomato", "Onion", "Cucumber", "Potato"],
  "action": { ... }
}
```

### Config example (hidden — no corpus)

```json
{
  "id": "manage-poultry-pigs",
  "title": {"en": "Manage Poultry & Pigs", "es": "..."},
  "category": "26653377",
  "hidden": true,
  "action": { ... }
}
```

### JSON Schema

The existing JSON Schema in `genie-ai-config.json` is **documentation-only and not enforced** (the `title` field type is declared as `string` but the actual config uses `{en, es}` objects). Add `serviceLabels` and `hidden` to the schema for documentation, but note the schema is advisory. Do NOT add either to `required`.

### Verified label strings (R1)

These EXACT strings were confirmed against `services.nameEN` in the el-salvador ArangoDB:

```
"Tomato", "Onion", "Cucumber", "Potato"
"Pest/ Disease Health"     ← note: space after slash
"Nutrition", "Establishment"
"Planning", "Monitoring", "Harvest/ Production"   ← note: space after slash
"Variety/ Breed Selection" ← note: space after slash
"Water", "Economics", "Climate Resilience", "Post-Harvest"
```

---

## 3. Frontend Changes (Vue 3 — ChatBotComponent.vue)

> All references are by **symbol name** (not line number — line numbers drift).

### 3.1 `loadQuickHelpButtons()`

Read `serviceLabels` + `hidden`. Filter hidden buttons. When `serviceLabels` present, use first label as display `service`; carry full array as `serviceLabels`.

```js
this.quickHelpButtons = buttons
  .filter((button) => !button.hidden)
  .map((button) => {
    const title = resolveConfigText(button.title, locale);
    const explicitLabels = Array.isArray(button.serviceLabels) ? button.serviceLabels : null;
    return {
      service: explicitLabels ? explicitLabels[0] : title,  // display name
      serviceLabels: explicitLabels,                         // full filter array (English KB labels)
      serviceKey: explicitLabels ? explicitLabels[0] : title, // stable English key for i18n
      textKey: button.title,
      visibleText, hiddenPrompt, icon: button.icon?.value,
      category: button.category,
      id: button.id
    };
  });
```

**R2 fix:** `serviceKey` is set to the first English label — the locale watcher translates it via the services collection, not the i18n key lookup. This avoids the "Tomato" not translating to "Tomate" issue.

### 3.2 `selectQuickHelpOption(option)`

Carry `serviceLabels` + `serviceKey` into `selectedContextItems`.

```js
this.selectedContextItems.push({
  service: rawOption.service,           // display name (localized at render)
  serviceLabels: rawOption.serviceLabels || null,
  serviceKey: rawOption.serviceKey || rawOption.service,  // stable English key
  serviceKey: rawOption.id || rawOption.service,
  category: categoryId,
  selected: true
});
```

**G3 — multiple Quick Help clicks:** Replace previous Quick Help selection (don't accumulate). Before pushing, remove any existing item with the same `id` (or all items where `serviceLabels !== null`). Decision: **Quick Help replaces previous Quick Help; sidebar items accumulate separately.** Rationale: Quick Help is a mode switch; sidebar is additive filtering.

```js
// Remove previous Quick Help selection (if any)
this.selectedContextItems = this.selectedContextItems.filter(
  (item) => !item.serviceLabels  // sidebar items have serviceLabels=null
);
```

### 3.3 Query-build section (`const serviceLabels = ...`)

Use `serviceLabels` array when available; fall back to `serviceKey` (NOT `service` — that's localized).

```js
const serviceLabels = this.selectedContextItems.flatMap((item) =>
  Array.isArray(item.serviceLabels) && item.serviceLabels.length > 0
    ? item.serviceLabels      // Quick Help: explicit English labels
    : [item.serviceKey || item.service]  // Sidebar: stable English key (G1 fix)
);
```

**G1 fix:** Sidebar items now use `serviceKey` (English) instead of `service` (localized). This fixes the non-English 0-docs bug for sidebar users.

### 3.4 `getCategoryLabelById()`

Return `null` instead of `` `Category ${id}` `` fallback.

**B4 resolution:** This change is PAIRED with the chatqna fix (§5.2). If chatqna is NOT fixed (singular/plural mismatch), categoryLabel is ignored anyway and this change is cosmetic. If chatqna IS fixed, null means "no category filter". Either way, null is correct. **Decision: fix both (§3.4 + §5.2) in the same MR.**

### 3.5 `checkContextConfig()`

**G2 fix:** Remove the admin-only guard for the blocking path. The warning (informational) can stay admin-only; the BLOCK must apply to all users.

**R3 fix:** Update the service-label mismatch check to use array membership:

```js
// OLD: find(i => i.service === label)
// NEW: check if label is in any item's serviceLabels OR matches serviceKey
const matched = this.selectedContextItems.some((item) =>
  (item.serviceLabels || []).includes(label) || item.serviceKey === label
);
```

Return boolean (`false` = abort query). Call site checks return value and aborts `sendMessage()` if false.

Block conditions:
1. `categoryLabel` matches `/^Category \d+$/` — defensive guard
2. `serviceLabels` is empty AND `categoryLabel` is null — no filter at all
3. `serviceLabels` contains a value matching a known button title (not a KB label) — catches misconfigured buttons

### 3.6 `removeContextItem()`

Carry `serviceLabels` + `serviceKey` when rebuilding from Quick Help.

### 3.7 `handleTreeNodeSelected()` (G1 fix)

Store `serviceKey` alongside the localized `service`:

```js
this.selectedContextItems.push({
  service: this.safeTranslate(item.service),  // display (localized)
  serviceKey: item.serviceKey || item.service, // stable English key for filter
  // ... rest unchanged
});
```

The query-build (§3.3) uses `serviceKey` for the filter; `service` is display-only.

**G4 — context persistence:** Quick Help context persists until: (a) user clicks a different Quick Help button (replaces), (b) user removes the context chip, or (c) new conversation/session. This is the existing behavior — no auto-clear after first message. Document this as intended.

---

## 4. Mobile Changes (Flutter)

### 4.1 B2 fix — `_sendStreaming()` context gating

**Problem (verified):** `hasContext = _selectedCategoryId != null` — Quick Help doesn't set `_selectedCategoryId` (only sidebar does), so Quick Help takes the else branch and sends no context at all.

**Fix:** Gate on `_selectedCategoryId != null || _activeServiceLabels.isNotEmpty`:

```dart
final hasContext = _selectedCategoryId != null || _activeServiceLabels.isNotEmpty;
```

Add `_activeServiceLabels` field:

```dart
List<String> _activeServiceLabels = [];
```

### 4.2 `_quickHelpPressed()`

Set `_activeServiceLabels` from the button config:

```dart
void _quickHelpPressed(Map<String, dynamic> button) {
  setState(() {
    _showQuickHelpOverlay = false;
    _activeServiceLabels = (button['serviceLabels'] as List<dynamic>?)
        ?.cast<String>() ?? [];
  });
  // ... existing visible/hidden prompt logic ...
  _sendMessage(visibleText, hiddenPrompt: hiddenPrompt);
}
```

### 4.3 `_sendStreaming()` context block

Use `_activeServiceLabels` instead of hardcoded `<String>[]`:

```dart
if (hasContext) ...{
  'context': {
    'categoryLabel': _selectedCategoryName.isNotEmpty ? _selectedCategoryName : null,
    'serviceLabels': _activeServiceLabels,
    'language': I18nService().currentLocale.languageCode.toUpperCase(),
  },
  ...
}
```

Clear `_activeServiceLabels` after sending (prevent leaking into next manual message — G4 parity with web):

```dart
// After stream completes or in onDone:
_activeServiceLabels = [];
```

### 4.4 `_loadQuickHelpConfig()`

Read `serviceLabels` + `hidden`. Filter hidden buttons.

### 4.5 Config file

Mobile config (`mobile/genie_ai_mobile/assets/config/genie-ai-config.json`) gets the same `serviceLabels` + `hidden` additions. Baked into APK — new build required.

---

## 5. Backend Changes

### 5.1 B3 fix — preserve null categoryLabel

**`query-service.js`** (around line 204, the `categoryLabel || 'General'` default):

Change to:
```js
categoryLabel: categoryLabel ?? null,  // preserve null (no category filter)
```

OR: remove the defaulting entirely and let null pass through to chatqna (which handles it).

The `|| 'General'` was for the mock/test response path (lines 102-204). The actual OPEA payload (lines 376-385) may not have this defaulting — verify during implementation. If the OPEA path doesn't default, only the mock path needs the change.

### 5.2 B4 fix — chatqna singular/plural mismatch

**`genie-ai-overlay/chatqna/genieai_chatqna.py`** (~line 780):

Change `retrieval_context.get("categoryLabels")` → `retrieval_context.get("categoryLabel")` and wrap in a list:

```python
cat_label = retrieval_context.get("categoryLabel")
if cat_label:
    _filter_labels.extend([cat_label] if isinstance(cat_label, str) else cat_label)
```

This makes category-level filtering functional (paired with §3.4's null return — null means "no category filter").

---

## 6. Config Migration (el-salvador)

### The 7 Quick Help buttons

| Button ID | serviceLabels | Action |
|-----------|---------------|--------|
| `diagnose-pest-disease` | `["Pest/ Disease Health"]` | Patch |
| `grow-fruits-veggies` | `["Tomato", "Onion", "Cucumber", "Potato"]` | Patch (category already fixed) |
| `fertilizer-soil-advice` | `["Nutrition", "Establishment"]` | Patch |
| `plant-basic-grains` | — | `hidden: true` (no corpus) |
| `manage-poultry-pigs` | — | `hidden: true` (no corpus) |
| `start-manage-apiary` | — | `hidden: true` (no corpus) |
| `tilapia-pond-care` | — | `hidden: true` (no corpus) |

### Files to patch

1. **Web config:** `components/gov-chat-frontend/public/config/genie-ai-config.json` — BUT verify this is the runtime config. The deployment may inject config via `window.APP_CONFIG` or a separate file at `/opt/<stack>/config/`. Check the config loading mechanism in `src/main.js` (`loadConfig`).
2. **Mobile config:** `mobile/genie_ai_mobile/assets/config/genie-ai-config.json` — same changes. APK rebuild required.

---

## 7. Tests

### 7.1 Frontend unit tests (`ChatBotComponent.test.js`)

- `loadQuickHelpButtons` reads `serviceLabels` from config
- `loadQuickHelpButtons` filters hidden buttons
- `loadQuickHelpButtons` sets `serviceKey` (R2)
- `selectQuickHelpOption` builds context with explicit labels (G3: replaces previous)
- `selectQuickHelpOption` carries `serviceKey` for sidebar items (G1)
- `getCategoryLabelById` returns null for unknown ID
- Query-build uses `serviceLabels` array then falls back to `serviceKey` (G1)
- Query-build backward compat: no `serviceLabels` → uses `serviceKey`
- `checkContextConfig` blocks on missing labels (all users, not admin-only — G2)
- `checkContextConfig` uses array membership for mismatch check (R3)
- `handleTreeNodeSelected` stores `serviceKey` alongside localized `service` (G1)

### 7.2 Config validation (DEFERRED — G5)

The `tests/config-validator/` has no ArangoDB connectivity. A full KB-label validation requires DB access in CI (scope expansion). **Deferred to a deployment-time smoke test** — a standalone script run post-deploy that validates config labels against the live KB.

For now: add a simple **structural validation** (non-empty string array, no whitespace-only entries) to the config-validator.

### 7.3 E2E (DEFERRED — G6)

No `tests/e2e/` directory or Playwright config exists. Writing the first E2E test is a separate infrastructure effort (CI integration, fixtures, Keycloak auth, SSE interceptor). **Deferred to a follow-up story.** The unit tests cover the filter-label logic; the E2E validates the full pipeline.

---

## 8. Scope Classification

### Generic (all deployments — code MR)

| Item | File |
|------|------|
| `loadQuickHelpButtons()` reads serviceLabels + hidden + serviceKey | `ChatBotComponent.vue` |
| `selectQuickHelpOption()` carries serviceLabels + replaces previous (G3) | `ChatBotComponent.vue` |
| Query-build uses serviceLabels then serviceKey fallback (G1) | `ChatBotComponent.vue` |
| `getCategoryLabelById()` returns null (§3.4) | `ChatBotComponent.vue` |
| `checkContextConfig()` blocks for all users (G2) + array membership (R3) | `ChatBotComponent.vue` |
| `removeContextItem()` carries serviceLabels | `ChatBotComponent.vue` |
| `handleTreeNodeSelected()` stores serviceKey (G1) | `ChatBotComponent.vue` |
| Flutter `_sendStreaming` gating fix (B2) | `chatbot_component.dart` |
| Flutter `_activeServiceLabels` field + set in `_quickHelpPressed` | `chatbot_component.dart` |
| Flutter `_loadQuickHelpConfig` reads new fields | `chatbot_component.dart` |
| Backend preserve null categoryLabel (B3) | `query-service.js` |
| chatqna singular/plural fix (B4/C) | `genieai_chatqna.py` |
| Frontend unit tests | `ChatBotComponent.test.js` |

### el-salvador-specific (config only)

| Item | File |
|------|------|
| Patch 3 working buttons with serviceLabels | `genie-ai-config.json` (web + mobile) |
| Hide 4 buttons with no corpus | same |
| Patch mobile config (stale 26653264 + serviceLabels) | mobile `genie-ai-config.json` |

---

## 9. Boundaries

### Always
- **Backward compat:** buttons WITHOUT `serviceLabels` fall back to `[serviceKey || service]`
- **`category` stays for UI grouping**, NOT used as retriever filter
- **`title` is display-only**, NEVER a filter label
- **`serviceKey` is the English stable key** used for filters + i18n lookup
- **Explicit labels must match `services.nameEN` exactly** (verified — see §2)

### Never
- Never send `"Category \d+"` to the retriever
- Never show a button that returns 0 docs (hide it)
- Never use the localized `service` as a retriever filter label (use `serviceKey`)
- Never send `serviceLabels` from a Quick Help button title

---

## 10. Out of Scope

1. **Backend label expansion** (parent → leaf at query time) — deferred; explicit serviceLabels is simpler
2. **Re-ingestion to add parent-category labels** — deferred
3. **Retriever-side fallback** (retry without filter when 0 results) — separately tracked
4. **Full config-validator with DB connectivity** (G5) — deferred to deployment smoke test
5. **E2E Playwright suite** (G6) — deferred to follow-up (no infra exists)
6. **Mobile APK delivery** — new build required; known limitation

---

## Appendix: Verified Code Locations (by symbol name)

| Component | File | Symbol |
|-----------|------|--------|
| Vue 3 | `ChatBotComponent.vue` | `getCategoryLabelById()` |
| Vue 3 | same | `checkContextConfig()` |
| Vue 3 | same | `loadQuickHelpButtons()` |
| Vue 3 | same | `selectQuickHelpOption()` |
| Vue 3 | same | `removeContextItem()` |
| Vue 3 | same | `handleTreeNodeSelected()` (G1 fix) |
| Vue 3 | same | query-build (`categoryLabel` resolution + `serviceLabels` mapping) |
| Vue 3 | same | `checkContextConfig()` call site |
| Flutter | `chatbot_component.dart` | `_loadQuickHelpConfig()` |
| Flutter | same | `_quickHelpPressed()` |
| Flutter | same | `_sendStreaming()` (context gating + construction) |
| Backend | `query-service.js` | `initStreamQuery()` (categoryLabel defaulting) |
| Backend | same | OPEA payload construction |
| ChatQnA | `genieai_chatqna.py` | label filter encoding (`categoryLabels` plural bug) |
| Retriever | `genieai_retriever_arangodb.py` | `_chunk_passes_label_filter()` |
| Config (web) | `genie-ai-config.json` | quickHelp.buttons schema |
| Config (mobile) | mobile `genie-ai-config.json` | same structure |
| Tests (FE) | `ChatBotComponent.test.js` | `selectQuickHelpOption` test block |
