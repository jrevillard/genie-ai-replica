# Quick Help: Explicit Service Labels for RAG Filtering

**Status:** Draft for review
**Date:** 2026-07-07
**Scope:** Frontend (Vue 3), Mobile (Flutter), el-salvador config
**Related:** El Salvador deployment — 6 of 7 Quick Help buttons return 0 documents

---

## 1. Intent

### What is broken

When a user clicks a Quick Help button in the GENIE.AI chat UI, the button sets conversation context that is forwarded to the RAG retriever as a label filter. The retriever uses an OR strategy: a chunk must carry at least one matching label to survive. **Six of seven Quick Help buttons return zero documents** because the labels sent to the retriever do not match any `chunk_labels` in the knowledge base.

### Root causes (three compounding bugs)

**Bug A — `serviceLabels` populated from button title (PRIMARY CAUSE).**

`loadQuickHelpButtons()` at `components/gov-chat-frontend/src/components/ChatBotComponent.vue:612` maps the button's localized title to the `service` field:

```js
return {
  service: title,            // e.g. "Grow Fruits & Veggies"
  ...
};
```

At query-build time (`ChatBotComponent.vue:788`), `selectedContextItems` is mapped to `serviceLabels`:

```js
const serviceLabels = this.selectedContextItems.map((item) => item.service);
```

No chunk in ArangoDB carries a label called "Grow Fruits & Veggies". Chunks are labeled at the service/crop level ("Tomato", "Onion", "Nutrition", "Pest/ Disease Health"). The retriever's exact-match OR filter eliminates everything.

**Bug B — `getCategoryLabelById` fallback sends a raw ID string.**

`getCategoryLabelById()` at `ChatBotComponent.vue:532` falls back to `` `Category ${id}` `` when the category ID is not found in `serviceCategories`. This string is sent as `context.categoryLabel` to the backend. However, **this does not actually cause the 0-docs bug** — see Bug C — but it is still broken behavior that must be fixed.

**Bug C — `categoryLabel` field name mismatch means it is silently ignored downstream.**

The chatqna service at `genie-ai-overlay/chatqna/genieai_chatqna.py:780` checks `retrieval_context.get("categoryLabels")` (plural), but the frontend sends `categoryLabel` (singular). The Pydantic model dump preserves the singular key, so `retrieval_context["categoryLabels"]` is never present. **Category-label filtering is completely non-functional** — only `serviceLabels` reaches the retriever filter. This means Bug B's fallback string never actually reaches the retriever, but fixing both is necessary for correctness.

### High-level approach

Add an optional `serviceLabels` array to each Quick Help button in the config. When present, these explicit labels replace the title as the service filter sent to the retriever. The `category` field remains for UI grouping only. The `title` remains for display only. Buttons with no matching corpus content are hidden via an optional `hidden` flag.

---

## 2. Proposed Config Schema Change

### New fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `serviceLabels` | `string[]` | No | Explicit label(s) to send as the RAG retriever filter. Must match `services.nameEN` values in ArangoDB. When absent, falls back to current behavior (title as service) for backward compatibility. |
| `hidden` | `boolean` | No (default `false`) | When `true`, the button is not rendered. Use for buttons whose topic has no matching corpus content. |

### Before (current config)

```json
{
  "id": "grow-fruits-veggies",
  "title": {"en": "Grow Fruits & Veggies", "es": "Cultivar Frutas y Hortalizas"},
  "icon": {"type": "file", "value": "/config/quickhelp/grow-fruits-veggies.svg"},
  "category": "28486647",
  "action": {
    "visibleText": {"en": "I need cultivation guides...", "es": "..."},
    "hiddenPrompt": {"en": "You are a Horticulture Specialist...", "es": "..."}
  }
}
```

### After (patched config)

```json
{
  "id": "grow-fruits-veggies",
  "title": {"en": "Grow Fruits & Veggies", "es": "Cultivar Frutas y Hortalizas"},
  "icon": {"type": "file", "value": "/config/quickhelp/grow-fruits-veggies.svg"},
  "category": "28486647",
  "serviceLabels": ["Tomato", "Onion", "Cucumber", "Potato"],
  "action": {
    "visibleText": {"en": "I need cultivation guides...", "es": "..."},
    "hiddenPrompt": {"en": "You are a Horticulture Specialist...", "es": "..."}
  }
}
```

### Hidden button example

```json
{
  "id": "manage-poultry-pigs",
  "title": {"en": "Manage Poultry & Pigs", "es": "..."},
  "icon": {"type": "file", "value": "/config/quickhelp/manage-poultry-pigs.svg"},
  "category": "26653377",
  "hidden": true,
  "serviceLabels": [],
  "action": { ... }
}
```

### JSON Schema update

In `components/gov-chat-frontend/public/config/genie-ai-config.json` (the `$schema` section, currently lines 143-231), add `serviceLabels` and `hidden` to the button `items.properties`. Neither field should be added to the `required` array — backward compatibility depends on both being optional.

---

## 3. Frontend Changes (Vue 3 — ChatBotComponent.vue)

### 3.1 `loadQuickHelpButtons()` (line 598)

Read `serviceLabels` and `hidden` from the config. Filter out hidden buttons.

When `serviceLabels` is present, use the FIRST label as the display `service` name (for UI context chips). The full array is carried for the filter.

### 3.2 `selectQuickHelpOption()` (line 650)

Carry `serviceLabels` into `selectedContextItems`:

```js
this.selectedContextItems.push({
  service: rawOption.service,
  serviceLabels: rawOption.serviceLabels || null,  // explicit filter labels
  serviceKey: rawOption.id || rawOption.service,
  category: categoryId,
  selected: true
});
```

### 3.3 Query-build section (line 786-806)

Use explicit `serviceLabels` when available; fall back to the `service` field for backward compatibility (sidebar tree selections):

```js
const serviceLabels = this.selectedContextItems.flatMap((item) =>
  Array.isArray(item.serviceLabels) && item.serviceLabels.length > 0
    ? item.serviceLabels
    : [item.service]
);
```

### 3.4 `getCategoryLabelById()` (line 516)

Return `null` instead of the broken `` `Category ${id}` `` fallback. The query handler treats null as "no category filter".

### 3.5 `checkContextConfig()` (line 535)

Escalate from warning to error-blocking when the filter labels are missing or the category is unresolved. Return a boolean (`true` = proceed, `false` = abort). Block conditions:
1. `categoryLabel === null` AND `serviceLabels` is empty
2. `categoryLabel` matches `/^Category \d+$/` (defensive guard)
3. `serviceLabels` contains the button display title (not a real KB label)

### 3.6 `removeContextItem()` (line 728)

Carry `serviceLabels` when rebuilding context from a Quick Help button.

---

## 4. Mobile Changes (Flutter)

### 4.1 Config reader — `_loadQuickHelpConfig()` (line 179)

Read `serviceLabels` and `hidden` from the button JSON. Filter hidden buttons during load.

### 4.2 `_quickHelpPressed()` (line 714)

Currently sends `serviceLabels: <String>[]` (hardcoded empty) — Quick Help on mobile has never sent any service filter. Add `_activeServiceLabels` field, set it from the button config, pass through `_sendStreaming()`.

### 4.3 Config file patch

The mobile config at `mobile/genie_ai_mobile/assets/config/genie-ai-config.json` needs the same `serviceLabels` / `hidden` additions. Baked into APK — new build required.

---

## 5. Backend Changes

### No backend changes required for the core fix

The backend (`query-service.js:280-388`) is a pass-through. It forwards `context: {categoryLabel, serviceLabels, language}` verbatim to OPEA. Sending correct `serviceLabels` from the frontend is sufficient.

### Optional hardening (recommended, separate task)

Add a validation step that warns when `serviceLabels` contains values not matching any `services.nameEN`. Advisory only (log warning, do not block).

### chatqna field-name mismatch (separate issue)

`categoryLabel` (singular) vs `categoryLabels` (plural) in `genie-ai-overlay/chatqna/genieai_chatqna.py:780` — category-level filtering is non-functional. Pre-existing bug, file separately. The explicit `serviceLabels` approach bypasses this entirely.

---

## 6. Config Migration (el-salvador)

### The 7 Quick Help buttons

| Button ID | Category ID | In KB? | serviceLabels | Action |
|-----------|-------------|--------|---------------|--------|
| `diagnose-pest-disease` | 28486582 | No | `["Pest/ Disease Health"]` | Patch |
| `grow-fruits-veggies` | 28486647 | Yes | `["Tomato","Onion","Cucumber","Potato"]` | Patch |
| `fertilizer-soil-advice` | 26653552 | No | `["Nutrition","Establishment"]` | Patch |
| `plant-basic-grains` | 26653158 | No | — | `hidden: true` |
| `manage-poultry-pigs` | 26653377 | No | — | `hidden: true` |
| `start-manage-apiary` | 26653325 | No | — | `hidden: true` |
| `tilapia-pond-care` | 26653435 | No | — | `hidden: true` |

### Label values must match `services.nameEN` exactly

Including punctuation and spacing: `"Pest/ Disease Health"` (space after slash), `"Variety/ Breed Selection"`, etc.

---

## 7. Tests

### Frontend unit tests (ChatBotComponent.test.js)

- `loadQuickHelpButtons` reads `serviceLabels` from config
- `loadQuickHelpButtons` filters hidden buttons
- `selectQuickHelpOption` builds context with explicit labels
- `getCategoryLabelById` returns null for unknown ID
- Query-build uses explicit serviceLabels array (flatMap)
- Backward compatibility — no `serviceLabels` falls back to `service`

### Config validation script (tests/config-validator/)

Validates all Quick Help `serviceLabels` exist in the KB `services` collection.

### E2E (Playwright)

Click a Quick Help button → intercept `/api/queries/stream` → assert `context.serviceLabels` contains explicit labels → assert response includes source documents.

---

## 8. Scope Classification

### Generic (all deployments)
- All `ChatBotComponent.vue` changes (sections 3.1-3.6)
- All Flutter `chatbot_component.dart` changes (sections 4.1-4.2)
- JSON Schema update
- Frontend unit tests + config validator

### el-salvador-specific (config only)
- Patch 3 working buttons with explicit `serviceLabels`
- Hide 4 buttons with no corpus
- Both web + mobile config files

---

## 9. Boundaries

### Always
- Backward compat: buttons WITHOUT `serviceLabels` fall back to current behavior
- `category` field stays for UI grouping, NOT used as filter
- `title` is display-only, NEVER a filter label
- Explicit labels must match `services.nameEN` exactly

### Never
- Never send `"Category \d+"` to the retriever
- Never show a button that returns 0 docs (hide it)
- Never use the button title as a retriever filter

---

## 10. Out of Scope

1. Backend label expansion (parent → leaf at query time) — deferred
2. Re-ingestion to add parent-category labels to chunks — deferred
3. Retriever-side fallback (retry without filter when 0 results) — separately tracked
4. chatqna `categoryLabel` vs `categoryLabels` mismatch — separate issue
5. Mobile config delivery (APK rebuild required) — known limitation

---

## Appendix: End-to-End Data Flow (After Fix)

```
User clicks "Grow Fruits & Veggies"
  ↓
selectQuickHelpOption()
  → selectedContextItems = [{
      service: "Tomato",                              // display name
      serviceLabels: ["Tomato","Onion","Cucumber","Potato"],  // explicit filter
      category: "28486647"
    }]
  ↓
sendMessage() builds query:
  context: {
    categoryLabel: "Vegetables" (or null),
    serviceLabels: ["Tomato","Onion","Cucumber","Potato"],
    language: "ES"
  }
  ↓
Backend pass-through → ChatQnA encodes into search_start:
  search_start = "chunk::labels:Tomato,Onion,Cucumber,Potato"
  ↓
Retriever label filter (OR strategy):
  chunk passes if chunk_labels contains ANY of [Tomato, Onion, Cucumber, Potato]
  → matches 100+ chunks
  ↓
Reranker → LLM → Response with source documents
```
