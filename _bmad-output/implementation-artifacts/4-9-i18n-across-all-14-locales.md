---
baseline_commit: 0a5f0a4d8
---

# Story 4.9: i18n across all 14 locales — AdminToolsView

Status: review

## Story

As an administrator using GENIE.AI in any of the 14 supported languages,
I want every string in the Tools Management admin surface keyed and translated,
so that the admin surface meets NFR30 (no untranslated UI) and the locale-consistency CI gate stays green.

## Current State (verified on `feat/sst` 2026-08-31)

- **[AdminToolsView.vue](components/gov-chat-frontend/src/views/AdminToolsView.vue) (489 lines) has ZERO i18n** — ~30 hardcoded English strings across the sidebar ("TOOLS & INTEGRATIONS", "RSS Feeds", "Web Search (SearXNG)", "Back to Admin"), page title, feeds table (headers, "No feeds configured.", "Active"/"Disabled"), SearXNG tab (label, placeholder, "Searching…"/"Test Search", results header/headers), and the add/edit modal (title, labels, placeholders, "Cancel"/"Save Feed").
- **Latent bug on the same strings**: the table's delete button calls `deleteFeed(feed._key)` (the Vuex action) directly — the `removeFeed()` method with its confirm dialog is never wired (`:253-257` vs `:93`).
- **The component is router-mounted** (`src/views/`), NOT a child of AdminDashboard — so QueryInspector's delegation pattern (`this.$parent?.translate?.(...)`, QueryInspector.vue:53-55) will not work here; it needs its own `this.$i18n`-based method (AdminDashboard.vue:1994 has the standalone implementation to copy).
- **Locale files**: 14 — `ar bn de en es fr id man pt ru st sw th zh` in `src/i18n/locales/`; `en` is the source of truth; `fallbackLocale: 'en'` (i18n/index.js:32); the CI gate `src/__tests__/localeConsistency.test.js` enforces an **identical deep-key set across all 14 files** — adding a key to one without the others fails the build.
- **Pre-existing gap (flagged, out of scope)**: QueryInspector components use `admin.queryInspector.*` keys that exist in **no** locale file — they run on fallbacks. Same NFR30 violation class; record for a follow-up, do not fix here.

## Acceptance Criteria

1. Every user-facing string in AdminToolsView is routed through a per-component `translate(key, fallback)` method (epic-specified: the helper is per-component, not global) with sensible English fallbacks identical to today's strings.
2. All new keys live under `admin.tools.*` in `en.js`, and **all 14 locale files carry the identical key set** with real translations (English text copied verbatim into non-`en` locales is NOT a translation — except where a term is genuinely proper-noun/untranslatable, e.g. "SearXNG", "RSS").
3. `localeConsistency.test.js` green (deep-key drift fails CI) — run it locally before finishing.
4. The feed delete button uses the confirm-guarded `removeFeed()` path, and the confirm text is translated.
5. Frontend Jest suite green (`npm test`), ESLint + Prettier clean on all touched files.

## Tasks / Subtasks

- [x] Task 1 — `translate()` method in AdminToolsView (AC: 1)
  - [x] Copy AdminDashboard's standalone `translate(key, fallback = '')` implementation (AdminDashboard.vue:1994-2010: null-`$i18n` guard → fallback; try/catch around `t()` with fallback on miss) — do NOT use `$parent` delegation (this view has no AdminDashboard parent)
- [x] Task 2 — Wire all template strings (AC: 1)
  - [x] Sidebar, page title, feeds tab, SearXNG tab, results table, modal — every hardcoded string becomes `translate('admin.tools.<key>', '<current English>')` (keep fallbacks byte-identical to today's text so untranslated-locale behavior is unchanged)
  - [x] Wire the delete button to `removeFeed(feed._key)` and translate the confirm text (AC: 4)
- [x] Task 3 — Keys in all 14 locales (AC: 2, 3)
  - [x] Add the `admin.tools` block to `en.js` (nested under the existing `admin` section)
  - [x] Add the same block, translated, to the other 13 files — preserving each file's existing formatting style (2-space, single quotes, trailing key structure) so the gate's parser and Prettier both pass
  - [x] Interpolations stay simple: no vue-i18n named params needed (counts like `Results ({{ n }})` can stay as label + template count)
- [x] Task 4 — Validation + trackers (AC: 3, 5)
  - [x] `npx jest src/__tests__/localeConsistency.test.js` green; full `npm test` green; `npm run lint` + `npx prettier --check` on touched files
  - [x] Update sprint-status (4-9 → review) + plan.md session log; flag the QueryInspector fallback-only gap

## Dev Notes

### Implementation guardrails

- Vue 3 **Options API**; no `<script setup>`; `translate()` in `methods`, used from template — matches every other admin component.
- Do NOT introduce `$t()` (project rule: use the per-component `translate(key, fallback)`).
- Keep the key namespace flat and specific: `admin.tools.feedsTitle`, `admin.tools.addFeed`, `admin.tools.testSearch`, etc. (~25-30 keys).
- Locale JS files are CommonJS-style objects (`export default {...}`) — check one non-en file's exact export shape before editing all 13.
- Translation quality bar: these are short UI labels — translate meaningfully (e.g. es "Fuentes RSS", fr "Flux RSS", ar "بث RSS", zh "RSS 订阅源", sw "Vyanzo vya RSS"); leave "SearXNG", "URL", "RSS" as-is where they're technical terms. `man` (Mandarin?), `st` (Sesotho), `bn`, `id`, `th`, `ru`, `de`, `pt` — write real translations; when genuinely unsure of a rare-locale term, reuse the English term rather than inventing wrong words.
- The modal, tables, and status tags must keep working when `translate` falls back (missing key → English) — the fallbacks ARE today's strings.
- Do not restructure the template beyond swapping string literals for `translate(...)` calls; do not touch the scoped styles.

### Testing standards

- Frontend Jest; the CI gate is itself the test (`localeConsistency.test.js` — identical deep-key sets, no duplicate keys).
- If AdminToolsView has no component test, do not add one for this story (string-swap only); the gate + suite regression cover it.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-4.9] — story text + AC (`localeConsistency.test.js:82-99` green; per-component translate)
- [Source: components/gov-chat-frontend/src/views/AdminToolsView.vue] — the 30 strings, the unwired removeFeed
- [Source: components/gov-chat-frontend/src/components/AdminDashboard.vue:1994] — standalone translate implementation to copy
- [Source: components/gov-chat-frontend/src/components/admin/QueryInspector/QueryInspector.vue:53-55] — the delegation pattern that does NOT apply here (no parent)
- [Source: components/gov-chat-frontend/src/__tests__/localeConsistency.test.js:82-99] — the CI gate mechanics
- [Source: components/gov-chat-frontend/src/i18n/locales/en.js] — `admin` section (source of truth), `admin.tools.*` lands here
- Previous-story intelligence (2-8): frontend tests must not mock away the layer under test — the locale gate reads real files, keep it that way


### Review Findings

_Code review 2026-08-31 — Blind Hunter complete; Edge Case Hunter + Acceptance Auditor partial (both died on API usage-limit 429s at ~18:20, reset 22:15) — their partial results (gate 5/5, removeFeed wiring safe, lint/format clean) are incorporated and were independently re-verified in-session. Every Blind Hunter finding was verified directly before triage._

- [x] [Review][Patch] **`admin.tools.urlPlaceholder` used in template, absent from all 14 locale files** — the parity check compared files to each other, not to the template; a uniformly-missing key passes the gate. FIXED: `'https://...'` is locale-neutral — the translate call was dropped for a static `placeholder` attribute (also kills the per-render vue-i18n miss warning).
- [x] [Review][Patch] **es `feedsCardTitle` grammar** — "del ingestadores" (singular article + plural noun) → "del ingestor".
- [x] [Review][Patch] **man `testSearchQuery` identical to `testSearch`** — label now 'Seeru dogo' (query), button stays 'Seeru toonoo'.
- [x] [Review][Patch] **man feedu/feedo inconsistency in `deleteConfirm`** — unified to 'feedu'.
- [x] [Review][Patch] **st `deleteConfirm` used the cancel verb** — 'hlakola' (= the file's established cancel) → 'phumula' (the file's delete verb), so the confirm no longer reads as its own Cancel button.
- [x] [Review][Dismiss] Delete-confirm is a "smuggled behavior change" — it IS the story: AC4 requires the confirm-guarded `removeFeed()` path (reviewer had diff-only visibility).
- [x] [Review][Dismiss] `translate()` miss-contract asymmetry (`return fallback` vs `fallback || key` on the no-$i18n branch) — byte-for-byte matches the established AdminDashboard implementation; consistency with the pattern wins.

_Review-process note: two one-word locale fixes were initially lost to a duplicate-key bug in the patch script (hardcoded success print lied); caught by post-patch grep and re-applied. Lesson already encoded in this initiative: verify the printout against the file._

## Dev Agent Record

### Agent Model Used

GLM-5.2 (Claude Code harness)

### Debug Log References

- localeConsistency CI gate green on first run (identical deep-key sets, no duplicate keys) — re-run green after each patch round
- Full frontend suite 1249 green throughout; ESLint + Prettier clean (559 pure insertions across 14 locale files + the view)
- Review layers 2-3 died on API 429 usage limits mid-verification (reset 22:15); partial results incorporated + independently re-verified

### Completion Notes List

- Per-component `translate(key, fallback)` added (standalone `$i18n`-based impl copied from AdminDashboard — this view is router-mounted, no parent to delegate to)
- 37 keys under `admin.tools.*` in en + 13 real translations (es/fr/de/pt/ru/ar/zh/sw/id/bn/th authored; man/st conservative adaptations following each file's established orthography and reusing its vocabulary — save/cancel/status/etc.)
- Fallbacks byte-identical to the pre-change strings (verified against `git show 0a5f0a4d8`)
- Delete button wired to confirm-guarded `removeFeed()` (AC4) — previously called the Vuex action directly, no confirmation
- 5 review patches applied (phantom urlPlaceholder key, 4 locale word fixes)
- **Pre-existing gap flagged for follow-up (NOT fixed here):** QueryInspector uses `admin.queryInspector.*` keys that exist in no locale file — runs entirely on fallbacks; same NFR30 class

### File List

- components/gov-chat-frontend/src/views/AdminToolsView.vue (translate method, 37 string wirings, removeFeed fix, static URL placeholder)
- components/gov-chat-frontend/src/i18n/locales/{ar,bn,de,en,es,fr,id,man,pt,ru,st,sw,th,zh}.js (admin.tools block, 37 keys each)
- _bmad-output/implementation-artifacts/4-9-i18n-across-all-14-locales.md, sprint-status.yaml, plan.md

### Change Log

- 2026-08-31: Implemented 14-locale i18n for AdminToolsView + removeFeed confirm wiring; review patches (phantom key, 4 locale fixes); gate + suite green → status review
## Debug Log References

### Completion Notes List

### File List

### Change Log
