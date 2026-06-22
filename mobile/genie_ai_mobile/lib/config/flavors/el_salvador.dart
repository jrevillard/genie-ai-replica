import '../keycloak_config.dart';

// El Salvador deployment flavor (AgroGenio AI).
// The redirectScheme MUST match KC_MOBILE_REDIRECT_SCHEME in the deployment .env.
// IMPORTANT: Also added a case in getConfig() in keycloak_config.dart for this flavor.
//
// El Salvador deployment (AgroGenio AI). The server is reachable at
// https://10.0.0.102 (LAN/VPN). Two deployment-specific facts:
//  - Keycloak uses the legacy /auth/ prefix, so keycloakUrl must end in "/auth"
//    (the realmUrl getter appends /realms/<realm>).
//  - The deployment uses a self-signed certificate (CN=10.0.0.102), so
//    allowInsecureConnections is required (the local flutter_appauth fork trusts
//    self-signed certs when enabled).

const config = KeycloakConfig(
  keycloakUrl: 'https://10.0.0.102/auth',
  realm: 'genie',
  clientId: 'genie-mobile-el-salvador',
  redirectScheme: 'sv.gov.agrogenio',
  backendUrl: 'https://10.0.0.102/api',
  allowInsecureConnections: true,
  // El Salvador serves English + Spanish only (all 14 locale files stay in source).
  supportedLocaleCodes: ['en', 'es'],
);
