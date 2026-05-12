import 'keycloak_config.dart';

const devConfig = KeycloakConfig(
  keycloakUrl: 'https://10.0.2.2:8443/auth',
  realm: 'genie',
  clientId: 'genie-mobile-dev',
  redirectScheme: 'com.itu.genieai.dev',
  backendUrl: 'https://10.0.2.2:8443/api',
  allowInsecureConnections: true,
);
