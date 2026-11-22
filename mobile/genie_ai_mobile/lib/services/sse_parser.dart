import 'dart:convert';

/// Parsed SSE event from the backend /queries/stream endpoint.
///
/// Event types:
/// - chunk: Incremental LLM token
/// - metadata: Source documents and confidence score
/// - translation: Translated response replacing streamed content
/// - done: Stream complete, carries queryId and the translation failure flag
/// - error: Stream-level error from the backend
/// - agent_activity: One agent tool call's lifecycle (additive, versioned
///   frame; the BFF writes it between the chunks)
/// - agent_verdict: The grounding verdict of the finished answer (additive,
///   versioned frame; the BFF writes it after the last chunk, before
///   metadata)
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

  /// What the query-translation step fed the embedder ("translated",
  /// "passthrough_english", "passthrough_unknown_language",
  /// "fallback_timeout" or "fallback_error").
  ///
  /// A non-English query whose translation timed out is embedded in its
  /// source language, which degrades retrieval against the English corpus.
  /// The non-streaming path keeps the whole metadata map; the streamed path
  /// rebuilds it, so the field has to be carried here for the two paths to
  /// report the same thing.
  final String? queryTranslationStatus;

  /// The grounding verdict of the finished answer, tri-state (`grounded` |
  /// `ungrounded` | `unverified`). Present only on the agentic path — its
  /// absence is how a legacy turn is told apart, and the legacy
  /// `is_grounded` fallback then decides the answer-level warning alone.
  final String? groundingStatus;

  /// Chatqna metadata keys outside the known set above, carried verbatim on
  /// the parsed event so a new diagnostic field survives the parser boundary
  /// without a parser edit. The backend parser (query-service.js) passes
  /// chatqna's unknown metadata keys through the same way; a field-by-field
  /// whitelist here is how `abstained`, `abstention_reason`, `filter_labels`
  /// and `self_confidence` were each lost on mobile until a hand edit. The
  /// keys in `SseParser._knownMetadataKeys` are normalized above and never
  /// appear here.
  final Map<String, dynamic> extra;

  const SseMetadataEvent({
    required this.sourceDocuments,
    required this.confidenceScore,
    required this.isGrounded,
    this.responseTime,
    this.queryTranslationStatus,
    this.groundingStatus,
    this.extra = const {},
  });
}

class SseTranslationEvent extends SseEvent {
  final String content;
  const SseTranslationEvent(this.content);
}

class SseDoneEvent extends SseEvent {
  final String? queryId;

  /// Whether the answer could not be translated into the requested language.
  ///
  /// The backend translates the answer after the stream ends. When that
  /// translation fails, the answer the client holds is the English original:
  /// the flag is what tells the client to say so instead of showing English
  /// as if it were the requested language.
  final bool translationFailed;

  const SseDoneEvent(this.queryId, {this.translationFailed = false});
}

class SseErrorEvent extends SseEvent {
  final String message;
  final String? code;
  const SseErrorEvent(this.message, {this.code});
}

/// One agent tool call's lifecycle (`agent_activity` frame, version 1).
///
/// The BFF writes one frame per tool-call event, interleaved with the
/// chunks; [status] is the raw wire value (`started` | `completed` |
/// `failed`) and the renderer maps it — an unknown status degrades to a
/// running row rather than dropping the frame.
class SseAgentActivityEvent extends SseEvent {
  final String? operation;

  /// Raw wire status: `started`, `completed` or `failed`.
  final String status;
  final String? callId;

  const SseAgentActivityEvent({
    required this.status,
    this.operation,
    this.callId,
  });
}

/// The grounding verdict of the finished answer (`agent_verdict` frame,
/// version 1), written after the last chunk and before metadata.
///
/// The answer-level warning renders from the METADATA frame, which carries
/// the same `grounding_status`/`is_grounded` pair and is what a restored
/// conversation persists — the verdict frame itself is typed here so the
/// envelope is pinned, its projection keys beyond the two normalized ones
/// ride [extra] verbatim.
class SseAgentVerdictEvent extends SseEvent {
  final String? groundingStatus;
  final bool isGrounded;

  /// The translation mode the BFF annotated onto the projection
  /// (`streaming-units` when the relay delivered translated units and did
  /// not fail; the finalize-time payload says 'none' — the agent service
  /// cannot know the delivery). The translation-scope caption's live
  /// signal; the `translation` frame carries the post-stream mode.
  final String? translationMode;

  /// Verdict-projection keys outside the normalized set above (`policy`,
  /// `judge`, `marking`, …), carried verbatim so a new projection field
  /// survives the parser boundary without a parser edit — the same
  /// contract as [SseMetadataEvent.extra].
  final Map<String, dynamic> extra;

  const SseAgentVerdictEvent({
    this.groundingStatus,
    this.isGrounded = false,
    this.translationMode,
    this.extra = const {},
  });
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

  /// The metadata keys the parser normalizes into typed fields. Everything
  /// else chatqna (or the backend envelope) sends goes to
  /// [SseMetadataEvent.extra] verbatim.
  static const _knownMetadataKeys = {
    'type',
    'source_documents',
    'confidence_score',
    'is_grounded',
    'responseTime',
    'query_translation_status',
    'grounding_status',
  };

  SseMetadataEvent _parseMetadata(Map<String, dynamic> json) {
    return SseMetadataEvent(
      sourceDocuments: json['source_documents'] as List<dynamic>? ?? [],
      confidenceScore: (json['confidence_score'] as num?)?.toDouble() ?? 0.0,
      isGrounded: json['is_grounded'] as bool? ?? false,
      // Tolerant num cast, like confidenceScore above: a double from the wire
      // must degrade this one field, not throw and drop the whole event.
      responseTime: (json['responseTime'] as num?)?.toInt(),
      queryTranslationStatus: json['query_translation_status'] as String?,
      groundingStatus: json['grounding_status'] as String?,
      extra: _extraOf(json, _knownMetadataKeys),
    );
  }

  SseAgentVerdictEvent _parseVerdict(Map<String, dynamic> json) {
    return SseAgentVerdictEvent(
      groundingStatus: json['grounding_status'] as String?,
      isGrounded: json['is_grounded'] as bool? ?? false,
      translationMode: json['translation_mode'] as String?,
      extra: _extraOf(json, _knownVerdictKeys),
    );
  }

  /// The keys of [json] outside [known] — the verbatim passthrough every
  /// extra-bearing frame rides: a new diagnostic or projection field
  /// reaches mobile without a parser edit.
  static Map<String, dynamic> _extraOf(
    Map<String, dynamic> json,
    Set<String> known,
  ) {
    final extra = <String, dynamic>{};
    json.forEach((key, value) {
      if (!known.contains(key)) {
        extra[key] = value;
      }
    });
    return extra;
  }

  /// The `agent_verdict` keys the parser normalizes into typed fields;
  /// the rest of the projection rides [SseAgentVerdictEvent.extra].
  static const _knownVerdictKeys = {
    'type',
    'version',
    'grounding_status',
    'is_grounded',
    'translation_mode',
  };

  SseEvent? _parseEvent(Map<String, dynamic> json) {
    final type = json['type'] as String?;
    return switch (type) {
      'chunk' => SseChunkEvent(json['content'] as String? ?? ''),
      'metadata' => _parseMetadata(json),
      'translation' => SseTranslationEvent(json['content'] as String? ?? ''),
      'done' => SseDoneEvent(
        json['queryId'] as String?,
        translationFailed: json['translationFailed'] == true,
      ),
      'error' => SseErrorEvent(
        json['message'] as String? ?? 'Unknown error',
        code: json['code'] as String?,
      ),
      'agent_activity' => SseAgentActivityEvent(
        status: json['status'] as String? ?? 'started',
        operation: json['operation'] as String?,
        callId: json['callId'] as String?,
      ),
      'agent_verdict' => _parseVerdict(json),
      _ => null,
    };
  }
}
