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
| M25 | Auth session resilience: proactive token refresh on app resume; after idle-expiry (SSO session death server-side) redirect to login instead of raw `ApiException … AuthException: Session expired` screens on every surface | **CORRECTED 2026-09-22 — "refresh failure clears tokens (correct)" was WRONG; it is the defect (DW-325).** `AuthNotifier.refreshToken()` calls `_tokenStorage.deleteAll()` on ANY non-network failure (`auth_notifier.dart:516-528`); the interceptor then reads back a null token and throws `AuthException('Session expired')` (`auth_interceptor.dart:42-49`) — the user-visible "Connection error"; afterwards `send()` omits the Authorization header when the token is null (line 26-29) **and** the 401 branch also requires a non-null token (line 40), so **every later request 401s with no path back short of a manual sign-in**. Compounding: `_isRefreshing` returns immediately on a concurrent call (`auth_notifier.dart:359`) so the interceptor retries with the stale token into a second 401. Refresh is reactive-only while realm `genie` issues 5-min tokens (`accessTokenLifespan=300`) with a 30-min SSO idle timeout — so 401s are routine, not exceptional | **High** |
| M28 | **Stale Quick Help filter**: the active context must be visible and clearable, and must not silently filter unrelated typed questions | `_activeServiceLabels` is set by a Quick Help press and **persisted into every subsequent typed message**; it is **displayed nowhere** (the context bar renders only for sidebar `_selectedCategoryName`, `chatbot_component.dart:1466`) and can be cleared only by pressing another Quick Help button, "Just Chat", or starting a new conversation. Vue shows removable context pills and warns on mismatch. Evidence (prod 2026-09-22): tapping Pest/Disease set `['Pest/ Disease Health']`, then four typed tomato/CENTA questions each returned **0 documents** (12:25-12:27); the same question with `serviceLabels: []` at 12:07 returned `Boletin_Centa_tomate_cuscatlan_EN.md` (0.9535), grounded | **DONE 2026-09-23** (MR !436, stack carries the !422 helper cherry-pick). D1a — visible removable chip mirroring Vue's `context-panel`; carries the !422 fix too (label fallback); new tests pin every shipped button to a non-empty label list | High → **closed** |
| M30 | **Zero-document retrieval must be distinguishable from an empty topic** | When the filter matches nothing the answer must be labelled as unfiltered/model-only, not presented as a normal grounded answer (Vue blocks/warns in `checkContextConfig`) | **DONE 2026-09-23** (MR !437). A warning-tinted banner appears above the assistant bubble when `isGrounded == false` AND a filter is active; new i18n key `chatbot.noDocsMatchingFilter` in en + es (other 12 locales fall back to English) | Medium → **closed** |
| M31 / DW-247 — non-streaming path | Streaming is the default path so this is low severity, but the non-streaming fallback leaks stale filters into other typed messages. | **DONE 2026-09-23** (MR !438). Mobile-only half: `clearQuickHelpContext()` now fires after every non-streaming send (success and error) so the labels cannot leak. The **full DW-247 ask** (sending `context.serviceLabels` through `_sendNonStreaming`) requires regenerating the OpenAPI client from updated backend types — that is backend-adjacent and stays out of scope until the OpenAPI sync question is answered | Medium → **partially closed** (mobile portion) |
| M29 | **Quick Help config labels must match the ingested taxonomy** | The shipped buttons send label strings that do not exist in the corpus: `Pest/ Disease Health`, `Nutrition`, `Establishment`, `Onion`, `Cucumber`, `Potato` all match **0 of 332 chunks**. The ingested taxonomy is `Diseases` (108), `Pests` (94), `Maize` (75), `Tomato` (26), `Planting` (67), `Fertilization` (51), `Soil` (45)… So those buttons can never ground, and every stale label they leak filters everything out. **Decision required (D2):** fixing the mobile config alone makes mobile ground where Vue does not — i.e. deliberate divergence. Tracked cross-client in #1001 | **High** |
| M30 | **Zero-document retrieval must be distinguishable from an empty topic** | When the filter matches nothing the UI presents a normal AI-generated answer with no hint that the knowledge base was filtered out. Vue blocks/warns (`checkContextConfig`: `noFilterWarning`, `serviceLabelMismatch`). Mobile has no equivalent, which is why the M28 failure looked like "the CENTA docs aren't ingested" | **Medium** |
| M31 | Quick Help labels survive on the **non-streaming** path (DW-247, still open) | `_sendNonStreaming` builds `ApiQueriesPostRequest(categoryId: _selectedCategoryId)` with **no context block** — labels silently dropped — and `_activeServiceLabels` is never reset on non-streaming success or error. Requiring `context.serviceLabels` needs an OpenAPI spec extension, or Quick Help is documented streaming-only | **Medium** |
| M32 | Chat stream must recover from an expired token like every other surface | `ApiService` retries after a refresh and heals (`401 — retried after token refresh` → 200); the SSE chat path has **no retry**, so it throws `AuthException` and renders "Connection error" — chat is the only surface that reports session expiry while the rest of the app looks healthy | **High** |
| M33 | Release-ready Android artifact: branded `android:label` (still "Genie AI Mobile", should be AgroGenio) + R8/ProGuard config (`proguard-rules.pro` + `build.gradle` proguard wiring, currently uncommitted) | Debug APK only; release hardening exists locally but is not in the repo | **Medium** |
| M26 | Chat AI streaming (server-side SSE) verified live: quick-help prompts stream a response; stream errors surface as retryable UI states, never blank bubbles | **Streaming VERIFIED LIVE 2026-09-22** on the emulator (`app-el_salvador-debug.apk`, `--dart-define=FLAVOR=el_salvador`) against prod `mvp.ai.assembly.govstack.global`: every quick-help press streamed and rendered; prod `queries` recorded each one with its context. The "reference main-branch app" question is moot. **Residual gap:** stream errors are NOT retryable UI states — an expired token renders the opaque string "Connection error" (see M32) | High → **Medium** (verification done; error-state half moved to M32) |
| M27 | Color scheme matches the Vue 3 app DS tokens (light + dark) on chat, Insights and Market Prices screens | App DS (ThemeManager + design_system) renders; palette audit vs the Vue app on `feat/agri-external-data-apis` pending | Medium (2026-09-20) |

## 2. Phases

### Phase A — Data layer (M1, M2) · effort S · no UI change · **DONE 2026-09-20**
Map the full envelope: every series (name, unit, data incl. `quality`),
meta passthrough. Acceptance: 15-series grains envelope maps 1:1 (fixture
test); existing screens still render from `series[0]`.
Shipped: `mapMarketPricesEnvelope` in `agri_api_service.dart` (commit
`8ea35f3b1`) + 6 fixture tests (spec §14 test 1 + never-fail paths).

### Phase A2 — Auth & connectivity hardening (M25, M32) · effort S·M · NEW 2026-09-20, REVISED 2026-09-22
**Revision note:** the 2026-09-20 entry assumed "refresh failure clears tokens"
was correct. Investigation on 2026-09-22 (DW-325) proved the opposite —
the clear-on-any-failure is the defect. Re-specify as:

1. **Do not destroy the session on the first refresh failure.** `deleteAll()`
   only on a definitive `invalid_grant` from the token endpoint; network,
   timeout and malformed responses must preserve tokens (the
   `_networkErrorClassifier` branch already does this — extend the same
   treatment to the rest).
2. **Always leave a path back.** `send()` must not silently drop the
   Authorization header, and the 401 branch must not require a non-null
   token — otherwise a tokenless app 401s forever with no recovery.
3. **Proactive refresh** on resume/foreground and at ~4 minutes (realm
   `genie` issues 5-minute tokens; `accessTokenLifespan=300`), instead of
   reactive-only on 401.
4. **Fix the concurrency hole:** `_isRefreshing` currently returns
   immediately on a concurrent call, so the caller reads a stale token and
   retries into a second 401. Callers must await the in-flight refresh.
5. **SSE chat parity (M32):** the stream must retry after a successful
   refresh exactly as `ApiService` does; "Connection error" must never be
   the way a session expiry is reported.
6. When refresh fails unrecoverably, the root navigator MUST land on
   `OidcLoginScreen` — no surface may keep rendering
   `ApiException … Session expired`. Include a network-unreachable state
   distinct from auth failure (the 2026-09-20 lab-VPN outage produced
   identical-looking errors for a pure-network cause).

Acceptance: with the SSO session expired server-side, every surface
(chat included) either recovers transparently or lands on login — never a
dead "Connection error"; killing the network mid-refresh preserves tokens.

### Phase A3 — Quick Help filter correctness (M28, M29, M30, M31) · effort S·M · NEW 2026-09-22
The stale-label class. Root cause chain: a Quick Help press sets
`_activeServiceLabels`; **nothing displays it**; it persists into every
typed message; and for the buttons whose labels do not exist in the corpus
the filter matches **zero** chunks, so the retriever returns nothing and the
UI answers from the model with no hint that the KB was filtered out. On
prod 2026-09-22 this made four tomato/CENTA questions return 0 documents
while the documents were present and retrieval was healthy.

1. **M28 — make the active filter visible and clearable.** Mirror Vue's
   context pill: a chip naming the active Quick Help topic with a remove
   action, rendered whenever `_activeServiceLabels` is non-empty (the
   context bar currently keys off sidebar `_selectedCategoryName` only).
   **Decision D1 required** — see §3ter.
2. **M30 — make zero-document retrieval legible.** When the filter yields
   no documents the answer must be labelled as unfiltered/model-only, not
   presented as a normal grounded answer (Vue blocks/warns in
   `checkContextConfig`).
3. **M31 / DW-247 — non-streaming path.** Send `context.serviceLabels` on
   `_sendNonStreaming` (needs an OpenAPI spec extension) or document Quick
   Help as streaming-only; reset `_activeServiceLabels` there too.
4. **M29 — taxonomy alignment.** Align the button labels with the ingested
   taxonomy (`Pests`/`Diseases`, `Fertilization`, `Tomato`…).
   **Decision D2 required** — see §3ter.

Acceptance: after any Quick Help press, the active topic is visible and
clearable; a typed question is never silently filtered without the user
being able to see why; a button whose labels match nothing cannot present
its answer as grounded.

### Phase B — Chart core (M3, M5, M7, M8) · effort L · **DONE 2026-09-20**
Date-keyed spots (`millisecondsSinceEpoch`), `minX/maxX` from union range,
month/year bottom-tick formatter. Multi-`LineChartBarData` with the web
palette semantics; custom legend chip row; series-count-scaled height.
Estimated overlay split by `quality` with `dashArray`. Per-unit axes with
titles; two unit groups → left/right. Multi-commodity Latest card with
per-series "latest month-end price of…" tooltips (M7), headline-number
tooltip on the summary cards (M10's tooltip half).
Acceptance: grains renders 15 color-matched series with legend;
cropProtection renders dual axes; every Latest row self-explains.
Shipped: `series_chart_core.dart` (S3/S4 palette + S5 date-keyed spots
+ S6 window/ticks + S8 axis recipe + S10 height + S11/S12 Latest
helpers), `market_price_series_chart.dart` (fl_chart multi-series,
estimated dashed overlay S7, dual unit groups via transform + inverse
right axis, S9 legend tap-toggle, S14 touch tooltip), dialog wiring
(full envelope on open, legacy fallback). Verified live on emulator:
grains renders 15 color-matched series with exact spec §2 legend names
+ Latest rows; 15 new tests, suite 513 green. NOTE: dual-axis visual
check on cropProtection still pending (dialog scroll UX); dots on
annual series render radius 6 per spec — revisit density if heavy.

### Phase C — Interaction & filters (M4, M6, M9, M10 chips, M11, M12, M20) · effort M/L · **SHIPPED 2026-09-20 (core)
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

Shipped (ae07d8c4e): S25 family masters + S15/S16 series chips,
S17/S18 start-year filter, M6 [-][+]/Fit + pinch/drag-pan with
Y re-scale, S19 multi-series table (lazy rows, union dates, localized
quality), S20 exact CSV via share sheet. 7 new tests, suite 520 green.
ALSO SHIPPED: Market Prices moved to a dedicated screen with a top-nav
toggle (mobile real-estate, 0c6f0f275); S21 acronym chips + latest
values on the summary cards (0c6f0f275); predictions news-picker
insert control moved to a pinned top bar (0c6f0f275).

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

A (S, DONE) → **A2 (S·M) → A3 (S·M)** → B (L) → C (M/L) → D (S).
B alone fixes the "wrong data on screen" class; C brings the dashboard
interactions.

**A2/A3 come first (revised 2026-09-22).** They are the only phases whose
defects make the app unusable or untrustworthy rather than merely incomplete:
A2 turns a dead session into either a transparent recovery or a login screen,
and A3 stops the app silently answering from the wrong (or empty) slice of the
knowledge base. A3 depends on D1; M29 within it depends on D2 and is
recommended to stay in #1001. Both are small — the code paths are already
identified and no backend change is required.
Total: roughly 3–4 focused days (v3 adds the filter, chips, multi-series
table/CSV). No backend changes required — mobile consumes the same
envelopes (month-end cadence, unit conversions, translated news,
15-series grains all server-side).

## 3bis. Scope notes

- **Admin Dashboard: OUT OF SCOPE for mobile, permanently** — the
  mobile app is end-user only; admin features are never ported.
- **M27 color-scheme audit** (chat + Insights + Market Prices vs the
  Vue DS tokens, light AND dark): **DONE (2026-09-20)** — AppTokens
  defaults now mirror the Vue `theme-variables.css` exactly (AgroGenio
  light palette incl. fixed verde-cultivo `--accent-secondary`, and the
  fixed dark-theme values incl. light navbar text); fallback brand is
  Verde AgroGenio #176B3A (was steel blue); hardcoded Material colors on
  the agri cards/dialogs (health/severity/trend) replaced with DS token
  values. Note: the brand sheet's exact logo greens (#1E5631 / #4CAF50)
  and the #E9C46A gold differ from the web UI tokens — mobile follows
  the web; changing both is a web-side decision.

## 3ter. Open decisions blocking Phase A2/A3 (need sign-off before coding)

**D1 — Quick Help filter semantics (blocks M28).**
- *(a) Vue parity + visibility* **(recommended)**: keep the filter persistent
  (Vue keeps `selectedContextItems` too), but render it as a removable chip so
  the state is never invisible. Satisfies the standing "respond exactly like
  Vue" requirement and removes the invisible-state defect.
- *(b) Clear after send*: reset `_activeServiceLabels` when the Quick Help
  response completes, so typed follow-ups are never filtered. Better free-chat
  UX, but diverges from Vue and breaks "ask within this topic" follow-ups.

Recommendation: **(a)**. The 2026-09-22 failure was caused by *invisibility*,
not by persistence — Vue persists as well and the user reports Vue behaves
correctly. Note that with (a) a typed question is still filtered by the active
topic; the difference is the user can see it and remove it.

**D2 — Stale label values (blocks M29).**
- *(a) Mobile-only relabel*: change the mobile config to the real taxonomy
  (`Pests`, `Diseases`, `Fertilization`, `Tomato`…). Those buttons then ground
  on mobile where Vue returns an ungrounded answer — a **deliberate divergence**.
- *(b) Keep parity, defer* **(recommended)**: leave both configs unchanged and
  fix cross-client under #1001, so mobile and web keep behaving identically.

Recommendation: **(b)** for this plan. It is a cross-client defect and #1001
owns it; choosing (a) makes mobile and web answer differently for the same
button, contradicting the parity requirement that motivated !422.

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

- 2026-09-22 v6: field session on the emulator (`app-el_salvador-debug.apk`,
  `--dart-define=FLAVOR=el_salvador`) against prod
  `mvp.ai.assembly.govstack.global`. **Bug sweep — six new matrix items and one
  correction.** M25 **corrected**: "refresh failure clears tokens (correct)" was
  wrong; that clear-on-any-failure is the defect (tracked as DW-325 in
  `_bmad-output/implementation-artifacts/deferred-work.md`) — one failed refresh
  deletes all tokens and every later request 401s with no path back, surfacing
  as a dead "Connection error". New: **M28** stale/invisible Quick Help filter
  (a press persists into typed messages and is displayed nowhere — prod
  12:25-12:27 sent `['Pest/ Disease Health']` on four tomato/CENTA questions,
  each returning 0 documents), **M29** button labels absent from the ingested
  taxonomy (`Pest/ Disease Health`, `Nutrition`, `Establishment`, `Onion`,
  `Cucumber`, `Potato` = 0 of 332 chunks; real labels are `Pests` 94 /
  `Diseases` 108 / `Tomato` 26), **M30** zero-document retrieval is
  indistinguishable from an empty topic, **M31** `_sendNonStreaming` drops the
  labels (DW-247, still open), **M32** the SSE chat has no retry-after-refresh
  while `ApiService` self-heals, **M33** release-readiness (unbranded
  `android:label`, uncommitted R8 config). **M26 verified live** — every
  quick-help press streamed and rendered, closing the "identify the reference
  main-branch app" question; its error-state half moved to M32. New **Phase A3**
  (Quick Help filter correctness) and a **revised Phase A2** (auth recovery),
  both sequenced ahead of B/C/D because they make the app untrustworthy rather
  than merely incomplete. New **§3ter** records the two blocking decisions: D1
  Quick Help filter semantics (recommend Vue parity + a visible removable chip),
  D2 stale label values (recommend deferring to #1001 to preserve parity).
  Parity fix already shipped separately as MR !422 (mobile `serviceLabels`
  derivation now matches Vue exactly).
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
- 2026-09-23 v7: **mobile bug fixes completed** — M28, M30, M31/DW-247
  closed in code, all on top of `release/el-salvador`. Unified release APK
  (sha256 `8dcee1d3…`) deployed to the emulator (`emulator-5554`) and
  your phone (`RRCTB06HGEY`); on-device sha256 matches the built APK on
  both. Stack on each branch:
  - **!422** quickhelp label fallback (eagerly merged into M28)
  - **!427** M25 auth recovery
  - **!428** M32 typed SSE errors (stacked on !427)
  - **!435** M33 release readiness (stacked on !428)
  - **!436** M28 visible filter chip (carries !422)
  - **!437** M30 zero-doc banner
  - **!438** M31 non-streaming label reset (carries !422 + M28)
  No backend changes; no OpenAPI regen (DW-247's full ask deferred);
  no config changes. **M29 (stale taxonomy labels)** stays on #1001 (D2b).
  Outstanding non-mobile items from this plan (M1–M24, B/C/D phases) are
  unchanged. All seven mobile bug-fix MRs are now in the same turn as the
  code landed (the new rule).
