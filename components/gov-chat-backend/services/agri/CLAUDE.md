# CLAUDE.md — agri data service (agent instructions)

Guidance for AI agents (Claude Code and others — see [AGENTS.md](AGENTS.md))
working on the pluggable agricultural data harness. Human-oriented overview:
[README.md](README.md). Full design: `docs/agri-external-data-apis/`.

## Non-negotiables

1. **Never add an upstream HTTP call to the request path.** Only
   `scheduler.js` fetches. Route handlers and builders read local
   Arango/Redis/seeds only. A user request must survive any upstream outage.
2. **Never hardcode a volatile upstream URL.** Use a resolver
   (`resolvers.js`) or env override. Verified history: HDX UUID churn broke
   the old mobile app; the Pink Sheet hash rotates monthly; FAOSTAT's API
   died outright.
3. **Never ship silent proxies.** Anything that is regional, annual, a
   proxy index, or an estimate MUST carry the matching caveat code and, for
   estimates, quality-tagged points. The AI prompt builders inject
   `meta.coverage` + caveats verbatim — what the user sees is what the
   model sees.
4. **0-doc normalize is a failure.** The scheduler treats an empty parse as
   a schema change (health goes red), not success. Keep it that way.

## Adding a source

1. Create `services/agri/adapters/<id>.js` implementing:
   `{id, configPrefix, cadence ('1h'|'24h'|'1w'), defaults, endpoints,
     async resolve(cfg), async fetch(resolved, cfg), parse(raw),
     normalize(parsed) -> {collection, docs}}`
2. Docs need deterministic `_key` (sha1 of a logical key via
   `node:crypto`) and go to `agri_series` (prices/indexes),
   `agri_ndvi`, `agri_alerts` (pest) or `agri_news`.
3. Use `http.js` (`fetchUrl`/`fetchJson`) — never axios directly; it
   enforces timeouts, retries, and the 5 MB cap.
4. Add a fixture test in `__tests__/services/agri/` using the REAL
   upstream schema (capture a trimmed sample once).
5. Wire it into the relevant `MARKET_CATEGORIES` seriesDefs
   (`agri-service.js`) or endpoint builder — ordered arrays are the
   degradation order.
6. Optional env overrides: prefix keys with the adapter's `configPrefix`.

No registry edits needed — `registry.js` auto-discovers non-`_` files.

## Fixing a broken source

- **Endpoint moved:** update the resolver or the `fallbackUrl` default; if
  a landing page/CKAN lookup can find it, put THAT in the resolver.
- **Schema changed:** fix `parse`/`normalize`, update the fixture, run tests.
- **Temporarily dead:** `AGRI_SOURCES_ENABLED=<ids minus broken one>` in
  the deployment `.env` — no code change. The category degrades down its
  `seriesDefs` order to the next source or the seed.

## Estimation engine rules (§5.1 of the plan)

`estimation.js` fills missing years with CPI-adjusted estimates:
trailing gaps chain from the last actual; interior gaps chain and let
actuals override; if the CPI estimate at the resume point deviates > 15 %
from the resumed actual, bridge actual-to-actual shaped by CPI; the
current year without published CPI is flagged `partial`. Estimates get
`quality: 'estimated'` + `estMethod: 'cpi'` — clients render them dashed.
Do NOT splice different-semantics series into one line (e.g. FAOSTAT
producer prices vs Comtrade export unit values = two labeled segments).

## Verification & commands

```bash
# tests (Windows local — node_modules must exist: npm ci first)
node node_modules/jest/bin/jest.js __tests__/services/agri __tests__/routes/agri-routes.test.js

# lint/format — use rtk proxy for true CI-equivalent output
rtk proxy npx eslint services/agri/ __tests__/services/agri/
rtk proxy npx prettier --check services/agri/ __tests__/services/agri/

# regenerate bundled seeds (after a green /api/agri/health)
node scripts/export-agri-seeds.js > services/agri/seeds/generated.json
```

## Known gotchas

- `crypto` and `URL` are built-in globals in this eslint config — alias
  requires as `const nodeCrypto = require('node:crypto')` / rename URL consts.
- WFP CSVs: use the `usdprice` column (not local-currency `price`); unit
  drift 45 KG ↔ 46 KG is normalized to USD/kg by `series.js`.
- FAOSTAT CSVs are fully quoted — strip `"` from cells before
  parseInt/parseFloat/indexOf (this bit us twice).
- GDELT rate-limits stickily beyond its documented 5 s — the adapter
  enforces ≥10 s spacing; never fetch it outside the scheduler.
- Comtrade preview: ~1 req/s with 429 retries; monthly variants return 0
  rows for our HS codes — annual only.
- The router in `routes/agri-routes.js` must be created INSIDE the
  factory function (per-mount binding) — a module-level router silently
  binds the first service instance (found by a test, 2026-09-17).

## Source verification register

Every adapter's header documents the last live-verified date and the
evidence. When you re-verify or a source changes, update the adapter
header comment AND `docs/agri-external-data-apis/data-availability-matrix.md`.
