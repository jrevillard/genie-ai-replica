# Quick-Help Label Drift — Implementation Plan

> **PIVOT (2026-10-27, review round 3 + product decision):** the design below was
> withdrawn after the third review. The server-side resolver, the label registry, the
> retriever rescue and the `/labels` endpoint were REMOVED; the final contract is
> "ENGLISH is the SSOT of the filter wire" (tree carries `nameEN`, clients speak EN,
> a broken Quick Help button is a visible error state that sends nothing, an empty
> scope abstains). The authoritative record of the pivot and its rulings is the
> execution ledger (`.superpowers/sdd/2026-10-26-quickhelp-label-drift/progress.md`,
> git-ignored) and the MR description. The tasks below describe the WITHDRAWN design
> and are kept for history only.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the knowledge hierarchy the single source of truth for the RAG label filter, so a stale, localized or invented label can never empty the retrieval and strip the LLM of its context.

**Architecture:** The server owns the label vocabulary. A new resolver reads the live taxonomy from ArangoDB (canonical English label + every translation per category/service), maps any client-supplied label — in any language — onto the canonical English label the retriever actually filters on, drops labels that resolve to nothing, and removes the filter entirely when nothing resolves. The retriever gains a last-resort fallback: a label filter that matches zero documents is retried without the filter, so the LLM always gets context.

**Tech Stack:** Node.js 22 / Express (backend BFF, Jest), ArangoDB (AQL), Vue 3 (web client, Jest), Python 3.11 / FastAPI (OPEA retriever, pytest).

**Spec:** `_bmad-output/party-mode/memories/installed/.memlog.md` (party decision of 2026-10-26) + the diagnosis in this plan's "Context" section.

## Context (the facts the plan rests on)

- The knowledge hierarchy lives **only** in ArangoDB: `serviceCategories` (`nameEN`, `catCode?`), `services` (`nameEN`, `serviceCode?`, `categoryId`), plus `serviceCategoryTranslations` / `serviceTranslations`.
- `chunk_labels` written at ingest are **always English**: `genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py::_fetch_all_labels` calls `GET /api/service-categories/categories` with no locale → English.
- The retriever filters with a hard AQL clause: `FILTER (doc.chunk_labels != null) AND (["X"] ANY IN doc.chunk_labels)` (`genie-ai-overlay/retriever/genieai_retriever_arangodb.py::_build_aql_filter_clause`). Zero matches → `search_res == []` → `return []` → ChatQnA `is_grounded = False` → the LLM answers with no context.
- The web client sends **localized** labels (`getCategoryLabelById` returns the localized category name; sidebar `serviceKey` is the localized service name) and, for Quick Help buttons without explicit `serviceLabels`, sends **the button id** as a label (`loadQuickHelpButtons` → `serviceKey: button.id`; `sendMessage` → `[item.serviceKey || item.service]`). Neither matches `chunk_labels`.
- `createQuery` (non-streaming) injects a literal `'General'` category label that matches no chunk.
- **The `categoryLabel` never reaches the retriever at all.** `core/genieai_api_protocol.py::RequestContext` declares `categoryLabels` (plural), `serviceLabels` and `language`; Pydantic v2's default `extra='ignore'` drops the singular `categoryLabel` the backend sends. `chatqna` reads `retrieval_context.get("categoryLabel")` — a key Pydantic has just removed. Category-level filtering has been dead at runtime.
- `_build_aql_filter_clause` interpolates labels into AQL **without escaping** — a client-supplied label is an AQL-injection surface.
- `core/label_contract.py` encodes labels as a comma-joined string — a label containing a comma is split into two labels.

**Central invariant (from the party):** *no hard label filter ever reaches the retriever with a label the server did not resolve to a live canonical English label. If resolution yields nothing, there is no filter — never an empty context.*

## Global Constraints

- All documentation, comments and code in **English** (repo language policy).
- Backend uses the `createApp()` pattern; tests use `supertest` without an HTTP server.
- Shared helpers go through the `shared-lib` barrel (`components/shared/lib/index.js`); the ESLint rule `local/no-runtime-unresolvable-shared-path` forbids `require('.../shared/lib...')` in shipped code.
- OPEA Python: copyright header (ITU), `ruff` lint + format, `CustomLogger` from `comps`.
- No merge to `main` without the user's explicit agreement.
- Vue 3 **Options API**; DS tokens only; i18n for user-facing strings.
- Every new user-facing string needs an entry in all 14 locale files of `components/gov-chat-frontend/src/i18n/locales/`.

## Review Focus

Input classes the spec implies but the tasks' own tests must pin:

1. A **localized** label (`"Registre des naissances"`) sent by the client → resolves to the English `chunk_labels` value (`"Birth Registration"`), so the filter matches.
2. A label that matches **nothing** in the taxonomy → dropped; if it was the only label → **no filter at all** (not an empty filter, not a crash).
3. A label that resolves but whose **chunks do not exist** in the corpus (service never ingested) → the retriever fallback must return documents instead of an empty list.
4. `serviceLabels: []` (the "Just Chat" button) → still no filter, and must not be mistaken for a misconfiguration.
5. A label containing a **comma** → the `search_start` encoding is comma-joined; the label must survive it intact.
6. A label containing a **double quote** → it is interpolated into AQL; it must not break out of the string literal.
7. The backend's singular **`categoryLabel`** → it must survive the Pydantic request model, otherwise the category filter is silently dead.
8. A client that sends a **stale category label** (the category was renamed) → the label names no entity, so it is dropped and the query goes unfiltered — never filtered on a label that matches no chunk.
9. A Quick Help configuration whose category **no longer exists** → the client holds both the configured value and the live tree, so it reports the drift to the admin (`chatbot.categoryNotFound`) instead of sending a filter on nothing.
10. A client that sends a **category key** (an older web build, or a third-party client) → the key is not part of the contract: it must not filter on an entity the client never named by label.

---

### Task 1: Live label registry

**Files:**
- Modify: `components/gov-chat-backend/services/service-category-service.js` (add `getLabelRegistry()`)
- Test: `components/gov-chat-backend/__tests__/services/service-category-service.test.js`

**Interfaces:**
- Produces: `ServiceCategoryService.getLabelRegistry(): Promise<{ categories: RegistryEntry[], services: RegistryEntry[] }>` where
  `RegistryEntry = { key: string, code: string|null, canonical: string, categoryKey?: string, translations: Record<string, string> }`
  (`translations` keys are upper-case locale codes, e.g. `EN`, `FR`).

- [ ] **Step 1: Write the failing test**

In `__tests__/services/service-category-service.test.js` add a describe block for `getLabelRegistry` that stubs `service.db.query` to return one category and one service with translations, and asserts the returned shape (canonical = `nameEN`, `code` = `catCode`/`serviceCode` or `null`, translations keyed by upper-case locale).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd components/gov-chat-backend && npx jest __tests__/services/service-category-service.test.js -t "getLabelRegistry"`
Expected: FAIL — `getLabelRegistry is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add to `service-category-service.js`:

```js
  /**
   * Load the live knowledge-label registry: every category and service with its
   * canonical English label and every active translation.
   *
   * The retriever filters on `chunk_labels`, which the dataprep writes from the
   * ENGLISH taxonomy. Clients, however, send labels in whatever language their
   * UI is showing. This registry is what lets the backend map one onto the other.
   */
  async getLabelRegistry() {
    await this.init();
    const query = aql`
      FOR category IN serviceCategories
        LET categoryTranslations = (
          FOR trans IN serviceCategoryTranslations
            FILTER trans.serviceCategoryId == category._key
            FILTER trans.isActive != false
            RETURN { locale: trans.languageCode, label: trans.translation }
        )
        LET services = (
          FOR edge IN categoryServices
            FILTER edge._from == category._id
            FOR service IN services
              FILTER service._id == edge._to
              LET serviceTranslations = (
                FOR trans IN serviceTranslations
                  FILTER trans.serviceId == service._key
                  FILTER trans.isActive != false
                  RETURN { locale: trans.languageCode, label: trans.translation }
              )
              RETURN {
                key: service._key,
                code: service.serviceCode != null ? service.serviceCode : null,
                categoryKey: category._key,
                canonical: service.nameEN,
                translations: serviceTranslations
              }
        )
        RETURN {
          key: category._key,
          code: category.catCode != null ? category.catCode : null,
          canonical: category.nameEN,
          translations: categoryTranslations,
          services: services
        }
    `;

    const cursor = await this.db.query(query);
    const rows = await cursor.all();

    const categories = [];
    const services = [];
    for (const row of rows) {
      categories.push({
        key: row.key,
        code: row.code,
        canonical: row.canonical,
        translations: toLocaleMap(row.translations)
      });
      for (const service of row.services || []) {
        services.push({
          key: service.key,
          code: service.code,
          categoryKey: service.categoryKey,
          canonical: service.canonical,
          translations: toLocaleMap(service.translations)
        });
      }
    }
    return { categories, services };
  }
```

with a module-level helper:

```js
// Registry translations arrive as [{ locale, label }]; the resolver looks them
// up by upper-case locale code.
function toLocaleMap(entries) {
  const map = {};
  for (const entry of entries || []) {
    if (!entry || !entry.locale || !entry.label) continue;
    map[String(entry.locale).toUpperCase()] = entry.label;
  }
  return map;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd components/gov-chat-backend && npx jest __tests__/services/service-category-service.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/gov-chat-backend/services/service-category-service.js components/gov-chat-backend/__tests__/services/service-category-service.test.js
git commit -m "feat(backend): load the live knowledge-label registry from ArangoDB"
```

---

### Task 2: Pure label resolver

**Files:**
- Create: `components/gov-chat-backend/services/label-resolver.js`
- Test: `components/gov-chat-backend/__tests__/services/label-resolver.test.js`

**Interfaces:**
- Consumes: the registry from Task 1.
- Produces:
  - `buildLabelIndex(registry): LabelIndex` — `LabelIndex = { categories: Map<string, Entry>, services: Map<string, Entry> }` keyed by normalized label.
  - `resolveCategoryLabel(index, label): { resolved: string|null, matched: boolean }`
  - `resolveServiceLabels(index, labels): { resolved: string[], dropped: string[] }`
  - `filterLabelOf(entry): string` — the English label the retriever filters on (`entry.translations.EN ?? entry.canonical`).
  - `normalizeLabel(value): string`

- [ ] **Step 1: Write the failing test**

Create `__tests__/services/label-resolver.test.js` with a registry fixture:

```js
const registry = {
  categories: [
    { key: '1', code: 'cat1', canonical: 'Identity & Civil Registration', translations: { EN: 'Identity & Civil Registration', FR: 'Identité et état civil' } },
    { key: '2', code: 'cat2', canonical: 'Taxes & Revenue', translations: { EN: 'Taxes & Revenue', FR: 'Impôts et recettes' } }
  ],
  services: [
    { key: '7', code: 'service_1', categoryKey: '1', canonical: 'Birth Registration', translations: { EN: 'Birth Registration', FR: 'Enregistrement des naissances' } }
  ]
};
```

and assert:

- `resolveServiceLabels(index, ['Enregistrement des naissances'])` → `{ resolved: ['Birth Registration'], dropped: [] }` (French resolves to the English filter label).
- `resolveServiceLabels(index, ['Birth registration'])` → resolves (case-insensitive).
- `resolveServiceLabels(index, ['Tomato'])` → `{ resolved: [], dropped: ['Tomato'] }`.
- `resolveServiceLabels(index, ['Tomato', 'Birth Registration'])` → `{ resolved: ['Birth Registration'], dropped: ['Tomato'] }` (valid labels survive).
- `resolveServiceLabels(index, [])` → `{ resolved: [], dropped: [] }` (no label, no drop — not a misconfiguration).
- `resolveServiceLabels(index, [''])` → `{ resolved: [], dropped: [] }` (blank labels are ignored, not reported as drift).
- `resolveServiceLabels(index, ['Birth Registration', 'Birth Registration'])` → `resolved` has one entry (dedup).
- `resolveCategoryLabel(index, 'Impôts et recettes')` → `{ resolved: 'Taxes & Revenue', matched: true }`.
- `resolveCategoryLabel(index, 'Nope')` → `{ resolved: null, matched: false }`.
- `resolveCategoryLabel(index, null)` → `{ resolved: null, matched: false }`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd components/gov-chat-backend && npx jest __tests__/services/label-resolver.test.js`
Expected: FAIL — `Cannot find module '../services/label-resolver'`.

- [ ] **Step 3: Write minimal implementation**

Create `components/gov-chat-backend/services/label-resolver.js`:

```js
// Resolution of client-supplied knowledge labels against the live taxonomy.
//
// The retriever filters on `chunk_labels`, which the dataprep writes from the
// ENGLISH taxonomy. Clients send whatever label their UI displays — often a
// translation, sometimes a stale config string, sometimes a button id. This
// module maps any of those onto the English label the retriever can actually
// match, and reports the ones that resolve to nothing so the caller can drop
// them instead of filtering the corpus down to zero documents.

const EN_LOCALE = 'EN';

/**
 * Normalize a label for comparison: trimmed, whitespace-collapsed, lower-case.
 * @param {*} value
 * @returns {string}
 */
function normalizeLabel(value) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * The label the retriever filters on: the English translation when the
 * hierarchy carries one, otherwise the canonical `nameEN`.
 * @param {Object} entry
 * @returns {string}
 */
function filterLabelOf(entry) {
  if (!entry) return '';
  const en = entry.translations && entry.translations[EN_LOCALE];
  return (typeof en === 'string' && en.trim()) || entry.canonical || '';
}

function indexEntries(entries) {
  const index = new Map();
  for (const entry of entries || []) {
    const candidates = [entry.canonical];
    for (const label of Object.values(entry.translations || {})) candidates.push(label);
    for (const candidate of candidates) {
      const key = normalizeLabel(candidate);
      if (!key || index.has(key)) continue;
      index.set(key, entry);
    }
  }
  return index;
}

/**
 * Build the label → entity lookup for a registry.
 * @param {{categories: Array, services: Array}} registry
 * @returns {{categories: Map<string, Object>, services: Map<string, Object>}}
 */
function buildLabelIndex(registry) {
  return {
    categories: indexEntries(registry && registry.categories),
    services: indexEntries(registry && registry.services)
  };
}

function lookup(index, labels, label) {
  const key = normalizeLabel(label);
  if (!key) return null;
  for (const map of labels) {
    const entry = map.get(key);
    if (entry) return entry;
  }
  return null;
}

/**
 * Resolve a category label (any language) to its canonical English label.
 * @param {Object} index
 * @param {*} label
 * @returns {{resolved: string|null, matched: boolean}}
 */
function resolveCategoryLabel(index, label) {
  const entry = lookup(index, [index.categories], label);
  if (!entry) return { resolved: null, matched: false };
  return { resolved: filterLabelOf(entry), matched: true };
}

/**
 * Resolve service labels (any language) to their canonical English labels.
 * Unknown labels are dropped; known ones are deduplicated in request order.
 * @param {Object} index
 * @param {Array} labels
 * @returns {{resolved: string[], dropped: string[]}}
 */
function resolveServiceLabels(index, labels) {
  const resolved = [];
  const dropped = [];
  const seen = new Set();
  for (const raw of Array.isArray(labels) ? labels : []) {
    const label = typeof raw === 'string' ? raw.trim() : '';
    if (!label) continue;
    const entry = lookup(index, [index.services, index.categories], label);
    if (!entry) {
      dropped.push(label);
      continue;
    }
    const filterLabel = filterLabelOf(entry);
    if (!filterLabel || seen.has(filterLabel)) continue;
    seen.add(filterLabel);
    resolved.push(filterLabel);
  }
  return { resolved, dropped };
}

module.exports = { buildLabelIndex, filterLabelOf, normalizeLabel, resolveCategoryLabel, resolveServiceLabels };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd components/gov-chat-backend && npx jest __tests__/services/label-resolver.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/gov-chat-backend/services/label-resolver.js components/gov-chat-backend/__tests__/services/label-resolver.test.js
git commit -m "feat(backend): resolve client labels against the live taxonomy"
```

---

### Task 3: Query pipeline uses resolved labels (and never an empty filter)

**Files:**
- Modify: `components/gov-chat-backend/services/query-service.js`
- Test: `components/gov-chat-backend/__tests__/services/query-service.test.js`

**Interfaces:**
- Consumes: `ServiceCategoryService.getLabelRegistry()` (Task 1) and `label-resolver` (Task 2).
- Produces: `QueryService.resolveContextLabels(context)` → `{ categoryLabel: string|null, serviceLabels: string[], dropped: string[] }`.

**Contract:** the resolved context is what reaches OPEA. `context.categoryLabel` becomes the canonical English category label (or `null`); `context.serviceLabels` becomes the canonical English labels (possibly empty). When **nothing** resolves, both are empty/null → OPEA receives no label → the retriever searches the whole corpus.

- [ ] **Step 1: Write the failing test**

In `__tests__/services/query-service.test.js` add a describe block `resolveContextLabels`:

- mocks `service-category-service` (`jest.mock('../services/service-category-service')`) so `getLabelRegistry` returns the registry fixture;
- asserts a French label resolves to English;
- asserts an unknown label is dropped and, when it is the only label, `serviceLabels` is `[]` and `categoryLabel` is `null`;
- asserts a mixed list keeps the valid label and reports the dropped one.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd components/gov-chat-backend && npx jest __tests__/services/query-service.test.js -t "resolveContextLabels"`
Expected: FAIL — `resolveContextLabels is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `query-service.js`:

```js
const serviceCategoryService = require('./service-category-service');
const { buildLabelIndex, resolveCategoryLabel, resolveServiceLabels } = require('./label-resolver');
```

and add the method to `QueryService`:

```js
  /**
   * Map the client-supplied context labels onto the canonical English labels the
   * retriever filters on.
   *
   * A label that resolves to nothing is dropped: a stale config label or an
   * invented button id must never narrow the corpus to zero documents — that
   * is what leaves the LLM without any context to answer from. When no label
   * resolves at all, the query is sent unfiltered.
   *
   * @param {Object} context
   * @returns {Promise<{categoryLabel: string|null, serviceLabels: string[], dropped: string[]}>}
   */
  async resolveContextLabels(context) {
    const registry = await serviceCategoryService.getLabelRegistry();
    const index = buildLabelIndex(registry);

    const category = resolveCategoryLabel(index, context ? context.categoryLabel : null);
    const services = resolveServiceLabels(index, context ? context.serviceLabels : []);

    const dropped = [...services.dropped];
    if (context && context.categoryLabel && !category.matched) {
      dropped.push(String(context.categoryLabel).trim());
    }

    if (dropped.length > 0) {
      logger.warn('QueryService.unresolved_context_labels', { dropped });
    }

    return {
      categoryLabel: category.resolved || null,
      serviceLabels: services.resolved,
      dropped
    };
  }
```

Then, in `initStreamQuery` and `createQuery`, replace the OPEA payload construction with the resolved context:

```js
    const resolvedContext = await this.resolveContextLabels(queryData.context);
```

and build the payload from it:

```js
        context: {
          categoryLabel: resolvedContext.categoryLabel,
          serviceLabels: resolvedContext.serviceLabels,
          language: pickLanguage(queryData.context)
        },
```

In `createQuery`, also remove the `'General'` default that injects a label matching no chunk:

```js
        if (queryData.context.categoryLabel === undefined) {
          queryData.context.categoryLabel = null;
        }
```

(replacing the `if (!queryData.context.categoryLabel) { ... = 'General' }` branch) and the matching `context: { categoryLabel: 'General', serviceLabels: [] }` default.

The `categoryId` / `serviceIds` resolution (analytics only) keeps using the **raw** client labels, which now also work for localized labels — switch those AQL lookups to match the resolved English labels:

```js
      const categoryQuery = aql`
          FOR cat IN ${this.serviceCategories}
            FILTER cat.nameEN IN ${resolvedContext.categoryLabel ? [resolvedContext.categoryLabel] : []}
            LIMIT 1
            RETURN cat._key
      `;
```

and

```js
        const servicesQuery = aql`
            FOR svc IN ${this.services}
              FILTER svc.nameEN IN ${resolvedContext.serviceLabels}
              RETURN svc._key
        `;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd components/gov-chat-backend && npx jest __tests__/services/query-service.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/gov-chat-backend/services/query-service.js components/gov-chat-backend/__tests__/services/query-service.test.js
git commit -m "fix(backend): resolve context labels before they reach the retriever"
```

---

### Task 4: Label vocabulary endpoint (discovery)

**Files:**
- Modify: `components/gov-chat-backend/routes/service-category-routes.js`
- Modify: `components/gov-chat-backend/services/service-category-service.js` (add `getLabelVocabulary()`)
- Test: `components/gov-chat-backend/__tests__/routes/service-category-routes.test.js` (create if absent — check first)

**Interfaces:**
- Produces: `GET /api/service-categories/labels` → `[{ code, label, kind: 'category'|'service', categoryCode, categoryLabel, translations }]`

- [ ] **Step 1: Write the failing test**

Assert that `GET /api/service-categories/labels` returns 200 and one entry per category and per service, with `kind` and the English `label`.

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — 404 (route does not exist).

- [ ] **Step 3: Write minimal implementation**

In `service-category-service.js`:

```js
  /**
   * The live label vocabulary: every category and service the retriever can
   * filter on. Deployers use it to check that the labels hardcoded in their
   * Quick Help configuration still exist.
   */
  async getLabelVocabulary() {
    const { categories, services } = await this.getLabelRegistry();
    const vocabulary = [];
    for (const category of categories) {
      vocabulary.push({
        code: category.code,
        label: category.translations.EN || category.canonical,
        kind: 'category',
        categoryCode: category.code,
        categoryLabel: category.translations.EN || category.canonical,
        translations: category.translations
      });
    }
    for (const service of services) {
      const parent = categories.find((category) => category.key === service.categoryKey);
      vocabulary.push({
        code: service.code,
        label: service.translations.EN || service.canonical,
        kind: 'service',
        categoryCode: parent ? parent.code : null,
        categoryLabel: parent ? parent.translations.EN || parent.canonical : null,
        translations: service.translations
      });
    }
    return vocabulary;
  }
```

In `routes/service-category-routes.js` add the route next to `/categories`, with the same auth middleware and a swagger block:

```js
  router.get('/labels', async (req, res) => {
    try {
      const vocabulary = await serviceCategoryService.getLabelVocabulary();
      res.json(vocabulary);
    } catch (error) {
      logger.error(`Error getting label vocabulary: ${error.message}`, { stack: error.stack });
      res.status(500).json({ message: error.message });
    }
  });
```

- [ ] **Step 4: Run test to verify it passes**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/gov-chat-backend/routes/service-category-routes.js components/gov-chat-backend/services/service-category-service.js components/gov-chat-backend/__tests__
git commit -m "feat(backend): expose the live knowledge-label vocabulary"
```

---

### Task 5: Web client stops sending invented labels

**Files:**
- Modify: `components/gov-chat-frontend/src/components/ChatBotComponent.vue`
- Test: `components/gov-chat-frontend/src/__tests__/components/ChatBotComponent.test.js`

**Interfaces:**
- Consumes: nothing new (the server resolves).
- Produces: the request `context.serviceLabels` contains only labels the deployment declared — never a button id.

- [ ] **Step 1: Write the failing test**

Add a test that selects a Quick Help button whose config has **no** `serviceLabels` and asserts the submitted context has `serviceLabels: []` (today it is `['<button id>']`).

Add a test that a Quick Help button **with** `serviceLabels` sends exactly those labels.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd components/gov-chat-frontend && npx jest src/__tests__/components/ChatBotComponent.test.js -t "quick help"`
Expected: FAIL — the context carries the button id.

- [ ] **Step 3: Write minimal implementation**

In `loadQuickHelpButtons`, keep `serviceLabels: explicitLabels` (already `null` when absent) and stop deriving a label from the id:

```js
              serviceKey: explicitLabels ? explicitLabels[0] : button.id || title,
```

`serviceKey` stays as the *display* key, but `sendMessage` must not use it as a filter label for Quick Help items. The label contribution of an item is:

```js
          const serviceLabels = this.selectedContextItems.flatMap((item) => {
            // Quick Help items contribute only the labels the deployment declared.
            // A button id is not a knowledge label: sending it filtered the corpus
            // down to zero documents and left the LLM with no context at all.
            if (item.source === 'quickHelp') {
              return Array.isArray(item.serviceLabels) ? item.serviceLabels : [];
            }
            // Sidebar items carry the service name, which the backend resolves
            // against the live taxonomy (in any language).
            return item.serviceKey ? [item.serviceKey] : [];
          });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd components/gov-chat-frontend && npx jest src/__tests__/components/ChatBotComponent.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/gov-chat-frontend/src/components/ChatBotComponent.vue components/gov-chat-frontend/src/__tests__/components/ChatBotComponent.test.js
git commit -m "fix(frontend): stop sending button ids as knowledge labels"
```

---

### Task 6: Retriever fallback — a label filter that matches nothing never empties the context

**Files:**
- Modify: `genie-ai-overlay/retriever/genieai_retriever_arangodb.py`
- Test: `genie-ai-overlay/tests/test_retriever.py`

**Interfaces:**
- Produces: when `labels_to_filter` is non-empty and the filtered search returns zero documents, the retriever retries **without** the label filter and returns those documents. The event is logged at WARNING level and recorded as the span attribute `rag.label_filter_fallback = True`.
- Produces: `_build_aql_filter_clause` escapes the labels it interpolates into AQL.

- [ ] **Step 1: Write the failing test**

In `genie-ai-overlay/tests/test_retriever.py` add a test that drives `invoke()` with a non-empty `labels_to_filter` and a mocked vector DB that returns zero documents for the filtered call and documents for the unfiltered call; assert the retriever returns the unfiltered documents and that the fallback was logged.

Add a unit test for `_build_aql_filter_clause` asserting that a label containing a double quote (`He said "hi"`) is escaped in the emitted clause and cannot break out of the string literal.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd genie-ai-overlay && python -m pytest tests/test_retriever.py -k fallback -v`
Expected: FAIL — the retriever returns `[]`.

- [ ] **Step 3: Write minimal implementation**

Extract the dense search into a local coroutine so it can be re-run without the filter clause:

```python
            async def _dense_search(clause: str) -> list:
                if input.search_type == "similarity_score_threshold":
                    docs_and_similarities = await vector_db.asimilarity_search_with_relevance_scores(
                        query=query,
                        embedding=embedding,
                        k=input.k,
                        score_threshold=input.score_threshold,
                        use_approx=use_approx_search,
                        filter_clause=clause,
                    )
                    return [{"doc": doc, "score": score} for doc, score in docs_and_similarities]
                if input.search_type == "mmr":
                    results = await vector_db.amax_marginal_relevance_search(
                        query=query,
                        embedding=embedding,
                        k=input.k,
                        fetch_k=input.k,
                        lambda_mult=input.lambda_mult,
                        use_approx=use_approx_search,
                        filter_clause=clause,
                    )
                    docs_and_scores = await vector_db.asimilarity_search_with_relevance_scores(
                        query=query,
                        embedding=embedding,
                        k=input.k,
                        use_approx=use_approx_search,
                        filter_clause=clause,
                    )
                    score_map = {id(doc): score for doc, score in docs_and_scores}
                    return [{"doc": doc, "score": score_map.get(id(doc), 0.0)} for doc in results]
                docs_and_scores = await vector_db.asimilarity_search_with_relevance_scores(
                    query=query,
                    embedding=embedding,
                    k=input.k,
                    use_approx=use_approx_search,
                    filter_clause=clause,
                )
                return [{"doc": doc, "score": score} for doc, score in docs_and_scores]
```

(call it with `aql_filter_clause if search_start == "chunk" else ""`), and after the hybrid block, before the empty check:

```python
            # A label filter that matches nothing leaves the LLM with no context:
            # the retrieval returns zero documents and the answer is generated
            # from the model's own knowledge. Retry without the filter so the
            # question is still answered from the corpus.
            if not search_res and labels_to_filter:
                logger.warning(
                    "Label filter matched no documents — retrying without the label filter "
                    f"(labels={labels_to_filter}, strategy={filter_strategy})"
                )
                span.set_attribute("rag.label_filter_fallback", True)
                search_res = await _dense_search("")
                if search_res:
                    logger.info(f"Label filter fallback returned {len(search_res)} documents.")

Escape the labels in `_build_aql_filter_clause` — they are interpolated into the
AQL text, so a double quote in a label would otherwise close the string literal:

```python
def _escape_aql_string(value: str) -> str:
    """Escape a value for interpolation into an AQL string literal."""
    return value.replace("\\", "\\\\").replace('"', '\\"')


def _build_aql_filter_clause(labels_to_filter, filter_strategy):
    if not labels_to_filter:
        return ""
    labels_array = "[" + ", ".join(f'"{_escape_aql_string(label)}"' for label in labels_to_filter) + "]"
    ...
```
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd genie-ai-overlay && python -m pytest tests/test_retriever.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add genie-ai-overlay/retriever/genieai_retriever_arangodb.py genie-ai-overlay/tests/test_retriever.py
git commit -m "fix(retriever): fall back to an unfiltered search when a label filter matches nothing"
```

---

### Task 7: The category label must survive the API contract

**Files:**
- Modify: `genie-ai-overlay/core/genieai_api_protocol.py` (`RequestContext`)
- Modify: `genie-ai-overlay/OVERRIDES.yaml`
- Test: `genie-ai-overlay/tests/test_request_context.py` (create)

**Interfaces:**
- Produces: `RequestContext.categoryLabel: str | None` — the singular field the backend sends and `chatqna` reads.

**Why:** `RequestContext` declares `categoryLabels` (plural) only. Pydantic v2's default `extra='ignore'` therefore drops the singular `categoryLabel`, so the category filter never reaches the retriever — category filtering has been dead at runtime. Adding the field is the smallest correct fix: the sender and the consumer already agree on the singular name.

- [ ] **Step 1: Write the failing test**

```python
from core.genieai_api_protocol import RequestContext


def test_request_context_keeps_the_singular_category_label():
    context = RequestContext.model_validate(
        {"categoryLabel": "Taxes & Revenue", "serviceLabels": ["Birth Registration"], "language": "en"}
    )
    dumped = context.model_dump(exclude_unset=True)
    assert dumped["categoryLabel"] == "Taxes & Revenue"
    assert dumped["serviceLabels"] == ["Birth Registration"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd genie-ai-overlay && python -m pytest tests/test_request_context.py -v`
Expected: FAIL — `KeyError: 'categoryLabel'`.

- [ ] **Step 3: Write minimal implementation**

In `core/genieai_api_protocol.py`:

```python
class RequestContext(BaseModel):
    """
    A model to hold structured context for metadata filtering during retrieval.
    """

    # OVERRIDE core.genieai_api_protocol.RequestContext.categoryLabel | disposition: still-needed | reason: upstream declares categoryLabels only, so Pydantic drops the singular categoryLabel the backend sends and chatqna reads — category filtering was dead | test: tests/test_request_context.py
    categoryLabel: str | None = None
    categoryLabels: list[str] | None = None
    serviceLabels: list[str] | None = None
    language: str | None = None
```

Add the matching manifest entry to `genie-ai-overlay/OVERRIDES.yaml`:

```yaml
  - override: core.genieai_api_protocol.RequestContext.categoryLabel
    disposition: still-needed
    owner: genie-ai
    justification: Upstream RequestContext declares categoryLabels only; Pydantic's extra='ignore' default drops the singular categoryLabel the backend sends and chatqna reads, so category-level filtering never reached the retriever.
    added_in: v1.5
    last_validated: v1.5
    test: tests/test_request_context.py
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd genie-ai-overlay && python -m pytest tests/test_request_context.py -v` → PASS
Run: `cd genie-ai-overlay && python build-patches/lint_overrides.py` → exit 0.

- [ ] **Step 5: Commit**

```bash
git add genie-ai-overlay/core/genieai_api_protocol.py genie-ai-overlay/OVERRIDES.yaml genie-ai-overlay/tests/test_request_context.py
git commit -m "fix(overlay): keep the category label across the chat request contract"
```

---

### Task 8: A label containing a comma must survive the filter encoding

**Files:**
- Modify: `genie-ai-overlay/core/label_contract.py`
- Test: `genie-ai-overlay/tests/test_label_contract.py` (create if absent)

**Interfaces:**
- Produces: `encode_filter_labels(base_mode, labels)` percent-encodes each label; `decode_filter_labels(search_start)` decodes it. Both sides of the contract live in this repo (`chatqna` encodes, `retriever` decodes).

- [ ] **Step 1: Write the failing test**

```python
from core.label_contract import decode_filter_labels, encode_filter_labels


def test_label_with_a_comma_survives_the_encoding():
    encoded = encode_filter_labels("chunk", ["Births, Deaths and Marriages", "Taxes"])
    base_mode, labels = decode_filter_labels(encoded)
    assert base_mode == "chunk"
    assert labels == ["Births, Deaths and Marriages", "Taxes"]
```

Plus a regression test asserting a plain label still round-trips unchanged, and that the decoded labels match the strings the retriever filters on.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd genie-ai-overlay && python -m pytest tests/test_label_contract.py -v`
Expected: FAIL — the comma splits the label.

- [ ] **Step 3: Write minimal implementation**

In `core/label_contract.py`:

```python
from urllib.parse import quote, unquote


def encode_filter_labels(base_mode: str, labels: list[str]) -> str:
    if not labels:
        return base_mode
    clean = [l.strip() for l in labels if l and l.strip()]
    if not clean:
        return base_mode
    # Percent-encode each label: the separator is a comma, so a label that
    # contains one would otherwise be split into two labels by the decoder.
    return f"{base_mode}{_LABEL_SEPARATOR}{','.join(quote(label, safe='') for label in clean)}"


def decode_filter_labels(search_start: str) -> tuple[str, list[str]]:
    if _LABEL_SEPARATOR not in str(search_start):
        return str(search_start), []
    parts = str(search_start).split(_LABEL_SEPARATOR, 1)
    base_mode = parts[0]
    labels = [unquote(label.strip()) for label in parts[1].split(",") if label.strip()]
    return base_mode, labels
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd genie-ai-overlay && python -m pytest tests/test_label_contract.py -v` → PASS
Run: `cd genie-ai-overlay && python -m pytest tests/ -v` → the whole suite still passes.

- [ ] **Step 5: Commit**

```bash
git add genie-ai-overlay/core/label_contract.py genie-ai-overlay/tests/test_label_contract.py
git commit -m "fix(overlay): percent-encode filter labels so a comma cannot split them"
```

---

### Task 9: Documentation

**Files:**
- Modify: `site/content/en/docs/rag-pipeline/data-labeling.md` (the page that documents the labelling and the retrieval filter)
- Modify: `site/content/en/docs/frontend/chat-ux.md`
- Modify: `site/content/en/docs/rag-pipeline/retrieval.md`

- [ ] **Step 1: Document the resolution rule**

Explain: labels are resolved server-side against the live taxonomy; unknown labels are dropped; an empty resolution means an unfiltered search; the retriever falls back to an unfiltered search when a filter matches nothing; `GET /api/service-categories/labels` lists the live vocabulary.

What the pages say today (the branch's own wording, not a plan):

- `rag-pipeline/data-labeling.md` — "Query-time label resolution": the resolution table, the
  distinction between a label and an identity, and the rule that a client names the hierarchy by
  **labels only** (`context.categoryLabel`, `context.serviceLabels`). The identity is what the
  server derives from the resolution; the database key is not part of the client contract. A
  configuration whose category the live hierarchy no longer carries is reported to the admin
  (`chatbot.categoryNotFound`), and the query goes unfiltered.
- `frontend/chat-ux.md` — what a Quick Help button sends, and what happens when its labels no
  longer match the hierarchy.
- `rag-pipeline/retrieval.md` — the retriever fallback: a label filter that matches nothing never
  empties the corpus.

- [ ] **Step 2: Build the site locally**

Run: `cd site && hugo --gc --minify --destination /tmp/genie-build` (see `.claude/rules/SITE-LOCAL-DEV.md` — no system `go`, use `/tmp/go/bin/go` and `npm install` in `site/`).

- [ ] **Step 3: Commit**

```bash
git add site/content/en/docs
git commit -m "docs: explain server-side label resolution and the retrieval fallback"
```

---

### Task 10: Out-of-scope defects → GitLab issues

Defects found during the investigation that this MR does **not** fix. All of them are filed:

| Issue | Defect |
|---|---|
| #1107 | The retriever reads `ARANGO_FILTER_STRATEGY` (`genie-ai-overlay/retriever/config.py`) while `docker-compose.yaml` and `deploy/ansible/templates/env.j2` set `RETRIEVER_ARANGO_FILTER_STRATEGY`. The deployment's choice of `AND` is silently ignored — the effective strategy is always `OR`. |
| #1108 | `POST /api/service-categories/init` calls `serviceCategoryService.initializeDefaultCategoriesAndServices()`, which does not exist anywhere in the repo. The route throws on every call. |
| #1109 | The dataprep returns the taxonomy as `list(set(labels))`, so the order of the labels injected into the LLM labelling prompt changes between runs. |
| #1111 | The mobile Quick Help buttons drop their declared category — the query is sent unfiltered. |
| #1112 | `serviceCode` is only unique within its category (`service_1` collides across categories). |
| #1113 | An untranslated category puts `None` into the dataprep taxonomy and breaks labelling. |
| #1114 | A renamed hierarchy entity leaves the ingested chunk labels stale, so the filter matches nothing. |
| #1115 | A selected Quick Help chip keeps the title of the language it was selected in. |
| #1116 | The shipped Quick Help configuration names its categories by the ArangoDB `_key` — unknowable to a deployer and void when the hierarchy is re-created. |
| #1117 | The public category tree returns `name: null` for an untranslated locale — the category filter silently disappears. |
| #1118 | `npm run format:py:check` fails on the overlay READMEs — CI excludes them, the local script does not. |

#1110 (the retriever extending a string context label into characters) was filed during the
investigation and closed by this branch — the encoding it needed now lives in the label contract.

Already tracked, do not duplicate: the mobile non-streaming path dropping Quick Help labels (`DW-247` in `_bmad-output/implementation-artifacts/deferred-work.md`).

- [ ] **Step 1: File the issues**

```bash
glab api --method POST projects/90/issues -H "Content-Type: application/json" --input -
```

- [ ] **Step 2: Report all of them at the end of the session**

---

## Verification

```bash
npm run lint && npm run format:check           # JS
npm run lint:py && npm run format:py:check      # Python
cd components/gov-chat-backend && npm test
cd components/gov-chat-frontend && npm test
cd genie-ai-overlay && python -m pytest tests/ -v
```

## Out of scope

- Changing the label **identity** model (stable codes for categories/services, `chunk_labels` keyed by id instead of name). That is the real cure for renames and belongs to its own MR — see #1116 and #1112.
- A deployer-facing drift report (config vs taxonomy). What this branch adds: the vocabulary endpoint (`GET /api/service-categories/labels`), the `QueryService.unresolved_context_labels` log, and the admin-only client warning for a configuration whose category is gone. The consolidated report is a follow-up.
- The mobile client: it already sends an empty label list when a button declares none, and the backend now resolves its localized labels. No mobile change needed — it never sent a category key either, which is why the generated client and the swagger were already out of sync (the swagger now matches).
- The Quick Help **configuration format**: it still names categories by the database key. A configuration keyed by a stable code is the real cure for the configuration side of the drift — #1116.

---

## Decision trail (the branch as it shipped)

The execution ledger lives outside the repository (`.superpowers/sdd/…/progress.md`,
git-ignored). This section is the committed record of what was decided, and why.

### The invariant

> **English is the SSOT. Everything that filters speaks EN; everything that displays
> is a translation.**

It rests on a fact the Context section above already carries: the dataprep builds
the labelling taxonomy from `GET /api/service-categories/categories` at the default
locale (`en`), so the corpus's `chunk_labels` ARE the English translations. The
tree therefore publishes the EN translation as `nameEN` — the very value the corpus
carries — and the clients put that value on the wire.

### What was withdrawn, and why

- **The server-side resolver + registry** (request-time machinery compensating a
  client bug): the tree publishing both spellings removes the need for it.
- **The retriever's corpus-wide rescue** (a filter matching nothing → retry
  unfiltered): it answered outside the requested scope, silently. A scope is
  absolute: a filter that matches zero documents returns zero documents, and
  chatqna's existing abstention says so.
- **Dropping the labels that no longer match**: also a fallback, also silent. A
  broken scope is a VISIBLE failure.
- **The `/labels` vocabulary endpoint**: the tree already carries the vocabulary.

### What the clients do when the hierarchy drifts

A Quick Help button whose declared label or category no longer exists in the live
hierarchy renders with a danger icon and a caption naming the problem, in the
user's language, and the click sends nothing — web and mobile alike. The caption
is the visible failure the drift deserves; the remedy is operational (update the
configuration, re-ingest the corpus after a rename).

### The scope rule

The service labels win; the category filters on its own. The rule lives in
`core/label_contract.py` — the one core file the chatqna and the retriever images
both carry — so there is a single implementation, and the AQL interpolation of a
label is escaped there too.

### Review rounds

Three whole-branch reviews, then a `/simplify` pass (reuse, simplification,
efficiency, altitude) and a `/test-audit` gate. What survived the last two:

- The live hierarchy is indexed ONCE per client (web: computed maps; mobile:
  `QuickHelpScopeResolver`), and the scope verdict is no longer recomputed by
  walking the tree on every render.
- The wire contract (the tree, the query context) is written once, in
  `components.schemas`, and referenced from the three routes that serve it.
- A backend test that asserted the mock's own answer was removed; the AQL guard
  now counts the EN selections and the dual-spelling projections, and is
  mutation-gated (dropping either kills it).

### Rebase onto `main`

The branch was rebased on `main` as a single squashed commit. The per-commit
rebase replayed 41 commits — 33 of them from the withdrawn design — and fought
`main`'s newer work (#1107, #1108, #1109, the Living Intelligence theme) over
state the amputation deleted anyway. The squash applies the branch's net diff in
a single 3-way merge, so `main`'s changes are preserved and the conflicts are
resolved once. The pre-squash history is kept under the tag
`backup/quickhelp-label-drift-pre-rebase`.
