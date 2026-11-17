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
 * resets the module registry and re-requires it after arranging the env.
 */

require('./setup-env');

const flowUrls = () => {
  const definition = require('../swagger-definition');
  const flow = definition.components.securitySchemes.KeycloakOAuth2.flows.authorizationCode;
  return { authorizationUrl: flow.authorizationUrl, tokenUrl: flow.tokenUrl };
};

describe('swagger-definition OAuth2 flow URLs', () => {
  let saved;

  beforeEach(() => {
    saved = ['KEYCLOAK_URL', 'KEYCLOAK_PUBLIC_URL', 'KEYCLOAK_REALM'].map((key) => [key, process.env[key]]);
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
    process.env.KEYCLOAK_URL = 'http://keycloak-service.genieai.svc.cluster.local:8080/auth';
    process.env.KEYCLOAK_PUBLIC_URL = 'https://docs.example.org/auth';
    process.env.KEYCLOAK_REALM = 'genie';
    jest.resetModules();
    const { authorizationUrl, tokenUrl } = flowUrls();
    expect(authorizationUrl).toBe('https://docs.example.org/auth/realms/genie/protocol/openid-connect/auth');
    expect(tokenUrl).toBe('https://docs.example.org/auth/realms/genie/protocol/openid-connect/token');
  });

  it('falls back to KEYCLOAK_URL when KEYCLOAK_PUBLIC_URL is unset (compose behaviour)', () => {
    delete process.env.KEYCLOAK_PUBLIC_URL;
    process.env.KEYCLOAK_URL = 'https://keycloak.example.com/auth';
    process.env.KEYCLOAK_REALM = 'genie';
    jest.resetModules();
    const { authorizationUrl, tokenUrl } = flowUrls();
    expect(authorizationUrl).toBe('https://keycloak.example.com/auth/realms/genie/protocol/openid-connect/auth');
    expect(tokenUrl).toBe('https://keycloak.example.com/auth/realms/genie/protocol/openid-connect/token');
  });

  it('strips a trailing slash from KEYCLOAK_PUBLIC_URL (same shape as the verifier alias)', () => {
    process.env.KEYCLOAK_PUBLIC_URL = 'https://docs.example.org/auth/';
    process.env.KEYCLOAK_REALM = 'genie';
    jest.resetModules();
    const { authorizationUrl } = flowUrls();
    expect(authorizationUrl).toBe('https://docs.example.org/auth/realms/genie/protocol/openid-connect/auth');
  });

  it('treats an EMPTY KEYCLOAK_PUBLIC_URL as unset (the compose delivery shape)', () => {
    // Compose delivers `KEYCLOAK_PUBLIC_URL=${KEYCLOAK_PUBLIC_URL:-}` — an
    // unset variable arrives as the empty string, not as an absent one.
    process.env.KEYCLOAK_URL = 'https://keycloak.example.com/auth';
    process.env.KEYCLOAK_PUBLIC_URL = '';
    process.env.KEYCLOAK_REALM = 'genie';
    jest.resetModules();
    const { authorizationUrl } = flowUrls();
    expect(authorizationUrl).toBe('https://keycloak.example.com/auth/realms/genie/protocol/openid-connect/auth');
  });

  it('ignores a KEYCLOAK_PUBLIC_URL that is not an absolute http(s) URL', () => {
    // Served verbatim, a scheme-less or whitespace-carrying value breaks the
    // Authorize popup — the same class the servers[0].url base refuses.
    process.env.KEYCLOAK_URL = 'https://keycloak.example.com/auth';
    process.env.KEYCLOAK_PUBLIC_URL = 'docs.example.org/auth';
    process.env.KEYCLOAK_REALM = 'genie';
    jest.resetModules();
    const { authorizationUrl } = flowUrls();
    expect(authorizationUrl).toBe('https://keycloak.example.com/auth/realms/genie/protocol/openid-connect/auth');
  });

  it('ignores a KEYCLOAK_PUBLIC_URL carrying surrounding whitespace (the verifier does not trim its alias)', () => {
    // Trimming here would point the browser at an issuer the shared
    // verifier never accepts (its public-issuer alias is not trimmed), so
    // a padded value is refused and the flow URLs fall back to KEYCLOAK_URL.
    process.env.KEYCLOAK_URL = 'https://keycloak.example.com/auth';
    process.env.KEYCLOAK_PUBLIC_URL = ' https://docs.example.org/auth ';
    process.env.KEYCLOAK_REALM = 'genie';
    jest.resetModules();
    const { authorizationUrl } = flowUrls();
    expect(authorizationUrl).toBe('https://keycloak.example.com/auth/realms/genie/protocol/openid-connect/auth');
  });

  it('ignores a KEYCLOAK_PUBLIC_URL carrying embedded whitespace', () => {
    process.env.KEYCLOAK_URL = 'https://keycloak.example.com/auth';
    process.env.KEYCLOAK_PUBLIC_URL = 'https://do cs.example.org/auth';
    process.env.KEYCLOAK_REALM = 'genie';
    jest.resetModules();
    const { authorizationUrl } = flowUrls();
    expect(authorizationUrl).toBe('https://keycloak.example.com/auth/realms/genie/protocol/openid-connect/auth');
  });

  it('strips a trailing slash from the KEYCLOAK_URL fallback (no doubled path segment)', () => {
    process.env.KEYCLOAK_URL = 'https://keycloak.example.com/auth/';
    delete process.env.KEYCLOAK_PUBLIC_URL;
    process.env.KEYCLOAK_REALM = 'genie';
    jest.resetModules();
    const { authorizationUrl } = flowUrls();
    expect(authorizationUrl).toBe('https://keycloak.example.com/auth/realms/genie/protocol/openid-connect/auth');
  });

  it('never degrades to a same-origin relative URL when no base URL is configured', () => {
    // A relative served URL opens the Authorize popup on the docs origin
    // itself — a silent misconfiguration. The unset case must stay visibly
    // broken instead.
    delete process.env.KEYCLOAK_URL;
    delete process.env.KEYCLOAK_PUBLIC_URL;
    process.env.KEYCLOAK_REALM = 'genie';
    jest.resetModules();
    const { authorizationUrl } = flowUrls();
    expect(authorizationUrl.startsWith('/')).toBe(false);
  });

  it.each([
    ['a path-only base', '/'],
    ['a scheme-only base', 'http://'],
    ['an empty base', '']
  ])('refuses %s (KEYCLOAK_URL is not an absolute http(s) URL)', (_label, value) => {
    // A degenerate base would hand the browser a same-origin relative path
    // (the Authorize popup on the docs origin) — a silent misconfiguration.
    // The served URL must stay visibly broken instead.
    process.env.KEYCLOAK_URL = value;
    delete process.env.KEYCLOAK_PUBLIC_URL;
    process.env.KEYCLOAK_REALM = 'genie';
    jest.resetModules();
    const { authorizationUrl } = flowUrls();
    expect(authorizationUrl.startsWith('/')).toBe(false);
    expect(authorizationUrl).toContain('undefined');
  });
});
