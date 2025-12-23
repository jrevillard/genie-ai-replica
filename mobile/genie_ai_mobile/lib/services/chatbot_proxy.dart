import 'dart:convert';
import 'package:genie_ai_mobile/services/api_service.dart';

class ChatbotProxy {
  final ApiService _api = ApiService();

  Future<Map<String, dynamic>> submitQuery(String text, String categoryId) async {
    final response = await _api.post('queries', {
      'query': text,
      'categoryId': categoryId,
      'timestamp': DateTime.now().toIso8601String(), //
    });

    if (response.statusCode == 200) {
      return jsonDecode(response.body);
    } else {
      throw Exception('Query Submission Failed');
    }
  }
}