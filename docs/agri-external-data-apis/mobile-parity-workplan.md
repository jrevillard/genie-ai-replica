# Flutter Mobile Parity — Assessment & Work Plan

Date: 2026-09-18 · Scope: agricultural intelligence charts in `mobile/genie_ai_mobile`
against the current Vue 3 web app (branch `feat/agri-external-data-apis`).

## Assessment

Verified by code reading of `lib/services/agri_api_service.dart`,
`lib/components/charts/market_price_chart.dart`, `crop_health_chart.dart`,
`pest_alert_chart.dart`, `market_price_summary_card.dart`, `agri_caveat_banner.dart`.

### Already at parity (inherited or previously delivered)

| Capability | Status |
|---|---|
| Data sources | Same `/api/agri/*` endpoints and envelopes — month-end cadence, unit conversions (USD/mt→quintal/kg, USD/kg→quintal), 10-year aquaculture window, relevance-gated + AI-translated news all apply automatically (server-side) |
| News picker | scope + UI-locale language, same as web |
| Caveat banner | `AgriCaveatBanner` renders the same envelope caveats |
| CSV export | Share-sheet export with unit headers, translated quality column |
| i18n | `charts`/`market` locale maps with EN/ES translations |
| USD denotation | `$` marker on currency values/axis ticks |
| Relative y-scale (top) | 1.5× the maximum series value |
| Dense-chart horizontal scroll | LayoutBuilder + SingleChildScrollView |

### Gaps

**Data layer**

- **G1 — Only `series[0]` is mapped** (`agri_api_service.dart` line ~73).
  Every secondary series is discarded before the UI: vegetables renders
  only cabbage, fertilizer only urea, livestock one benchmark, maize no
  US-Gulf benchmark, aquaculture no fishmeal. This is the single largest
  parity defect — no chart work matters until the data flows.
- **G2 — Point fields dropped**: `quality` (estimated vs actual) and
  per-series `name`/`unit` are not mapped, so dashed-estimate rendering
  and correct tooltips are impossible today.

**Market chart visuals (vs web)**

- **G3 — Single-series render**: one `LineChartBarData` with `_buildSpots()`;
  needs multi-series + palette + legend (fl_chart has no built-in legend —
  custom chip row).
- **G4 — Index-based x-axis** (`FlSpot(index, value)`): with the backend's
  uniform month-end cadence this is *approximately* a month grid for a
  single series, but annual/benchmark series misalign exactly like the web
  bug did before the datetime axis. Spots must be date-keyed
  (`DateTime.millisecondsSinceEpoch`), `minX`/`maxX` from the union range.
- **G5 — No estimated overlay**: CPI-estimated gap years render as if
  observed. Web renders them dashed; mobile needs `dashArray` + the mapped
  `quality` field (G2).
- **G6 — No zoom/pan/fit**: fl_chart has none built-in. Web now ships
  wheel-zoom + drag-pan + a native +/−/reset toolbar.
- **G7 — Fixed 250 px chart height** vs web's series-count-scaled height.
- **G8 — Tooltip lacks the unit** (shows date+value; web shows date+value+unit).
- **G9 — Y-floor formula** differs from web's step-based floor
  (align: hug the data minimum, clamp at 0 for positive prices).
- **G10 — No axis unit titles** (web labels each axis with its unit;
  fl_chart `AxisTitles` can carry it; dual-unit categories — cropProtection —
  map to left/right axes like web's dual y-axis).

**Other charts**

- **G11 — crop_health_chart**: verify tooltip date+value parity and the
  14-department coverage rendering after the data-layer changes (no known
  defect; verification item).

## Work Plan

Ordered so each phase is independently shippable and testable.

### Phase 1 — Data layer (G1, G2) — effort: S

- Map the full `series` array (name, unit, data incl. `quality`) through
  `getMarketPrices`; keep envelope meta untouched.
- Fixture test: an envelope with 3 series/2 units maps 1:1.

### Phase 2 — Chart core (G3, G4, G5, G7, G10) — effort: L

- Date-keyed spots; `minX/maxX` from the union of series ranges;
  per-interval bottom titles from timestamps.
- Multi-series `LineChartBarData` with a fixed palette matching web's
  semantic colors (primary = category color; estimate = warning; extras =
  muted/info/danger), custom legend chip row, series-count-scaled height.
- Estimated overlay series with `dashArray` (split by `quality`, same as
  web's actual/estimated pair).
- Axis titles carry units; two unit groups → left/right axes.

### Phase 3 — Interaction (G6) — effort: M

- Pinch-to-zoom + drag-pan: `onScaleStart/Update/End` on a `GestureDetector`
  driving `minX/maxX` state (scale = zoom, focal delta = pan), clamped to
  the data range; y re-scales to the visible window (web's
  `autoScaleYaxis` behavior).
- A `[−] [+] [Fit]` icon-button row on the chart header (parity with the
  web toolbar) — zoom steps ×2 around the visible center; Fit restores the
  full range.

### Phase 4 — Polish & verification (G8, G9, G11) — effort: S

- Tooltip: unit appended; date formatting matches web (month/year cadence).
- Y-floor formula aligned to web's step-based floor.
- Crop-health chart verification pass; flutter analyze/format/tests green;
  manual smoke on Android + iOS emulators against 10.0.0.101.

### Out of scope

- Backend changes — none required; mobile consumes the same envelopes.
- Pest-alerts (list + map already parity; no chart on web either).

## Definition of done

Every market category renders the same series set, units, cadence and
visual treatment as the Vue app; zoom/pan/fit available without a wheel;
`flutter analyze` clean; widget tests for the data mapping and the zoom
window math; reviewed by jrevillard in MR !388's follow-up.
