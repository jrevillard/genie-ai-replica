# Agricultural External Data APIs — Research Findings (Verified)

**Date:** 2026-09-16 · **Branch:** `feat/agri-external-data-apis` · **Status:** Verified by 5 parallel research agents, every claim probed live on 2026-09-16 unless marked otherwise.

This dossier consolidates the live-verified research behind the replacement of the fake/stale external data sources used by the Insights (Crop Health, Pest Alerts) and Market Prices dialogs. The companion [remediation-plan.md](remediation-plan.md) defines the target architecture and implementation sequence.

---

## 1. Method

Each candidate source was probed live (curl/WebFetch): endpoints hit, responses parsed, **actual latest data date extracted** — no marketing claims accepted. Dead ends are documented with evidence. CORS was tested with an `Origin` header probe. All URLs below were returning real data on 2026-09-16.

---

## 2. Crop Health (NDVI)

### 2.1 Root cause of current staleness

- **Web:** `agriculturalService.js` returns hardcoded mock NDVI — no HTTP call is ever made.
- **Mobile:** `hdx_ndvi_service.dart` hardcodes HDX resource UUID `2151cc86-…`, which now **404s** — the WFP dataset moved to a new id. The dataset itself is alive and updated daily.
- **Dead code:** `google_earth_engine_service.dart` (actually a NASA POWER client) can never work: **NASA POWER does not serve NDVI** (`parameters=NDVI` → `"One of your parameters is incorrect: NDVI."` — verified). POWER serves meteorology/solar only (e.g. `PRECTOTCORR`, `GWETROOT` soil moisture — both verified current).

### 2.2 Primary — WFP HDX subnational NDVI ✅

- Dataset: https://data.humdata.org/dataset/slv-ndvi-subnational (CKAN id `b84f0c2e-2b7f-41c0-bf5d-8d0d7407a228`)
- **Verified:** latest dekad **2026-09-01 for all 14 departments** (SV01 Ahuachapán `vim=0.822` … SV14 La Unión `0.767`); file metadata_modified 2026-09-15; dekadal cadence (1st/11th/21st).
- History: 5ytd file starts 2022-01-01; **full file starts 2002-07-01** → same-dekad long-term baselines over 24 years.
- Schema: `date,adm_level,adm_id,PCODE,n_pixels,vim,vim_avg,viq` (`vim` = VI mean — the value to use).
- Quirk: PCODE SV11 has two adm_ids (900391 main + 900395 sliver) — dedupe by larger `n_pixels`.
- Working URLs (verified):
  - 5ytd: `https://data.humdata.org/dataset/b84f0c2e-2b7f-41c0-bf5d-8d0d7407a228/resource/331b851f-1bb4-4244-91d1-247c23ec1d15/download/slv-ndvi-subnat-5ytd.csv`
  - full: `https://data.humdata.org/dataset/b84f0c2e-2b7f-41c0-bf5d-8d0d7407a228/resource/12da522a-c634-4520-8a94-c6eb627c427f/download/slv-ndvi-subnat-full.csv`
  - **Robust resolution (use this):** `GET https://data.humdata.org/api/3/action/package_show?id=slv-ndvi-subnational` → pick resource by filename. Survives future UUID churn.
- CORS: CKAN API `*`; CSV 302→signed S3 where the first hop restricts ACAO → **backend must proxy the CSV for web**; Flutter could fetch directly but will use the backend like everything else.
- License: **CC-BY 4.0** (attribution: "Source: WFP VAM via HDX"). No auth, no documented rate limit.

### 2.3 Fallback / cross-check — ORNL DAAC MODIS subsetting ✅

- `https://modis.ornl.gov/rst/api/v1/MOD13Q1/subset?latitude=…&longitude=…&band=250m_16_days_NDVI&startDate=A2026225&endDate=A2026225&kmAboveBelow=2&kmLeftRight=2` — verified live.
- Latest MOD13Q1 granule verified **2026-08-13**; point-based (median of pixel window per department centroid). Cross-validates WFP: Ahuachapán 0.830 (ORNL, Aug 13) vs 0.822 (WFP, Sep 1).
- No auth; **CORS open (echoes any origin)**; latency 2–11 s/query → server-side with caching. Use MOD13Q1 (Terra) — VIIRS VNP13A1 at ORNL is stale (2024-05-24).

### 2.4 Phase-2 upgrade — Copernicus CDSE Statistical API

- Sentinel-2 10 m zonal statistics per department polygon; scenes over El Salvador verified as recent as **2026-09-15**; free OAuth client-credentials (self-service, no card). Highest quality, highest effort (evalscripts, GeoJSON polygons, token refresh). Defer.

### 2.5 Dead ends (verified)

NASA POWER (no NDVI), FAO WaPOR (only NDVI *quality-flag* layers, no values — full catalog enumerated), AppEEARS (moved to `appeears.earthdatacloud.nasa.gov`, async task-poll workflow, Earthdata login), NASA GIBS (rendered RGB, not values), Google Earth Engine (no plain REST; service-account clients only), Sentinel Hub commercial (now Planet-owned; free tier unverifiable), FEWS NET (no values API).

---

## 3. Pest & Disease Alerts

### 3.1 Honest headline

**No free live structured pest-alert API for Central America exists today.** El Salvador has filed **zero** IPPC official pest reports (country page says "No pest reports available"); GBIF holds 0 SV records for all five target pests; MAG publishes no plant-health feed (its RSS is procurement auctions, 3 items). The USDA APHIS RSS the mobile app polls is **decommissioned — all feed URLs 404**.

### 3.2 Achievable architecture (all parts verified live)

| Layer | Source | Verified evidence |
|---|---|---|
| Curated seasonal advisories | Existing 5-pest content, **relabeled "seasonal advisory" not "alert"**; taxonomy enriched offline via EPPO Data Portal | — |
| Regional official news | **OIRSA WordPress REST**: `https://web.oirsa.org/wp-json/wp/v2/posts?categories=121903&per_page=20` (+ RSS `/archivos/category/noticias/feed`) | Feed built **2026-09-16**; verified items: locust control Honduras 2025-08-13, Fusarium R4T Guatemala 2025-08-21, SV citrus nursery 2026-01-05. Spanish-native. Keyword lexicon required (langosta, roya, fusarium, gusano, mosca, HLB, broca, plagas) |
| Community sightings | **iNaturalist**: `https://api.inaturalist.org/v1/observations?place_id=7563&taxon_name=…` | *Spodoptera frugiperda* obs 388247063, **2026-08-04, Acajutla, Sonsonate**; *Hemileia vastatrix* 2 obs 2025-06-06. No auth, 60 req/min, CORS-friendly |
| Watch (quarterly) | IPPC **POARS** (Pest Outbreak Alert & Response System) — dataset call open until **2026-10-31**; NAPPO table (US/CA/MX, HTML only) | Re-check Q1-2027 — the only credible path to a real regional alert API |

### 3.3 Dead ends (verified)

USDA APHIS RSS (404, decommissioned), FAO EMPRES-i+ (animal diseases only — verified platform metadata), IPPC reports (zero CA content), FAO GIEWS (food-security domain, no feed), CABI Pest Alerts (email signup, no API; KB factsheets are good curated content to cite), ProMED (paywalled 5 articles/month), FAO FAW page/Locust Hub/TR4GN (static/dead/wrong geography), HDX (0 pest datasets), Google News RSS for ES pest queries (consistently 0 items — no Spanish news volume on these topics).

---

## 4. Market Prices

### 4.1 The core problem (confirmed)

The current World Bank service does not fetch **prices** — it fetches annual production indices (`AG.PRD.CROP.XD`, `AG.PRD.LVSK.XD`, `SP.RUR.TOTL.ZS`…) with 2–4-year lag and missing years, silently falling back SLV→LCN→1W. Two categories reuse the same livestock index; harvestStorage uses *rural population %*.

### 4.2 Primary — WFP VAM Food Prices via HDX ✅

- Dataset: https://data.humdata.org/dataset/wfp-food-prices-for-el-salvador (CKAN id `0ff64070-c95b-4962-9d99-09d989d43f75`, updated 2026-09-13 by "HDX Scraper: WFP Food Prices"). This is the **official MAG/SIMMAG data** republished by WFP.
- Price CSV (verified, 7,822 rows): `https://data.humdata.org/dataset/0ff64070-c95b-4962-9d99-09d989d43f75/resource/843fb265-6f80-4d86-ae41-ef89b6daff15/download/wfp_food_prices_slv.csv`
- Commodities: Maize (white), Beans (red), Beans (silk red), Rice, Sorghum, Wheat flour. Markets: 13 Salvadoran + National Average. All USD.
- **Latest row verified 2026-08-15** (San Salvador wholesale, USD/46 KG ≈ 1 quintal): maize 26.61, beans 72.70, rice 43.22, sorghum 35.26. Beans eased 80.76→72.70 Jan→Aug 2026; rice 47.28→43.22.
- **Data-quality caveat (must be handled in UI):** ~700 rows/yr 2005–2014 → ~170/yr 2015–2019 → 42 in 2022 → **zero rows 2023–2025** → since Jan 2026 San Salvador only (~10 rows/month). Unit drift 45 KG→46 KG (both ≈ Central American quintal); retail in Libra.
- CORS: CSV fetch must be proxied via backend (same 302-redirect pattern as NDVI). License **CC BY-IGO**.

### 4.3 Supplements (verified)

| Source | What it gives | Latest verified |
|---|---|---|
| **WB Pink Sheet monthly xlsx** | International benchmarks: maize (US Gulf), rice (Thai), sorghum, chicken, beef, soybeans/meal/oil, fish meal, sugar, coffee, bananas; **fertilizer: urea, DAP, TSP, MOP, phosphate rock** | **2026M08** (urea $390/mt, DAP $793.5/mt, TSP $704.4/mt, MOP $386.9/mt, chicken $1.69/kg); history 1960M01→now. Live URL: `https://thedocs.worldbank.org/en/doc/74e8be41ceb20fa0da750cda2f6b9e4e-0050012026/related/CMO-Historical-Data-Monthly.xlsx` — **URL hash changes monthly; resolve by scraping the commodity-markets page**. ⚠️ The widely-circulated `5d903e84…-0350012021` URL serves a stale copy (through 2024M12) — do not use |
| **IMF PCPS xlsx** | Cross-check incl. PFERT index, poultry index | 1980M01→2026M08 (mind NOLA $/short-ton vs $/mt unit mismatches) |
| **FAOSTAT bulk** (API dead — see 4.5) | Producer Prices, LCU+USD/tonne + PPI; **the only free source with vegetables, eggs, poultry, pork for SV** (tomatoes, onions, potatoes, chillies, cabbages, plantains, mangoes…) | ES actual prices stop **2022** (maize 667.9 USD/t Dec-2022); 2023–2025 are imputed index values only. `https://bulks-faostat.fao.org/production/Prices_E_All_Data_(Normalized).zip` (11.6 MB zip, keyless, updated 2026-01-09; SV = 6,797 rows) |
| **UN Comtrade public preview** (keyless) | **El-Salvador-specific import/export unit values**: HS 3102 urea imports ($434/t CIF from Russia, 2024), HS 3808 pesticides, HS 0409 honey exports ($3.43/kg 2023; 2025 annual present; monthly ~12 mo back) | `https://comtradeapi.un.org/public/v1/preview/C/A/HS?reporterCode=222&period=2025&cmdCode=0409&flowCode=X` — hard limit ~1 req/s (429 + retry), **no CORS → backend only** |
| **BLS PPI** | Crop-protection cost proxy (pesticide mfg PPI `PCU325320325320`), fertilizer mfg PPI | **2026-M08** (186.874); no key (25 queries/day; free v2 key → 500/day + 20-yr history); **CORS `*`** — the only price API callable browser-side |

### 4.4 No-source categories (honest re-scope required)

- **Tilapia/aquaculture price:** no free machine-readable API exists. GLOBEFISH publishes weekly tilapia prices but dashboard-only (no download/API); FishStat = annual volumes, old hosts dead. Options: fish meal/feed-cost index (WB, current) + curated GLOBEFISH figures with as-of dates, or drop.
- **Post-harvest/storage cost:** no free source anywhere. Options: FAOSTAT Food-Loss % (annual, curated, multi-year lag) or drop/repurpose the category.

### 4.5 FAOSTAT API status (important)

All three API hosts verified dead or auth-walled on 2026-09-16: `fenixservices.fao.org` → Cloudflare 521; `apps.fao.org/faostat-api` → NXDOMAIN; `faostatservices.fao.org/api/v1` → 401 (Bearer required). **Bulk-download zips work keylessly and are the only reliable channel.** The user's FAOSTAT relationship should be used to ask about the API roadmap (and possibly elevated bulk access), but the design must not depend on it.

---

## 5. News Feeds (Market Prices prediction dialogs)

### 5.1 Global — GDELT DOC 2.0 ✅ (recommended)

- `https://api.gdeltproject.org/api/v2/doc/doc?query=…&mode=artlist&format=json&sort=datedesc&maxrecords=N` — no key, **CORS `*`**, license: *"unlimited and unrestricted use for any academic, commercial, or governmental use"* (best licensing of any candidate; citation required).
- Verified live: 8 articles, newest 2026-09-13. Response: `{url, title, seendate, domain, language, sourcecountry}` — **title-only, no snippet**.
- Gotchas (verified): **always add `sourcelang:`** (eng/spa) or results are cross-language noise (Bengali/Albanian observed); country filter uses FIPS codes and SV coverage via `sourcecountry:ES` is thin → use language + keyword targeting instead.
- **Rate limit 1 req/5 s, enforced (429s hit readily)** → backend mutex + exponential backoff + cache.

### 5.2 Local — Google News RSS ✅ (with ToS caveat) + CoLatino ✅ (clean)

- **Google News RSS**: `https://news.google.com/rss/search?q=agricultura+El+Salvador+when:7d&hl=es-419&gl=SV&ceid=SV:es` — verified 49 fresh items (≤7 days), including content from La Prensa Gráfica and El Diario de Hoy, whose own RSS endpoints are 403-bot-blocked. `when:7d` operator verified working. Title-only; no CORS → backend. **ToS states personal, non-commercial use** — gray zone for a public-sector product (mitigation options in the plan).
- **Diario CoLatino**: `https://www.diariocolatino.com/feed/` (+ `/category/economia/feed/`) — live, same-day fresh (2026-09-16 11:03 UTC), **real text snippets** (WordPress). The only Salvadoran outlet with a directly-accessible feed. No CORS → backend.
- **FAO newsroom RSS**: `https://www.fao.org/feeds/fao-newsroom-rss` — live (2026-09-15), authoritative global-ag supplement, title-only.

### 5.3 Disqualified (verified)

NewsAPI.org (free tier dev-only, "cannot be used in production", $449/mo paid), GNews (dev-only, no commercial), Bing News Search (retired), Reuters feeds (DNS-dead), AP (never public), World Bank RSS (404), USDA/FAS (403 bot-wall), Currents (no advantage).

### 5.4 Spanish support

Global: GDELT `sourcelang:spa` variant (mandatory operator anyway). Local: Google News `hl=es-419` + CoLatino — natively Spanish. The news picker serves ES or EN feed sets by app locale.

---

## 6. FX (supporting)

All chosen price sources are already USD and El Salvador is dollarized — FX is contingency only. Primary `https://api.frankfurter.dev/v1/latest?base=EUR&symbols=USD` (verified 2026-09-16, no key, CORS `*`; note `.app` now 301s to `.dev`); backup jsDelivr `@fawazahmed0/currency-api` (CORS `*`, effectively unlimited); `open.er-api.com` third. `exchangerate.host` no longer keyless.

---

## 7. Cross-cutting constraints

| Constraint | Finding |
|---|---|
| CORS | Browser-direct is only clean for: ORNL, BLS, GDELT, frankfurter, er-api, jsdelivr. All HDX CSVs (NDVI + prices), Pink Sheet xlsx, FAOSTAT zips, Comtrade, all RSS, CDSE → **backend proxy required**. Conclusion: proxy everything through the backend uniformly |
| Rate limits | Comtrade ~1 req/s (429 retry); GDELT 1 req/5 s; BLS 25/day keyless; iNaturalist 60/min; HDX none documented (be polite, cache 12–24 h) |
| Licensing | CC-BY 4.0 (HDX NDVI), CC BY-IGO (WFP prices), WB/IMF open data (attribution), FAOSTAT CC BY-4.0, BLS public domain, GDELT unlimited-gov (cite), Comtrade attribution required, Google News RSS **gray zone**, CoLatino/OIRSA institutional news (link-out + attribution, cache respectfully) |
| Volatility of URLs | HDX resource UUIDs churn (resolve via CKAN `package_show`); Pink Sheet doc hash changes monthly (scrape landing page); FAOSTAT API hosts unstable (use bulks) |
