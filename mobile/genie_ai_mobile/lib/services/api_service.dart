import 'dart:convert';
import 'package:genie_ai_mobile/config/keycloak_config.dart' show getConfig;
import 'package:http/http.dart' as http;

import 'auth/auth_logger.dart';

class ApiService {
  final http.Client _httpClient;
  final String baseUrl;
  final AuthLogger? _logger;

  // Backward-compatible: existing code calls ApiService(logger: logger).
  // The logger parameter is accepted but http.Client defaults to a new instance
  // and baseUrl defaults to config — this matches the old singleton behavior.
  // TODO(epic-6): remove — all consumers migrated to apiServiceProvider
  ApiService({
    http.Client? httpClient,
    String? baseUrl,
    AuthLogger? logger,
  })  : _httpClient = httpClient ?? http.Client(),
        baseUrl = baseUrl ?? getConfig().backendUrl,
        _logger = logger;

  // TODO(epic-6): remove — use AuthInterceptor via apiServiceProvider
  @Deprecated('Epic 6 Story 6.1 will remove this. Use AuthInterceptor via apiServiceProvider.')
  void setToken(String token) {
    _logger?.logApiError(
      httpStatus: 0,
      endpoint: 'deprecated',
      message: 'setToken() is deprecated — use AuthInterceptor',
      source: 'ApiService.setToken',
    );
  }

  // TODO(epic-6): remove — use AuthInterceptor via apiServiceProvider
  @Deprecated('Epic 6 Story 6.1 will remove this. Use AuthInterceptor via apiServiceProvider.')
  void clearToken() {
    _logger?.logApiError(
      httpStatus: 0,
      endpoint: 'deprecated',
      message: 'clearToken() is deprecated — use AuthInterceptor',
      source: 'ApiService.clearToken',
    );
  }

  // TODO(epic-6): remove — use AuthInterceptor via apiServiceProvider
  @Deprecated('Epic 6 Story 6.1 will remove this. Use AuthInterceptor via apiServiceProvider.')
  String? get accessToken => null;

  // TODO(epic-6): remove — use AuthInterceptor via apiServiceProvider
  @Deprecated('Epic 6 Story 6.1 will remove this. Use AuthInterceptor via apiServiceProvider.')
  Map<String, String> getHeaders({String contentType = 'application/json'}) {
    _logger?.logApiError(
      httpStatus: 0,
      endpoint: 'deprecated',
      message: 'getHeaders() is deprecated — use AuthInterceptor',
      source: 'ApiService.getHeaders',
    );
    return {'Content-Type': contentType};
  }

  Future<http.Response> get(
    String endpoint, {
    Map<String, dynamic>? params,
  }) async {
    final uri = Uri.parse('$baseUrl/$endpoint').replace(
      queryParameters: params?.map((k, v) => MapEntry(k, v.toString())),
    );

    _logger?.logAuthEvent(
      message: 'GET $endpoint',
      source: 'ApiService.get',
    );

    try {
      final response = await _httpClient.get(uri, headers: {'Content-Type': 'application/json'});
      _logResponse(response, endpoint);
      return response;
    } catch (e, _) {
      _logError(e, endpoint);
      rethrow;
    }
  }

  Future<http.Response> post(String endpoint, Map<String, dynamic> data) async {
    final uri = Uri.parse('$baseUrl/$endpoint');

    _logger?.logAuthEvent(
      message: 'POST $endpoint',
      source: 'ApiService.post',
    );

    try {
      final response = await _httpClient.post(
        uri,
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode(data),
      );
      _logResponse(response, endpoint);
      return response;
    } catch (e, _) {
      _logError(e, endpoint);
      rethrow;
    }
  }

  Future<http.Response> put(String endpoint, Map<String, dynamic> data) async {
    final uri = Uri.parse('$baseUrl/$endpoint');

    _logger?.logAuthEvent(
      message: 'PUT $endpoint',
      source: 'ApiService.put',
    );

    try {
      final response = await _httpClient.put(
        uri,
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode(data),
      );
      _logResponse(response, endpoint);
      return response;
    } catch (e, _) {
      _logError(e, endpoint);
      rethrow;
    }
  }

  Future<http.Response> patch(
    String endpoint,
    Map<String, dynamic> data,
  ) async {
    final uri = Uri.parse('$baseUrl/$endpoint');

    _logger?.logAuthEvent(
      message: 'PATCH $endpoint',
      source: 'ApiService.patch',
    );

    try {
      final response = await _httpClient.patch(
        uri,
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode(data),
      );
      _logResponse(response, endpoint);
      return response;
    } catch (e, _) {
      _logError(e, endpoint);
      rethrow;
    }
  }

  Future<http.Response> delete(
    String endpoint, {
    Map<String, dynamic>? params,
  }) async {
    final uri = Uri.parse('$baseUrl/$endpoint').replace(
      queryParameters: params?.map((k, v) => MapEntry(k, v.toString())),
    );

    _logger?.logAuthEvent(
      message: 'DELETE $endpoint',
      source: 'ApiService.delete',
    );

    try {
      final response = await _httpClient.delete(uri, headers: {'Content-Type': 'application/json'});
      _logResponse(response, endpoint);
      return response;
    } catch (e, _) {
      _logError(e, endpoint);
      rethrow;
    }
  }

  void _logResponse(http.Response response, String endpoint) {
    if (response.statusCode >= 400) {
      _logger?.logApiError(
        httpStatus: response.statusCode,
        endpoint: endpoint,
        message: 'HTTP ${response.statusCode}',
        source: 'ApiService',
      );
    }
  }

  void _logError(Object error, String endpoint) {
    _logger?.logApiError(
      httpStatus: 0,
      endpoint: endpoint,
      message: '$error',
      source: 'ApiService',
    );
  }
}
