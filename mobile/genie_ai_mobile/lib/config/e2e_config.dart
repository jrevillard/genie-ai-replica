import 'keycloak_config.dart';

const e2eConfig = KeycloakConfig(
  keycloakUrl: 'https://10.0.2.2:8443/auth',
  realm: 'genie',
  clientId: 'genie-mobile-e2e',
  redirectScheme: 'com.itu.genieai.e2e',
  backendUrl: 'https://10.0.2.2:8443',
  allowInsecureConnections: true,
);
