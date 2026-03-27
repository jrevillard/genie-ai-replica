import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:genie_ai_mobile/services/api_service.dart';
import 'dart:convert' as convert;

class ChatbotProxy {
  final ApiService _api = ApiService();

  Future<Map<String, dynamic>> submitQuery({
    required String sessionId,
    required List<Map<String, dynamic>> messages,
    required String userId,
    String? categoryId,
    String? contextLabels,
    String? language,
  }) async {
    // DEBUG: Log the incoming language parameter
    print("[CHATBOT_PROXY] submitQuery called with language: '$language'");

    // Build context object first (like Vue does)
    // Backend checks context.language FIRST (line 1238 of genieai_chatqna.py)
    final Map<String, dynamic> context = {};

    // Always include language in context (UPPERCASE like Vue)
    context['language'] = (language ?? 'en').toUpperCase();

    if (categoryId != null && categoryId.isNotEmpty) {
      context['categoryLabel'] = categoryId;  // Vue uses 'categoryLabel', not 'categoryId'
    }
    if (contextLabels != null && contextLabels.isNotEmpty) {
      context['serviceLabels'] = contextLabels;  // Vue uses 'serviceLabels', not 'labels'
    }

    final Map<String, dynamic> payload = {
      'sessionId': sessionId,
      'messages': messages,
      'userId': userId,
      'timestamp': DateTime.now().toIso8601String(),
    };

    // Add context if it has content (it should always have at least language)
    if (context.isNotEmpty) {
      payload['context'] = context;
    }

    // Add contextOption like Vue does
    if (categoryId != null && categoryId.isNotEmpty) {
      payload['contextOption'] = 'conversation-with-context-labels';
    }

    print("[CHATBOT_PROXY] Context object: $context");
    print("[CHATBOT_PROXY] Payload keys: ${payload.keys.toList()}");
    print("[CHATBOT_PROXY] Context in JSON: ${jsonEncode(context)}");
    print("[CHATBOT_PROXY] Full payload with context: ${jsonEncode(payload)}");

    try {
      print("[CHATBOT_PROXY] Submitting query to /queries");
      print("[CHATBOT_PROXY] Payload as JSON: ${jsonEncode(payload)}");

      final response = await _api.post('queries', payload);

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
      // FIX: Ensure userId in body is clean (remove 'users/' prefix)
      // This solves the backend warning "userId in body does not match token userId"
      if (feedback.containsKey('userId') && feedback['userId'] is String) {
        feedback['userId'] =
            (feedback['userId'] as String).replaceFirst('users/', '');
      }

      // Note: queryId here should now be clean (e.g. "274711...") thanks to the fix in the Dialog.
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
