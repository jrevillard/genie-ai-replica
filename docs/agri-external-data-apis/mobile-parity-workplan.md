# Flutter Mobile Parity — Comprehensive Work Plan (v5)

Date: 2026-09-19 (v5 · 2026-09-20) · Implementation branch:
**`feat/agri-mobile-parity`** (branch off `feat/agri-external-data-apis`;
own MR, reviewed after !388) · Status: **Phase A done** (S1/S2 mapper +
tests, commit `8ea35f3b1`); quick-help render fix landed (`3c2d3f977`);
Phases B–D pending; live verification blocked 2026-09-20 by lab-VPN
outage (10.0.0.x unreachable from dev host).
Scope: bring Crop Health, Pest Alerts and ALL Market Prices screens in
`mobile/genie_ai_mobile` into line with the Vue 3 web app.

**Build contract:** the item-by-item specification lives in
[`mobile-parity-spec.md`](mobile-parity-spec.md) (S1-S26, exact
algorithms, strings, i18n keys, tests). This file is the tracker; the
spec is what gets implemented. Binding constraint: the mobile app reuses
the Vue app's backend adapters/APIs exclusively (spec §0).

> v4 incorporates everything shipped on the web app during the
> 2026-09-18/19 sessions (news pipeline, chart crash fixes, grains
> expansion, history filter, multi-series table). The capability matrix
> is the source of truth; numbered items (M#) are independent so
> adjustments between now and kickoff stay cheap.

## 1. Parity matrix — web capability × mobile status

### Data & content (server-side — automatically at parity once M1/M2 land)

| # | Web capability (as shipped) | Mobile today | Gap |
|---|---|---|---|
| M1 | All series per category — grains now **15 series** (SV wholesale ×5, GT ×2, NIC ×4, intl benchmarks ×4 auto-converted USD/mt→quintal), vegetables 5, fertilizer 5, aquaculture 3 | **Data layer maps `series[0]` only** (`agri_api_service.dart` ~line 73) | **Critical** |
| M2 | Per-series `name`, `unit`, point `quality` consumed | Dropped in the mapping | Critical (blocks M5/M8/M13) |
| M3 | Nicaragua defs are wholesale | Server-side — none once M1 lands | (closed by M1) |
| M4 | Start-year history filter on every dialog (options: earliest→current−5, default 2015, chart+table+CSV re-render; axis pinned to selected year) | Absent | High |
| M5 | CPI-estimated points rendered dashed | No quality handling | High |
| M6 | Wheel-zoom + drag-pan + native +/−/fit toolbar | None (fl_chart has none built-in) | High |
| M7 | Multi-commodity Latest card (per-series figure, color-matched, per-series "latest month-end price of…" tooltips) | Single figure, primary only | High |
| M8 | Relative per-unit y-axes: floor-hug + 1.5× max, `$` on USD ticks, axis unit titles, left/right axes for irreducible unit mixes (cropProtection) | 1.5× top + `$` done; floor differs; single axis; no unit titles | Medium |
| M9 | Tooltips: date + value + unit (sparkline too) | Date + value (no unit) | Medium |
| M10 | Category summary buttons as dashboard: acronym chips (CAB-GT, DAP-US…) with palette dots + full-description/price tooltips; headline number self-explaining tooltip | Rows were dropped for chips on web; mobile has neither — chips needed | Medium |
| M11 | Data table: one column per series, date-aligned union rows, horizontal scroll | Primary-only rows | Medium |
| M12 | CSV export: all series, date-aligned, unit headers, translated quality | **Done** — but mobile's export still assumes primary-only; must switch to the date-aligned multi-series shape | Medium |
| M20 | Global series on/off toggles: one checkbox per commodity (color-dotted, short name, full name on hover) driving chart + table + CSV + Latest card together; stable per-series palette slots; last active series cannot be switched off | Absent (depends on M1) | Medium |
| M22 | Card dashboard layout: chips for ALL series (incl. primary — Livestock shows chicken AND beef) left-aligned under the sparkline; 3-column grid when >4 chips; primary chip accent-bordered | Chips beside value; primary absent | Medium |
| M23 | Commodity-TYPE master toggles in dialogs (Beans (5), Maize (4)…): tristate family switch above per-series toggles, empty-chart guard | Absent (depends on M20) | Medium |
| M24 | Card order: grains, veg, livestock, aquaculture, apiary, fertilizer, crop protection, harvest | Order differs | Trivial |
| M21 | Shared short display names + legend layout: compact commodity names (country-tagged on collisions, e.g. "Beans (red) (SV)" vs "(NIC)") used IDENTICALLY by chart legend, toggles, Latest rows and table headers; legend top-left, compact markers; per-series palette slots survive filtering/toggling (no black-marker class bugs) | Absent (depends on M1) | Medium — implement together with M20 |
| M13 | News: language-follows-locale, relevance gate, AI translation fallback (translate-then-persist `_tr<lang>`), wire dedupe, economía feed | **Done** (same endpoints) | — |
| M14 | Caveat chips + About panel (source/coverage/estimation) | Banner only; About panel absent | Low |
| M15 | Unit calibration explanations (quintal/PPI/index/SDG %-of-what incl. the 8-in-100-kg example) | Exists | — |
| M16 | EN/ES i18n: all chart strings **plus data-layer localization** (spec §12bis S27 — series-name/meta dictionaries, UI-locale dates, chart month names) | Strings **Done**; data-layer localization absent | High |
| M17 | Debug logging: per-load line (series/points/units/stale) + per-axis line (groups/min/max) | Absent | Low |
| M18 | Crop Health: 14 depts, baseline/trend/health buckets | List renders; verify baseline/change display + tooltips | Verify |
| M19 | Pest Alerts: advisories/regional/sightings, severity filter, AI assistance | Exists | Verify |
| M25 | Auth session resilience: proactive token refresh on app resume; after idle-expiry (SSO session death server-side) redirect to login instead of raw `ApiException … AuthException: Session expired` screens on every surface | Refresh failure clears tokens (correct) but screens keep rendering profile/settings/chat errors; user must manually restart to reach login | High (2026-09-20) |
| M26 | Chat AI streaming (server-side SSE) verified live: quick-help prompts stream a response; stream errors surface as retryable UI states, never blank bubbles | Code present (`sse_parser.dart`, `chatbot_proxy.dart`, component stream handlers); live verification blocked by VPN outage 2026-09-20; user references a main-branch implementation — `origin/main` has NO `mobile/` tree, so the reference app must be identified (repo/branch) before diffing | High (2026-09-20) |
| M27 | Color scheme matches the Vue 3 app DS tokens (light + dark) on chat, Insights and Market Prices screens | App DS (ThemeManager + design_system) renders; palette audit vs the Vue app on `feat/agri-external-data-apis` pending | Medium (2026-09-20) |

## 2. Phases

### Phase A — Data layer (M1, M2) · effort S · no UI change · **DONE 2026-09-20**
Map the full envelope: every series (name, unit, data incl. `quality`),
meta passthrough. Acceptance: 15-series grains envelope maps 1:1 (fixture
test); existing screens still render from `series[0]`.
Shipped: `mapMarketPricesEnvelope` in `agri_api_service.dart` (commit
`8ea35f3b1`) + 6 fixture tests (spec §14 test 1 + never-fail paths).

### Phase A2 — Auth & connectivity hardening (M25) · effort S · NEW 2026-09-20
Proactive token refresh when the app resumes/foregrounds (before the
first 401); when refresh fails with an unrecoverable grant error, the
root navigator MUST land on `OidcLoginScreen` — no surface may keep
rendering `ApiException … Session expired` screens. Include a
network-unreachable state distinct from auth failure (the 2026-09-20
lab-VPN outage produced identical-looking errors for a pure-network
cause).

### Phase B — Chart core (M3, M5, M7, M8) · effort L
Date-keyed spots (`millisecondsSinceEpoch`), `minX/maxX` from union range,
month/year bottom-tick formatter. Multi-`LineChartBarData` with the web
palette semantics; custom legend chip row; series-count-scaled height.
Estimated overlay split by `quality` with `dashArray`. Per-unit axes with
titles; two unit groups → left/right. Multi-commodity Latest card with
per-series "latest month-end price of…" tooltips (M7), headline-number
tooltip on the summary cards (M10's tooltip half).
Acceptance: grains renders 15 color-matched series with legend;
cropProtection renders dual axes; every Latest row self-explains.

### Phase C — Interaction & filters (M4, M6, M9, M10 chips, M11, M12, M20) · effort M/L
Start-year dropdown (same contract as web: earliest→current−5, default
2015, clamped; chart+table+CSV re-render; axis pinned to the selection).
Global series toggles (M20): a wrap of checkbox chips above the chart —
each toggle drives chart, table, CSV and the Latest card together;
palette slots stay keyed to the series' original index so survivors keep
their color; the last active series' checkbox disables. Pinch-zoom +
drag-pan driving a `minX/maxX` window state (y re-scales to the visible
window) with `[−] [+] [Fit]` buttons. Tooltip gains unit. Summary cards
gain the acronym chips (dot + code, tooltip = description + price).
Table: one column per ACTIVE series over date-aligned union rows,
horizontally scrollable. CSV rebuilt on the same rows.
Acceptance: filter + toggles + zoom compose (zoom respects the filtered,
toggled range); chips and table match the web's information density
without widening the cards; toggling never leaves an empty chart.

### Phase D — Polish, parity verification, logging (M14, M17, M18, M19, M26, M27) · effort S
About panel from meta; `debugPrint` load/axis lines matching the web's
console lines; crop-health and pest-alerts verification passes; flutter
analyze/format/tests green; manual smoke on Android + iOS against
10.0.0.101. NEW 2026-09-20: live streaming check — every quick-help
button sends, streams and renders its AI response (M26), after
identifying the reference "main-branch" mobile app the user cited
(`origin/main` carries no `mobile/` tree — ask user for repo/branch);
color-scheme audit of chat + Insights + Market Prices against the Vue
app DS tokens, light AND dark (M27).

## 3. Sequencing & estimates

A (S, DONE) → A2 (S) → B (L) → C (M/L) → D (S). B alone fixes the
"wrong data on screen" class; C brings the dashboard interactions.
Total: roughly 3–4 focused days (v3 adds the filter, chips, multi-series
table/CSV). No backend changes required — mobile consumes the same
envelopes (month-end cadence, unit conversions, translated news,
15-series grains all server-side).

## 4. Risks

- fl_chart: pinch/pan math is hand-rolled; if the pinned version fights
  window-state updates, upgrade is contained to Phase C.
- Performance: 15 series × ~200-800 monthly points each is the new
  grains worst case — verify frame timing on a low-end device in Phase B;
  the month-end cadence keeps totals bounded (~1,700 points/category).
- Wide table + chips on small screens: follow the web's answers (scroll
  container, wrapping chips) rather than inventing new layouts.
- i18n: new strings (filter label, zoom buttons, About rows, chip
  tooltips) need EN/ES in `lib/i18n/locales/{en,es}.dart`; other locale
  files stay key-complete with EN fallback (locale-consistency CI +
  reuse by other countries). On-screen language selector stays EN/ES.

## 5. Definition of done

Every Crop Health, Pest Alerts and Market Prices screen shows the same
series set, units, cadence, calibration text, caveats, history filter and
interactive behavior as the Vue app; `flutter analyze` clean; widget
tests cover the data mapping, palette/legend, zoom-window math and the
date-aligned table/CSV; manual sign-off against 10.0.0.101; reviewed by
jrevillard.

## 6. Change log (for pre-kickoff adjustments)

> Standing rule (2026-09-19): EVERY web enhancement/change made from now
> on is tracked here and reflected in the matrix/phases, so the mobile
> catch-up plan never drifts from the web app.

- 2026-09-20 v5: field session on the deployed stack (10.0.0.101,
  `release/el-salvador`). Provisioning gap fixed server-side: the realm
  had no `genie-mobile-dev` OIDC client (keycloak-config-cli does not
  create it on this deployment) — created per the documented recipe
  (public, PKCE S256, redirect `com.itu.genieai.dev://callback`).
  Quick-help buttons rendered as outlines (loader read non-existent
  `appearance.*` config fields; labels empty, icons fell back to a
  missing default.svg) — fixed in `3c2d3f977`. Phase A shipped
  (`8ea35f3b1`). New matrix items: M25 auth session resilience (an
  overnight SSO idle expiry cleared tokens and every surface showed raw
  `Session expired` ApiException screens instead of re-login), M26 live
  streaming verification (SSE code present in this branch; reference
  "main-branch" app to be identified — `origin/main` has no `mobile/`),
  M27 color-scheme alignment audit vs the Vue 3 app. Dev-environment
  note: the lab (10.0.0.x) is reached through a WireGuard tunnel; when
  it drops, app errors are network-shaped, not auth-shaped (motivates
  the M25 distinct-network-state requirement).
- 2026-09-19 v4.5: full EN/ES parity sweep (web) — audits proved every
  `$t()` key complete; the visible gaps were DATA-derived strings. New
  web contract `src/utils/agri-i18n.js`: exact-match ES dictionaries for
  the 33 base + 40 full series names, countries, sources, coverage and
  CPI-estimation templates (unknown input falls back, never
  mistranslates); tooltip sentences via `market.latestTip`; UI-locale
  date formatting; ApexCharts EN/ES month names; SatisfactionGauge
  fallback labels reuse `analytics.timePeriods`. M16 re-opened for the
  mobile side (spec §12bis S27, new widget tests).
- 2026-09-19 v4.4: AI-prediction output contract (web) — the backend
  caps LLM completions at 1024 tokens (comps `LLMParams` default; no
  client in our chain sends `max_tokens`), which truncated long
  prediction reports mid-word. The prediction prompt now enforces a
  summarized per-commodity format (~350-word cap; heading / Outlook /
  4 month-end projections / Risk). New spec §16 (S26): any mobile
  AI-answer surface embeds the same contract. No new matrix item —
  mobile has no market-prediction UI yet.
- 2026-09-19 v4.3: web regression fixes folded into M21/M22 acceptance —
  display-name helpers must be METHODS (Vue-compat computed crash) and
  renaming a helper requires grep-checking every call site (stale
  shortSeriesName reference blanked all cards). Mobile note: Dart has no
  such computed layer, but keep name helpers in one file (series_display)
  with tests referencing them.
- 2026-09-19 v4.2: card dashboard layout + all-series chips (M22),
  commodity-TYPE master toggles (M23, spec S25), fixed card order (M24).
- 2026-09-19 v4.1: shared short display names + legend layout (new M21,
  pair with M20 in Phase C) — the web's marker-color regression (indexOf
  on copied series → -1 → black markers) and legend-overlap fix are
  captured as acceptance criteria: palette slots survive
  filtering/toggling, and one display-name map feeds legend, toggles,
  Latest rows and table headers.
- 2026-09-19 v4: global series on/off toggles (new M20, Phase C) —
  checkbox chips driving chart + table + CSV + Latest card, stable
  palette slots, last-active guard. Plan now under a standing sync rule.
- 2026-09-19 v3: session sync — 15-series grains (M1/M3), start-year
  filter (M4), acronym chips + self-explaining headline (M10), per-series
  tooltips (M7), date-aligned multi-series table + CSV (M11/M12), serve-path
  fixes (empty-LKG miss, obsolete-LKG rebuild, news in the periodic
  rebuild), debug logging (M17). Nicaragua wholesale fix noted (M3).
- 2026-09-19 v2: comprehensive matrix + phases; multi-commodity Latest
  card (M7), zoom toolbar (M6), About panel (M12→M14), debug logging
  (M15→M17), SDG unit-explanation wording, month-end cadence context.
- 2026-09-18 v1: initial assessment (series[0]-only data layer, chart
  core, interaction, polish).
