import 'keycloak_config.dart';

const devConfig = KeycloakConfig(
  keycloakUrl: 'https://10.0.2.2/auth',
  realm: 'genie',
  clientId: 'genie-app',
  redirectScheme: 'com.itu.genieai.dev',
  backendUrl: 'https://10.0.2.2/api',
  allowInsecureConnections: true,
);
