import '../keycloak_config.dart';

final config = KeycloakConfig(
  keycloakUrl: 'https://keycloak.itu.int',
  realm: 'genie',
  clientId: 'genie-mobile-itu',
  redirectScheme: 'com.itu.genieai',
  backendUrl: 'https://api.itu.int',
);
