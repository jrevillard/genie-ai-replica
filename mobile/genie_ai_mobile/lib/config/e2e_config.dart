import 'keycloak_config.dart';

const _keycloakUrl = String.fromEnvironment(
  'E2E_KEYCLOAK_URL',
  defaultValue: 'https://10.0.2.2:8443/auth',
);
const _backendUrl = String.fromEnvironment(
  'E2E_BACKEND_URL',
  defaultValue: 'https://10.0.2.2:8443',
);

final e2eConfig = KeycloakConfig(
  keycloakUrl: _keycloakUrl,
  realm: 'genie',
  clientId: 'genie-mobile-e2e',
  redirectScheme: 'com.itu.genieai.e2e',
  backendUrl: _backendUrl,
  allowInsecureConnections: true,
);
