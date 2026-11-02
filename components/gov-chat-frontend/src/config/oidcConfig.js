/**
 * OIDC Configuration for Keycloak integration
 * Ported from upstream GenieAI v2.0.1 (components/gov-chat-frontend/src/config/oidcConfig.js).
 *
 * Configuration hierarchy:
 * 1. window.APP_CONFIG?.keycloak (runtime config from /config.js, written at container start)
 * 2. process.env.VUE_APP_KEYCLOAK_* (build-time env var fallback for url/clientId only)
 * 3. Sensible defaults for local development
 *
 * Property names match oidc-client-ts OidcClientSettings interface (snake_case).
 * Token storage uses oidc-client-ts browser-storage DEFAULTS (DEC-11):
 * user/token in sessionStorage, OIDC state in localStorage — no custom
 * WebStorageStateStore is configured on purpose; the library defaults ARE the decision.
 */

function getOidcConfig() {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const appConfig = typeof window !== 'undefined' ? window.APP_CONFIG : null;
  const keycloakConfig = appConfig?.keycloak || {};

  const keycloakUrl = (
    keycloakConfig.url ||
    process.env.VUE_APP_KEYCLOAK_URL ||
    (origin ? `${origin}/auth` : 'http://localhost:8080')
  ).replace(/\/+$/, '');

  const realm = keycloakConfig.realm || 'genie';

  const clientId =
    keycloakConfig.client_id || keycloakConfig.clientId || process.env.VUE_APP_KEYCLOAK_CLIENT_ID || 'genie-app';

  return {
    authority: `${keycloakUrl}/realms/${realm}`,
    client_id: clientId,
    redirect_uri: `${origin}/callback`,
    post_logout_redirect_uri: origin,
    response_type: 'code',
    scope: 'openid profile email roles',
    automaticSilentRenew: true,
    storeAuthStateInCookie: false
  };
}

export default getOidcConfig();
