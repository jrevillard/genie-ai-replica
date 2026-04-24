import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/http.dart' as http;

import '../../config/keycloak_config.dart';
import '../api_service.dart';
import '../keycloak/keycloak_service.dart';
import 'app_auth.dart';
import 'auth_logger.dart';
import 'auth_notifier.dart';
import 'auth_state.dart';
import 'token_storage.dart';

final tokenStorageProvider = Provider<TokenStorage>((ref) {
  return SecureTokenStorage();
});

final authLoggerProvider = Provider<AuthLogger>((ref) {
  final logger = AuthLogger();
  ApiService(logger: logger);
  return logger;
});

final keycloakServiceProvider = Provider<KeycloakService>((ref) {
  final client = http.Client();
  ref.onDispose(client.close);
  return KeycloakService(
    keycloakConfig: getConfig(),
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
