'use strict';

/**
 * The spec extraction that feeds the mobile OpenAPI client generation
 * (scripts/generate-api-client.sh) runs with placeholder pins (API_URL,
 * KEYCLOAK_URL, KEYCLOAK_REALM) baked into the committed Dart artifacts;
 * the pin asserts in scripts/build-openapi-spec.js exist so a dropped pin
 * throws instead of shipping a silently degraded client.
 *
 * This suite requires the module directly and drives the same pins the
 * generation envelope sets (KEYCLOAK_URL/KEYCLOAK_REALM spellings mirror
 * setup-env.js, API_URL mirrors the generation script's pin value) — the
 * positive spec shape and the negative throw paths.
 *
 * swagger-definition.js reads process.env at require time, so each negative
 * case resets the module registry and re-requires the chain after deleting
 * its pin.
 */

require('../setup-env');

// This file overwrites API_URL (the generation envelope's pin value) for
// the suite below — the assignment happens in beforeAll, AFTER the module
// imports have succeeded, so a load failure cannot leave the pin behind in
// the shared Jest worker environment. The original is restored at file end
// (Jest workers share process.env across test files).
let originalApiUrl;

afterAll(() => {
  if (originalApiUrl === undefined) {
    delete process.env.API_URL;
  } else {
    process.env.API_URL = originalApiUrl;
  }
});

const { buildSpec } = require('../../../../scripts/build-openapi-spec');

describe('scripts/build-openapi-spec', () => {
  let spec;
  let savedPins;

  beforeAll(() => {
    // The generation envelope pins API_URL so the committed client carries
    // a deterministic absolute base path.
    originalApiUrl = process.env.API_URL;
    process.env.API_URL = 'https://localhost';
    // Snapshot taken AFTER the pin assignment, so the restore puts back
    // exactly the pins the suite runs with — no second copy of the literal
    // values to keep in sync with setup-env.js.
    savedPins = ['API_URL', 'KEYCLOAK_URL', 'KEYCLOAK_REALM'].map((key) => [key, process.env[key]]);
    spec = buildSpec();
  });

  afterEach(() => {
    // The negative cases delete pins and reset the module registry; restore
    // the pinned environment so no case leaks state into another.
    for (const [key, value] of savedPins) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    jest.resetModules();
  });

  it('generates a spec with paths (the apis glob matched the routes)', () => {
    expect(Object.keys(spec.paths ?? {}).length).toBeGreaterThan(0);
  });

  it('carries the API_URL pin as a concrete server entry', () => {
    expect((spec.servers ?? []).some((s) => s?.url === 'https://localhost')).toBe(true);
  });

  it('builds concrete Keycloak OAuth2 flow URLs (no undefined interpolation)', () => {
    const flow = spec.components?.securitySchemes?.KeycloakOAuth2?.flows?.authorizationCode;
    expect(typeof flow?.authorizationUrl).toBe('string');
    expect(flow.authorizationUrl).not.toContain('undefined');
    expect(typeof flow?.tokenUrl).toBe('string');
    expect(flow.tokenUrl).not.toContain('undefined');
  });

  it.each([
    ['API_URL', /API_URL pin/],
    ['KEYCLOAK_URL', /concrete URL/],
    ['KEYCLOAK_REALM', /concrete URL/]
  ])('fails loudly when the %s pin is missing', (pin, messagePattern) => {
    delete process.env[pin];
    jest.resetModules();
    const unpinned = require('../../../../scripts/build-openapi-spec');
    expect(() => unpinned.buildSpec()).toThrow(messagePattern);
  });
});
