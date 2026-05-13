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
    onRefreshToken: () => ref.read(authProvider.notifier).refreshToken(),
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
