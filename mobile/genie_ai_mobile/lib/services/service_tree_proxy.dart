import 'dart:convert';
import 'package:http/http.dart' as http;

import 'package:genie_ai_mobile/services/api_service.dart';

class ServiceTreeProxy {
  final ApiService _api;

  ServiceTreeProxy({http.Client? httpClient})
      : _api = ApiService(httpClient: httpClient ?? http.Client());

  Future<List<dynamic>> getAllCategories({String locale = 'en'}) async {
    final res = await _api.get(
      'services/categories',
      params: {'locale': locale},
    );
    return jsonDecode(res.body);
  }

  Future<List<dynamic>> getAdminCategories({String locale = 'en'}) async {
    final res = await _api.get(
      'service-categories/categories/detailed',
      params: {'locale': locale},
    );
    return jsonDecode(res.body);
  }

  Future<List<dynamic>> getCategoryServices(
    String categoryId, {
    String locale = 'en',
  }) async {
    final res = await _api.get(
      'services/categories/$categoryId',
      params: {'locale': locale},
    );
    return jsonDecode(res.body)['children'] ?? [];
  }

  Future<Map<String, dynamic>> searchServices(
    String query, {
    String locale = 'en',
  }) async {
    final res = await _api.get(
      'services/search',
      params: {'query': query, 'locale': locale},
    );
    return jsonDecode(res.body);
  }

  Future<Map<String, dynamic>> createCategory(
    Map<String, dynamic> payload,
  ) async {
    final res = await _api.post('service-categories', payload);
    return jsonDecode(res.body);
  }

  Future<Map<String, dynamic>> updateCategory(
    String id,
    Map<String, dynamic> payload,
  ) async {
    final res = await _api.put('service-categories/$id', payload);
    return jsonDecode(res.body);
  }

  Future<Map<String, dynamic>> createService(
    String catId,
    Map<String, dynamic> payload,
  ) async {
    final res = await _api.post('service-categories/$catId/services', payload);
    return jsonDecode(res.body);
  }

  Future<Map<String, dynamic>> deleteCategory(String id) async {
    final res = await _api.delete('service-categories/$id');
    return jsonDecode(res.body);
  }
}
