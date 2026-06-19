import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/http.dart' as http;

import '../../config/keycloak_config.dart';
import '../keycloak/keycloak_service.dart';
import 'app_auth.dart';
import 'auth_logger.dart';
import 'auth_notifier.dart';
import 'auth_state.dart';
import 'connectivity_checker.dart';
import 'insecure_http_client.dart';
import 'token_storage.dart';

final tokenStorageProvider = Provider<TokenStorage>((ref) {
  return SecureTokenStorage();
});

final authLoggerProvider = Provider<AuthLogger>((ref) {
  return AuthLogger();
});

final keycloakServiceProvider = Provider<KeycloakService>((ref) {
  final config = getConfig();
  final http.Client client = config.allowInsecureConnections
      ? InsecureHttpClient()
      : http.Client();
  ref.onDispose(client.close);
  return KeycloakService(
    keycloakConfig: config,
    httpClient: client,
    logger: ref.read(authLoggerProvider),
  );
});

final appAuthProvider = Provider<AppAuth>((ref) {
  return const FlutterAppAuthAdapter();
});

final authProvider = NotifierProvider<AuthNotifier, AuthState>(
  AuthNotifier.new,
);

final connectivityCheckerProvider = Provider<ConnectivityChecker>((ref) {
  return RealConnectivityChecker();
});
