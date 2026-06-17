import '../keycloak_config.dart';

// El Salvador deployment flavor (AgroGenio AI).
// The redirectScheme MUST match KC_MOBILE_REDIRECT_SCHEME in the deployment .env.
// IMPORTANT: Also added a case in getConfig() in keycloak_config.dart for this flavor.

const config = KeycloakConfig(
  keycloakUrl: 'https://ai.assembly.govstack.global',
  realm: 'genie',
  clientId: 'genie-mobile-el-salvador',
  redirectScheme: 'sv.gov.agrogenio',
  backendUrl: 'https://ai.assembly.govstack.global/api',
  // El Salvador serves English + Spanish only (all 14 locale files stay in source).
  supportedLocaleCodes: ['en', 'es'],
);
