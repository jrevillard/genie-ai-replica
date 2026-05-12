import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:genie_ai_mobile/services/api_service.dart';

class ChatbotProxy {
  final ApiService _api = ApiService();
  static DateTime? _loginTime;

  static void markLoginNow() {
    _loginTime = DateTime.now();
  }

  Future<Map<String, dynamic>> submitQuery({
    required String sessionId,
    required List<Map<String, dynamic>> messages,
    required String userId,
    String? categoryId,
    String? contextLabels,
    String? language,
  }) async {
    final now = DateTime.now();
    final loginTime = _loginTime ?? now;
    final Map<String, dynamic> payload = {
      'sessionId': sessionId,
      'messages': messages,
      'userId': userId,
      'timestamp': now.toUtc().toIso8601String(),
      'clientContext': {
        'currentTimeIso': now.toUtc().toIso8601String(),
        'loginTimeIso': loginTime.toUtc().toIso8601String(),
        'timezoneOffsetMinutes': now.timeZoneOffset.inMinutes,
        'timezoneName': now.timeZoneName,
        'locale': language,
        'platform': kIsWeb ? 'web' : defaultTargetPlatform.name,
      },
    };

    if (language != null && language.isNotEmpty) {
      payload['language'] = language;
    }

    if ((categoryId != null && categoryId.isNotEmpty) ||
        (contextLabels != null && contextLabels.isNotEmpty)) {
      payload['context'] = {
        'categoryId': ?categoryId,
        'labels': ?contextLabels,
      };
      if (categoryId != null) payload['categoryId'] = categoryId;
    }

    try {
      debugPrint("[CHATBOT_PROXY] Submitting query to /queries: $payload");

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
        feedback['userId'] = (feedback['userId'] as String).replaceFirst(
          'users/',
          '',
        );
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
