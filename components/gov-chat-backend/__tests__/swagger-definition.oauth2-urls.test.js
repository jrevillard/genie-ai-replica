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
});
