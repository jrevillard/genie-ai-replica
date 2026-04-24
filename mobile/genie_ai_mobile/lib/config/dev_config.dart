import 'keycloak_config.dart';

const devConfig = KeycloakConfig(
  keycloakUrl: 'http://localhost:8080',
  realm: 'genie',
  clientId: 'genie-mobile-dev',
  redirectScheme: 'com.itu.genieai.dev',
  backendUrl: 'http://localhost:3000',
);
