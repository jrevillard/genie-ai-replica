# Agri Data Service — Pluggable Source Harness

Backend service behind `/api/agri/*` feeding the Insights (Crop Health,
Pest Alerts) and Market Prices dialogs of the El Salvador GENIE.AI
deployment, plus the news headline picker on the prediction dialogs.

Design docs live in [`docs/agri-external-data-apis/`](../../../../../docs/agri-external-data-apis/)
(research findings, availability matrix, remediation plan, BMAD verification).
Agent-facing conventions: [`CLAUDE.md`](CLAUDE.md) (linked from
[`AGENTS.md`](AGENTS.md)).

## What it guarantees

- **Never-fail:** requests are served from Redis → ArangoDB `agri_cache`
  (last-known-good) → bundled seeds. Only the scheduler ever contacts
  upstream APIs; an upstream outage degrades to stale data with a visible
  freshness flag, never an error screen.
- **Pluggable:** every external source is a self-contained adapter. Sources
  move/get replaced by editing one file or an env var — verified necessity:
  the WFP HDX resource UUID churned (breaking the old mobile app), the Pink
  Sheet URL hash changes monthly, and FAOSTAT's API died outright during
  the 2026-09-16 research.
- **Honest data:** regional references, proxies, and inflation-adjusted
  estimates are quality-tagged in the data and surfaced as structured
  caveat codes the UI renders visibly and the AI prompts inject verbatim.

## Architecture

```
routes/agri-routes.js            HTTP (crop-health, pest-alerts,
                                 market-prices/:category, news, health)
services/agri/
├── agri-service.js              Public service: endpoint builders,
│                                category mapping, serving semantics
├── cache.js                     Redis → Arango agri_cache → seeds
├── scheduler.js                 Single-flight prefetch (distributed locks)
├── registry.js                  Auto-discovers adapters/
├── config.js                    AGRI_* env resolution, enabled-sources
├── http.js                      Fetch w/ timeout, retry, 5 MB payload cap
├── csv.js / zip.js              Dependency-free parsers
├── resolvers.js                 Volatile-URL resolution (CKAN, page scrape)
├── estimation.js                CPI inflation-adjustment engine
├── series.js                    USD/kg normalization, trends, quintal
├── envelope.js                  Response contract + caveat codes
├── adapters/                    ONE FILE PER SOURCE (the harness)
└── seeds/                       Bundled floor: real captured data,
                                  curated pest advisories, CI export merge
scripts/export-agri-seeds.js     CI job: regenerate seeds from live cache
```

## Configured data sources (adapters/)

Verified live 2026-09-16/17 — see the research dossier for evidence and
the availability matrix for per-category assignment.

| Adapter file         | Upstream                                                                | Serves                                                                        | Cadence | Notes                                                                                          |
| -------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------- |
| `wfp-slv.js`         | `data.humdata.org` → WFP VAM food prices CSV (official MAG/SIMMAG data) | Local maize/beans/rice/sorghum/wheat-flour, USD                               | 24 h    | URL resolved via CKAN `package_show` (UUID-churn safe); 2023–25 hole disclosed + CPI-estimated |
| `wfp-nic.js`         | WFP VAM Nicaragua CSV                                                   | Regional protein/vegetable reference (eggs, chicken, pork, tomatoes, onions…) | 24 h    | Country-labeled; the only current monthly protein/veg source in the region                     |
| `wfp-gtm.js`         | WFP VAM Guatemala CSV                                                   | Regional staple/vegetable reference (La Terminal wholesale)                   | 24 h    | Protein items dead upstream — filtered to staples + veg                                        |
| `hdx-ndvi.js`        | WFP subnational NDVI CSV (NASA MODIS)                                   | Crop health: dekadal NDVI, all 14 departments                                 | 24 h    | SV11 sliver dedupe by `n_pixels`; 24-yr baseline file available                                |
| `ornl-modis.js`      | `modis.ornl.gov/rst/api/v1` MOD13Q1                                     | NDVI fallback/cross-check                                                     | 24 h    | Point-median per department centroid; CORS-open; no auth                                       |
| `wb-cpi.js`          | WB indicators API `FP.CPI.TOTL` (SLV)                                   | CPI for the estimation engine                                                 | 1 wk    | Verified through 2025; keyless                                                                 |
| `bls-ppi.js`         | `api.bls.gov` PCU325320325320                                           | Crop-protection cost proxy                                                    | 24 h    | Monthly, current; CORS-open; no key (25 q/day)                                                 |
| `comtrade.js`        | `comtradeapi.un.org/public/v1/preview`                                  | Urea/pesticide import parity (SV), honey export UV, tilapia HN/CR export UVs  | 24 h    | ~1 req/s throttle enforced; annual data                                                        |
| `pink-sheet.js`      | WB CMO monthly xlsx (URL scraped from landing page)                     | Fertilizer (urea/DAP/TSP/MOP), feed inputs, intl benchmarks                   | 24 h    | Hash changes monthly — resolver + last-known-good fallback                                     |
| `imf-pcps.js`        | IMF PCPS xlsx                                                           | Fertilizer/poultry cross-check                                                | 24 h    | Watch NOLA $/short-ton vs $/mt units                                                           |
| `faostat-pp.js`      | `bulks-faostat.fao.org` producer-prices zip                             | SV vegetables/poultry/eggs annuals (to 2022) + Honduras anchors (2024), honey | 1 wk    | FAOSTAT API is dead — bulk zips only; CPI estimation fills the gap years                       |
| `faostat-sdg.js`     | FAOSTAT SDG bulk zip                                                    | Harvest & Storage curated stat (CA loss 16.5 %, 2023)                         | 1 wk    | Regional aggregates only — no country rows exist                                               |
| `oirsa.js`           | `web.oirsa.org/wp-json` + RSS                                           | Regional plant-health news (ES)                                               | 24 h    | Keyword lexicon; severity honestly `info`                                                      |
| `inaturalist.js`     | `api.inaturalist.org/v1` (place 7563)                                   | Community pest sightings (90 d)                                               | 24 h    | Sparse by nature — always labeled "community"                                                  |
| `gdelt.js`           | `api.gdeltproject.org` DOC 2.0                                          | Global ag news EN + ES                                                        | 1 h     | Sticky limiter — ≥10 s spacing enforced in-adapter                                             |
| `rss-mag.js`         | `mag.gob.sv/feed`                                                       | Local news (official, ES)                                                     | 1 h     | ToS-clean replacement for Google News RSS                                                      |
| `rss-presidencia.js` | `presidencia.gob.sv/feed`                                               | Local news (official, ES)                                                     | 1 h     |                                                                                                |
| `rss-colatino.js`    | `diariocolatino.com/feed`                                               | Local news (outlet, ES, real snippets)                                        | 1 h     | Only Salvadoran outlet with a direct feed                                                      |
| `rss-fao.js`         | `fao.org/feeds/fao-newsroom-rss`                                        | Institutional ag news                                                         | 1 h     |                                                                                                |
| `frankfurter.js`     | `api.frankfurter.dev`                                                   | FX contingency                                                                | 24 h    | All price sources are USD; SLV is dollarized                                                   |

Factories shared by families: `_wfp-factory.js` (CSV schema),
`_rss-factory.js` (hardened RSS 2.0 parsing). Files starting with `_` are
not registered as adapters.

## Data flow contract

Every response is an envelope:

```json
{
  "data": {},
  "meta": {
    "fetchedAt": "…",
    "source": "…",
    "attribution": "…",
    "coverage": "San Salvador wholesale; gap 2023–2025",
    "estimation": "2023–2025 values are inflation-adjusted estimates …",
    "stale": false,
    "seeded": false,
    "caveats": [{ "code": "ESTIMATED_CPI", "params": { "years": "2023–2025", "baseYear": 2022 } }],
    "nextRefresh": "…"
  }
}
```

Caveat codes (rendered by clients via i18n — `REGIONAL_DATA`,
`ESTIMATED_CPI`, `GAP_YEARS`, `ANNUAL_ONLY`, `SINGLE_MARKET`,
`COMMUNITY_DATA`, `CURATED_STAT`, `PROXY_INDEX`, `STALE_CACHE`) are the
same text users see and the AI prompts inject.

Series points are quality-tagged: `{date, value, quality: "actual" |
"estimated", estMethod?, baseYear?, partial?}` — estimated segments render
dashed in the clients.

## Environment variables (`env` Section 15)

| Var                      | Purpose                                                                            |
| ------------------------ | ---------------------------------------------------------------------------------- |
| `AGRI_SOURCES_ENABLED`   | Comma list of adapter ids; unset = all                                             |
| `AGRI_REDIS_URL`         | Hot cache + scheduler locks (falls back to `REDIS_URL`; unset = Arango+seeds only) |
| `AGRI_PREFETCH_ON_START` | `0` disables the startup prefetch (test stacks)                                    |
| `AGRI_<PREFIX>_<KEY>`    | Per-adapter override of any `defaults` key (e.g. `AGRI_WFP_SLV_FALLBACKURL`)       |

## Operations

- **Health:** `GET /api/agri/health` → per-adapter `{ok, ranAt, ageHours,
latestDataDate, error}`. Alert when `latestDataDate` exceeds the source-type
  threshold (monthly > 45 d, news > 6 h, NDVI > 10 dekads, annual > 15 mo).
- **Seed refresh:** after a healthy prefetch cycle run
  `node scripts/export-agri-seeds.js > services/agri/seeds/generated.json`
  and commit — scheduled monthly by CI.
- **Collections:** `agri_series`, `agri_ndvi`, `agri_alerts`, `agri_news`,
  `agri_cache`, `agri_fetch_log` (auto-created at startup).

## Tests

```bash
cd components/gov-chat-backend
node node_modules/jest/bin/jest.js __tests__/services/agri __tests__/routes/agri-routes.test.js
```

Adapter fixtures replicate the real upstream schemas captured during
verification — a parser regression fails CI before it ships.
