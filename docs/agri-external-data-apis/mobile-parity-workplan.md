# Flutter Mobile Parity — Comprehensive Work Plan (v2)

Date: 2026-09-19 · Implementation branch: **`feat/agri-mobile-parity`**
(branch off `feat/agri-external-data-apis` once MR !388 merges; own MR,
reviewed after !388) · Status: **plan only — not started**
Scope: bring Crop Health, Pest Alerts and ALL Market Prices screens in
`mobile/genie_ai_mobile` into line with the Vue 3 web app.

> This plan is deliberately adjustment-friendly: every item is numbered
> (M#) and independent. Bug fixes and enhancements on the web app before
> kickoff should be folded in here, not around it.

## 1. Parity matrix — web capability × mobile status

| # | Web capability (as shipped 2026-09-18/19) | Mobile today | Gap |
|---|---|---|---|
| M1 | All series served per category (benchmarks, regional refs, every commodity) with month-end cadence and unit normalization server-side | **Data layer maps `series[0]` only** (`agri_api_service.dart` ~line 73); everything else discarded | **Critical** |
| M2 | Per-series `name`, `unit`, point `quality` consumed | Point quality + per-series name/unit dropped in mapping | Critical (blocks M5, M8, M13) |
| M3 | Multi-series chart: palette-matched lines, legend, up to 5 series | Single `LineChartBarData` (primary only) | Critical |
| M4 | True datetime x-axis (date-keyed points, mixed cadences align) | Index-based `FlSpot(i, v)` | High |
| M5 | CPI-estimated gap years rendered dashed + "estimated" quality | No quality handling — estimates render as observed | High |
| M6 | Wheel-zoom + drag-pan + native +/−/fit toolbar buttons | None (fl_chart has none built-in) | High |
| M7 | Multi-commodity Latest card: per-commodity figures, color-matched | Single figure (primary series only) | High |
| M8 | Relative y-scales per unit group (floor-hug, 1.5× max, $ markers, axis unit titles, dual left/right axes for irreducible mixes) | 1.5× top + $ done; floor differs; single axis; no unit titles | Medium |
| M9 | Tooltips: date + value + unit, dense-marker sizing | Date + value (no unit) | Medium |
| M10 | CSV export with unit headers + translated quality column | **Done** (share sheet) | — |
| M11 | News: language-follows-locale, relevance gate, AI translation, dedupe | **Done** (same endpoints; picker wired to locale) | — |
| M12 | Caveat banner + About panel from envelope meta | Banner exists (`AgriCaveatBanner`); About panel absent | Low |
| M13 | Unit calibration explanations (quintal/PPI/index/SDG %-of-what) on the Latest unit | Exists incl. the new SDG 12.3.1 wording | — |
| M14 | EN/ES i18n for all chart strings | **Done** (`charts`/`market` maps) | — |
| M15 | Debug logging (load line + axis build line in console) | Absent | Low |
| M16 | Crop Health: 14 departments, baseline/trend/health buckets, map pin per dept | Department list renders; verify parity of baseline/change display + tooltips | Verify |
| M17 | Pest Alerts: advisories/regional/sightings with severity filter + AI-assistance dialog | Exists (list + map + assistance) | Verify |

## 2. Phases

### Phase A — Data layer (M1, M2) · effort S · no UI change
Map the full envelope: every series (name, unit, data incl. `quality`),
envelope meta (source/coverage/caveats/estimation) passthrough.
- Acceptance: an envelope with 3 series/2 units maps 1:1; fixture unit test;
  existing screens still render from `series[0]` unchanged.

### Phase B — Chart core (M3, M4, M5, M7, M8) · effort L
Date-keyed spots (`millisecondsSinceEpoch`), `minX/maxX` from union range,
bottom-title formatter for month/year ticks. Multi-`LineChartBarData` with
the web palette semantics (primary = category color; warning = estimated;
muted/info/danger = extras), custom legend chip row, series-count-scaled
chart height. Estimated overlay split by `quality` with `dashArray`.
Axis titles carry units; two unit groups → left/right axes. Multi-commodity
Latest card mirroring the web card (dot + short name + value per series).
- Acceptance: vegetables renders all 5 commodities color-matched with
  legend; maize shows dashed estimates; cropProtection renders dual axes;
  every category's Latest card lists all its commodities.

### Phase C — Interaction (M6, M9) · effort M
`onScaleStart/Update/End` on a `GestureDetector` driving `minX/maxX`
window state (pinch = zoom, focal delta = pan), clamped to data range, y
re-scaled to the visible window. `[−] [+] [Fit]` icon-button row on the
chart header (zoom ×2 around visible center; Fit = full range). Tooltip
appends the unit.
- Acceptance: one-hand pinch + drag navigation; buttons work without
  gestures; Fit restores full range exactly.

### Phase D — Polish, parity verification, logging (M12, M15, M16, M17) · effort S
About panel (source/coverage/estimation from meta); `debugPrint` load-line
parity with the web console line; crop-health tooltip/baseline pass;
pest-alerts regression pass; flutter analyze/format/tests green; manual
smoke on Android + iOS against 10.0.0.101.

## 3. Sequencing & estimates

A (S) → B (L) → C (M) → D (S). B and C are separable: B alone already
fixes the "wrong data on screen" class; C adds navigation. Total: roughly
2–3 focused days. No backend changes required — mobile consumes the same
envelopes (month-end cadence, unit conversions, translated news all
server-side).

## 4. Risks

- fl_chart version: pinch/pan math is hand-rolled; if the pinned version
  fights window-state updates, upgrade is contained to Phase C.
- Performance: 5 series × 800 monthly points is well within fl_chart;
  dense dailies no longer exist thanks to the month-end cadence.
- i18n: new UI strings (legend, zoom buttons, About rows) get EN/ES
  translations in `lib/i18n/locales/{en,es}.dart`; other locale files stay
  key-complete with EN fallback (locale-consistency CI + branch reuse for
  other countries). The on-screen language selector stays EN/ES
  (flavor-driven) — unchanged.

## 5. Definition of done

Every Crop Health, Pest Alerts and Market Prices screen shows the same
series, units, cadence, calibration text, caveats and interactive behavior
as the Vue app; `flutter analyze` clean; widget tests cover the data
mapping, the palette/legend construction and the zoom-window math; manual
sign-off against 10.0.0.101; reviewed by jrevillard.

## 6. Change log (for pre-kickoff adjustments)

- 2026-09-19 v2: comprehensive matrix + phases; added multi-commodity
  Latest card (M7), zoom toolbar (M6), About panel (M12), debug logging
  (M15), SDG unit-explanation wording, month-end cadence context.
- 2026-09-18 v1: initial assessment (series[0]-only data layer, chart
  core, interaction, polish).
