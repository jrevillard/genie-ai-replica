import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/http.dart' as http;
import 'package:openapi/api.dart';

import '../config/keycloak_config.dart';
import '../services/auth/auth_interceptor.dart';
import '../services/auth/auth_providers.dart';
import '../services/auth/insecure_http_client.dart';

final authenticatedApiProvider = Provider<ApiClient>((ref) {
  final config = getConfig();
  final tokenStorage = ref.watch(tokenStorageProvider);
  final logger = ref.read(authLoggerProvider);
  final client = config.allowInsecureConnections
      ? InsecureHttpClient()
      : http.Client();

  final interceptor = AuthInterceptor(
    inner: client,
    tokenStorage: tokenStorage,
    // #2019 half-two: this closure used to read `authProvider.notifier` —
    // an element inside authProvider's own listener tree, so Riverpod 3
    // raised CircularDependencyError on EVERY refresh and a 401 could
    // never recover (the 2026-11-20 emulator session deaths). The leaf
    // refresher shares the in-flight refresh with the notifier without
    // re-entering the auth graph.
    onRefreshToken: () => ref.read(tokenRefresherProvider).refresh(),
    logger: logger,
  );
  ref.onDispose(() {
    interceptor.close();
    client.close();
  });

  return ApiClient(basePath: config.backendUrl)..client = interceptor;
});

final authenticatedHttpClientProvider = Provider<http.Client>((ref) {
  return ref.watch(authenticatedApiProvider).client;
});

final backendUrlProvider = Provider<String>((ref) {
  return getConfig().backendUrl;
});

final currentUserApiProvider = Provider<CurrentUserApi>((ref) {
  return CurrentUserApi(ref.watch(authenticatedApiProvider));
});

final chatHistoryApiProvider = Provider<ChatHistoryApi>((ref) {
  return ChatHistoryApi(ref.watch(authenticatedApiProvider));
});

final queriesApiProvider = Provider<QueriesApi>((ref) {
  return QueriesApi(ref.watch(authenticatedApiProvider));
});

final serviceCategoriesApiProvider = Provider<ServiceCategoriesApi>((ref) {
  return ServiceCategoriesApi(ref.watch(authenticatedApiProvider));
});

final servicesApiProvider = Provider<ServicesApi>((ref) {
  return ServicesApi(ref.watch(authenticatedApiProvider));
});

final analyticsApiProvider = Provider<AnalyticsApi>((ref) {
  return AnalyticsApi(ref.watch(authenticatedApiProvider));
});

final weatherApiProvider = Provider<WeatherApi>((ref) {
  return WeatherApi(ref.watch(authenticatedApiProvider));
});

final translationApiProvider = Provider<TranslationApi>((ref) {
  return TranslationApi(ref.watch(authenticatedApiProvider));
});

final authenticationApiProvider = Provider<AuthenticationApi>((ref) {
  return AuthenticationApi(ref.watch(authenticatedApiProvider));
});

final okfApiProvider = Provider<OkfApi>((ref) {
  return OkfApi(ref.watch(authenticatedApiProvider));
});
