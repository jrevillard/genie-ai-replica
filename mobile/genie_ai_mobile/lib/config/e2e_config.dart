import 'keycloak_config.dart';

// The local build's edge is nginx on host 80/443 — nothing publishes host
// 8443 (the compose keeps Kong internal-only), so the emulator reaches the
// edge through the slirp host-loopback alias 10.0.2.2 on 443. The old 8443
// default died with the mixed-age stack that happened to hold that port.
// allowInsecureConnections accepts the edge's self-signed cert; a deployment
// that serves a different edge overrides both via dart-defines.
const _keycloakUrl = String.fromEnvironment(
  'E2E_KEYCLOAK_URL',
  defaultValue: 'https://10.0.2.2/auth',
);
const _backendUrl = String.fromEnvironment(
  'E2E_BACKEND_URL',
  defaultValue: 'https://10.0.2.2',
);

final e2eConfig = KeycloakConfig(
  keycloakUrl: _keycloakUrl,
  realm: 'genie',
  clientId: 'genie-mobile-e2e',
  redirectScheme: 'com.itu.genieai.e2e',
  backendUrl: _backendUrl,
  allowInsecureConnections: true,
  // The local Keycloak advertises https://localhost/auth/... — inside an
  // emulator that is the DEVICE (nothing listens there). Discovery reached
  // Keycloak through the 10.0.2.2 slirp alias, so the advertised endpoints
  // are rewritten to that origin (token POST, end session and the
  // authorization page all follow it).
  rewriteAdvertisedOrigins: true,
);
