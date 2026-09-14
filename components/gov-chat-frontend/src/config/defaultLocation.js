/**
 * Deployment fallback location (name + coordinates).
 *
 * Injected at runtime by docker-entrypoint.sh into window.APP_CONFIG from
 * DEFAULT_LOCATION / DEFAULT_LAT / DEFAULT_LON (root .env, Section 15). The
 * same variables drive the backend, weather-mcp-service, drought-monitoring,
 * warning_system_engine and geo-inference-worker, so the web app falls back
 * to the same place as every service. Unset = Dhaka.
 */

export const BUILT_IN_DEFAULT_LOCATION = Object.freeze({ name: 'Dhaka', lat: 23.8103, lon: 90.4125 });

function readConfig() {
  return (typeof window !== 'undefined' && window.APP_CONFIG) || {};
}

function parseCoord(raw, fallback, limit) {
  const value = parseFloat(raw);
  return Number.isFinite(value) && Math.abs(value) <= limit ? value : fallback;
}

/** @returns {{ name: string, lat: number, lon: number }} */
export function getDefaultLocation() {
  const cfg = readConfig();
  const name = String(cfg.defaultLocation || '').trim() || BUILT_IN_DEFAULT_LOCATION.name;
  return {
    name,
    lat: parseCoord(cfg.defaultLat, BUILT_IN_DEFAULT_LOCATION.lat, 90),
    lon: parseCoord(cfg.defaultLon, BUILT_IN_DEFAULT_LOCATION.lon, 180)
  };
}

/** localStorage key where CropAlertBanner caches the district resolved from geolocation. */
export const DISTRICT_CACHE_KEY = 'mewa_alert_district';
export const DISTRICT_CACHE_MS = 24 * 60 * 60 * 1000; // re-resolve location once a day

/** Placeholder that config prompts use for "the user's district". */
export const LOCATION_PLACEHOLDER = '{{location}}';

/**
 * District the UI currently treats as "my area": the geolocation-resolved
 * district cached by CropAlertBanner when fresh, else the deployment default.
 * @returns {string}
 */
export function getResolvedDistrict() {
  try {
    const cached = JSON.parse(localStorage.getItem(DISTRICT_CACHE_KEY) || 'null');
    if (cached?.district && Date.now() - (cached.at || 0) < DISTRICT_CACHE_MS) {
      return String(cached.district);
    }
  } catch {
    // corrupt cache entry: fall through to the default
  }
  return getDefaultLocation().name;
}

/**
 * Replace every {{location}} in a prompt with the resolved district.
 * Non-string input is returned unchanged.
 * @param {string|null|undefined} text
 */
export function fillLocationPlaceholder(text) {
  if (typeof text !== 'string' || !text.includes(LOCATION_PLACEHOLDER)) return text;
  return text.split(LOCATION_PLACEHOLDER).join(getResolvedDistrict());
}

export default getDefaultLocation;
