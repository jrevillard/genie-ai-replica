---
title: "Admin dashboard customization"
description: "How to add, remove, and customize tabs and action cards in the GENIE.AI admin dashboard — for deployers and frontend contributors modifying AdminDashboard.vue."
weight: 6
mode: how-to
persona: deployer
owner: "docs-stewards"
last_reviewed: 2026-09-20
---

## Overview

The GENIE.AI admin dashboard is a single-file Vue 3 component,
[`AdminDashboard.vue`](https://opensource.unicc.org/un/itu/genie-ai/-/blob/main/components/gov-chat-frontend/src/components/AdminDashboard.vue)
(4465 lines, Options API) that renders a left sidebar, four stat tiles, and a
tabbed content area. The eight tabs cover everything an operator needs to run
the platform: **System Health**, **Knowledge Hierarchy**, **Document
Management**, **Database**, **Logs**, **Query Inspector**, **User
Management**, and **Security**.

This page is the **how-to** for customizing the dashboard. It walks through
the wiring model — sidebar nav-links, the `adminTabs` computed property, the
`DsTabs` component, and the `activeTab === '<tab-name>'` content gates — then
gives step-by-step recipes for adding a tab, removing a tab, and adding a
new action card (the Backup / Optimize style). It also covers per-institution
access control (which goes through Keycloak, not the dashboard) and the
local-dev rebuild loop.

For a reference of **what each existing tab does** (data sources, failure
modes, sidebar layout), see
[Frontend → Admin Dashboard](/docs/frontend/admin-dashboard/). This page is
about **changing** the dashboard; that page is about **using** it.

## How tabs are wired

The dashboard has three layers that must stay in sync when you add or
remove a tab:

### 1. Sidebar nav-links

The sidebar is a flat list of `<a class="nav-link">` elements, grouped under
four section headers (`Dashboard`, `Content Management`, `System`,
`Settings`). Each nav-link sets `activeTab` on click and toggles the
`active` class when its value matches the current tab. The tab identifiers
in the sidebar are: `overview`, `hierarchy`, `documents`, `database`,
`logs`, `queryInspector`, `users`, `security`.

```vue
<!-- AdminDashboard.vue, sidebar nav-link pattern (lines 10-21) -->
<li class="nav-item">
  <a
    href="#"
    :class="['nav-link', { active: activeTab === 'overview' }]"
    @click.prevent="setActiveTab('overview')"
  >
    <i>📊</i>
    <span>{{ translate('admin.overview', 'Overview') }}</span>
  </a>
</li>
```

### 2. The `tabs` data array and `adminTabs` computed

The data array `tabs` (defined at line 1623 of `AdminDashboard.vue`) is the
single source of truth for tab identifiers and English fallback labels. The
`adminTabs` computed property (line 1760) maps that array through the i18n
helper so the tab strip uses the locale-resolved label and exposes the tab
id as `value`:

```javascript
// AdminDashboard.vue
data() {
  return {
    // ...
    activeTab: 'overview',
    tabs: [
      { id: 'overview', label: 'System Health' },
      { id: 'hierarchy', label: 'Knowledge Hierarchy' },
      { id: 'documents', label: 'Document Management' },
      { id: 'database', label: 'Database' },
      { id: 'logs', label: 'Logs' },
      { id: 'queryInspector', label: 'Query Inspector' },
      { id: 'security', label: 'Security' },
      { id: 'users', label: 'Users' }
    ],
    // ...
  };
},
computed: {
  // AdminDashboard.vue line 1760
  adminTabs() {
    return this.tabs.map((t) => ({
      label: this.translate(`admin.tabs.${t.id}`, t.label),
      value: t.id
    }));
  },
  // ...
}
```

The `DsTabs` component receives this computed:

```vue
<!-- AdminDashboard.vue line 172 -->
<DsTabs
  :tabs="adminTabs"
  :model-value="activeTab"
  @update:model-value="setActiveTab"
>
```

### 3. Per-tab content blocks

Below `DsTabs`, the dashboard renders all eight tab bodies inside one
container; each body uses `v-if="activeTab === '<tab-id>'"` so only the
active tab paints. For example, the System Health body gates on `overview`
(line 174), the Knowledge Hierarchy body on `hierarchy` (line 221), the
Document Management body on `documents` (line 389), the Database body on
`database` (line 573), the Logs body on `logs` (line 614), the Query
Inspector body on `queryInspector` (line 810/819), the User Management body
on `users`, and the Security body on `security`.

### 4. `setActiveTab` and `loadDataForTab`

When the user clicks a sidebar link or a tab, `setActiveTab(tabId)` (line
2041) sets `this.activeTab`, clears the hierarchy-form dirty flag, and then
delegates per-tab data loading to `loadDataForTab(tabId)` (line 2075):

```javascript
// AdminDashboard.vue line 2075
loadDataForTab(tabId) {
  if (tabId === 'database') this.loadDatabaseStats();
  else if (tabId === 'logs') { this.loadLogsSummary(); this.loadLogs(); }
  else if (tabId === 'security') this.loadSecurityMetrics();
  else if (tabId === 'users') this.loadUserStats();
  else if (tabId === 'documents') this.loadDocuments();
  else if (tabId === 'hierarchy' && this.knowledgeHierarchy.length === 0) {
    this.loadKnowledgeHierarchy();
  }
}
```

If you add a new tab, register its data-loading call here — otherwise the
tab renders empty until the user does a hard refresh.

### Why this layering matters

The sidebar drives `activeTab` directly; `DsTabs` is a controlled component
that follows `activeTab` via `v-model:model-value`. They MUST use the same
tab identifiers, otherwise the tab strip and the sidebar will desync (the
tab content disappears when you click a sidebar item, or vice versa). Adding
a tab identifier to the sidebar without adding the matching entry to the
`tabs` array will hide the tab strip entry but keep the sidebar item
clickable, which is a common bug.

## Adding a new tab

This recipe adds a tab called `monitoring` that shows a placeholder tile.
Repeat the same pattern for any new tab.

### Step 1 — add a nav-link in the sidebar

Pick a section (Dashboard / Content Management / System / Settings) and add
the nav-link. Stay consistent with the emoji + label pattern:

```vue
<!-- AdminDashboard.vue, in the <ul class="nav-items"> of an existing section -->
<li class="nav-item">
  <a
    href="#"
    :class="['nav-link', { active: activeTab === 'monitoring' }]"
    @click.prevent="setActiveTab('monitoring')"
  >
    <i>📈</i>
    <span>{{ translate('admin.monitoring', 'Monitoring') }}</span>
  </a>
</li>
```

### Step 2 — register the tab in the `tabs` array

Append the entry to the data array (line 1623) so `adminTabs` exposes the
tab to `DsTabs`. The English label here is the fallback used when the i18n
key is missing:

```javascript
tabs: [
  // ... existing tabs ...
  { id: 'monitoring', label: 'Monitoring' }
]
```

### Step 3 — add a content block

Inside the `<DsTabs>` container (around line 173) add a new sibling gated on
`activeTab === 'monitoring'`. Use the DS primitives (`DsCard`, `DsButton`,
`DsStateDisplay`) — do not introduce ad-hoc styling.

```vue
<div v-if="activeTab === 'monitoring'" class="dashboard-card" style="grid-column: span 2">
  <div class="card-header">
    <div class="card-title">
      {{ translate('admin.monitoring.title', 'Live Monitoring') }}
    </div>
  </div>
  <div class="monitoring-body">
    <!-- your content here -->
  </div>
</div>
```

### Step 4 — register the data loader

If the tab needs to fetch data on activation, add a branch to
`loadDataForTab(tabId)` (line 2075):

```javascript
loadDataForTab(tabId) {
  // ... existing branches ...
  else if (tabId === 'monitoring') this.loadMonitoringData();
}
```

You also need to call the loader in the `watch.activeTab` block (line 1870)
if you want it to run on hot-reload, and in `mounted()` / `loadInitialData()`
if the tab should be ready before the user clicks it.

### Step 5 — translate the labels

Add entries to all 14 locale files under
`components/gov-chat-frontend/src/i18n/locales/`:

```javascript
// en.js (and every other locale) — admin block
admin: {
  // ... existing keys ...
  monitoring: 'Monitoring',
  tabs: {
    // ... existing tab keys ...
    monitoring: 'Monitoring'
  }
}
```

The `adminTabs` computed uses the key `admin.tabs.<id>` for the tab strip
label, and the sidebar uses `admin.<id>` (or `admin.<section>.<key>` for
nested groups like `admin.tabs.security`). Add both.

> {{< callout type="info" >}}
> English (`en.js`) is the source of truth. Translations for non-English
> locales fall back to the English label until you provide them. See
> [Contribute → i18n guide](/docs/contribute/i18n/) for the locale parity
> workflow and which locales are production-required.
> {{< /callout >}}

### Step 6 — lint, format, and rebuild

```bash
cd components/gov-chat-frontend
npm run lint
npm run format:check
npm run test
```

For local dev with hot reload see [Local development workflow](#local-development-workflow) below.

## Removing a tab

Reversing the recipe: remove (in order) the data loader branch in
`loadDataForTab`, the content block inside `DsTabs`, the entry in the
`tabs` array, and the sidebar nav-link. Then delete the i18n keys from all
14 locale files.

If the tab has a backend dependency (for example the Query Inspector tab
calls `/api/admin/queries/inspect/*` endpoints), audit call sites of those
endpoints first — a tab removal can leave dead backend routes. Search the
backend in `components/gov-chat-backend/routes/admin-routes.js` for the route
prefix and decide whether to retire the route or keep it (some integrators
hit the backend directly via curl).

## Per-institution customization

GENIE.AI does **not** ship per-institution tab visibility. The dashboard
renders all eight tabs for every authenticated user who reaches `/admin`.
There is no `v-if="userHasRole('admin')"` on the tab containers, and the
router guard (`router.js` lines 37-42) only checks `requiresAuth: true` —
no role gate at the route level either:

```javascript
// components/gov-chat-frontend/src/router.js line 37-42
{
  path: '/admin',
  name: 'Admin',
  component: () => import('@/components/AdminDashboard.vue'),
  meta: { requiresAuth: true, showSidebar: false }
}
```

Access control is therefore a **Keycloak** problem, not a dashboard problem.
Two practical approaches, depending on what your institution needs:

| Need | Mechanism | Where to configure it |
|---|---|---|
| Hide the entire admin surface from non-admin users | Add a Keycloak role (e.g. `admin`) to the user; gate the `/admin` route with a `router.beforeEach` check on `realm_access.roles` | Edit `router.js` and add the role assertion to the `/admin` route guard |
| Show all tabs but block backend writes (read-only operators) | Wrap each backend POST/PUT/DELETE in `requireAdmin` in `routes/admin-routes.js`, leave GET endpoints accessible to `functional-admin` | Edit `components/gov-chat-backend/routes/admin-routes.js` |
| Customize which tabs render for which role | Add a `v-if` gate on each sidebar nav-link and tab content block, keyed on `currentUser.roles.includes('...')` | Edit `AdminDashboard.vue` template + add `currentUser` data field |

For the full role / group / client model and how to assign roles in the
Keycloak admin console, see
[Keycloak Admin Guide → Roles and groups](/docs/configure/keycloak-admin-guide/#roles-and-groups).

> {{< callout type="warning" >}}
> Any role check you add inside `AdminDashboard.vue` is **client-side only**.
> A motivated user can still hit the backend REST endpoints directly with a
> stolen JWT. Always enforce authorization on the **backend** — the dashboard
> gate is for UX, not security.
> {{< /callout >}}

## Local development workflow

You have two ways to see your changes: hot-reload the frontend dev server
(quick iteration) or rebuild the production image (what operators actually
run).

### Frontend hot reload (recommended for tab / i18n work)

```bash
# From the repo root
cd components/gov-chat-frontend
npm install          # first time only
npm run serve        # vue-cli-service serve, default :8090 (overridable via .env NGINX_FRONTEND_PORT)
```

The dev server picks up `AdminDashboard.vue` edits on save. Browse to
`http://localhost:8090/admin`, log in as a Keycloak admin user, and verify
your new tab renders, the sidebar nav-link highlights, and the tab strip
switches correctly. Browser DevTools → Vue DevTools lets you inspect
`activeTab` and `adminTabs` live.

### Rebuild the production image (for the docker compose stack)

If you are running the full stack via `docker compose up -d`, the frontend
container is built from `components/gov-chat-frontend/Dockerfile`. After
editing `AdminDashboard.vue` you must rebuild:

```bash
# From the repo root
docker compose build frontend
docker compose up -d frontend
```

If you also touched the backend (e.g. added a new admin route), rebuild that
service too:

```bash
docker compose build backend
docker compose up -d backend
```

For a full clean rebuild of the dependency stack:

```bash
docker compose down -v
docker compose up -d --build
```

See [Get started → Quickstart for developers](/docs/get-started/quickstart-developer/)
for the full local stack bring-up, and
[Get started → Quickstart for deployers](/docs/get-started/quickstart-deployer/)
for the production-style swarm bring-up.

## Adding a new dashboard card

Action cards (the small clickable tiles on the Database tab, e.g. **Backup**
and **Optimize** at lines 582-597) follow a tighter pattern than tabs. They
live inside an existing tab and call a method on click — there is no i18n
key for the tab id and no entry in the `tabs` array.

### Step 1 — add the card markup

Inside the relevant tab body, after the existing `db-action-card` siblings:

```vue
<!-- AdminDashboard.vue, inside the database tab body -->
<div class="db-action-card" @click="reindexDatabase">
  <h4>{{ translate('admin.dbActions.reindex', 'Reindex') }}</h4>
  <p>{{ translate('admin.dbActions.reindexDesc', 'Rebuild search indexes') }}</p>
</div>
```

Keep the structure shallow: a `<h4>` for the title and a `<p>` for the
description. Use the existing `admin.dbActions.*` i18n namespace so all
action cards stay translatable together.

### Step 2 — wire the click handler

Add a method in the `methods:` block that delegates to `executeOperation`:

```javascript
// AdminDashboard.vue methods
async reindexDatabase() {
  this.executeOperation('reindexDatabase', async () => {
    await adminService.reindexDatabase();
  });
}
```

`executeOperation` is the existing helper that toggles the operation-result
dialog and surfaces errors — reuse it instead of writing your own try/catch.
Look at `backupDatabase` (line 2374) and `optimizeDatabase` for the canonical
pattern.

### Step 3 — translate the labels

Add `reindex` and `reindexDesc` to the `admin.dbActions` block of every
locale file under `components/gov-chat-frontend/src/i18n/locales/`. The
English entries are the source of truth.

### Step 4 — test

```bash
cd components/gov-chat-frontend
npm run test
```

The Dashboard test suite (`src/__tests__/components/AdminDashboard.test.js`
if present, or the broader component suite) will catch typos in the
method name and unmapped i18n keys via snapshot tests.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| New tab does not appear in the tab strip | Entry missing from the `tabs` array | Add `{ id: '<your-id>', label: '<English fallback>' }` to the array at line 1623 |
| Sidebar nav-link works but tab content is blank | Content block not added or `v-if` predicate mismatch | Confirm the content block uses `v-if="activeTab === '<your-id>'"` with the exact same id as the nav-link and the `tabs` entry |
| Clicking the new sidebar item throws `Cannot read property of null` | `loadDataForTab` not registered for the new tab | Add a branch in `loadDataForTab` (line 2075) |
| Tab label shows the raw i18n key, e.g. `admin.tabs.monitoring` | Missing locale entry | Add the `admin.tabs.<id>` key to `en.js` (and other locales); the `translate()` helper falls back to the English label in the `tabs` array, not the key |
| Tab strip and sidebar desync (one highlights, the other does not) | Identifier mismatch between sidebar, `tabs` array, and `v-if` blocks | Grep the file for the tab id (`grep -n monitoring AdminDashboard.vue`); all three locations must use the identical string |
| Edit hot-reloads but changes do not appear in the browser | Browser cache | Hard reload (Cmd+Shift+R / Ctrl+Shift+R) or clear the Vue DevTools component state |
| Frontend image rebuild fails | Out-of-date `package-lock.json` | Run `npm install` in `components/gov-chat-frontend` then re-run `docker compose build frontend` |
| Backend endpoint added but `/admin` tab returns 404 | Container not rebuilt after route file change | `docker compose build backend && docker compose up -d backend` |
| Lint fails on the new template | Vue style or i18n key violation | `cd components/gov-chat-frontend && npm run lint:fix` — common issues: hardcoded user-facing strings (use `translate()`), DS primitive not used (use `DsButton` instead of `<button>`) |
| Vue warns "Duplicate keys detected" | Two tabs in the `tabs` array share the same `id` | Dedup the `id`s |

## Related

- [Frontend → Admin Dashboard](/docs/frontend/admin-dashboard/) — reference doc for **what each existing tab does** (data sources, failure modes, sidebar layout). Read this for the contents of `overview`, `hierarchy`, `documents`, `database`, `logs`, `queryInspector`, `security`, `users`.
- [Operate → Admin Logs](/docs/operate/admin-logs/) — the `logs` tab: VictoriaLogs-backed search, the MELT seam, and the five endpoints behind it.
- [Operate → Backup & restore](/docs/operate/backup-restore/) — the `database` tab and the **Backup / Optimize / Restore** action cards, including the underlying `arangodump` flow.
- [Configure → Keycloak admin guide](/docs/configure/keycloak-admin-guide/) — the role / group / client model. Use this to decide which user roles see the admin surface.
- [Architecture → Authentication](/docs/architecture/architecture/#authentication) — how the OIDC token flows from Keycloak to the frontend, and why role checks must be enforced on the backend.
- [Get started → Quickstart for developers](/docs/get-started/quickstart-developer/) — local dev bring-up, hot-reload, and the npm scripts for `gov-chat-frontend`.
- [Get started → Quickstart for deployers](/docs/get-started/quickstart-deployer/) — production-style bring-up via Docker Swarm, including the order in which to rebuild the frontend image.
- [Contribute → i18n guide](/docs/contribute/i18n/) — locale parity, which locales are required for production, and the validation script.
- [Contribute → Dev workflow](/docs/contribute/dev-workflow/) — the full dev loop (lint, format, test, hot-reload) for the JS components.
