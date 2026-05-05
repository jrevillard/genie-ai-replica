import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:genie_ai_mobile/config/keycloak_config.dart';
import 'package:genie_ai_mobile/services/auth/auth_providers.dart';
import 'package:genie_ai_mobile/services/auth/token_storage.dart';

import 'auth_helper.dart';
import 'test_app.dart';

/// Obtains ROPC tokens and returns an [InMemoryTokenStorage] pre-populated
/// with them. Pass the returned storage to [createAuthenticatedContainer]
/// (or add it to your own overrides list).
Future<InMemoryTokenStorage> obtainE2ETokens({
  required AuthHelper auth,
  required KeycloakConfig config,
  required String username,
  required String password,
}) async {
  final tokens = await auth.getRopcToken(
    clientId: config.clientId,
    username: username,
    password: password,
  );

  final storage = InMemoryTokenStorage();
  final expiration = DateTime.tryParse(tokens['expires_at']!) ??
      DateTime.now().add(const Duration(seconds: 300));
  await storage.saveTokens(
    accessToken: tokens['access_token']!,
    idToken: tokens['id_token']!,
    refreshToken: tokens['refresh_token']!,
    accessTokenExpiration: expiration,
  );

  return storage;
}

/// Creates a [ProviderContainer] whose token storage is pre-populated with
/// ROPC tokens. Launch the app with [TestApp(container: container)] —
/// [AuthNotifier._initializeAuth] will find the tokens on first build and
/// transition directly to [AuthState.authenticated].
///
/// No call to [ProviderContainer.invalidate] is needed (and it would crash
/// anyway because AuthNotifier uses `late final` fields that cannot be
/// reassigned when build() runs a second time).
Future<ProviderContainer> createAuthenticatedContainer({
  required AuthHelper auth,
  required KeycloakConfig config,
  required String username,
  required String password,
}) async {
  final storage = await obtainE2ETokens(
    auth: auth,
    config: config,
    username: username,
    password: password,
  );

  return ProviderContainer(overrides: [
    ...testProviderOverrides,
    tokenStorageProvider.overrideWithValue(storage),
  ]);
}
