import '../keycloak_config.dart';

const config = KeycloakConfig(
  keycloakUrl: 'https://keycloak.itu.int',
  clientId: 'genie-mobile-itu',
  redirectScheme: 'com.itu.genieai',
  backendUrl: 'https://api.itu.int',
);
