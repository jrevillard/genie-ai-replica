'use strict';

/**
 * The spec extraction that feeds the mobile OpenAPI client generation
 * (scripts/generate-api-client.sh) lives in scripts/build-openapi-spec.js.
 * The generation runs it with placeholder pins (API_URL, KEYCLOAK_URL,
 * KEYCLOAK_REALM) baked into the committed Dart artifacts, and its sanity
 * asserts exist to fail loudly when a pin assignment is dropped from the
 * generation envelope — a broken apis glob or a missing pin would otherwise
 * ship a silently degraded client.
 *
 * This suite requires the module directly and drives the same pins the
 * generation envelope sets (KEYCLOAK_URL/KEYCLOAK_REALM spellings mirror
 * setup-env.js, API_URL mirrors the generation script's pin value), then
 * asserts the positive spec shape AND the negative paths: a spec built
 * without a pin must throw the corresponding assert, not degrade silently.
 *
 * swagger-definition.js reads process.env at require time, so each negative
 * case resets the module registry and re-requires the chain after deleting
 * its pin.
 */

require('../setup-env');
// The generation envelope pins API_URL so the committed client carries a
// deterministic absolute base path.
process.env.API_URL = 'https://localhost';

const { buildSpec } = require('../../../../scripts/build-openapi-spec');

describe('scripts/build-openapi-spec', () => {
  let spec;

  beforeAll(() => {
    spec = buildSpec();
  });

  afterEach(() => {
    // The negative cases delete pins and reset the module registry; restore
    // the pinned environment so no case leaks state into another.
    process.env.API_URL = 'https://localhost';
    process.env.KEYCLOAK_URL = 'https://keycloak.example.com/auth';
    process.env.KEYCLOAK_REALM = 'genie';
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

  it('fails loudly when the API_URL pin is missing', () => {
    delete process.env.API_URL;
    jest.resetModules();
    const unpinned = require('../../../../scripts/build-openapi-spec');
    expect(() => unpinned.buildSpec()).toThrow(/API_URL pin/);
  });

  it('fails loudly when the Keycloak pins are missing', () => {
    delete process.env.KEYCLOAK_URL;
    jest.resetModules();
    const unpinned = require('../../../../scripts/build-openapi-spec');
    expect(() => unpinned.buildSpec()).toThrow(/concrete URL/);
  });
});
