# Kickoff prompt — `feat/agri-mobile-parity` implementation

Copy everything below this line into a fresh Claude Code session (started
in `C:\Dev\el-salvador\genie-ai`) to begin the Flutter mobile catch-up
work. It assumes the web work in MR !388 is merged (or the branch is
available locally); if it is not merged yet, branch from
`feat/agri-external-data-apis` and rebase later.

---

Act as the senior Flutter engineer for the GENIE.AI El Salvador mobile
app and implement the agricultural-screens parity project END TO END.

## Mission

Bring `mobile/genie_ai_mobile` — the Crop Health, Pest Alerts and all
eight Market Prices screens — to exact functional and visual parity with
the Vue 3 web app as it exists TODAY on branch
`feat/agri-external-data-apis` (test build at https://10.0.0.101).

## Binding documents (read them FIRST, in this order)

1. `docs/agri-external-data-apis/mobile-parity-spec.md` — THE BUILD
   CONTRACT. Sections §0–§16 / S1–S27 carry exact algorithms, palette
   rules, display-name output tables, toggle semantics, start-year
   contract, date-aligned table/CSV rules, chip algorithm, tooltip
   templates, the AI output-budget contract (§16) and the data-layer
   localization dictionaries (§12bis). Where this prompt and the spec
   disagree, THE SPEC WINS.
2. `docs/agri-external-data-apis/mobile-parity-workplan.md` — the M1–M24
   tracker, phases A–D and the change log. Work the phases in order:
   A (data layer) → B (chart core) → C (interaction & filters) →
   D (polish & verification).
3. Web reference implementations — port behavior 1:1, do NOT invent:
   - `components/gov-chat-frontend/src/components/charts/MarketPriceChart.vue`
     (toggles, start-year filter, display names, table/CSV, prediction
     prompt + output contract, zoom/pan)
   - `components/gov-chat-frontend/src/components/charts/MarketPriceSummaryCard.vue`
     (sparkline card, acronym chips, tooltips)
   - `components/gov-chat-frontend/src/utils/agri-i18n.js`
     (ES dictionaries for series names and meta — copy the dictionaries
     verbatim into Dart)

## Hard rules

- **Data**: the app reuses the five `/api/agri/*` endpoints EXCLUSIVELY
  (spec §0). Zero upstream calls, zero data derivation in Dart — no
  aggregation, unit conversion, name shortening or estimation in the
  client; the server envelopes already carry month-end cadence, unit
  conversions, caveats and 15-series grains.
- **Branch/process**: create branch `feat/agri-mobile-parity` off
  `feat/agri-external-data-apis` (or off `main` after !388 merges).
  MR only; NEVER push to `release/*` or `main`. Reviewer: jrevillard.
- **Visual parity (spec PRIME DIRECTIVE)**: the screens must look almost
  exactly like the Vue app — same layout, same palette semantics
  (5-slot palette keyed to ORIGINAL series index; estimated overlay
  dashed), same toggles/chips/legend/table/CSV/Latest-card behavior,
  same tooltips word-for-word in both EN and ES.
- **i18n**: EN/ES fully translated (strings via the locale maps; data
  names via the ported `agri_i18n` dictionaries). Other locale files
  stay key-complete with EN fallback. On-screen selector stays EN/ES.
- **Vue-compat regression guardrails** (learned the hard way on web —
  spec §v4.3): keep name helpers in ONE Dart file with widget tests;
  never derive palette indices from filtered arrays — always from the
  original series list.
- **Quality gates**: `flutter analyze` clean, `dart format` clean,
  widget tests from spec §14 green, manual smoke on Android + iOS
  emulators against 10.0.0.101 for ALL 8 market categories.

## Acceptance

Every M-item in the workplan matrix demonstrably at parity (side-by-side
web vs mobile), §14 tests green, MR open and passing CI. Report progress
per phase; stop for my review after Phase B and after Phase D.
