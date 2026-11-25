import 'keycloak_config.dart';

// The two known-good test targets are checked in so neither needs dart-defines:
//
//   101 (test)    flutter build apk --debug --flavor dev          -> this file
//   prod          flutter build apk --debug --flavor el_salvador  -> flavors/el_salvador.dart
//
// 10.0.0.101 is the project's dev server (bb-ai-vm-02, `genieai` stack), so it is
// the default here rather than `localhost`. Override for a genuinely local stack
// with --dart-define=DEV_SERVER=localhost.
//
// The clientId/redirectScheme below are the ones already registered in 101's
// Keycloak — changing them breaks the OAuth redirect.
const _server = String.fromEnvironment(
  'DEV_SERVER',
  defaultValue: '10.0.0.101',
);
const _port = String.fromEnvironment('DEV_PORT', defaultValue: '443');

// Locale whitelist: NOT set here — the dev default keeps every shipped
// locale active (the main-branch contract its own test suite asserts).
// The El Salvador product (AgroGenio AI) ships English + Spanish only, and
// that restriction lives in the flavor that builds the product:
// `flavors/el_salvador.dart` sets supportedLocaleCodes: ['en', 'es'] — a dev
// build from this file is not a product build.
final devConfig = KeycloakConfig(
  keycloakUrl: 'https://$_server:$_port/auth',
  realm: 'genie',
  clientId: 'genie-mobile-dev',
  redirectScheme: 'com.itu.genieai.dev',
  backendUrl: 'https://$_server:$_port',
  allowInsecureConnections: true,
);
