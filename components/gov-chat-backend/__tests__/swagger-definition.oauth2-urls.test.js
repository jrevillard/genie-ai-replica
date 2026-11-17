'use strict';

/**
 * The Swagger UI OAuth2 round-trip runs IN THE BROWSER: the authorizationUrl
 * and tokenUrl swagger-definition.js serves in /api-docs.json must be
 * reachable from the user's browser, not from the container network (#1889).
 *
 * Split-URL deployments (the k8s venue) carry the cluster-internal issuer in
 * KEYCLOAK_URL — a browser popup opening it dies on DNS, and even with a
 * host mapping the HTTPS docs page + plain-HTTP token endpoint is mixed
 * content, hard-blocked by Chromium. The fix mirrors the split-URL OIDC
 * convention the shared verifier already honours
 * (shared/lib/keycloak-auth-service.js): prefer the browser-facing
 * KEYCLOAK_PUBLIC_URL for the flow URLs, fall back to KEYCLOAK_URL when the
 * public variable is unset (the compose deployment's historical behaviour —
 * there KEYCLOAK_URL is already browser-reachable, env §839).
 *
 * swagger-definition.js reads process.env at require time, so each case
 * arranges the env, resets the module registry and re-requires the module.
 * The realm comes from setup-env.js (KEYCLOAK_REALM='genie').
 */

require('./setup-env');

const FLOW_URL_VARS = ['KEYCLOAK_URL', 'KEYCLOAK_PUBLIC_URL'];

/**
 * The served OAuth2 flow URLs for the given environment. An undefined value
 * removes the variable (the "unset" state).
 */
const flowUrlsFor = ({ KEYCLOAK_URL, KEYCLOAK_PUBLIC_URL }) => {
  for (const [key, value] of [
    ['KEYCLOAK_URL', KEYCLOAK_URL],
    ['KEYCLOAK_PUBLIC_URL', KEYCLOAK_PUBLIC_URL]
  ]) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  jest.resetModules();
  const definition = require('../swagger-definition');
  const flow = definition.components.securitySchemes.KeycloakOAuth2.flows.authorizationCode;
  return { authorizationUrl: flow.authorizationUrl, tokenUrl: flow.tokenUrl };
};

describe('swagger-definition OAuth2 flow URLs', () => {
  let saved;

  beforeEach(() => {
    saved = FLOW_URL_VARS.map((key) => [key, process.env[key]]);
  });

  afterEach(() => {
    for (const [key, value] of saved) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    jest.resetModules();
  });

  it('prefers KEYCLOAK_PUBLIC_URL when set (split-URL deployments, #1889)', () => {
    const { authorizationUrl, tokenUrl } = flowUrlsFor({
      KEYCLOAK_URL: 'http://keycloak-service.genieai.svc.cluster.local:8080/auth',
      KEYCLOAK_PUBLIC_URL: 'https://docs.example.org/auth'
    });
    expect(authorizationUrl).toBe('https://docs.example.org/auth/realms/genie/protocol/openid-connect/auth');
    expect(tokenUrl).toBe('https://docs.example.org/auth/realms/genie/protocol/openid-connect/token');
  });

  it('falls back to KEYCLOAK_URL when KEYCLOAK_PUBLIC_URL is unset (compose behaviour)', () => {
    const { authorizationUrl, tokenUrl } = flowUrlsFor({
      KEYCLOAK_URL: 'https://keycloak.example.com/auth'
    });
    expect(authorizationUrl).toBe('https://keycloak.example.com/auth/realms/genie/protocol/openid-connect/auth');
    expect(tokenUrl).toBe('https://keycloak.example.com/auth/realms/genie/protocol/openid-connect/token');
  });

  it('strips a trailing slash from KEYCLOAK_PUBLIC_URL (same shape as the verifier alias)', () => {
    const { authorizationUrl } = flowUrlsFor({
      KEYCLOAK_URL: 'https://keycloak.example.com/auth',
      KEYCLOAK_PUBLIC_URL: 'https://docs.example.org/auth/'
    });
    expect(authorizationUrl).toBe('https://docs.example.org/auth/realms/genie/protocol/openid-connect/auth');
  });

  it('treats an EMPTY KEYCLOAK_PUBLIC_URL as unset (the compose delivery shape)', () => {
    // Compose delivers `KEYCLOAK_PUBLIC_URL=${KEYCLOAK_PUBLIC_URL:-}` — an
    // unset variable arrives as the empty string, not as an absent one.
    const { authorizationUrl } = flowUrlsFor({
      KEYCLOAK_URL: 'https://keycloak.example.com/auth',
      KEYCLOAK_PUBLIC_URL: ''
    });
    expect(authorizationUrl).toBe('https://keycloak.example.com/auth/realms/genie/protocol/openid-connect/auth');
  });

  it('ignores a KEYCLOAK_PUBLIC_URL that is not an absolute http(s) URL', () => {
    // Served verbatim, a scheme-less or whitespace-carrying value breaks the
    // Authorize popup — the same class the servers[0].url base refuses.
    const { authorizationUrl } = flowUrlsFor({
      KEYCLOAK_URL: 'https://keycloak.example.com/auth',
      KEYCLOAK_PUBLIC_URL: 'docs.example.org/auth'
    });
    expect(authorizationUrl).toBe('https://keycloak.example.com/auth/realms/genie/protocol/openid-connect/auth');
  });

  it('ignores a KEYCLOAK_PUBLIC_URL carrying surrounding whitespace (the verifier does not trim its alias)', () => {
    // Trimming here would point the browser at an issuer the shared
    // verifier never accepts (its public-issuer alias is not trimmed), so
    // a padded value is refused and the flow URLs fall back to KEYCLOAK_URL.
    const { authorizationUrl } = flowUrlsFor({
      KEYCLOAK_URL: 'https://keycloak.example.com/auth',
      KEYCLOAK_PUBLIC_URL: ' https://docs.example.org/auth '
    });
    expect(authorizationUrl).toBe('https://keycloak.example.com/auth/realms/genie/protocol/openid-connect/auth');
  });

  it('ignores a KEYCLOAK_PUBLIC_URL carrying embedded whitespace', () => {
    const { authorizationUrl } = flowUrlsFor({
      KEYCLOAK_URL: 'https://keycloak.example.com/auth',
      KEYCLOAK_PUBLIC_URL: 'https://do cs.example.org/auth'
    });
    expect(authorizationUrl).toBe('https://keycloak.example.com/auth/realms/genie/protocol/openid-connect/auth');
  });

  it('strips a trailing slash from the KEYCLOAK_URL fallback (no doubled path segment)', () => {
    const { authorizationUrl } = flowUrlsFor({ KEYCLOAK_URL: 'https://keycloak.example.com/auth/' });
    expect(authorizationUrl).toBe('https://keycloak.example.com/auth/realms/genie/protocol/openid-connect/auth');
  });

  it.each([
    ['no base at all', undefined],
    ['a path-only base', '/'],
    ['a scheme-only base', 'http://'],
    ['an empty base', '']
  ])('refuses %s (no usable KEYCLOAK_URL)', (_label, value) => {
    // The contract: with no usable base the served URL must stay the
    // visibly-broken marker — it must not name an origin, and it must not
    // be a relative path of any shape (root-relative or scheme-less): the
    // Authorize popup would open on the docs origin itself. The marker is
    // what distinguishes it from a relative path; WHATWG parsing is what
    // proves it names no origin.
    const { authorizationUrl } = flowUrlsFor({ KEYCLOAK_URL: value });
    expect(authorizationUrl).toContain('undefined');
    expect(() => new URL(authorizationUrl)).toThrow();
  });
});
