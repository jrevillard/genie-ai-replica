import 'dart:convert';
import 'package:genie_ai_mobile/services/api_service.dart';

class ServiceTreeProxy {
  final ApiService _api = ApiService();

  Future<List<dynamic>> getAllCategories({String locale = 'en'}) async {
    final categories = await _fetchAllCategories(locale: locale);
    if (locale.toLowerCase() == 'en' || !_hasMissingLabels(categories)) {
      return categories;
    }

    final fallbackCategories = await _fetchAllCategories(locale: 'en');
    return _mergeCategoryFallbacks(categories, fallbackCategories);
  }

  Future<List<dynamic>> getAdminCategories({String locale = 'en'}) async {
    final categories = await _fetchAdminCategories(locale: locale);
    if (locale.toLowerCase() == 'en' || !_hasMissingLabels(categories)) {
      return categories;
    }

    final fallbackCategories = await _fetchAdminCategories(locale: 'en');
    return _mergeCategoryFallbacks(categories, fallbackCategories);
  }

  Future<List<dynamic>> getCategoryServices(
    String categoryId, {
    String locale = 'en',
  }) async {
    final res = await _api.get(
      'services/categories/$categoryId',
      params: {'locale': locale},
    );
    final decoded = jsonDecode(res.body);
    final children = decoded['children'] ?? [];
    if (locale.toLowerCase() == 'en' || !_hasMissingLabels(children)) {
      return children;
    }

    final fallbackRes = await _api.get(
      'services/categories/$categoryId',
      params: {'locale': 'en'},
    );
    return _mergeChildrenFallbacks(
      children,
      jsonDecode(fallbackRes.body)['children'] ?? [],
    );
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

  Future<List<dynamic>> _fetchAllCategories({required String locale}) async {
    final res = await _api.get(
      'services/categories',
      params: {'locale': locale},
    );
    return jsonDecode(res.body);
  }

  Future<List<dynamic>> _fetchAdminCategories({required String locale}) async {
    final res = await _api.get(
      'service-categories/categories/detailed',
      params: {'locale': locale},
    );
    return jsonDecode(res.body);
  }

  List<dynamic> _mergeCategoryFallbacks(
    List<dynamic> categories,
    List<dynamic> fallbackCategories,
  ) {
    final fallbackByKey = <String, Map<String, dynamic>>{};
    for (final category in fallbackCategories) {
      if (category is! Map) continue;
      final key = _itemKey(category);
      if (key.isNotEmpty) {
        fallbackByKey[key] = Map<String, dynamic>.from(category);
      }
    }

    return categories.asMap().entries.map((entry) {
      final index = entry.key;
      final category = entry.value;
      if (category is! Map) {
        return _isBlankLabel(category) && index < fallbackCategories.length
            ? fallbackCategories[index]
            : category;
      }

      final merged = Map<String, dynamic>.from(category);
      final fallback =
          fallbackByKey[_itemKey(merged)] ??
          (index < fallbackCategories.length && fallbackCategories[index] is Map
              ? Map<String, dynamic>.from(fallbackCategories[index] as Map)
              : null);

      if (fallback == null) return merged;

      _copyFallbackLabel(merged, fallback);
      merged['children'] = _mergeChildrenFallbacks(
        (merged['children'] is List) ? merged['children'] as List : const [],
        (fallback['children'] is List)
            ? fallback['children'] as List
            : const [],
      );
      return merged;
    }).toList();
  }

  List<dynamic> _mergeChildrenFallbacks(List children, List fallbackChildren) {
    final fallbackByKey = <String, Map<String, dynamic>>{};
    for (final child in fallbackChildren) {
      if (child is! Map) continue;
      final key = _itemKey(child);
      if (key.isNotEmpty) fallbackByKey[key] = Map<String, dynamic>.from(child);
    }

    return children.asMap().entries.map((entry) {
      final index = entry.key;
      final child = entry.value;
      final fallback = index < fallbackChildren.length
          ? fallbackChildren[index]
          : null;

      if (child is! Map) {
        return _isBlankLabel(child) && fallback != null ? fallback : child;
      }

      final merged = Map<String, dynamic>.from(child);
      final keyedFallback =
          fallbackByKey[_itemKey(merged)] ??
          (fallback is Map ? Map<String, dynamic>.from(fallback) : null);
      if (keyedFallback != null) _copyFallbackLabel(merged, keyedFallback);
      return merged;
    }).toList();
  }

  void _copyFallbackLabel(
    Map<String, dynamic> item,
    Map<String, dynamic> fallback,
  ) {
    for (final key in const ['label', 'name', 'nameEN', 'title']) {
      if (_isBlankLabel(item[key]) && !_isBlankLabel(fallback[key])) {
        item[key] = fallback[key];
      }
    }

    if (_isBlankLabel(item['name']) && !_isBlankLabel(fallback['label'])) {
      item['name'] = fallback['label'];
    }
    if (_isBlankLabel(item['label']) && !_isBlankLabel(fallback['name'])) {
      item['label'] = fallback['name'];
    }
  }

  bool _hasMissingLabels(dynamic value) {
    if (value is List) return value.any(_hasMissingLabels);
    if (value is Map) {
      final hasLabelField =
          value.containsKey('label') ||
          value.containsKey('name') ||
          value.containsKey('nameEN') ||
          value.containsKey('title');
      if (hasLabelField &&
          _isBlankLabel(value['label']) &&
          _isBlankLabel(value['name']) &&
          _isBlankLabel(value['nameEN']) &&
          _isBlankLabel(value['title'])) {
        return true;
      }
      return value.values.any(_hasMissingLabels);
    }
    return _isBlankLabel(value);
  }

  bool _isBlankLabel(dynamic value) {
    if (value == null) return true;
    final text = value.toString().trim();
    return text.isEmpty || text.toLowerCase() == 'null';
  }

  String _itemKey(Map<dynamic, dynamic> item) {
    for (final key in const ['id', 'key', '_key', 'catKey', 'catCode']) {
      final value = item[key];
      if (!_isBlankLabel(value)) return value.toString();
    }
    return '';
  }
}
