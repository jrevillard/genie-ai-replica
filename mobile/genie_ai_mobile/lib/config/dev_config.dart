import 'keycloak_config.dart';

const _server = String.fromEnvironment('DEV_SERVER', defaultValue: 'localhost');
const _port = String.fromEnvironment('DEV_PORT', defaultValue: '443');

final devConfig = KeycloakConfig(
  keycloakUrl: 'https://$_server:$_port/auth',
  realm: 'genie',
  clientId: 'genie-mobile-dev',
  redirectScheme: 'com.itu.genieai.dev',
  backendUrl: 'https://$_server:$_port',
  allowInsecureConnections: true,
);
