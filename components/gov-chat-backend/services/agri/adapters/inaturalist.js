/**
 * inaturalist — community pest sightings for El Salvador (place_id 7563).
 *
 * Verified 2026-09-16: e.g. Spodoptera frugiperda obs 388247063 (2026-08-04,
 * Acajutla). Sparse by nature — always rendered as "community sightings",
 * never as severity-graded alerts (COMMUNITY_DATA caveat).
 */
const { fetchJson } = require('../http');
const { docKey } = require('../keys');

// Target crop-pest taxa (scientific names verified via EPPO/iNaturalist)
const TAXA = [
  'Spodoptera frugiperda', // Fall Armyworm
  'Hemileia vastatrix', // Coffee Leaf Rust
  'Bemisia tabaci', // Whitefly
  'Phytophthora infestans', // Late Blight
  'Hypothenemus hampei' // Coffee Berry Borer
];

module.exports = {
  id: 'inaturalist',
  configPrefix: 'INATURALIST',
  cadence: '24h',
  allowEmpty: true, // community sightings are legitimately sparse most weeks
  defaults: {
    placeId: 7563,
    taxa: TAXA.join('|'),
    withinDays: 90,
    perPage: 200
  },
  endpoints: ['pest-alerts'],

  async resolve(cfg) {
    const since = new Date(Date.now() - cfg.withinDays * 86400000).toISOString().split('T')[0];
    return { since };
  },

  async fetch(_, cfg) {
    const since = new Date(Date.now() - cfg.withinDays * 86400000).toISOString().split('T')[0];
    // taxon_name accepts a raw '|' separator for multi-taxon queries —
    // encodeURIComponent would turn it into %7C and iNaturalist would treat
    // the whole string as one bogus taxon. Encode the rest, leave '|' raw.
    const taxaParam = encodeURIComponent(cfg.taxa).replace(/%7C/gi, '|');
    const url =
      'https://api.inaturalist.org/v1/observations' +
      `?place_id=${cfg.placeId}&taxon_name=${taxaParam}` +
      `&per_page=${cfg.perPage}&order=desc&order_by=observed_on&d1=${since}`;
    return fetchJson(url, { timeoutMs: 20000 });
  },

  parse(json) {
    return (json && json.results) || [];
  },

  normalize(observations) {
    const docs = [];
    for (const obs of observations) {
      if (!obs || !obs.taxon) continue;
      const logical = `inat:${obs.id}`;
      docs.push({
        _key: docKey(logical),
        kind: 'sighting',
        scientificName: obs.taxon.name,
        observedOn: obs.observed_on || null,
        placeGuess: obs.place_guess || null,
        latitude: obs.latitude || null,
        longitude: obs.longitude || null,
        uri: obs.uri || null,
        source: 'inaturalist'
      });
    }
    return { collection: 'agri_alerts', docs };
  }
};
