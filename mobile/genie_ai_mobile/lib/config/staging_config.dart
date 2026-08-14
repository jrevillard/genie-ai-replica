import 'keycloak_config.dart';

final stagingConfig = KeycloakConfig(
  keycloakUrl: 'https://staging-keycloak.example.com',
  realm: 'genie',
  clientId: 'genie-mobile-staging',
  redirectScheme: 'com.itu.genieai.staging',
  backendUrl: 'https://staging-api.example.com',
);
