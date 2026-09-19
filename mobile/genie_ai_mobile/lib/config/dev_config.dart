import 'keycloak_config.dart';

const _server = String.fromEnvironment('DEV_SERVER', defaultValue: 'localhost');
const _port = String.fromEnvironment('DEV_PORT', defaultValue: '443');
// Must match KC_MOBILE_CLIENT_ID in the deployment .env (the realm import
// auto-provisions this client — see configs/keycloak/genie-realm.yaml).
const _clientId = String.fromEnvironment(
  'DEV_CLIENT_ID',
  defaultValue: 'genie_ai_mobile',
);

final devConfig = KeycloakConfig(
  keycloakUrl: 'https://$_server:$_port/auth',
  realm: 'genie',
  clientId: _clientId,
  redirectScheme: 'com.itu.genieai.dev',
  backendUrl: 'https://$_server:$_port',
  allowInsecureConnections: true,
  // MEWA Bangladesh ships English + Bengali only (parity with
  // VUE_APP_AVAILABLE_LOCALES=en,bn on the web).
  supportedLocaleCodes: const ['en', 'bn'],
);
