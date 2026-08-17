import '../keycloak_config.dart';

// Template for new deployment flavors.
// Copy this file to flavors/<institution>.dart and fill in the values below.
// The redirectScheme MUST match KC_MOBILE_REDIRECT_SCHEME in the deployment .env.
// IMPORTANT: Also add a case in getConfig() in keycloak_config.dart for this flavor.

final config = KeycloakConfig(
  keycloakUrl: 'https://keycloak.<institution>.int',
  realm: 'genie',
  clientId: 'genie-mobile-<institution>',
  redirectScheme: 'com.<institution>.genieai',
  backendUrl: 'https://api.<institution>.int',
);
