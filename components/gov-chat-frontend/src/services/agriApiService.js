/**
 * Agri API Service
 *
 * Client for the backend /api/agri/* endpoints (crop health, pest alerts,
 * market prices, news) — see components/gov-chat-backend/services/agri/.
 *
 * Never-fail semantics on the client side: every successful response is
 * persisted to localStorage as last-known-good; on fetch failure the cached
 * envelope is returned with meta.stale forced true. Chart components render
 * immediately from cache (stale-while-revalidate is left to the component's
 * refresh cadence — this service exposes both get() and getCached()).
 */
import httpService from './httpService';

const CACHE_PREFIX = 'agri-lkg:';
const CACHE_SCHEMA_VERSION = 'v2'; // bump to invalidate old shapes

class AgriApiService {
  /**
   * Fetch an agri endpoint with last-known-good fallback.
   * @param {string} endpoint - e.g. 'agri/market-prices/maize'
   * @returns {Promise<{data: Object, meta: Object}>} envelope
   */
  async get(endpoint) {
    try {
      const response = await httpService.get(endpoint);
      const envelope = response.data;
      if (envelope && envelope.data !== undefined) {
        this.writeCache(endpoint, envelope);
        return envelope;
      }
      throw new Error('Unexpected response shape');
    } catch (error) {
      console.warn(`[AgriApiService] fetch failed for ${endpoint}, using cached data:`, error.message);
      const cached = this.readCache(endpoint);
      if (cached) {
        return {
          ...cached,
          meta: {
            ...cached.meta,
            stale: true,
            caveats: [
              ...(cached.meta && cached.meta.caveats ? cached.meta.caveats : []),
              { code: 'STALE_CACHE', params: { source: 'offline' } }
            ]
          }
        };
      }
      // No cache, no backend — honest empty envelope, never a crash
      return {
        data: {},
        meta: {
          fetchedAt: null,
          source: 'unavailable',
          stale: true,
          coverage: 'offline',
          caveats: []
        }
      };
    }
  }

  getMarketPrices(category) {
    return this.get(`agri/market-prices/${category}`);
  }

  /**
   * Crop health mapped to the chart's legacy field names
   * (department/change kept, plus baseline/date/source added).
   */
  async getCropHealth() {
    const envelope = await this.get('agri/crop-health');
    const departments = (envelope.data && envelope.data.departments) || [];
    return {
      data: departments.map((d) => ({
        department: d.name,
        ndvi: d.ndvi,
        trend: d.trend,
        change: d.changePct,
        health: d.health,
        date: d.date,
        baseline: d.baseline,
        source: d.source
      })),
      average: (envelope.data && envelope.data.average) || {},
      meta: envelope.meta
    };
  }

  /**
   * Pest alerts mapped to the chart's legacy alert shape, with honest
   * section provenance: advisories (curated, seasonal), regional (OIRSA
   * news, severity 'info'), sightings (community, severity 'sighting').
   */
  /**
   * Selected UI language normalized to the backend news enum (es/en).
   * Reads the `userLocale` key the LanguageSelector persists; callers that
   * hold a live locale (components with $i18n) pass it explicitly instead.
   */
  _uiLang(explicit) {
    const raw = explicit || localStorage.getItem('userLocale') || 'en';
    return String(raw).toLowerCase().startsWith('es') ? 'es' : 'en';
  }

  async getPestAlerts() {
    const envelope = await this.get('agri/pest-alerts');
    const d = envelope.data || {};
    const lang = this._uiLang();

    const alerts = [
      ...(d.advisories || []).map((a) => ({
        id: `advisory-${a.scientificName}`,
        pest: a.pest ? a.pest[lang] || a.pest.en : a.scientificName,
        scientificName: a.scientificName,
        severity: 'advisory',
        affectedCrops: a.affectedCrops ? a.affectedCrops[lang] || a.affectedCrops.en : [],
        departments: a.departments || [],
        description: a.advisory ? a.advisory[lang] || a.advisory.en : '',
        recommendations: '',
        firstDetected: null,
        source: a.source,
        link: null,
        seasonal: true
      })),
      ...(d.regional || []).map((r) => ({
        id: `regional-${r.link || r.title}`,
        pest: r.title,
        scientificName: '',
        severity: 'info',
        affectedCrops: [],
        departments: [],
        description: (r.matchedKeywords || []).join(', '),
        recommendations: '',
        firstDetected: r.publishedAt,
        source: r.source || 'OIRSA',
        link: r.link,
        seasonal: false
      })),
      ...(d.sightings || []).map((s) => ({
        id: `sighting-${s.scientificName}-${s.observedOn}`,
        pest: s.commonName ? s.commonName[lang] || s.commonName.en : s.scientificName,
        scientificName: s.scientificName,
        severity: 'sighting',
        affectedCrops: [],
        departments: s.placeGuess ? [s.placeGuess] : [],
        description: '',
        recommendations: '',
        firstDetected: s.observedOn,
        source: 'iNaturalist (community)',
        link: s.uri,
        seasonal: false
      }))
    ];

    return {
      region: 'El Salvador',
      alerts,
      summary: {
        total: alerts.length,
        advisory: (d.advisories || []).length,
        regional: (d.regional || []).length,
        sightings: (d.sightings || []).length,
        high: 0,
        moderate: 0,
        low: 0
      },
      meta: envelope.meta
    };
  }

  getNews(scope = 'global', lang = null) {
    return this.get(`agri/news?scope=${scope}&lang=${this._uiLang(lang)}`);
  }

  // ==================== LAST-KNOWN-GOOD CACHE ====================

  writeCache(endpoint, envelope) {
    try {
      localStorage.setItem(`${CACHE_PREFIX}${CACHE_SCHEMA_VERSION}:${endpoint}`, JSON.stringify(envelope));
    } catch {
      /* quota exceeded — cache is best-effort */
    }
  }

  readCache(endpoint) {
    try {
      const raw = localStorage.getItem(`${CACHE_PREFIX}${CACHE_SCHEMA_VERSION}:${endpoint}`);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  /** Synchronous cache read for instant first paint (stale-while-revalidate). */
  getCached(endpoint) {
    return this.readCache(endpoint);
  }

  clearCache() {
    try {
      Object.keys(localStorage)
        .filter((k) => k.startsWith(CACHE_PREFIX))
        .forEach((k) => localStorage.removeItem(k));
    } catch {
      /* ignore */
    }
  }
}

export default new AgriApiService();
