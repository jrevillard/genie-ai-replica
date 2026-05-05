import 'keycloak_config.dart';

const e2eConfig = KeycloakConfig(
  keycloakUrl: 'https://localhost:8443/auth',
  realm: 'genie',
  clientId: 'genie-mobile-e2e',
  redirectScheme: 'com.itu.genieai.e2e',
  backendUrl: 'https://localhost:8443/api',
  allowInsecureConnections: true,
);
