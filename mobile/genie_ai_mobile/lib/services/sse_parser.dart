import 'dart:convert';

/// Parsed SSE event from the backend /queries/stream endpoint.
///
/// Event types:
/// - chunk: Incremental LLM token
/// - metadata: Source documents and confidence score
/// - translation: Translated response replacing streamed content
/// - done: Stream complete, carries queryId
/// - error: Stream-level error from the backend
sealed class SseEvent {
  const SseEvent();
}

class SseChunkEvent extends SseEvent {
  final String content;
  const SseChunkEvent(this.content);
}

class SseMetadataEvent extends SseEvent {
  final List<dynamic> sourceDocuments;
  final double confidenceScore;
  final int? responseTime;
  final bool isGrounded;
  const SseMetadataEvent({
    required this.sourceDocuments,
    required this.confidenceScore,
    required this.isGrounded,
    this.responseTime,
  });
}

class SseTranslationEvent extends SseEvent {
  final String content;
  const SseTranslationEvent(this.content);
}

class SseDoneEvent extends SseEvent {
  final String? queryId;
  const SseDoneEvent(this.queryId);
}

class SseErrorEvent extends SseEvent {
  final String message;
  final String? code;
  const SseErrorEvent(this.message, {this.code});
}

/// Parses an SSE text stream from the backend into typed [SseEvent] objects.
///
/// Usage:
/// ```dart
/// final streamedResponse = await request.send();
/// await for (final chunk in streamedResponse.stream.transform(utf8.decoder)) {
///   for (final event in SseParser.parseChunk(chunk)) {
///     // handle event
///   }
/// }
/// // Flush any remaining buffered lines:
/// for (final event in SseParser.flush()) { ... }
/// ```
class SseParser {
  String _buffer = '';

  /// Feed a raw text chunk from the HTTP stream.
  /// Returns parsed events (may be empty if chunk was incomplete).
  List<SseEvent> parseChunk(String chunk) {
    _buffer += chunk;
    final events = <SseEvent>[];
    final lines = _buffer.split('\n');
    _buffer = lines.removeLast();

    for (final line in lines) {
      final trimmed = line.trim();
      if (trimmed.isEmpty) continue;
      if (trimmed.startsWith(': ')) continue; // SSE comment / keepalive
      if (!trimmed.startsWith('data: ')) continue;

      final data = trimmed.substring(6);
      if (data == '[DONE]') {
        events.add(const SseDoneEvent(null));
        continue;
      }

      try {
        final json = jsonDecode(data) as Map<String, dynamic>;
        final event = _parseEvent(json);
        if (event != null) events.add(event);
      } catch (_) {
        // Malformed JSON — skip
      }
    }

    return events;
  }

  /// Flush any remaining buffered content.
  List<SseEvent> flush() {
    if (_buffer.trim().isEmpty) return [];
    final remaining = _buffer;
    _buffer = '';
    return parseChunk('$remaining\n');
  }

  SseEvent? _parseEvent(Map<String, dynamic> json) {
    final type = json['type'] as String?;
    return switch (type) {
      'chunk' => SseChunkEvent(json['content'] as String? ?? ''),
      'metadata' => SseMetadataEvent(
        sourceDocuments: json['source_documents'] as List<dynamic>? ?? [],
        confidenceScore: (json['confidence_score'] as num?)?.toDouble() ?? 0.0,
        isGrounded: json['is_grounded'] as bool? ?? false,
        responseTime: json['responseTime'] as int?,
      ),
      'translation' => SseTranslationEvent(json['content'] as String? ?? ''),
      'done' => SseDoneEvent(json['queryId'] as String?),
      'error' => SseErrorEvent(
        json['message'] as String? ?? 'Unknown error',
        code: json['code'] as String?,
      ),
      _ => null,
    };
  }
}
