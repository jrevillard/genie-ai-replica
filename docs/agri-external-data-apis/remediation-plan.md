# Agricultural External Data APIs — Remediation Plan

**Date:** 2026-09-16 · **Branch:** `feat/agri-external-data-apis` → MR → `release/el-salvador`
**Inputs:** [research-findings.md](research-findings.md) · [data-availability-matrix.md](data-availability-matrix.md) (all sources live-verified)

---

## 1. Goals

1. Replace fake/stale external data (mock crop health, mock pest alerts, World Bank indices masquerading as prices) with the verified free sources in the matrix.
2. **Never-fail guarantee:** the app works even when upstream APIs are unavailable — persistent caches, stale-serve, bundled seeds (user requirement).
3. **Pluggable source harness:** any backend service call can be modified, moved, or replaced with minimal, localized change (user requirement — validated by reality: HDX UUIDs churned, Pink Sheet hash rotates monthly, FAOSTAT's API died outright during research).
4. Auto-populate the Market Prices prediction dialogs' World/Local news fields from free feeds via a headline picker (ES + EN) (user requirement).
5. Zero client-side external API calls — all data via the backend BFF.

**Non-goals (this phase):** Copernicus CDSE 10 m NDVI (phase 2), machine-learning price forecasting, paid sources, client-side scraping.

---

## 2. Target architecture

```
┌─ Vue 3 (web) ────────────┐   ┌─ Flutter (mobile) ───────┐
│ agriApiService (new)     │   │ agri_api_service (new)   │
│ localStorage LKG cache   │   │ SharedPreferences LKG    │
│ bundled seed snapshots   │   │ bundled seed snapshots   │
│ freshness chip in charts │   │ freshness chip in charts │
└────────────┬─────────────┘   └────────────┬─────────────┘
             │  GET /api/agri/* (via Kong gateway)
┌────────────▼──────────────────────────────▼─────────────┐
│ gov-chat-backend — new `agri` module                    │
│                                                         │
│  REST (envelope contract §4):                           │
│   /api/agri/crop-health      /api/agri/pest-alerts      │
│   /api/agri/market-prices/:category                     │
│   /api/agri/news?scope=&lang=   /api/agri/health        │
│                                                         │
│  Serving layer: Redis hot cache → ArangoDB last-known-  │
│  good → bundled seed; stale-serve semantics §5          │
│                                                         │
│  Scheduler (prefetch jobs, per-source cadence):          │
│   resolves → fetches → parses → normalizes → upserts    │
│                                                         │
│  SOURCE ADAPTER REGISTRY (§3 — pluggable harness)       │
└─────────────────────────────────────────────────────────┘
```

Both clients keep their existing chart/AI-prompt data contract (`{title, unit, data:[{date|year, value}], trend, latest}`) — the backend normalizes everything to it, so `MarketPriceChart.vue`, `crop_health_chart.dart`, etc. keep working with minimal diffs.

---

## 3. Pluggable source harness (hard requirement)

Each external source is a **self-contained adapter** implementing one interface:

```js
// components/gov-chat-backend/services/agri/adapters/<sourceId>.js
module.exports = {
  id: 'hdx-ndvi',                    // stable id, used in env + registry + data lineage
  configPrefix: 'AGRI_HDX_NDVI',     // env-overridable: URL templates, TTL, timeouts
  resolves: ['ckan:slv-ndvi-subnational:slv-ndvi-subnat-5ytd.csv'], // URL resolution strategies
  cadence: '24h',                     // prefetch schedule
  async resolve(cfg) {},              // find the CURRENT endpoint (CKAN package_show,
                                      //  landing-page scrape for Pink Sheet, static URL)
  async fetch(resolved, cfg) {},      // single upstream call w/ timeout + retry/backoff
  parse(raw) {},                      // CSV/xlsx/zip/RSS/JSON → raw records
  normalize(records) {}               // → canonical docs (agri_series/agri_ndvi/…)
};
```

Rules:
- **Registry, not imports scattered:** `adapters/index.js` registers all adapters; `AGRI_SOURCES_ENABLED=hdx-ndvi,wfp-slv,…` (comma list, default all) enables subsets — a broken source is disabled by env, not code.
- **Endpoints env-overridable, resolvers for volatile URLs:** HDX via CKAN `package_show` (survives UUID churn), Pink Sheet via commodity-markets page scrape (survives monthly hash change), FAOSTAT via bulk base URL. A source that moves = adapter `resolve()` fix or env override, nothing else changes.
- **Per-adapter health:** each fetch logs `{adapterId, ok, latencyMs, latestDataDate, error}` to Arango `agri_fetch_log`; health validates **schema, not just HTTP 200** — a parse failure or unexpected column set flips the adapter to failing. `/api/agri/health` exposes per-source age; Grafana alerts route to the ops channel when `latestDataDate` exceeds source-type thresholds: **monthly sources > 45 days, news > 6 h, NDVI > 10 dekads, annual sources > 15 months**.
- **Contract tests per adapter:** recorded fixtures (a real response per source) replayed in CI; a parser regression is caught before deploy.
- **Adding source #19:** create adapter file, register, add fixture, set env — no client or route changes.

### Adapter inventory (17 at launch)

| Adapter id | Serves | Upstream |
|---|---|---|
| `hdx-ndvi` | crop health (14 depts, dekadal + baselines) | HDX CKAN → CSV |
| `ornl-modis` | NDVI fallback/cross-check | ORNL REST (CORS-open) |
| `wfp-slv`, `wfp-nic`, `wfp-gtm` | local + regional staple/protein/veg prices | HDX CKAN → CSV |
| `pink-sheet` | fertilizer, feed, intl benchmarks (monthly xlsx) | WB (scraped URL) |
| `imf-pcps` | cross-check | IMF xlsx |
| `faostat-pp` | honey, regional annual producer prices | bulk zip |
| `faostat-sdg` | storage curated stat (CA loss %) | bulk zip |
| `comtrade` | tilapia + import parity (HS 3102/3808/0409/030461/030271) | preview API, 1 req/s throttle |
| `bls-ppi` | crop-protection proxy | BLS v1 |
| `wb-cpi` | El Salvador CPI for inflation adjustment of missing years (§5.1) | WB indicators API `FP.CPI.TOTL` (verified live through **2025**, keyless) |
| `oirsa` | regional pest news | WP REST/RSS |
| `inaturalist` | pest sightings | REST |
| `gdelt` | global news EN+ES | DOC 2.0, ≥10 s spacing |
| `rss-mag`, `rss-presidencia`, `rss-colatino`, `rss-fao` | local + institutional news | RSS |
| `frankfurter` | FX contingency | REST |

---

## 4. API contract

All responses share an envelope:

```json
{
  "data": { },
  "meta": {
    "fetchedAt": "2026-09-16T12:00:00Z",
    "source": "WFP VAM via HDX",
    "attribution": "Source: WFP VAM via HDX (CC BY-IGO)",
    "stale": false,
    "coverage": "San Salvador wholesale, Jan 2026–Aug 2026; gap 2023–2025",
    "estimation": "2023–2025 values are inflation-adjusted estimates (base: 2022 actual, WB CPI)",
    "caveats": [
      { "code": "ESTIMATED_CPI", "params": { "years": "2023–2025", "baseYear": 2022 } },
      { "code": "SINGLE_MARKET", "params": { "market": "San Salvador" } }
    ]
  }
}
```

**Caveat codes** (structured, rendered client-side via i18n — never raw server prose): `REGIONAL_DATA` (country), `ESTIMATED_CPI` (years, baseYear), `GAP_YEARS` (range), `ANNUAL_ONLY` (lastYear), `SINGLE_MARKET` (market), `COMMUNITY_DATA`, `CURATED_STAT` (asOf), `PROXY_INDEX` (index name), `STALE_CACHE` (age). Every impacted screen MUST render its active caveats visibly (§8) — this is a user requirement, not a nicety.

| Endpoint | Returns |
|---|---|
| `GET /api/agri/crop-health` | `{departments:[{name, ndvi, baseline, trend, changePct, health}], average, startDate, endDate}` |
| `GET /api/agri/pest-alerts` | `{advisories:[curated], regional:[OIRSA-derived], sightings:[iNaturalist last 90d]}` — UI renders three honest sections |
| `GET /api/agri/market-prices/:category` | Existing chart contract: `{title, unit, data:[{date, value}], trend, latest, benchmarks?, notes}` for the 8 categories (see §6 mapping) |
| `GET /api/agri/news?scope=global\|local&lang=en\|es` | `{items:[{id, title, source, url, publishedAt, snippet?}]}` — top 5 per feed, ≤48 h window |
| `GET /api/agri/health` | Per-adapter `{ok, latestDataDate, ageHours, enabled}` |

Auth: standard gateway JWT (same as other `/api/*`). Rate limit: generous — data is cached.

**Correctness mandate (BMAD red-team finding):** the AI prompt builders on both platforms MUST inject `meta.coverage`, the market type (e.g. "San Salvador wholesale"), and per-series source labels into the prediction/assistance prompts. Feeding regional-reference data (Nicaraguan eggs, Guatemala City wholesale) into an LLM as if it were the user's local price produces confidently wrong advice — the single most dangerous failure mode of this design. Charts must render the source label **inline next to each series** (not only in a tooltip/note).

---

## 5. Caching & failure semantics (never-fail)

**TTL / prefetch cadence per source:** news 1 h · GDELT/OIRSA/iNaturalist 24 h · WFP CSVs 24 h · Pink Sheet/IMF/BLS 24 h · FAOSTAT bulks weekly check (annual data) · Comtrade 24 h attempt (annual data) · HDX NDVI 24 h.

**Serving order (every request):** Redis (if fresh) → if stale, serve Arango last-known-good (`stale:true`) and nudge the scheduler → bundled seed (`stale:true, seeded:true`). Upstream fetches happen ONLY in the prefetch scheduler, never on the request path — user requests are always cache/DB reads, immune to upstream outages and rate limits.

**Scheduler discipline (BMAD red-team findings):**
- **Single-flight with distributed lock:** the scheduler runs per-adapter under a Redis lock so swarm replicas cannot double-fetch (a duplicate GDELT caller would trip its sticky limiter and get the deployment's IP throttled).
- **Startup seed import:** on boot, the backend idempotently imports the bundled `agri-seeds` into Arango — otherwise a fresh deployment serves empty responses until the first prefetch completes.
- **XML/RSS hardening:** parsers disable external entity resolution and cap payload sizes (5 MB) — feeds are third-party content.
- **Client cache hygiene:** localStorage/SharedPreferences keys are schema-versioned; store only the last response per endpoint (size budget < 500 KB total); TTL-clean on read.

**Failure matrix:** upstream slow → scheduler timeout (30 s) + retry/backoff, users unaffected · upstream down for days → `stale:true` + freshness chip · backend restarted → Redis rehydrates from Arango · cold install, first request ever → bundled seed · regional-reference/annual categories → `coverage` + `notes` fields drive UI disclosure labels.

**Client LKG:** Vue caches each response in localStorage keyed by endpoint (stale-while-revalidate: render cache, refresh in background); Flutter in SharedPreferences. Charts show a freshness chip: "Updated 2 h ago" / "Saved data — 6 d old" / "Bundled snapshot (Sep 2026)".

**Bundled seeds:** CI job exports the current Arango snapshot per endpoint to `agri-seeds/*.json`; committed monthly by the scheduled pipeline; shipped in both app builds. Ultimate floor — even first launch offline shows real data, never mocks.

### 5.1 Estimation engine — inflation-adjusted missing years (user requirement)

Where a price series has missing years (FAOSTAT producer prices end 2022; WFP SLV has a 2023–25 hole), the backend fills them with **CPI-adjusted estimates** from the `wb-cpi` adapter (El Salvador CPI, WB `FP.CPI.TOTL`, verified through 2025):

- **Trailing gaps** (e.g. honey: actual to 2022): `est(Y) = lastActual × CPI(Y) / CPI(baseYear)` for each missing year. For the current year where CPI is not yet published, apply the last known YoY rate and flag `partial`.
- **Interior gaps** (WFP 2023–25): same CPI chain from the last pre-gap actual; when actuals resume, actuals override. If the CPI-scaled estimate at the resume point deviates > 15 % from the resumed actual, the gap is instead bridged actual-to-actual along the CPI path (blend), and the deviation is noted in `meta.estimation`.
- **Series items are quality-tagged:** `{date, value, quality: "actual" | "estimated", estMethod: "cpi", baseYear}`. Charts render estimated segments as a **dashed line with a legend entry**; the AI prompt builders append `meta.estimation` verbatim so the LLM never presents an estimate as a market observation.
- CPI is annual — monthly series use the year's CPI ratio (disclosed); no attempt to invent monthly inflation.

---

## 6. Market price category mapping (new)

**Degradation order:** each category defines an ordered source preference; if the primary source is disabled/unhealthy, the next fills in (never a silent hole): e.g. vegetables → `wfp-nic` → `wfp-gtm` → `faostat-pp` → bundled seed.

**Normalization rules (red-team findings):**
- Use the WFP CSV **`usdprice` column** explicitly (NIC/GT files also carry local-currency `price`); convert everything to **USD/kg**, rendering in USD/quintal (45.97 kg) where the dialog expects it — the 45 KG→46 KG drift must not create step artifacts.
- **Trend:** minimum 3 observations in the window; monthly series use a 3-point slope, annual series last-vs-previous — never a 2-point trend on gapped data.
- **Honey:** FAOSTAT producer prices (to 2022) and Comtrade export unit values (2025) are different semantics — render as two labeled segments, never spliced into one line.

| Button | Sources (adapter) | Display |
|---|---|---|
| Maize & Basic Grains | `wfp-slv` maize (+ 2023–25 gap annotation) + `pink-sheet` intl benchmark line + `wfp-gtm` La Terminal regional line | local USD/quintal monthly |
| Fruits & Vegetables | `wfp-nic` (veg, national avg) + `wfp-gtm` (La Terminal wholesale) + `faostat-pp` HN annual | **country-labeled regional reference** |
| Poultry & Pigs | `wfp-nic` (eggs/chicken/pork) + `pink-sheet` (chicken/beef/feed) + `faostat-pp` HN | regional + intl |
| Fertilizer & Soil | `pink-sheet` (urea/DAP/TSP/MOP monthly) + `comtrade` HS3102 SV import parity | intl monthly + local annual |
| Diagnose Pest & Disease (crop protection) | `bls-ppi` + `comtrade` HS3808 | proxy + local annual |
| Apiary & Honey | `faostat-pp` (1991–2022) + `comtrade` HS0409 (2025) | blend, as-of labels |
| Tilapia & Aquaculture | `comtrade` (HN $7.65/kg fillets, CR $7.36/kg, 2024) + `pink-sheet` fish meal feed-cost context | annual regional reference |
| Harvest & Storage | `faostat-sdg` (CA 16.5% loss, 2023) | curated stat *(open decision §10)* |

---

## 7. News picker (confirmed decisions)

- Scope: Market Prices prediction dialog only. UX: collapsible "Add from recent news" under each textarea; checkbox list; "insert selected" appends `[Title — Source, date]` (+ snippet when available) lines to the field.
- Feeds: global = GDELT (EN + `sourcelang:spa` ES); local = MAG + Presidencia + CoLatino (ES). FAO RSS joins global scope. **Google News RSS dropped** — official feeds make the ToS gray zone unnecessary.
- Window ≤48 h, top 5 per feed, 1 h cache; picker language follows app locale (ES default for SV deployment). **Quiet-feed fallback:** if a feed yields < 3 items within 48 h, widen to ≤ 7 d and show item dates (agriculture news is not hourly — an empty picker reads as broken).

---

## 8. Client changes

**Vue:** new `services/agriApiService.js` (GET via httpService, LKG localStorage, envelope unwrap) → chart components load from it; add freshness chip + picker to `MarketPriceChart.vue`; three-section render in `PestAlertChart.vue`; relabel "Alerts"→advisories+regional+sightings.
**Flutter:** new `services/agri_api_service.dart`; same changes to `market_price_chart.dart`, `pest_alert_chart.dart` (+ map card fed by sightings coordinates); SharedPreferences LKG.

**On-screen caveat documentation (user requirement — every impacted screen):** wherever placeholder estimates or regional data are used, the screen shows it clearly, not buried in tooltips:
- Market-price charts: caveat banner row directly under the chart title, active codes rendered as DsPill chips (e.g. "Regional data: Nicaragua", "2023–25 estimated (inflation-adjusted)") + a collapsible **"About this data"** panel listing per-series source + country, estimation method + base year, last actual date, unit, and attribution link.
- Estimated series segments render dashed with a legend entry.
- Pest dialog: per-section subtitles ("Regional official news — OIRSA", "Community sightings — iNaturalist (unverified)").
- Crop health: source + dekad date chip.
- Freshness chip (§5) on every screen; caveat strings via i18n (`charts.caveats.*`), ES + EN at minimum.
- AI prompts inject the same caveat text (§4 mandate) — what the user sees is what the model sees.

**Delete (deprecation §11):** all five old services on both platforms + their tests, and with them ALL World Bank indicator calls (decision: full removal — no WB production-index context lines).

---

## 9. Implementation — three staged MRs (interview decision 2026-09-17)

| MR | Content | Effort |
|---|---|---|
| **MR1 — backend** | agri module skeleton, adapter registry, envelope, Redis/Arango serving layer + startup seed import, single-flight scheduler, estimation engine (§5.1), ALL 17 adapters + fixtures, `/api/agri/*` routes incl. `/health`, OTel spans, seed-export job; curl-verifiable on the test stack | 8–10 d |
| **MR2 — clients** | Vue + Flutter `agriApiService`, LKG caches, freshness chips, on-screen caveat system (§8), chart migration, pest three-section UI | 5–6 d |
| **MR3 — news picker + cleanup** | News picker on both platforms, deprecation deletion (§11), Playwright E2E (dialogs, picker, stale-mode, caveats), config-validator entries, cold-start smoke test | 3–4 d |

Each MR is reviewed and merged to `release/el-salvador` before the next begins. `AGRI_API_ENABLED` flag lets old and new paths coexist on the test stack until MR3 deletes the old code.

## 10. Resolved decisions (user interview, 2026-09-17)

| Decision | Resolution |
|---|---|
| Harvest & Storage button | **Keep as curated stat** (CA loss 16.5 %, FAO 2023) |
| Tilapia button | **Keep as annual regional reference** (HN/CR export UVs) |
| Google News RSS | **Dropped** — MAG + Presidencia + CoLatino official feeds |
| Price display unit | **USD per quintal** (render; canonical storage USD/kg) |
| Pest button name | **Keep "Pest Alerts"** — honest three-section dialog inside |
| World Bank indicator data | **Full removal** — no production-index context lines |
| Delivery | **Three staged MRs** (MR1 backend → MR2 clients → MR3 news+cleanup) |
| FAOSTAT contact email | **Skipped** — instead: inflation-adjust missing years (§5.1) via WB CPI |
| Missing-year values | **Inflation-adjusted estimates, visibly documented on screen** (§4 caveats, §5.1, §8) |
| Caveats on impacted screens | **Every screen with estimates/regional data shows them clearly** — caveat chips + "About this data" panel; same text feeds the AI prompts |

## 11. Deprecation list (exact files)

- Web: `services/worldBankService.js`, `services/agriculturalService.js`, `services/usdaRssService.js` + tests
- Mobile: `services/world_bank_service.dart`, `services/agricultural_proxy.dart`, `services/usda_rss_service.dart`, `services/hdx_ndvi_service.dart`, `services/google_earth_engine_service.dart` (dead NASA POWER code) + tests

## 12. Risks & mitigations

| Risk | Mitigation |
|---|---|
| HDX UUID churn (already bit us once) | CKAN `package_show` resolution in adapter; health check alerts on resolution failure |
| Pink Sheet monthly URL change | landing-page scrape + pin last-known-good URL as fallback |
| GDELT sticky rate limiter (worse than documented) | ≥10 s spacing, backoff, 1 h cache — only the scheduler ever calls it |
| Comtrade 429s | 1 req/s throttle queue + retry; annual data means one daily attempt suffices |
| WFP SLV 2023–25 hole / SS-only | enforced annotation in `coverage`; regional GT/NIC lines fill context |
| Comtrade SV import unit values implausibly low | prefer exporter declarations (HN/CR) for tilapia; disclose method |
| iNaturalist sparsity | labeled "community sightings", never severity claims |
| OIRSA feed structure change | adapter fixture contract test + RSS fallback endpoint |
| FAOSTAT bulk retirement | weekly health check; sources are supplements not primaries; watch via FAO contact |
| WFP SLV dataset dies like Honduras' did (silent stop) | staleness alert at 45 days; staples degrade to GT La Terminal / NIC regional lines via degradation order |
| Comtrade preview API tightened (undocumented public endpoint) | adapter droppable via registry; categories degrade to next source; quarterly watch item |
| Regional data mistaken for local prices | §4 correctness mandate: coverage + market type + inline source labels in prompts and charts |
| Freshness confusion for users | every response carries `meta.coverage`; UI chip vocabulary defined once, reused |

## 13. Testing strategy

- **Adapter contract tests** (fixture replay per adapter) — parser regressions caught in CI
- **Route contract tests** (supertest `createApp()`) — envelope shape, category mapping
- **Failure injection** (nock): upstream 404/429/timeout → assert stale-serve + `meta.stale`, never 5xx
- **Scheduler tests**: cadence, throttle queue, backoff
- **config-validator**: new `AGRI_*` env vars covered
- **Playwright E2E**: dialogs render from `/api/agri/*`, picker inserts items, stale-mode chip appears when backend simulates outage
- **Flutter tests**: service LKG + picker widget tests
- **Load**: burst 50 concurrent dialog opens → all cache hits, zero upstream calls
