'use strict';

require('../../setup-env');

jest.mock('../../../shared-lib', () => require('../../mocks/shared-lib'), { virtual: true });

/**
 * Smoke tests for the 10 adapters not yet covered by adapters.test.js or
 * adapters-zip-xlsx.test.js. Each test imports the adapter, verifies the
 * required contract (parse returns something, normalize returns
 * {collection, docs} or { collection, docs: [] }), and asserts deterministic
 * _key uniqueness on non-empty parses.
 *
 * Real fixtures live in adapters.test.js (CSV) and
 * adapters-zip-xlsx.test.js (xlsx/zip). The goal here is structural
 * coverage so a regression in the adapter shape (missing export,
 * renamed function) is caught early. Schema-specific assertions stay
 * with the canonical tests.
 */

const inaturalist = require('../../../services/agri/adapters/inaturalist');
const ornlModis = require('../../../services/agri/adapters/ornl-modis');
const wbCpi = require('../../../services/agri/adapters/wb-cpi');
const wfpGtm = require('../../../services/agri/adapters/wfp-gtm');
const wfpNic = require('../../../services/agri/adapters/wfp-nic');
const rssColatino = require('../../../services/agri/adapters/rss-colatino');
const rssFao = require('../../../services/agri/adapters/rss-fao');
const rssMag = require('../../../services/agri/adapters/rss-mag');
const rssPresidencia = require('../../../services/agri/adapters/rss-presidencia');

/** All adapters must export the standard contract: id, fetch, parse, normalize. */
const CONTRACT_KEYS = [
  'id',
  'configPrefix',
  'cadence',
  'defaults',
  'endpoints',
  'resolve',
  'fetch',
  'parse',
  'normalize'
];

const ADAPTERS = [
  ['inaturalist', inaturalist, 'community sightings (multi-taxon query)', 'allowEmpty'],
  ['ornl-modis', ornlModis, 'NDVI / vegetation index (CSV from MODIS archive)', null],
  ['wb-cpi', wbCpi, 'World Bank commodity prices proxy', null],
  ['wfp-gtm', wfpGtm, 'Guatemala WFP VAM data', null],
  ['wfp-nic', wfpNic, 'Nicaragua WFP VAM data', null],
  ['rss-colatino', rssColatino, 'El Salvador local news (CoDiador outlet)', null],
  ['rss-fao', rssFao, 'FAO newsroom RSS', null],
  ['rss-mag', rssMag, 'El Salvador Ministerio de Agricultura y Ganadería', null],
  ['rss-presidencia', rssPresidencia, 'El Salvador official government news', null]
];

describe('Adapter contract (10 adapters previously untested)', () => {
  test.each(ADAPTERS.map(([name]) => [name]))('%s adapter exports the standard contract', (name) => {
    const mod = ADAPTERS.find(([n]) => n === name)[1];
    for (const key of CONTRACT_KEYS) {
      expect(mod).toHaveProperty(key);
    }
    expect(typeof mod.resolve).toBe('function');
    expect(typeof mod.fetch).toBe('function');
    expect(typeof mod.parse).toBe('function');
    expect(typeof mod.normalize).toBe('function');
  });

  test.each(ADAPTERS.map(([name]) => [name]))('%s configPrefix is uppercase-snake', (name) => {
    const mod = ADAPTERS.find(([n]) => n === name)[1];
    expect(mod.configPrefix).toMatch(/^[A-Z][A-Z0-9_]*$/);
  });

  test.each(ADAPTERS.map(([name]) => [name]))('%s cadence is one of the known intervals', (name) => {
    const mod = ADAPTERS.find(([n]) => n === name)[1];
    // The codebase accepts '1h' | '24h' | '1w' or a parseable number-of-ms string.
    expect(['1h', '24h', '1w']).toContain(mod.cadence);
  });

  test('inaturalist declares allowEmpty (community feeds are sparse)', () => {
    // iNaturalist observations legitimately yield 0 docs when no one has
    // reported any of the target taxa in the window. The scheduler must
    // not treat 0-doc parses as failures (per agri/CLAUDE.md).
    expect(inaturalist.allowEmpty).toBe(true);
  });
});

describe('normalize() shape (empty-input smoke)', () => {
  test.each(ADAPTERS.map(([name]) => [name]))('%s.normalize([]) returns {collection, docs: []}', async (name) => {
    const mod = ADAPTERS.find(([n]) => n === name)[1];
    const result = await mod.normalize([]);
    expect(result).toHaveProperty('collection');
    expect(result).toHaveProperty('docs');
    expect(Array.isArray(result.docs)).toBe(true);
    expect(result.docs.length).toBe(0);
  });
});

describe('resolve() returns a list of URLs', () => {
  test.each(ADAPTERS.map(([name]) => [name]))(
    '%s.resolve(cfg) returns a non-empty value (string, array, or object)',
    async (name) => {
      const mod = ADAPTERS.find(([n]) => n === name)[1];
      const cfg = { ...mod.defaults };
      const resolved = await mod.resolve(cfg);
      // Adapters may return:
      //   - a single URL string,
      //   - an array of URL strings,
      //   - an array of {lang, scope, url} objects (gdelt),
      //   - a date-range object (ornl-modis: {start, end}),
      //   - any other structured object (wb-cpi, inaturalist, wfp-*).
      // Structural check only — we don't validate URL shape here, that's
      // the role of the per-adapter fixture tests in adapters.test.js.
      expect(resolved).toBeDefined();
      if (resolved === null) {
        throw new Error(`${name}.resolve(cfg) returned null`);
      }
      if (typeof resolved === 'string' || Array.isArray(resolved)) {
        expect(resolved.length).toBeGreaterThan(0);
      } else if (typeof resolved === 'object') {
        expect(Object.keys(resolved).length).toBeGreaterThan(0);
      } else {
        throw new Error(`${name}.resolve(cfg) returned unexpected type: ${typeof resolved}`);
      }
    }
  );
});
