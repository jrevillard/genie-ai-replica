/**
 * Shared fallback location (DEFAULT_LOCATION / DEFAULT_LAT / DEFAULT_LON).
 *
 * Used whenever a request carries no usable coordinates or place name and no
 * geolocation (browser or IP) is available. The same three variables are read
 * by weather-mcp-service, drought-monitoring, warning_system_engine and the
 * geo-inference-worker so every service falls back to the same point.
 * Values are read at call time so tests and hot reloads see env changes.
 */

const BUILT_IN = Object.freeze({ name: 'Dhaka', latitude: 23.8103, longitude: 90.4125, country: 'Bangladesh' });

function parseCoord(raw, fallback, limit) {
  const value = parseFloat(raw);
  return Number.isFinite(value) && Math.abs(value) <= limit ? value : fallback;
}

/**
 * @returns {{ name: string, latitude: number, longitude: number, city: string }}
 *   `city` is the display form used by weather-service ("Dhaka, Bangladesh").
 */
function getDefaultLocation() {
  const name = (process.env.DEFAULT_LOCATION || '').trim() || BUILT_IN.name;
  const latitude = parseCoord(process.env.DEFAULT_LAT, BUILT_IN.latitude, 90);
  const longitude = parseCoord(process.env.DEFAULT_LON, BUILT_IN.longitude, 180);
  // Only the built-in default carries a known country suffix; a custom name is used as-is.
  const city = name === BUILT_IN.name ? `${name}, ${BUILT_IN.country}` : name;
  return { name, latitude, longitude, city };
}

module.exports = { getDefaultLocation, BUILT_IN_DEFAULT_LOCATION: BUILT_IN };
