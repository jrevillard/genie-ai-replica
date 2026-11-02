// lib/services/api_service.dart
import 'dart:convert';
import 'package:http/http.dart' as http;

class ApiService {
  // Changed from static const to instance getter
  // This allows instance access (_api.baseUrl) while keeping the value constant
  //String get baseUrl => 'https://localhost/api';
  // For production, you can easily switch:
  String get baseUrl => 'https://genie-ai.itu.int/api';

  String? _accessToken;

  // Singleton pattern
  static final ApiService _instance = ApiService._internal();
  factory ApiService() => _instance;
  ApiService._internal();

  void setToken(String token) {
    print(
        '[ApiService] Setting access token: ${token.substring(0, token.length > 5 ? 5 : token.length)}...');
    _accessToken = token;
  }

  void clearToken() {
    print('[ApiService] Clearing access token');
    _accessToken = null;
  }

  String? get accessToken => _accessToken;

  Map<String, String> getHeaders({String contentType = 'application/json'}) {
    final headers = <String, String>{
      'Content-Type': contentType,
      if (_accessToken != null) 'Authorization': 'Bearer $_accessToken',
    };
    // print('[ApiService] Generated Headers: $headers');
    return headers;
  }

  Future<http.Response> get(String endpoint,
      {Map<String, dynamic>? params}) async {
    final uri = Uri.parse('$baseUrl/$endpoint').replace(
      queryParameters: params?.map((k, v) => MapEntry(k, v.toString())),
    );

    print('----------------------------------------------------------------');
    print('[API Request] GET');
    print('URL: $uri');

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

    print('----------------------------------------------------------------');
    print('[API Request] POST');
    print('URL: $uri');
    print('Body: ${jsonEncode(data)}');

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

    print('----------------------------------------------------------------');
    print('[API Request] PUT');
    print('URL: $uri');
    print('Body: ${jsonEncode(data)}');

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
      String endpoint, Map<String, dynamic> data) async {
    final uri = Uri.parse('$baseUrl/$endpoint');

    print('----------------------------------------------------------------');
    print('[API Request] PATCH');
    print('URL: $uri');
    print('Body: ${jsonEncode(data)}');

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

  Future<http.Response> delete(String endpoint,
      {Map<String, dynamic>? params}) async {
    final uri = Uri.parse('$baseUrl/$endpoint').replace(
      queryParameters: params?.map((k, v) => MapEntry(k, v.toString())),
    );

    print('----------------------------------------------------------------');
    print('[API Request] DELETE');
    print('URL: $uri');

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
    print('[API Response] Status Code: ${response.statusCode}');
    print('Body: ${response.body}');
    print('----------------------------------------------------------------');
  }

  void _logError(Object error, StackTrace stackTrace) {
    print('!!!!!!!!!!! [API EXCEPTION] !!!!!!!!!!!');
    print('Error: $error');
    print('Stack Trace: $stackTrace');
    print('----------------------------------------------------------------');
  }
}
