// lib/services/api_service.dart
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

class ApiService {
  // Changed from static const to instance getter
  // This allows instance access (_api.baseUrl) while keeping the value constant
  //String get baseUrl => 'https://localhost/api';
  // For production, you can easily switch:
  //String get baseUrl => 'https://genie-ai.itu.int/api';
  String get baseUrl => 'https://mvp.ai.assembly.govstack.global/api';

  String? _accessToken;

  // Singleton pattern
  static final ApiService _instance = ApiService._internal();
  factory ApiService() => _instance;
  ApiService._internal();

  void setToken(String token) {
    debugPrint(
      '[ApiService] Setting access token: ${token.substring(0, token.length > 5 ? 5 : token.length)}...',
    );
    _accessToken = token;
  }

  void clearToken() {
    debugPrint('[ApiService] Clearing access token');
    _accessToken = null;
  }

  String? get accessToken => _accessToken;

  Map<String, String> getHeaders({String contentType = 'application/json'}) {
    final headers = <String, String>{
      'Content-Type': contentType,
      if (_accessToken != null) 'Authorization': 'Bearer $_accessToken',
    };
    // debugPrint('[ApiService] Generated Headers: $headers');
    return headers;
  }

  Future<http.Response> get(
    String endpoint, {
    Map<String, dynamic>? params,
  }) async {
    final uri = Uri.parse('$baseUrl/$endpoint').replace(
      queryParameters: params?.map((k, v) => MapEntry(k, v.toString())),
    );

    debugPrint(
      '----------------------------------------------------------------',
    );
    debugPrint('[API Request] GET');
    debugPrint('URL: $uri');

    try {
      final response = await http.get(uri, headers: getHeaders());
      _logResponse(response);
      return response;
    } catch (e, stackTrace) {
      _logError(e, stackTrace);
      rethrow;
    }
  }

  Future<http.Response> post(String endpoint, Map<String, dynamic> data) async {
    final uri = Uri.parse('$baseUrl/$endpoint');

    debugPrint(
      '----------------------------------------------------------------',
    );
    debugPrint('[API Request] POST');
    debugPrint('URL: $uri');
    debugPrint('Body: ${jsonEncode(data)}');

    try {
      final response = await http.post(
        uri,
        headers: getHeaders(),
        body: jsonEncode(data),
      );
      _logResponse(response);
      return response;
    } catch (e, stackTrace) {
      _logError(e, stackTrace);
      rethrow;
    }
  }

  Future<http.Response> put(String endpoint, Map<String, dynamic> data) async {
    final uri = Uri.parse('$baseUrl/$endpoint');

    debugPrint(
      '----------------------------------------------------------------',
    );
    debugPrint('[API Request] PUT');
    debugPrint('URL: $uri');
    debugPrint('Body: ${jsonEncode(data)}');

    try {
      final response = await http.put(
        uri,
        headers: getHeaders(),
        body: jsonEncode(data),
      );
      _logResponse(response);
      return response;
    } catch (e, stackTrace) {
      _logError(e, stackTrace);
      rethrow;
    }
  }

  Future<http.Response> patch(
    String endpoint,
    Map<String, dynamic> data,
  ) async {
    final uri = Uri.parse('$baseUrl/$endpoint');

    debugPrint(
      '----------------------------------------------------------------',
    );
    debugPrint('[API Request] PATCH');
    debugPrint('URL: $uri');
    debugPrint('Body: ${jsonEncode(data)}');

    try {
      final response = await http.patch(
        uri,
        headers: getHeaders(),
        body: jsonEncode(data),
      );
      _logResponse(response);
      return response;
    } catch (e, stackTrace) {
      _logError(e, stackTrace);
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

    debugPrint(
      '----------------------------------------------------------------',
    );
    debugPrint('[API Request] DELETE');
    debugPrint('URL: $uri');

    try {
      final response = await http.delete(uri, headers: getHeaders());
      _logResponse(response);
      return response;
    } catch (e, stackTrace) {
      _logError(e, stackTrace);
      rethrow;
    }
  }

  void _logResponse(http.Response response) {
    debugPrint('[API Response] Status Code: ${response.statusCode}');
    debugPrint('Body: ${response.body}');
    debugPrint(
      '----------------------------------------------------------------',
    );
  }

  void _logError(Object error, StackTrace stackTrace) {
    debugPrint('!!!!!!!!!!! [API EXCEPTION] !!!!!!!!!!!');
    debugPrint('Error: $error');
    debugPrint('Stack Trace: $stackTrace');
    debugPrint(
      '----------------------------------------------------------------',
    );
  }
}
