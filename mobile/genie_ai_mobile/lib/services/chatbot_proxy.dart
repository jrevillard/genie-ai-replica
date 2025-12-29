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
    String? contextLabels,
    String? language, // ADDED: Language parameter
  }) async {
    final Map<String, dynamic> payload = {
      'sessionId': sessionId,
      'messages': messages,
      'userId': userId,
      'timestamp': DateTime.now().toIso8601String(),
    };

    // Add language to payload if present
    if (language != null && language.isNotEmpty) {
      payload['language'] = language;
    }

    // Construct the 'context' object expected by the backend validation
    if ((categoryId != null && categoryId.isNotEmpty) ||
        (contextLabels != null && contextLabels.isNotEmpty)) {
      payload['context'] = {
        if (categoryId != null) 'categoryId': categoryId,
        if (contextLabels != null) 'labels': contextLabels,
      };

      // Keep root categoryId for backward compatibility if needed
      if (categoryId != null) payload['categoryId'] = categoryId;
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

  /// Submits feedback for a specific query response
  Future<Map<String, dynamic>> submitFeedback({
    required String queryId,
    required Map<String, dynamic> feedback,
  }) async {
    try {
      debugPrint("[CHATBOT_PROXY] Submitting feedback for $queryId: $feedback");

      final response = await _api.post('queries/$queryId/feedback', feedback);

      if (response.statusCode == 200 || response.statusCode == 201) {
        final Map<String, dynamic> data = jsonDecode(response.body);
        return data;
      } else {
        throw Exception('Feedback failed: ${response.statusCode}');
      }
    } catch (e) {
      debugPrint("[CHATBOT_PROXY] Feedback error: $e");
      rethrow;
    }
  }
}
