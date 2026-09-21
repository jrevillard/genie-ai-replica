import 'keycloak_config.dart';

const _server = String.fromEnvironment('DEV_SERVER', defaultValue: 'localhost');
const _port = String.fromEnvironment('DEV_PORT', defaultValue: '443');

// The El Salvador product (AgroGenio AI) ships English + Spanish only — the
// other 12 locales stay in the source for other deployments but must not
// surface in the dropdown on this flavor. (The `el_salvador` and `itu`
// flavors enforce the same whitelist; this matches their behaviour on the
// default dev build that talks to DEV_SERVER=10.0.0.101.)
final devConfig = KeycloakConfig(
  keycloakUrl: 'https://$_server:$_port/auth',
  realm: 'genie',
  clientId: 'genie-mobile-dev',
  redirectScheme: 'com.itu.genieai.dev',
  backendUrl: 'https://$_server:$_port',
  allowInsecureConnections: true,
  supportedLocaleCodes: ['en', 'es'],
);
