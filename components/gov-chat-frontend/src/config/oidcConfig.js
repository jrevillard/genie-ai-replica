/**
 * OIDC Configuration for Keycloak integration
 *
 * Configuration hierarchy:
 * 1. window.APP_CONFIG?.keycloak (runtime config from /config/genie-ai-config.json)
 * 2. process.env.VUE_APP_KEYCLOAK_* (build-time env var fallback)
 * 3. Sensible defaults for local development
 */

function getOidcConfig() {
  const appConfig = typeof window !== 'undefined' ? window.APP_CONFIG : null;
  const keycloakConfig = appConfig?.keycloak || {};

  const keycloakUrl = (keycloakConfig.url
    || process.env.VUE_APP_KEYCLOAK_URL
    || 'http://localhost:8080').replace(/\/+$/, '');

  const realm = keycloakConfig.realm
    || process.env.VUE_APP_KEYCLOAK_REALM
    || 'genie';

  const clientId = keycloakConfig.clientId
    || process.env.VUE_APP_KEYCLOAK_CLIENT_ID
    || 'genie-app';

  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  return {
    authority: `${keycloakUrl}/realms/${realm}`,
    clientId: clientId,
    redirectUri: `${origin}/callback`,
    postLogoutRedirectUri: origin,
    responseType: 'code',
    scope: 'openid profile email',
    automaticSilentRenew: true,
    storeAuthStateInCookie: false
  };
}

export default getOidcConfig();
