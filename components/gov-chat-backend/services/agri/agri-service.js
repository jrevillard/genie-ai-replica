/**
 * AgriService — public service behind /api/agri/* (remediation-plan.md §4-§7).
 *
 * Responsibilities:
 * - init: collections, optional Redis, serving cache, scheduler, seed import
 * - endpoint builders: crop-health, pest-alerts, market-prices:<category>,
 *   news:<scope>:<lang> — assembled ONLY from local Arango data (requests
 *   never touch upstreams), with degradation order + CPI estimation + caveats
 * - serving semantics: Redis → Arango LKG (stale flag) → bundled seed
 * - health: per-adapter last-success reporting
 */
const { logger } = require('../../shared-lib');
const { ServingCache } = require('./cache');
const { AgriScheduler } = require('./scheduler');
const { enabledAdapters } = require('./registry');
const { cadenceMs } = require('./config');
const { buildEnvelope, caveat } = require('./envelope');
const { fillMissingYears } = require('./estimation');
const { computeTrend, usdPerKgToQuintal } = require('./series');
const seeds = require('./seeds/index');
const { activeAdvisories } = require('./seeds/pest-advisories');
const { isRelevantNews } = require('./newsfilter');

const COLLECTIONS = ['agri_series', 'agri_ndvi', 'agri_alerts', 'agri_news', 'agri_cache', 'agri_fetch_log'];

const QUINTAL = 'USD/quintal (46 kg)';
const KG = 'USD/kg';

/**
 * Market-price category definitions (remediation-plan.md §6).
 * `seriesDefs` are ordered — the first source with data wins per slot;
 * a slot with no data degrades to the next entry or drops with a caveat.
 */
const MARKET_CATEGORIES = {
  maize: {
    title: 'Maize & Basic Grains',
    seriesDefs: [
      {
        type: 'wfp',
        adapter: 'wfp-slv',
        country: 'El Salvador',
        commodity: 'Maize (white)',
        pricetype: 'wholesale',
        name: 'Maize (white), San Salvador wholesale',
        unit: QUINTAL
      },
      {
        type: 'wfp',
        adapter: 'wfp-gtm',
        country: 'Guatemala',
        commodity: 'Maize (white)',
        pricetype: 'wholesale',
        name: 'Maize (white), Guatemala City (La Terminal) [regional]',
        unit: QUINTAL,
        regional: true
      },
      { type: 'wb', key: 'WB:MAIZE_INTL', name: 'Maize (US #2, US Gulf intl benchmark)', unit: 'USD/mt' }
    ],
    estimate: true
  },
  cropProtection: {
    title: 'Crop Protection Costs',
    seriesDefs: [
      {
        type: 'index',
        key: 'BLS:PPI:PESTICIDE',
        name: 'PPI pesticide & ag-chemical manufacturing',
        unit: 'PPI index',
        proxy: true
      },
      {
        type: 'trade',
        key: 'COMTRADE:pesticide-import-parity',
        name: 'Pesticide import parity (El Salvador CIF)',
        unit: 'USD/kg',
        annual: true
      }
    ]
  },
  vegetables: {
    title: 'Fruits & Vegetables',
    seriesDefs: [
      // Commodities verified against the WFP VAM feeds actually publishing
      // for these markets (NIC has NO tomatoes/onions; GT La Terminal has
      // no tomatoes at all) — matched to the real GT wholesale list.
      {
        type: 'wfp',
        adapter: 'wfp-gtm',
        country: 'Guatemala',
        commodity: 'Cabbage',
        pricetype: 'wholesale',
        name: 'Cabbage, Guatemala La Terminal wholesale [regional]',
        unit: QUINTAL,
        regional: true
      },
      {
        type: 'wfp',
        adapter: 'wfp-gtm',
        country: 'Guatemala',
        commodity: 'Carrots',
        pricetype: 'wholesale',
        name: 'Carrots, Guatemala La Terminal wholesale [regional]',
        unit: QUINTAL,
        regional: true
      },
      {
        type: 'wfp',
        adapter: 'wfp-gtm',
        country: 'Guatemala',
        commodity: 'Watermelons',
        pricetype: 'wholesale',
        name: 'Watermelons, Guatemala La Terminal wholesale [regional]',
        unit: QUINTAL,
        regional: true
      },
      {
        type: 'faostat',
        key: 'FAOSTAT:PP:El Salvador:Tomatoes',
        name: 'Tomatoes producer price (El Salvador)',
        unit: KG,
        annual: true
      },
      {
        type: 'faostat',
        key: 'FAOSTAT:PP:Honduras:Tomatoes',
        name: 'Tomatoes producer price (Honduras) [regional]',
        unit: KG,
        annual: true,
        regional: true
      }
    ],
    estimate: true
  },
  livestock: {
    title: 'Poultry & Pigs',
    seriesDefs: [
      {
        type: 'wfp',
        adapter: 'wfp-nic',
        country: 'Nicaragua',
        commodity: 'Chicken (poultry)',
        pricetype: 'retail',
        name: 'Chicken, Nicaragua national average [regional]',
        unit: 'USD/lb',
        regional: true
      },
      {
        type: 'wfp',
        adapter: 'wfp-nic',
        country: 'Nicaragua',
        commodity: 'Pork',
        pricetype: 'retail',
        name: 'Pork, Nicaragua national average [regional]',
        unit: 'USD/lb',
        regional: true
      },
      {
        type: 'wfp',
        adapter: 'wfp-nic',
        country: 'Nicaragua',
        commodity: 'Eggs',
        pricetype: 'retail',
        name: 'Eggs, Nicaragua national average [regional]',
        unit: 'USD/dozen',
        regional: true
      },
      { type: 'wb', key: 'WB:CHICKEN_INTL', name: 'Chicken (Brazil wholesale, intl benchmark)', unit: 'USD/kg' },
      { type: 'wb', key: 'WB:BEEF_INTL', name: 'Beef (intl benchmark)', unit: 'USD/kg' }
    ],
    estimate: true
  },
  fertilizer: {
    title: 'Fertilizer & Soil',
    seriesDefs: [
      { type: 'wb', key: 'WB:UREA', name: 'Urea (Middle East f.o.b.)', unit: 'USD/mt' },
      { type: 'wb', key: 'WB:DAP', name: 'DAP (US Gulf spot)', unit: 'USD/mt' },
      { type: 'wb', key: 'WB:TSP', name: 'TSP (US Gulf)', unit: 'USD/mt' },
      { type: 'wb', key: 'WB:MOP', name: 'MOP (Brazil CFR granular)', unit: 'USD/mt' },
      {
        type: 'trade',
        key: 'COMTRADE:urea-import-parity',
        name: 'Urea import parity (El Salvador CIF)',
        unit: 'USD/mt',
        annual: true
      }
    ],
    estimate: true
  },
  apiary: {
    title: 'Apiary & Honey',
    seriesDefs: [
      {
        type: 'faostat',
        key: 'FAOSTAT:PP:El Salvador:Natural honey',
        name: 'Honey producer price (El Salvador)',
        unit: KG,
        annual: true
      },
      {
        type: 'trade',
        key: 'COMTRADE:honey-export-uv',
        name: 'Honey export unit value (El Salvador)',
        unit: KG,
        annual: true
      }
    ],
    estimate: true
  },
  aquaculture: {
    title: 'Tilapia & Aquaculture',
    seriesDefs: [
      {
        type: 'trade',
        key: 'COMTRADE:tilapia-fillet-export-uv-hn',
        name: 'Tilapia fillets, Honduras exports (FOB) [regional]',
        unit: KG,
        annual: true,
        regional: true
      },
      {
        type: 'trade',
        key: 'COMTRADE:tilapia-whole-export-uv-cr',
        name: 'Whole tilapia, Costa Rica exports (FOB) [regional]',
        unit: KG,
        annual: true,
        regional: true
      },
      { type: 'wb', key: 'WB:FISHMEAL', name: 'Fish meal feed cost (intl benchmark)', unit: 'USD/mt' }
    ],
    estimate: true
  },
  harvestStorage: {
    title: 'Harvest & Storage',
    seriesDefs: [
      {
        type: 'sdg',
        key: 'FAOSTAT:SDG:Central America',
        name: 'Central America post-harvest food loss (FAO SDG 12.3.1)',
        unit: '% of production',
        annual: true
      }
    ],
    // Fallback when the faostat-sdg adapter has not run yet (interview decision:
    // curated stat — no live feed exists)
    curated: {
      value: 16.5,
      asOf: '2023',
      name: 'Central America post-harvest food loss (FAO SDG 12.3.1)',
      unit: '% of production'
    }
  }
};

/** iNaturalist scientific name -> common name (EN/ES) for sightings display. */
const TAXA_NAMES = {
  'Spodoptera frugiperda': { en: 'Fall Armyworm', es: 'Cogollero' },
  'Hemileia vastatrix': { en: 'Coffee Leaf Rust', es: 'Roya del Café' },
  'Bemisia tabaci': { en: 'Whitefly', es: 'Mosca Blanca' },
  'Phytophthora infestans': { en: 'Late Blight', es: 'Tizón Tardío' },
  'Hypothenemus hampei': { en: 'Coffee Berry Borer', es: 'Broca del Café' }
};

/**
 * Redis URL for the hot cache tier. Explicit AGRI_REDIS_URL/REDIS_URL win;
 * otherwise reuse the stack's existing cache instance — the TRANSLATION_CACHE_*
 * vars point at the shared redis-cache service (password included), so the
 * default engages the top tier on deployments that define no agri-specific URL.
 * @returns {string|null} redis:// URL or null when nothing is configured
 */
function resolveRedisUrl() {
  if (process.env.AGRI_REDIS_URL) return process.env.AGRI_REDIS_URL;
  if (process.env.REDIS_URL) return process.env.REDIS_URL;
  const host = process.env.TRANSLATION_CACHE_HOST;
  if (!host) return null;
  const port = process.env.TRANSLATION_CACHE_PORT || 6379;
  const password = process.env.TRANSLATION_CACHE_PASSWORD
    ? `:${encodeURIComponent(process.env.TRANSLATION_CACHE_PASSWORD)}@`
    : '';
  return `redis://${password}${host}:${port}`;
}

class AgriService {
  constructor() {
    if (AgriService.instance) return AgriService.instance;
    this.initialized = false;
    this.db = null;
    this.redis = null;
    this.cache = null;
    this.scheduler = null;
    this.adapters = [];
    AgriService.instance = this;
    return this;
  }

  static getInstance() {
    if (!AgriService.instance) AgriService.instance = new AgriService();
    return AgriService.instance;
  }

  async init(deps = {}) {
    if (this.initialized) return;
    const { dbService } = require('../../shared-lib');
    // Real shared-lib getConnection() is async (the Jest mock returns
    // synchronously) — without the await this.db was a Promise and every
    // .collection() call failed (found on the 10.0.0.101 deploy)
    this.db = deps.db || null;
    if (!this.db) {
      try {
        this.db = await dbService.getConnection();
      } catch (error) {
        logger.warn(`agri: Arango connection failed (${error.message}) — seed tier only`);
      }
    }

    // Optional Redis — degrade gracefully (never-fail design)
    try {
      const Redis = require('ioredis');
      const url = resolveRedisUrl();
      if (url) {
        this.redis = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1 });
        await this.redis.connect();
        logger.info('agri: redis connected');
      } else {
        logger.info('agri: no Redis URL configured — Arango+seed tiers only');
      }
    } catch (error) {
      logger.warn(`agri: redis unavailable (${error.message}) — continuing without`);
      this.redis = null;
    }

    if (this.db) {
      for (const name of COLLECTIONS) {
        try {
          await this.db.createCollection(name);
        } catch {
          /* already exists */
        }
      }
    }

    this.adapters = enabledAdapters();
    this.cache = new ServingCache({ redis: this.redis, db: this.db, seeds });

    // Idempotent seed import (startup floor for cold deployments)
    for (const [key, envelope] of Object.entries(seeds)) {
      if (!envelope) continue;
      const { origin } = await this.cache.get(key);
      if (origin === null) {
        await this.cache.set(key, { ...envelope, meta: { ...envelope.meta, seeded: true } }, 24 * 3600 * 1000);
      }
    }

    this.scheduler = new AgriScheduler({
      adapters: this.adapters,
      db: this.db,
      redis: this.redis,
      onAdaptersRun: async () => this.rebuildAllEndpoints()
    });

    this.initialized = true;
    logger.info(
      `AgriService initialized (${this.adapters.length} adapters: ${this.adapters.map((a) => a.id).join(', ')})`
    );

    // First prefetch pass in the background (never blocks startup)
    if (process.env.AGRI_PREFETCH_ON_START !== '0') {
      setImmediate(() =>
        this.scheduler.runOnce().catch((e) => logger.error(`agri initial prefetch failed: ${e.message}`))
      );
    }
    const shortest = Math.min(...this.adapters.map((a) => cadenceMs(a)), 3600 * 1000);
    this.scheduler.start(shortest);

    // Envelope rebuilds run on their OWN cadence, independent of fetch
    // outcomes: a pass where only dead adapters are due (0 ok) must not
    // leave new series mappings or recovered data unwritten for a full
    // cadence cycle (found live 2026-09-17: vegetables stayed 'pending'
    // for hours after its mapping fix deployed).
    this.rebuildTimer = setInterval(
      () => {
        this.rebuildAllEndpoints().catch((e) => logger.error(`agri periodic rebuild failed: ${e.message}`));
      },
      15 * 60 * 1000
    );
    this.rebuildTimer.unref();
    // First periodic rebuild shortly after the startup pass begins —
    // rebuilds are cheap local queries and idempotent.
    setTimeout(() => {
      this.rebuildAllEndpoints().catch(() => {});
    }, 90 * 1000).unref();
  }

  // ==================== SERVING ====================

  endpointTtlMs(key) {
    return key.startsWith('news:') ? 3600 * 1000 : 24 * 3600 * 1000;
  }

  /**
   * Serve an endpoint with never-fail semantics (plan §5).
   * @param {string} key
   * @param {Function} builder - async () => envelope (reads local DB only)
   */
  async serve(key, builder) {
    const started = Date.now();
    const ttl = this.endpointTtlMs(key);
    let { envelope, origin } = await this.cache.get(key);

    // A cached empty envelope ('pending' from a failed pass) must not mask
    // a usable seed — the seed floor wins until a real rebuild lands.
    if (this.constructor.isEmptyEnvelope(envelope) && seeds[key]) {
      logger.info(`agri serve ${key}: cached envelope empty — falling back to seed`);
      envelope = seeds[key];
      origin = 'seed';
    }

    if (envelope) {
      const ageHours = (Date.now() - Date.parse(envelope.meta.fetchedAt)) / 3600000;
      const isStale = origin === 'seed' || ageHours * 3600000 > ttl * 2;
      if (isStale) {
        envelope.meta.stale = true;
        envelope.meta.seeded = origin === 'seed';
        envelope.meta.caveats = [...(envelope.meta.caveats || []), caveat.staleCache(Math.round(ageHours))];
      }
      logger.info(
        `agri serve ${key}: origin=${origin} stale=${!!envelope.meta.stale} ` +
          `${envelope.data && envelope.data.departments ? `depts=${envelope.data.departments.length} ` : ''}` +
          `${envelope.data && envelope.data.series ? `series=${envelope.data.series.length} ` : ''}` +
          `(${Date.now() - started}ms)`
      );
      if (origin !== 'redis' && envelope.meta && !envelope.meta.seeded) {
        // Arango LKG served while a refresh is due — nudge the scheduler
        setImmediate(() => this.scheduler && this.scheduler.runOnce().catch(() => {}));
      }
      return envelope;
    }

    try {
      const fresh = await builder();
      await this.cache.set(key, fresh, ttl);
      return fresh;
    } catch (error) {
      logger.error(`agri serve: builder failed for ${key}: ${error.message} | ${error.stack}`);
      return buildEnvelope({}, { source: 'unavailable', stale: true, coverage: 'No data available yet' });
    }
  }

  /** True when an envelope carries no usable payload. */
  static isEmptyEnvelope(envelope) {
    if (!envelope || !envelope.data) return true;
    const d = envelope.data;
    if (Array.isArray(d)) return d.length === 0;
    if (Array.isArray(d.series)) return d.series.length === 0;
    if (Array.isArray(d.departments)) return d.departments.length === 0;
    // pest-alerts shape: advisories/regional/sightings
    if (Array.isArray(d.advisories))
      return d.advisories.length + (d.regional || []).length + (d.sightings || []).length === 0;
    return false;
  }

  /** Rebuild + persist every endpoint (called by scheduler after prefetch). */
  async rebuildAllEndpoints() {
    const keys = ['crop-health', 'pest-alerts', ...Object.keys(MARKET_CATEGORIES).map((c) => `market-prices:${c}`)];
    for (const key of keys) {
      try {
        const builder =
          key === 'crop-health'
            ? () => this.buildCropHealth()
            : key === 'pest-alerts'
              ? () => this.buildPestAlerts()
              : () => this.buildMarketPrices(key.replace('market-prices:', ''));
        const envelope = await builder();
        // Never-fail floor: an empty rebuild ('pending' placeholder) must not
        // overwrite data already cached or seeded — e.g. when a pass fails
        // mid-way. Keep what we have; the next good pass replaces it.
        if (this.constructor.isEmptyEnvelope(envelope)) {
          const { envelope: existing } = await this.cache.get(key);
          if (existing && !this.constructor.isEmptyEnvelope(existing)) {
            logger.warn(`agri rebuild: empty result for ${key} — keeping cached data`);
            continue;
          }
        }
        const detail =
          envelope.data && envelope.data.departments
            ? `${envelope.data.departments.length} depts`
            : envelope.data && envelope.data.series
              ? `${envelope.data.series.length} series`
              : 'empty';
        logger.info(`agri rebuild ${key}: wrote ${detail} (source=${envelope.meta.source})`);
        await this.cache.set(key, envelope, this.endpointTtlMs(key));
      } catch (error) {
        logger.warn(`agri rebuild failed for ${key}: ${error.message} | ${error.stack}`);
      }
    }
  }

  // ==================== DATA ACCESS HELPERS ====================

  async querySeries(aql, binds) {
    const cursor = await this.db.query(aql, binds);
    return cursor.all();
  }

  async cpiByYear() {
    try {
      const rows = await this.querySeries(
        'FOR d IN agri_series FILTER d.key == "WB:CPI:SLV" AND d.year != null SORT d.year RETURN {year: d.year, value: d.value}',
        {}
      );
      return new Map(rows.map((r) => [r.year, r.value]));
    } catch {
      return new Map();
    }
  }

  /**
   * WFP price series for one seriesDef, converted to its display unit,
   * with CPI-estimated points for missing years (plan §5.1).
   */
  async wfpSeries(def, cpi) {
    const rows = await this.querySeries(
      'FOR d IN agri_series FILTER d.key LIKE @prefix AND d.commodity == @commodity ' +
        'AND UPPER(d.pricetype) == UPPER(@pricetype) ' +
        'AND (@market == null OR d.market == @market) SORT d.date RETURN KEEP(d, "date", "usdPerKg", "country", "market")',
      {
        prefix: `${def.country}:%`,
        commodity: def.commodity,
        pricetype: def.pricetype,
        market: def.market || null
      }
    );
    if (rows.length === 0) return null;

    const toDisplay =
      def.unit === QUINTAL
        ? (r) => Math.round(usdPerKgToQuintal(r.usdPerKg) * 100) / 100
        : def.unit === 'USD/lb'
          ? (r) => Math.round(r.usdPerKg * 0.45359237 * 100) / 100
          : (r) => r.usdPerKg;

    const data = rows.map((r) => ({
      date: r.date,
      value: toDisplay(r),
      quality: 'actual'
    }));

    // CPI-estimated fill for years with no actuals (monthly -> one estimated
    // annual point at mid-year, rendered dashed — user requirement)
    if (cpi.size > 0 && def.estimate !== false) {
      const byYear = new Map();
      for (const point of data) byYear.set(Number(point.date.slice(0, 4)), point.value);
      const years = [...byYear.keys()].sort((a, b) => a - b);
      if (years.length > 0) {
        const actuals = years.map((y) => ({ year: y, value: byYear.get(y) }));
        const { series: filled } = fillMissingYears(actuals, cpi, new Date().getFullYear());
        for (const point of filled) {
          if (point.quality === 'estimated') {
            data.push({
              date: `${point.date}-07-01`,
              value: point.value,
              quality: 'estimated',
              estMethod: 'cpi',
              baseYear: point.baseYear
            });
          }
        }
        data.sort((a, b) => a.date.localeCompare(b.date));
      }
    }

    return {
      name: def.name,
      source: 'wfp-vam',
      country: def.country,
      data,
      trend: computeTrend(data, { dense: true })
    };
  }

  /** Annual trade unit-value / index / producer-price series (Comtrade, BLS, FAOSTAT). */
  async annualSeries(keyPrefix, def) {
    const rows = await this.querySeries(
      'FOR d IN agri_series FILTER d.key == @key AND (d.year != null OR d.date != null) ' +
        'SORT d.year, d.date RETURN KEEP(d, "year", "date", "value", "usdPerKg")',
      { key: keyPrefix }
    );
    if (rows.length === 0) return null;

    // Monthly/period-keyed series (e.g. BLS PPI stores date, not year) —
    // emit date points directly; annual CPI estimation does not apply.
    if (!rows.some((r) => r.year != null)) {
      const monthly = rows
        .filter((r) => Number.isFinite(r.value))
        .map((r) => ({ date: r.date, value: r.value, quality: 'actual' }));
      if (monthly.length > 0) {
        return {
          name: def.name,
          source: keyPrefix.startsWith('BLS:') ? 'bls' : 'agri',
          country: def.country || 'El Salvador',
          data: monthly,
          trend: computeTrend(monthly, { dense: true }),
          latest: monthly[monthly.length - 1].value
        };
      }
      return null;
    }

    const actuals = rows
      .filter((r) => r.year != null && Number.isFinite(r.usdPerKg ?? r.value))
      .map((r) => ({ year: r.year, value: r.usdPerKg ?? r.value }));

    const cpi = await this.cpiByYear();
    let data;
    let estimation = null;
    if (cpi.size > 0) {
      const filled = fillMissingYears(actuals, cpi, new Date().getFullYear());
      data = filled.series;
      estimation = filled.estimation;
    } else {
      data = actuals.map((a) => ({ date: String(a.year), value: a.value, quality: 'actual' }));
    }

    const sourceByPrefix = {
      COMTRADE: 'un-comtrade',
      FAOSTAT: keyPrefix.includes(':SDG:') ? 'faostat-sdg' : 'faostat',
      BLS: 'bls'
    };
    const prefix = Object.keys(sourceByPrefix).find((p) => keyPrefix.startsWith(p));

    return {
      name: def.name,
      source: sourceByPrefix[prefix] || 'agri',
      country: def.country || (keyPrefix.includes('Honduras') ? 'Honduras' : 'El Salvador'),
      data,
      trend: computeTrend(data),
      estimation
    };
  }

  /** Monthly international benchmark series (Pink Sheet / IMF keyed docs). */
  async keyedSeries(keyPrefix, def) {
    const rows = await this.querySeries(
      'FOR d IN agri_series FILTER d.key == @key AND d.date != null SORT d.date ' + 'RETURN KEEP(d, "date", "value")',
      { key: keyPrefix }
    );
    if (rows.length === 0) return null;

    const data = rows
      .filter((r) => Number.isFinite(r.value))
      .map((r) => ({ date: r.date, value: r.value, quality: 'actual' }));

    return {
      name: def.name,
      source: keyPrefix.startsWith('WB:') ? 'world-bank-cmo' : 'imf-pcps',
      country: 'World',
      data,
      trend: computeTrend(data, { dense: true })
    };
  }

  // ==================== ENDPOINT BUILDERS ====================

  async buildCropHealth() {
    // Latest NDVI per department, preferring WFP HDX with ORNL fallback
    const rows = await this.querySeries(
      'FOR d IN agri_ndvi COLLECT department = d.department INTO groups = d ' +
        'LET latest = FIRST(FOR g IN groups FILTER g.source == "wfp-hdx" SORT g.date DESC LIMIT 1 RETURN g) ' +
        'LET fallback = FIRST(FOR g IN groups FILTER g.source == "ornl-modis" SORT g.date DESC LIMIT 1 RETURN g) ' +
        'LET chosen = latest != null ? latest : fallback ' +
        'FILTER chosen != null ' +
        'LET baseline = LENGTH(FOR g IN groups FILTER g.source == chosen.source AND g.date != chosen.date ' +
        '  AND RIGHT(g.date, 5) == RIGHT(chosen.date, 5) COLLECT AGGREGATE avgVim = AVG(g.vim) RETURN avgVim) > 0 ' +
        '  ? FIRST(FOR g IN groups FILTER g.source == chosen.source AND g.date != chosen.date ' +
        '  AND RIGHT(g.date, 5) == RIGHT(chosen.date, 5) COLLECT AGGREGATE avgVim = AVG(g.vim) RETURN avgVim) : null ' +
        'RETURN MERGE(KEEP(chosen, "department", "vim", "date", "source"), { baseline })',
      {}
    );

    const departments = rows.map((r) => {
      const changePct = r.baseline ? Math.round(((r.vim - r.baseline) / r.baseline) * 1000) / 10 : 0;
      return {
        name: r.department,
        ndvi: r.vim,
        date: r.date,
        source: r.source,
        baseline: r.baseline,
        changePct,
        trend: changePct > 2 ? 'improving' : changePct < -2 ? 'declining' : 'stable',
        health: r.vim >= 0.65 ? 'good' : r.vim >= 0.5 ? 'moderate' : 'warning'
      };
    });

    const vims = departments.map((d) => d.ndvi);
    const average = vims.length > 0 ? vims.reduce((a, b) => a + b, 0) / vims.length : 0;

    return buildEnvelope(
      { departments, average: { ndvi: Math.round(average * 1000) / 1000, trend: 'stable', changePct: 0 } },
      {
        source: 'WFP VAM via HDX (NASA MODIS)',
        attribution: 'Source: WFP VAM via HDX (CC BY 4.0)',
        coverage:
          departments.length > 0
            ? `Dekadal NDVI through ${departments[0].date}, ${departments.length} departments`
            : 'No NDVI data available'
      }
    );
  }

  async buildPestAlerts() {
    const cutoff = new Date(Date.now() - 90 * 86400000).toISOString();

    const [regional, sightings] = await Promise.all([
      this.querySeries(
        'FOR a IN agri_alerts FILTER a.kind == "regional-news" AND a.publishedAt >= @cutoff ' +
          'SORT a.publishedAt DESC LIMIT 10 RETURN KEEP(a, "title", "publishedAt", "link", "severity", "matchedKeywords", "source")',
        { cutoff }
      ),
      this.querySeries(
        'FOR a IN agri_alerts FILTER a.kind == "sighting" AND a.observedOn >= @cutoff ' +
          'SORT a.observedOn DESC LIMIT 25 RETURN KEEP(a, "scientificName", "observedOn", "placeGuess", "latitude", "longitude", "uri")',
        { cutoff }
      )
    ]);

    const advisories = activeAdvisories().map((a) => ({
      pest: a.pest,
      scientificName: a.scientificName,
      eppoCode: a.eppoCode,
      affectedCrops: a.affectedCrops,
      departments: a.departments,
      advisory: a.advisory,
      source: a.source
    }));

    const caveats = [];
    if (sightings.length > 0) caveats.push(caveat.communityData());

    return buildEnvelope(
      {
        advisories,
        regional: regional.map((r) => ({ ...r, severity: r.severity || 'info' })),
        sightings: sightings.map((s) => ({
          ...s,
          commonName: TAXA_NAMES[s.scientificName] || { en: s.scientificName, es: s.scientificName }
        }))
      },
      {
        source: 'Curated advisories + OIRSA + iNaturalist',
        coverage: `Seasonal advisories (curated), OIRSA regional news and community sightings from the last 90 days — no live official alert feed exists for Central America`,
        caveats
      }
    );
  }

  async buildMarketPrices(category) {
    const def = MARKET_CATEGORIES[category];
    if (!def) return null;

    // Categories with a curated fallback (harvestStorage): use live series
    // when the adapter has run, else the curated stat
    let usedCurated = false;
    if (def.curated && def.seriesDefs.length === 0) {
      usedCurated = true;
    }

    const cpi = await this.cpiByYear();
    const series = [];
    const caveats = [];
    const estimations = [];

    for (const sdef of def.seriesDefs) {
      let built = null;
      if (sdef.type === 'wfp') {
        built = await this.wfpSeries(sdef, cpi);
      } else if (sdef.type === 'index' || sdef.type === 'trade' || sdef.type === 'faostat' || sdef.type === 'sdg') {
        built = await this.annualSeries(sdef.key, sdef);
      } else if (sdef.type === 'wb') {
        built = await this.keyedSeries(sdef.key, sdef);
      }
      if (!built) continue; // degradation order: next def fills the slot

      const entry = { ...built, unit: sdef.unit };
      if (sdef.regional) {
        caveats.push(caveat.regionalData(sdef.country || entry.country));
        entry.name = entry.name.replace(' [regional]', '');
      }
      if (sdef.proxy) caveats.push(caveat.proxyIndex('BLS PPI'));
      if (sdef.annual) {
        const lastYear = Math.max(...built.data.map((d) => Number(String(d.date).slice(0, 4))));
        caveats.push(caveat.annualOnly(lastYear));
      }
      if (built.estimation) estimations.push(built.estimation);
      if (built.data.some((d) => d.quality === 'estimated')) {
        const estYears = built.data.filter((d) => d.quality === 'estimated').map((d) => String(d.date).slice(0, 4));
        caveats.push(
          caveat.estimatedCpi(`${Math.min(...estYears)}–${Math.max(...estYears)}`, new Date().getFullYear() - 1)
        );
      }
      series.push(entry);
    }

    if (series.length === 0 && def.curated) {
      // Curated fallback when no live series exists yet
      const c = def.curated;
      series.push({
        name: c.name,
        source: 'faostat-sdg',
        country: 'Central America (regional aggregate)',
        unit: c.unit,
        data: [{ date: `${c.asOf}-01-01`, value: c.value, quality: 'actual' }],
        trend: 'stable'
      });
      usedCurated = true;
    }

    if (usedCurated) caveats.push(caveat.curatedStat(def.curated.asOf));

    if (series.length === 0) {
      return buildEnvelope(
        { title: def.title, unit: '', series: [], trend: 'unknown', latest: null },
        { source: 'pending', stale: true, coverage: 'No data fetched yet — awaiting first successful prefetch' }
      );
    }

    const primary = series[0];
    const hasGap = series.some((s) => s.name.includes('San Salvador'));
    if (hasGap) caveats.push(caveat.gapYears('2023–2025'));
    if (def.seriesDefs.some((sd) => sd.adapter === 'wfp-slv')) caveats.push(caveat.singleMarket('San Salvador'));

    return buildEnvelope(
      {
        title: def.title,
        unit: primary.unit,
        series,
        trend: primary.trend,
        latest: primary.data.length > 0 ? primary.data[primary.data.length - 1].value : null
      },
      {
        source: 'GENIE.AI agri service (composite)',
        coverage: series
          .map((s) => `${s.name} (${s.country}, through ${s.data[s.data.length - 1]?.date || '?'})`)
          .join('; '),
        estimation: estimations.length > 0 ? estimations.join(' | ') : null,
        caveats
      }
    );
  }

  async buildNews(scope, lang) {
    const scopes = scope === 'local' ? ['local'] : ['global', 'institutional'];
    const fetch = async (windowHours) => {
      const cutoff = new Date(Date.now() - windowHours * 3600000).toISOString();
      return this.querySeries(
        'FOR n IN agri_news FILTER n.scope IN @scopes AND n.language == @lang ' +
          'AND n.publishedAt >= @cutoff SORT n.publishedAt DESC LIMIT 60 ' +
          'RETURN KEEP(n, "title", "source", "url", "publishedAt", "snippet", "scope")',
        { scopes, lang, cutoff }
      );
    };

    // Widening window: 48 h normally; 7 d, then 14 d when the feeds have
    // been quiet/rate-limited — an older-but-relevant list beats an empty
    // picker (user req: never show nothing while major events unfold).
    let windowHours = 48;
    let items = await fetch(windowHours);
    if (items.length < 3) {
      windowHours = 168;
      items = await fetch(windowHours);
    }
    if (items.length < 3) {
      windowHours = 336;
      items = await fetch(windowHours);
    }

    // Relevance gate at serve time too — filters items landed before the
    // ingest gate existed (economics/agriculture only, user req 2026-09-18)
    items = items.filter((n) => isRelevantNews(n));

    // Top 5 per feed source, newest first
    const perSource = new Map();
    for (const item of items) {
      const list = perSource.get(item.source) || [];
      if (list.length < 5) {
        list.push(item);
        perSource.set(item.source, list);
      }
    }
    const capped = [...perSource.values()]
      .flat()
      .sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || ''));

    return buildEnvelope(
      { items: capped },
      {
        source: 'GDELT + official RSS feeds',
        attribution: 'Global news via the GDELT Project (gdeltproject.org)',
        coverage:
          (scope === 'local'
            ? lang === 'en'
              ? 'English-language coverage of El Salvador via GDELT (no English-language local outlet feeds exist)'
              : 'MAG El Salvador, Presidencia, Diario CoLatino + GDELT Spanish coverage of El Salvador'
            : 'GDELT DOC 2.0 + FAO newsroom') +
          (windowHours > 48 ? ` — widened to the last ${windowHours / 24} days (feeds quiet or rate-limited)` : '')
      }
    );
  }

  // ==================== PUBLIC API (routes) ====================

  async getCropHealth() {
    return this.serve('crop-health', () => this.buildCropHealth());
  }

  async getPestAlerts() {
    return this.serve('pest-alerts', () => this.buildPestAlerts());
  }

  async getMarketPrices(category) {
    if (!MARKET_CATEGORIES[category]) return null;
    return this.serve(`market-prices:${category}`, () => this.buildMarketPrices(category));
  }

  async getNews(scope, lang) {
    const s = scope === 'local' ? 'local' : 'global';
    const l = lang === 'en' ? 'en' : 'es';
    return this.serve(`news:${s}:${l}`, () => this.buildNews(s, l));
  }

  async getHealth() {
    const rows = await this.querySeries(
      'FOR l IN agri_fetch_log COLLECT adapterId = l.adapterId INTO runs = l ' +
        'LET last = FIRST(FOR r IN runs SORT r.ranAt DESC LIMIT 1 RETURN r) ' +
        'RETURN {adapterId, ok: last.ok, ranAt: last.ranAt, latestDataDate: last.latestDataDate, error: last.error}',
      {}
    );
    const byId = new Map(rows.map((r) => [r.adapterId, r]));
    return {
      adapters: this.adapters.map((a) => {
        const last = byId.get(a.id) || {};
        const ranAt = last.ranAt ? Date.parse(last.ranAt) : null;
        const ageHours = ranAt ? Math.round((Date.now() - ranAt) / 3600000) : null;
        return {
          id: a.id,
          enabled: true,
          ok: last.ok === true,
          ranAt: last.ranAt || null,
          ageHours,
          latestDataDate: last.latestDataDate || null,
          error: last.error || null
        };
      })
    };
  }

  listCategories() {
    return Object.keys(MARKET_CATEGORIES);
  }

  clearCache() {
    if (this.redis) {
      // Redis keys deleted via pattern is discouraged in ioredis; Arango is source of truth
      this.redis
        .keys('agri:*')
        .then((keys) => this.redis.del(keys))
        .catch(() => {});
    }
    return this.db
      .collection('agri_cache')
      .truncate()
      .catch((e) => logger.warn(`agri cache truncate failed: ${e.message}`));
  }
}

module.exports = AgriService;
