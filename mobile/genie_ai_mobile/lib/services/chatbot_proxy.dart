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
    String? categoryKey,
    String? contextLabels,
    String? language,
  }) async {
    // CRITICAL FIX: Clean userId to remove 'users/' prefix
    // This ensures backend profile lookup succeeds and avoids "User profile not found" warnings
    final cleanUserId = userId.startsWith('users/') ? userId.substring(6) : userId;

    // Build context object (matching Vue app's queryData.context)
    final Map<String, dynamic> context = {};

    // Always include language in context (UPPERCASE like Vue)
    context['language'] = (language ?? 'en').toUpperCase();

    // categoryLabel must be the category NAME (e.g. "Grain Crop Cultivation"),
    // NOT the _key. Backend resolves the name to _key via nameEN lookup.
    // categoryId parameter here is actually the category NAME (set by callers).
    if (categoryId != null && categoryId.isNotEmpty) {
      context['categoryLabel'] = categoryId;
    }
    // contextLabels parameter contains service label names as a comma-separated string or list
    if (contextLabels != null && contextLabels.isNotEmpty) {
      context['serviceLabels'] = contextLabels;
    }

    final Map<String, dynamic> payload = {
      'sessionId': sessionId,
      'messages': messages,
      'userId': cleanUserId,
      'timestamp': DateTime.now().toUtc().toIso8601String(),
    };

    // Add context if it has content (it should always have at least language)
    if (context.isNotEmpty) {
      payload['context'] = context;
    }

    // Add contextOption like Vue does
    if (categoryId != null && categoryId.isNotEmpty) {
      payload['contextOption'] = 'conversation-with-context-labels';
    }

    // If we have the raw category _key but no resolved name, send it directly
    // so the backend can use it as categoryId (backend checks queryData.categoryId first)
    if (categoryKey != null && categoryKey.isNotEmpty) {
      payload['categoryId'] = categoryKey;
    }

    try {
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
