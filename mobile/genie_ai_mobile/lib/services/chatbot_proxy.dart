import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:genie_ai_mobile/services/api_service.dart';

class ChatbotProxy {
  final ApiService _api = ApiService();

  Future<Map<String, dynamic>> submitQuery({
    required String sessionId,
    required List<Map<String, dynamic>> messages,
    required String userId,
    String? categoryId,
  }) async {
    final Map<String, dynamic> payload = {
      'sessionId': sessionId,
      'messages': messages,
      'userId': userId,
      'timestamp': DateTime.now().toIso8601String(),
    };

    if (categoryId != null && categoryId.isNotEmpty) {
      payload['categoryId'] = categoryId;
    }

    try {
      debugPrint("[CHATBOT_PROXY] Submitting query to /queries: $payload");

      final response = await _api.post('queries', payload);

      // Accept both 200 and 201 as success
      if (response.statusCode == 200 || response.statusCode == 201) {
        final Map<String, dynamic> data = jsonDecode(response.body);
        debugPrint("[CHATBOT_PROXY] Query successful: $data");
        return data;
      } else {
        throw Exception('Query failed: ${response.statusCode}');
      }
    } catch (e) {
      debugPrint("[CHATBOT_PROXY] Query error: $e");
      rethrow;
    }
  }
}