import '../keycloak_config.dart';

// El Salvador deployment flavor (AgroGenio AI).
// Server: https://mvp.ai.assembly.govstack.global (public DNS, Let's Encrypt TLS).
// The redirectScheme MUST match KC_MOBILE_REDIRECT_SCHEME in the deployment .env.
// IMPORTANT: Also added a case in getConfig() in keycloak_config.dart for this flavor.
//  - Keycloak uses the legacy /auth/ prefix, so keycloakUrl must end in "/auth"
//    (the realmUrl getter appends /realms/<realm>).
//  - backendUrl is an ORIGIN ONLY — it must NOT include the "/api" prefix.
//    The OpenAPI client is built as ApiClient(basePath: backendUrl) and the
//    spec paths already start with "/api/...", and the plain-http callers
//    append "/api/..." themselves (e.g. "${backendUrl}/api/files/<id>/view").
//    Including "/api" here produced "…/api/api/…" and every chat, folder and
//    service-category call 404'd on the deployment.

final config = KeycloakConfig(
  keycloakUrl: 'https://mvp.ai.assembly.govstack.global/auth',
  realm: 'genie',
  clientId: 'genie-mobile-el-salvador',
  redirectScheme: 'sv.gov.agrogenio',
  backendUrl: 'https://mvp.ai.assembly.govstack.global',
  allowInsecureConnections: false,
  // El Salvador serves English + Spanish only (all 14 locale files stay in source).
  supportedLocaleCodes: ['en', 'es'],
);
