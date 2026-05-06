import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:genie_ai_mobile/services/api_service.dart';
import 'package:genie_ai_mobile/services/sse_parser.dart';

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
    final Map<String, dynamic> payload = {
      'sessionId': sessionId,
      'messages': messages,
      'userId': userId,
      'timestamp': DateTime.now().toUtc().toIso8601String(),
    };

    if (language != null && language.isNotEmpty) {
      payload['language'] = language;
    }

    if ((categoryId != null && categoryId.isNotEmpty) ||
        (contextLabels != null && contextLabels.isNotEmpty)) {
      payload['context'] = {
        if (categoryId != null) 'categoryId': categoryId,
        if (contextLabels != null) 'labels': contextLabels,
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

  /// Submits a streaming query via SSE.
  ///
  /// [httpClient] must be the AuthInterceptor-wrapped client from
  /// Riverpod's `apiServiceProvider` so that Bearer tokens are auto-injected.
  /// Returns parsed [SseEvent] objects as they arrive.
  ///
  /// If the backend returns a non-200 status (e.g. 501 streaming disabled),
  /// this falls back to [submitQuery] for a non-streaming response.
  Stream<SseEvent> submitQueryStream({
    required http.Client httpClient,
    required String baseUrl,
    required String sessionId,
    required List<Map<String, dynamic>> messages,
    required String userId,
    String? categoryId,
    String? contextLabels,
    String? language,
  }) async* {
    final Map<String, dynamic> payload = {
      'sessionId': sessionId,
      'messages': messages,
      'userId': userId,
      'timestamp': DateTime.now().toUtc().toIso8601String(),
    };

    if (language != null && language.isNotEmpty) {
      payload['language'] = language;
    }

    if ((categoryId != null && categoryId.isNotEmpty) ||
        (contextLabels != null && contextLabels.isNotEmpty)) {
      payload['context'] = {
        if (categoryId != null) 'categoryId': categoryId,
        if (contextLabels != null) 'labels': contextLabels,
      };
      if (categoryId != null) payload['categoryId'] = categoryId;
    }

    final uri = Uri.parse('$baseUrl/queries/stream');
    final request = http.Request('POST', uri);
    request.headers['Content-Type'] = 'application/json';
    request.body = jsonEncode(payload);

    debugPrint("[CHATBOT_PROXY] Submitting streaming query to /queries/stream");

    final streamedResponse = await httpClient.send(request);

    if (streamedResponse.statusCode == 501) {
      // Streaming disabled on backend — fall back to non-streaming
      debugPrint("[CHATBOT_PROXY] Streaming disabled (501), falling back");
      final body = await streamedResponse.stream.bytesToString();
      throw StreamingDisabledException(body);
    }

    if (streamedResponse.statusCode != 200) {
      final body = await streamedResponse.stream.bytesToString();
      throw StreamHttpException(streamedResponse.statusCode, body);
    }

    final parser = SseParser();
    await for (final chunk in streamedResponse.stream.transform(
      const _Utf8ChunkDecoder(),
    )) {
      for (final event in parser.parseChunk(chunk)) {
        yield event;
      }
    }
    for (final event in parser.flush()) {
      yield event;
    }
  }

  /// Submits feedback for a specific query response
  Future<Map<String, dynamic>> submitFeedback({
    required String queryId,
    required Map<String, dynamic> feedback,
  }) async {
    try {
      if (feedback.containsKey('userId') && feedback['userId'] is String) {
        feedback['userId'] = (feedback['userId'] as String).replaceFirst(
          'users/',
          '',
        );
      }

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

class StreamingDisabledException implements Exception {
  final String body;
  const StreamingDisabledException(this.body);
  @override
  String toString() => 'StreamingDisabledException: $body';
}

class StreamHttpException implements Exception {
  final int statusCode;
  final String body;
  const StreamHttpException(this.statusCode, this.body);
  @override
  String toString() => 'StreamHttpException: $statusCode $body';
}

class _Utf8ChunkDecoder extends Converter<List<int>, String> {
  const _Utf8ChunkDecoder();

  @override
  String convert(List<int> input) => utf8.decode(input, allowMalformed: true);

  @override
  Sink<List<int>> startChunkedConversion(Sink<String> sink) {
    return _Utf8Sink(sink);
  }
}

class _Utf8Sink implements Sink<List<int>> {
  final Sink<String> _outputSink;
  final List<int> _buffer = [];

  _Utf8Sink(this._outputSink);

  @override
  void add(List<int> chunk) {
    _buffer.addAll(chunk);
    final decoded = utf8.decode(_buffer, allowMalformed: true);
    _buffer.clear();
    _outputSink.add(decoded);
  }

  @override
  void close() {
    if (_buffer.isNotEmpty) {
      _outputSink.add(utf8.decode(_buffer, allowMalformed: true));
      _buffer.clear();
    }
    _outputSink.close();
  }
}
