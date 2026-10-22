import '../keycloak_config.dart';

// Template for new deployment flavors.
// Copy this file to flavors/<institution>.dart and fill in the values below.
// The redirectScheme MUST match KC_MOBILE_REDIRECT_SCHEME in the deployment .env.
// IMPORTANT: Also add an entry for this flavor to _flavorTable in
// keycloak_config.dart, so getConfig() resolves it and the startup error
// messages mention it.

final config = KeycloakConfig(
  keycloakUrl: 'https://keycloak.<institution>.int',
  realm: 'genie',
  clientId: 'genie-mobile-<institution>',
  redirectScheme: 'com.<institution>.genieai',
  backendUrl: 'https://api.<institution>.int',
);
