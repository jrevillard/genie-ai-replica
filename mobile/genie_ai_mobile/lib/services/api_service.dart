import 'dart:convert';
import 'package:http/http.dart' as http;

class ApiService {
  static const String baseUrl = 'https://localhost/api'; 
  String? _accessToken;

  static final ApiService _instance = ApiService._internal();
  factory ApiService() => _instance;
  ApiService._internal();

  void setToken(String token) => _accessToken = token;
  void clearToken() => _accessToken = null;

  Map<String, String> getHeaders() {
    return {
      'Content-Type': 'application/json',
      if (_accessToken != null) 'Authorization': 'Bearer $_accessToken',
    };
  }

  Future<http.Response> get(String endpoint, {Map<String, dynamic>? params}) async {
    final uri = Uri.parse('$baseUrl/$endpoint').replace(
      queryParameters: params?.map((k, v) => MapEntry(k, v.toString()))
    );
    return await http.get(uri, headers: getHeaders());
  }

  Future<http.Response> post(String endpoint, Map<String, dynamic> data) async {
    return await http.post(Uri.parse('$baseUrl/$endpoint'), headers: getHeaders(), body: jsonEncode(data));
  }

  Future<http.Response> put(String endpoint, Map<String, dynamic> data) async {
    return await http.put(Uri.parse('$baseUrl/$endpoint'), headers: getHeaders(), body: jsonEncode(data));
  }

  Future<http.Response> patch(String endpoint, Map<String, dynamic> data) async {
    return await http.patch(Uri.parse('$baseUrl/$endpoint'), headers: getHeaders(), body: jsonEncode(data));
  }

  Future<http.Response> delete(String endpoint, {Map<String, dynamic>? params}) async {
    final uri = Uri.parse('$baseUrl/$endpoint').replace(
      queryParameters: params?.map((k, v) => MapEntry(k, v.toString()))
    );
    return await http.delete(uri, headers: getHeaders());
  }
}