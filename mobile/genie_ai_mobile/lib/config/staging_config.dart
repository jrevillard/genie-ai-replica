import 'keycloak_config.dart';

const stagingConfig = KeycloakConfig(
  keycloakUrl: 'https://staging-keycloak.example.com',
  clientId: 'genie-mobile-staging',
  redirectScheme: 'com.itu.genieai.staging',
  backendUrl: 'https://staging-api.example.com',
);
