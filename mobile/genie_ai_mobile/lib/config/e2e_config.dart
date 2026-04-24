import 'keycloak_config.dart';

const e2eConfig = KeycloakConfig(
  keycloakUrl: 'http://localhost:8080',
  realm: 'genie',
  clientId: 'genie-mobile-e2e',
  redirectScheme: 'com.itu.genieai.e2e',
  backendUrl: 'http://localhost:3000',
);
