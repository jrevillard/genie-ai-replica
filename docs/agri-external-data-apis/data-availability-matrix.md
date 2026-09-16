# Data Requirements vs. Availability Matrix — FINAL

**Date:** 2026-09-16 · **Branch:** `feat/agri-external-data-apis` · Companion to [research-findings.md](research-findings.md)

Legend: ✅ **VERIFIED** (live-probed, meets cadence) · ⚠️ **PARTIAL** (usable with mandatory UI disclosure) · 🌐 **REGIONAL-REFERENCE** (nearby-country data, labeled by country) · 📌 **CURATED** (static/contextual stat with as-of date)

All rows verified live across 6 research agents on 2026-09-16. Gaps resolved via nearby-country, trade-unit-value, and official-RSS alternatives.

## Crop Health

| # | Requirement | Cadence needed | Primary source | Verified freshness | Fallback | Status |
|---|---|---|---|---|---|---|
| 1 | NDVI per department (14) | ≤1 month | WFP HDX subnational NDVI (dekadal, no auth, CC-BY) | **2026-09-01** all 14 depts | ORNL DAAC MOD13Q1 point subsets (2026-08-13, CORS-open) | ✅ |
| 2 | Long-term baseline for trend | ≥10 yr same-dekad | HDX full file (2002→now) | 24 years | — | ✅ |
| 3 | Rainfall / soil moisture (context, optional) | days | NASA POWER `PRECTOTCORR`/`GWETROOT` | 2026-09-10 | — | ✅ optional |
| 4 | 10 m Sentinel-2 zonal stats (future) | days | Copernicus CDSE Statistical API | scenes 2026-09-15 | — | deferred phase 2 |

## Pest & Disease Alerts

| # | Requirement | Cadence | Source | Verified freshness | Status |
|---|---|---|---|---|---|
| 5 | Regional official pest news (ES) | days–weeks | OIRSA WordPress REST + RSS | feed built **2026-09-16** | ⚠️ low volume; keyword-lexicon extraction; no severity fields |
| 6 | Local pest sightings | continuous | iNaturalist place_id=7563 | FAW obs **2026-08-04** Acajutla | ⚠️ sparse; label "community sightings" |
| 7 | Structured official alerts | days | **none exists** (IPPC: 0 SV reports; EMPRES-i+: animals only; APHIS RSS 404) | — | 📌 curated seasonal advisories + quarterly IPPC POARS watch (dataset call closes 2026-10-31) |
| 8 | Pest taxonomy EN/ES + hosts | static | EPPO Data Portal (free account) | — | ✅ offline enrichment |

## Market Prices

| # | Requirement | Primary source | Verified freshness | Fallback / benchmark | Status |
|---|---|---|---|---|---|
| 9 | Maize (white) local USD | WFP VAM HDX SLV (official MAG data) | **2026-08-15** | Pink Sheet intl 2026M08; 🌐 GT La Terminal 2026-08-15 | ⚠️ 2023–25 hole; SS-only since 2026 → annotate + regional reference |
| 10 | Beans (red/silk) local | WFP VAM HDX SLV | 2026-08-15 | 🌐 NIC national avg 2026-05-15 | ⚠️ same |
| 11 | Rice local + intl | WFP VAM + Pink Sheet | 2026-08-15 / 2026M08 | — | ⚠️ / ✅ |
| 12 | Sorghum, wheat flour | WFP VAM + Pink Sheet | 2026-08-15 / 2026M08 | — | ⚠️ / ✅ |
| 13 | Vegetables (tomato/onion/potato…) | 🌐 WFP VAM **Nicaragua** national avg retail (eggs→veg, 28+ continuous months) + 🌐 GT La Terminal wholesale | **2026-05-15** (NIC) / **2026-08-15** (GT) | FAOSTAT PP **Honduras** annual USD to **2024** (all 5 items) | 🌐 regional-reference, country-labeled — no SV-local monthly exists |
| 14 | Poultry / eggs / pork | 🌐 WFP VAM Nicaragua (eggs $2.46/dozen, chicken $1.79/lb, pork $2.38/lb) | **2026-05-15** | Pink Sheet chicken/beef monthly 2026M08 ✅; FAOSTAT HN to 2024 | 🌐 regional + ✅ intl |
| 15 | Feed inputs (maize, soymeal, fish meal) | WB Pink Sheet | **2026M08** | IMF PCPS | ✅ intl |
| 16 | Fertilizer | Pink Sheet (urea/DAP/TSP/MOP) | **2026M08** | Comtrade HS3102 SV import parity $434/t (2024); HDX "Central America Fertilizer Prices" to 2025-11 | ✅ intl / ⚠️ local annual |
| 17 | Crop protection costs | BLS PPI pesticide mfg (CORS `*`, no key) | **2026-M08** | Comtrade HS3808 SV import UVs | ✅ proxy / ⚠️ annual |
| 18 | Honey | FAOSTAT PP 1991–2022 + Comtrade HS0409 export UV | 2022 / 2025 | — | ⚠️ blend + disclose |
| 19 | Tilapia price | 🌐 UN Comtrade export unit values: **HN fillets $7.65/kg, CR whole $7.36/kg (2024)**; SV imports 300 t | **2024** (annual; Comtrade monthly returns 0 for these codes) | Feed-cost context: fish meal (Pink Sheet, monthly ✅) | 🌐 annual regional-reference — no monthly tilapia price exists free; GLOBEFISH/FAOSTAT fisheries confirmed not-viable |
| 20 | Post-harvest/storage indicator | FAOSTAT SDG 12.3.1 (bulk verified, updated 2026-09-16): **Central America 16.5% (2023)** | regional aggregate only — no country rows | — | 📌 curated contextual stat; no feed exists |
| 21 | Department-level SV staple prices | not viable free today — regional thinness confirmed: every current WFP CA series collapses to one market (SV=San Salvador, GT=La Terminal, NIC=national avg; HN dead since 2022-06) | — | — | ❌ accepted limitation |
| 22 | FX (contingency; SLV dollarized) | frankfurter.dev (no key, CORS `*`) | 2026-09-16 | jsdelivr currency-api | ✅ |

## News (Market Prices prediction dialogs; ES + EN)

| # | Requirement | Source | Verified freshness | Status |
|---|---|---|---|---|
| 23 | Global ag/commodity news EN | GDELT DOC 2.0 (no key, unlimited-gov license) | 2026-09-13 | ✅ |
| 24 | Global ag news ES | GDELT `sourcelang:spa` (verified: regional LatAm coverage) | live | ✅ (⚠️ sticky rate-limiter — budget ≥10 s spacing, not 5 s; **zero .sv outlet coverage**) |
| 25 | Local SV ag news ES | **MAG feed `mag.gob.sv/feed` (2026-09-14) + Presidencia `presidencia.gob.sv/feed` (2026-09-07) + CoLatino RSS (same-day, real snippets)** | 2026-09-14 | ✅ all official/clean — **Google News RSS dropped** (ToS gray zone no longer needed) |
| 26 | Institutional ag news | FAO newsroom RSS | 2026-09-15 | ✅ |

## Cross-cutting constraints

| Constraint | Impact |
|---|---|
| CORS | Only ORNL, BLS, GDELT, frankfurter/er-api/jsdelivr are browser-direct → proxy ALL sources through the backend uniformly |
| URL churn | HDX resource UUIDs change; Pink Sheet hash changes monthly; FAOSTAT API hosts dead → **pluggable adapter harness with URL resolvers is a hard requirement** |
| Rate limits | Comtrade ~1 req/s (429 retry); GDELT sticky limiter (≥10 s); BLS 25/day keyless → scheduled prefetch + cache; clients never hit upstreams |
| Licensing | CC-BY family / open / public domain everywhere in final set; Google News gray zone eliminated | 
| Data honesty | UI must label: regional-reference (country), annual + as-of year, curated stats, 2023–25 hole, community sightings — the freshness chip is a feature |
