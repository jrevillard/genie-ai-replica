/**
 * OIDC Configuration for Keycloak integration
 *
 * Configuration hierarchy:
 * 1. window.APP_CONFIG?.keycloak (runtime config from /config/genie-ai-config.json)
 * 2. process.env.VUE_APP_KEYCLOAK_* (build-time env var fallback)
 * 3. Sensible defaults for local development
 *
 * Property names match oidc-client-ts OidcClientSettings interface (snake_case).
 */

function getOidcConfig() {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const appConfig = typeof window !== 'undefined' ? window.APP_CONFIG : null;
  const keycloakConfig = appConfig?.keycloak || {};

  const keycloakUrl = (keycloakConfig.url
    || process.env.VUE_APP_KEYCLOAK_URL
    || (origin ? `${origin}/auth` : 'http://localhost:8080')).replace(/\/+$/, '');

  const realm = keycloakConfig.realm
    || process.env.VUE_APP_KEYCLOAK_REALM
    || 'genie';

  const clientId = keycloakConfig.client_id
    || keycloakConfig.clientId
    || process.env.VUE_APP_KEYCLOAK_CLIENT_ID
    || 'genie-app';

  return {
    authority: `${keycloakUrl}/realms/${realm}`,
    client_id: clientId,
    redirect_uri: `${origin}/callback`,
    post_logout_redirect_uri: origin,
    response_type: 'code',
    scope: 'openid profile email',
    automaticSilentRenew: true,
    storeAuthStateInCookie: false
  };
}

export default getOidcConfig();
