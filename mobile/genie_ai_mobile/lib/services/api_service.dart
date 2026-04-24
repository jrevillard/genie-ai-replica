// lib/services/api_service.dart
import 'dart:convert';
import 'package:http/http.dart' as http;

import 'auth/auth_logger.dart';

class ApiService {
  AuthLogger? _logger;

  String get baseUrl => 'https://genie-ai.itu.int/api';

  String? _accessToken;

  static final ApiService _instance = ApiService._internal();
  factory ApiService({AuthLogger? logger}) {
    if (logger != null) _instance._logger = logger;
    return _instance;
  }
  ApiService._internal();

  void setToken(String token) {
    _logger?.logAuthEvent(
      message: 'Access token set',
      source: 'ApiService.setToken',
    );
    _accessToken = token;
  }

  void clearToken() {
    _logger?.logAuthEvent(
      message: 'Access token cleared',
      source: 'ApiService.clearToken',
    );
    _accessToken = null;
  }

  String? get accessToken => _accessToken;

  Map<String, String> getHeaders({String contentType = 'application/json'}) {
    final headers = <String, String>{
      'Content-Type': contentType,
      if (_accessToken != null) 'Authorization': 'Bearer $_accessToken',
    };
    return headers;
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
      final response = await http.get(uri, headers: getHeaders());
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
      final response = await http.post(
        uri,
        headers: getHeaders(),
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
      final response = await http.put(
        uri,
        headers: getHeaders(),
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
      final response = await http.patch(
        uri,
        headers: getHeaders(),
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
      final response = await http.delete(uri, headers: getHeaders());
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
