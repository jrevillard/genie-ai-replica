import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/services/sse_parser.dart';

void main() {
  group('SseParser', () {
    late SseParser parser;

    setUp(() {
      parser = SseParser();
    });

    test('parses a single chunk event', () {
      final events = parser.parseChunk(
        'data: {"type":"chunk","content":"Hello"}\n\n',
      );
      expect(events, hasLength(1));
      expect(events[0], isA<SseChunkEvent>());
      expect((events[0] as SseChunkEvent).content, 'Hello');
    });

    test('parses multiple chunk events in one chunk', () {
      final events = parser.parseChunk(
        'data: {"type":"chunk","content":"Hello"}\n'
        'data: {"type":"chunk","content":" world"}\n\n',
      );
      expect(events, hasLength(2));
      expect((events[0] as SseChunkEvent).content, 'Hello');
      expect((events[1] as SseChunkEvent).content, ' world');
    });

    test('buffers incomplete lines across chunks', () {
      // First chunk: incomplete (no trailing newline)
      final events1 = parser.parseChunk('data: {"type":"chunk","content":"Hel');
      expect(events1, isEmpty);

      // Second chunk: completes the line
      final events2 = parser.parseChunk('lo"}\n\n');
      expect(events2, hasLength(1));
      expect((events2[0] as SseChunkEvent).content, 'Hello');
    });

    test('parses done event', () {
      final events = parser.parseChunk(
        'data: {"type":"done","queryId":"abc123"}\n\n',
      );
      expect(events, hasLength(1));
      expect(events[0], isA<SseDoneEvent>());
      expect((events[0] as SseDoneEvent).queryId, 'abc123');
    });

    test('parses [DONE] sentinel', () {
      final events = parser.parseChunk('data: [DONE]\n\n');
      expect(events, hasLength(1));
      expect(events[0], isA<SseDoneEvent>());
      expect((events[0] as SseDoneEvent).queryId, isNull);
    });

    test('parses metadata event', () {
      final events = parser.parseChunk(
        'data: {"type":"metadata","source_documents":[{"title":"Doc1"}],"confidence_score":0.95,"responseTime":1200}\n\n',
      );
      expect(events, hasLength(1));
      final meta = events[0] as SseMetadataEvent;
      expect(meta.sourceDocuments, hasLength(1));
      expect(meta.confidenceScore, 0.95);
      expect(meta.responseTime, 1200);
    });

    test('parses is_grounded flag in metadata event', () {
      final events = parser.parseChunk(
        'data: {"type":"metadata","source_documents":[],"confidence_score":0,"is_grounded":true}\n\n',
      );
      final meta = events[0] as SseMetadataEvent;
      expect(meta.isGrounded, isTrue);
    });

    test('defaults is_grounded to false when absent', () {
      final events = parser.parseChunk(
        'data: {"type":"metadata","source_documents":[],"confidence_score":0.9}\n\n',
      );
      final meta = events[0] as SseMetadataEvent;
      expect(meta.isGrounded, isFalse);
    });

    test('parses translation event', () {
      final events = parser.parseChunk(
        'data: {"type":"translation","content":"Bonjour"}\n\n',
      );
      expect(events, hasLength(1));
      expect((events[0] as SseTranslationEvent).content, 'Bonjour');
    });

    test('parses error event', () {
      final events = parser.parseChunk(
        'data: {"type":"error","message":"Rate limited","code":"RATE_LIMIT"}\n\n',
      );
      expect(events, hasLength(1));
      final err = events[0] as SseErrorEvent;
      expect(err.message, 'Rate limited');
      expect(err.code, 'RATE_LIMIT');
    });

    test('skips SSE comments (keepalive)', () {
      final events = parser.parseChunk(': this is a keepalive\n\n');
      expect(events, isEmpty);
    });

    test('skips blank lines', () {
      final events = parser.parseChunk('\n\n\n');
      expect(events, isEmpty);
    });

    test('skips malformed JSON', () {
      final events = parser.parseChunk('data: {invalid json}\n\n');
      expect(events, isEmpty);
    });

    test('skips lines without data: prefix', () {
      final events = parser.parseChunk('event: chunk\nid: 123\n\n');
      expect(events, isEmpty);
    });

    test('skips unknown event types', () {
      final events = parser.parseChunk(
        'data: {"type":"unknown_type","foo":"bar"}\n\n',
      );
      expect(events, isEmpty);
    });

    test('flush returns remaining buffered content', () {
      parser.parseChunk('data: {"type":"chunk","content":"Hi"}\n');
      // Line is complete but not yet processed because no trailing \n
      // Actually, split('\n') on "data: {...}\n" gives ["data: {...}", ""]
      // so the line IS processed. Let's test a truly incomplete buffer:
      final events = parser.parseChunk(
        'data: {"type":"chunk","content":"Hi"}\ndata: {"type":"chunk","content":" Bye"}',
      );
      expect(events, hasLength(1));
      expect((events[0] as SseChunkEvent).content, 'Hi');

      final flushed = parser.flush();
      expect(flushed, hasLength(1));
      expect((flushed[0] as SseChunkEvent).content, ' Bye');
    });

    test('flush returns empty when buffer is empty', () {
      parser.parseChunk('data: {"type":"chunk","content":"X"}\n\n');
      expect(parser.flush(), isEmpty);
    });

    test('handles metadata with missing optional fields', () {
      final events = parser.parseChunk(
        'data: {"type":"metadata","source_documents":[],"confidence_score":0.5}\n\n',
      );
      expect(events, hasLength(1));
      final meta = events[0] as SseMetadataEvent;
      expect(meta.sourceDocuments, isEmpty);
      expect(meta.confidenceScore, 0.5);
      expect(meta.responseTime, isNull);
    });

    test('handles error event without code', () {
      final events = parser.parseChunk(
        'data: {"type":"error","message":"Something went wrong"}\n\n',
      );
      expect(events, hasLength(1));
      final err = events[0] as SseErrorEvent;
      expect(err.message, 'Something went wrong');
      expect(err.code, isNull);
    });

    test('full stream simulation: chunks + metadata + done', () {
      final allEvents = <SseEvent>[];

      allEvents.addAll(
        parser.parseChunk(
          'data: {"type":"chunk","content":"The "}\n'
          'data: {"type":"chunk","content":"answer "}\n'
          'data: {"type":"chunk","content":"is 42"}\n\n',
        ),
      );

      allEvents.addAll(
        parser.parseChunk(
          'data: {"type":"metadata","source_documents":[],"confidence_score":0.88}\n\n',
        ),
      );

      allEvents.addAll(
        parser.parseChunk('data: {"type":"done","queryId":"q789"}\n\n'),
      );

      expect(allEvents, hasLength(5));
      expect(allEvents[0], isA<SseChunkEvent>());
      expect(allEvents[1], isA<SseChunkEvent>());
      expect(allEvents[2], isA<SseChunkEvent>());
      expect(allEvents[3], isA<SseMetadataEvent>());
      expect(allEvents[4], isA<SseDoneEvent>());

      final content = allEvents
          .whereType<SseChunkEvent>()
          .map((e) => e.content)
          .join();
      expect(content, 'The answer is 42');

      final meta = allEvents.whereType<SseMetadataEvent>().first;
      expect(meta.confidenceScore, 0.88);

      final done = allEvents.whereType<SseDoneEvent>().first;
      expect(done.queryId, 'q789');
    });
  });
}
