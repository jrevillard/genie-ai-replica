import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/components/chat/agent_activity_line.dart';
import 'package:genie_ai_mobile/components/chat/chatbot_component.dart';
import 'package:genie_ai_mobile/design_system/components/ds_spinner.dart';
import 'package:genie_ai_mobile/services/i18n_service.dart';
import 'package:http/http.dart' as http;
import 'package:openapi/api.dart';

import '../helpers/chatbot_harness.dart';
import '../helpers/test_app.dart';

// The agent activity line's mobile contract: the line
// renders in the trailing in-flight slot from the turn's first
// agent_activity frame, replaces the legacy indicator for the rest of
// the turn, collapses at the first chunk and never re-opens; the
// verdict truth table renders answer-level from the metadata frame —
// live and restored alike. Every locator is a declared ValueKey handle.

/// The mock streaming client: answers `/api/queries/stream` with an
/// OPEN stream the test drives frame by frame (the line's states are
/// visible only while the turn is still running), every other request
/// through the harness tree client.
class _AgentStreamMockClient extends QuickHelpTreeMockClient {
  _AgentStreamMockClient(
    super.tree, [
    StreamController<Uint8List>? withController,
  ]) : controller = withController ?? StreamController<Uint8List>();

  /// The open stream the test drives; mountStreaming re-points a mock
  /// built before its mount onto the mount's own controller.
  StreamController<Uint8List> controller;

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    if (request.url.path.endsWith('/api/queries/stream')) {
      return http.StreamedResponse(
        controller.stream,
        200,
        headers: {'content-type': 'text/event-stream'},
      );
    }
    return super.send(request);
  }
}

/// The conversation GET the restore scenario loads; the stream route
/// (unused there) stays dark.
class _RestoredVerdictMockClient extends ChatbotMockClient {
  _RestoredVerdictMockClient(super.tree, {required this.messageMetadata});

  /// The metadata map the one saved assistant message carries.
  final Map<String, dynamic> messageMetadata;

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    if (request.method == 'GET' &&
        request.url.path.contains('/api/chat/conversations/')) {
      final id = request.url.path.split('/api/chat/conversations/').last;
      return httpResponseJson(<String, dynamic>{
        '_key': id,
        'title': 'Saved conversation',
        'categoryId': '2',
        'tags': <String>[],
        'messages': <dynamic>[
          <String, dynamic>{
            '_id': 'm-1',
            'sender': 'assistant',
            'content': 'Restored answer text',
            'timestamp': '2026-11-22T00:00:00.000Z',
            'metadata': messageMetadata,
          },
        ],
      }, 200);
    }
    return super.send(request);
  }
}

/// The non-streaming JSON client: answers POST /api/queries with a
/// legacy-shaped metadata (is_grounded, NO grounding_status) plus the
/// root translationFailed latch — the two inputs the JSON path's truth
/// table and caption must read.
class _QueriesJsonMockClient extends QuickHelpTreeMockClient {
  _QueriesJsonMockClient(super.tree, {this.translationFailed = true});

  /// The root translation latch the JSON path reads. Null = the backend
  /// reported no failure at all (an answer that was never translated).
  final bool? translationFailed;

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    if (request.url.path.endsWith('/api/queries')) {
      return httpResponseJson(<String, dynamic>{
        'queryId': 'q-json',
        'response': 'Answer text',
        if (translationFailed != null) 'translationFailed': translationFailed,
        'metadata': <String, dynamic>{
          'sources': <dynamic>[],
          'confidence_score': 0.9,
          'is_grounded': false,
        },
      }, 201);
    }
    return super.send(request);
  }
}

/// The JSON client that also plays the SAVE side: every messages-post body
/// is captured — the record the restore reads.
class _SavingJsonMockClient extends _QueriesJsonMockClient {
  _SavingJsonMockClient(super.tree, {super.translationFailed});

  final List<Map<String, dynamic>> savedMessageBodies = [];

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    if (request.method == 'POST' &&
        request.url.path.endsWith('/api/chat/conversations')) {
      return httpResponseJson(<String, dynamic>{'_key': 'conv-save'}, 200);
    }
    if (request.method == 'POST' &&
        request.url.path.contains('/api/chat/conversations/') &&
        request.url.path.endsWith('/messages')) {
      savedMessageBodies.add(
        jsonDecode(utf8.decode((request as http.Request).bodyBytes))
            as Map<String, dynamic>,
      );
      return httpResponseJson(<String, dynamic>{'_id': 'm-saved'}, 200);
    }
    return super.send(request);
  }
}

Uint8List _frames(List<Map<String, dynamic>> frames) => Uint8List.fromList(
  utf8.encode(frames.map((f) => 'data: ${jsonEncode(f)}\n\n').join()),
);

/// The streaming mock that also plays the SAVE side: the conversation
/// create answers with a key, and every messages-post body is captured —
/// the wire the save uploads each message's metadata on.
class _SavingStreamMockClient extends _AgentStreamMockClient {
  _SavingStreamMockClient(super.tree);

  final List<Map<String, dynamic>> savedMessageBodies = [];

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    if (request.method == 'POST' &&
        request.url.path.endsWith('/api/chat/conversations')) {
      return httpResponseJson(<String, dynamic>{'_key': 'conv-save'}, 200);
    }
    if (request.method == 'POST' &&
        request.url.path.contains('/api/chat/conversations/') &&
        request.url.path.endsWith('/messages')) {
      savedMessageBodies.add(
        jsonDecode(utf8.decode((request as http.Request).bodyBytes))
            as Map<String, dynamic>,
      );
      return httpResponseJson(<String, dynamic>{'_id': 'm-saved'}, 200);
    }
    return super.send(request);
  }
}

void main() {
  final tree = quickHelpTreeFixture();

  late Uint8List config;
  setUpAll(() async {
    config = await chatbotConfigBytesWithButtons(const [
      {
        'title': {'en': 'Births Card'},
        'category': '2',
        'serviceLabels': ['Births'],
      },
    ]);
  });

  setUp(resetChatbotTestState);
  tearDown(resetChatbotTestState);

  /// Mounts the chatbot on an open stream and returns the controller the
  /// test feeds frames into.
  Future<StreamController<Uint8List>> mountStreaming(
    WidgetTester tester, {
    _AgentStreamMockClient? mock,
    GlobalKey<ChatBotComponentState>? chatKey,
  }) async {
    final controller = StreamController<Uint8List>();
    final client = mock ?? _AgentStreamMockClient(tree, controller);
    if (mock != null) mock.controller = controller;
    // The phone surface: the composer's send control is tappable at the
    // phone-sized viewport the Quick Help suites use (the default test
    // surface obscures it).
    usePhoneSurface(tester);
    mockChatbotConfigAsset(tester, config);
    await pumpChatBot(
      tester,
      client,
      chatKey: chatKey,
      httpClient: client,
      streamBaseUrl: 'http://mock',
    );
    // The scoped-card tap first (the pattern the Quick Help suites use):
    // it installs the context bar and shifts the composer up, so the
    // send control is tappable.
    await tester.tap(find.text('Births Card'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).first, 'permit question');
    await tester.tap(find.byIcon(Icons.send));
    await tester.pump();
    return controller;
  }

  testWidgets(
    'the line renders from the first agent_activity frame and supersedes the legacy indicator for the turn',
    (tester) async {
      final controller = await mountStreaming(tester);

      controller.add(
        _frames([
          {
            'type': 'agent_activity',
            'version': 1,
            'status': 'started',
            'operation': 'search_knowledge',
            'callId': 'c1',
          },
        ]),
      );
      await tester.pump();

      expect(find.byKey(const ValueKey('agent-activity-line')), findsOneWidget);
      expect(
        find.byKey(const ValueKey('agent-activity-op-search_knowledge')),
        findsOneWidget,
      );
      expect(find.text('Searching knowledge…'), findsOneWidget);
      // The DS marker, not the raw indicator the legacy row keeps.
      expect(find.byType(DsSpinner), findsOneWidget);
      expect(find.byKey(const ValueKey('streaming-indicator')), findsNothing);

      // A completed row holds; a new started frame replaces it.
      controller.add(
        _frames([
          {
            'type': 'agent_activity',
            'version': 1,
            'status': 'completed',
            'operation': 'search_knowledge',
            'callId': 'c1',
          },
        ]),
      );
      await tester.pump();
      expect(find.text('Searched the knowledge base.'), findsOneWidget);
      expect(find.byType(DsSpinner), findsNothing);

      // A failed row names the step and carries the warning glyph.
      controller.add(
        _frames([
          {
            'type': 'agent_activity',
            'version': 1,
            'status': 'started',
            'operation': 'read_source',
            'callId': 'c2',
          },
          {
            'type': 'agent_activity',
            'version': 1,
            'status': 'failed',
            'operation': 'read_source',
            'callId': 'c2',
          },
        ]),
      );
      await tester.pump();
      expect(find.text('Reading the source failed.'), findsOneWidget);
      expect(find.byIcon(Icons.warning_amber_rounded), findsOneWidget);

      await controller.close();
    },
  );

  testWidgets(
    'a chunk that precedes any activity frame keeps the line unrendered for the whole turn',
    (tester) async {
      final controller = await mountStreaming(tester);

      // The answer starts before the first tool call: the frame is a
      // post-chunk frame from birth and must never render the line — the
      // legacy in-flight indicator keeps the slot.
      controller.add(
        _frames([
          {'type': 'chunk', 'content': 'Partial'},
        ]),
      );
      await tester.pump();
      expect(find.byKey(const ValueKey('streaming-indicator')), findsOneWidget);

      controller.add(
        _frames([
          {
            'type': 'agent_activity',
            'version': 1,
            'status': 'started',
            'operation': 'search_knowledge',
            'callId': 'c1',
          },
          {'type': 'chunk', 'content': ' answer'},
        ]),
      );
      await tester.pump();

      expect(find.byKey(const ValueKey('agent-activity-line')), findsNothing);
      expect(
        find.byKey(const ValueKey('agent-activity-op-search_knowledge')),
        findsNothing,
      );
      // The legacy indicator still owns the slot (no activity frame ever
      // rendered pre-chunk).
      expect(find.byKey(const ValueKey('streaming-indicator')), findsOneWidget);

      await controller.close();
      await tester.pumpAndSettle();
      expect(find.textContaining('Partial'), findsOneWidget);
    },
  );

  testWidgets(
    'the line collapses at the first chunk, never re-opens, and the legacy indicator stays gone',
    (tester) async {
      final controller = await mountStreaming(tester);

      controller.add(
        _frames([
          {
            'type': 'agent_activity',
            'version': 1,
            'status': 'started',
            'operation': 'search_knowledge',
            'callId': 'c1',
          },
        ]),
      );
      await tester.pump();
      expect(find.byKey(const ValueKey('agent-activity-line')), findsOneWidget);

      controller.add(
        _frames([
          {'type': 'chunk', 'content': 'The answer'},
          {
            'type': 'agent_activity',
            'version': 1,
            'status': 'started',
            'operation': 'read_source',
            'callId': 'c2',
          },
        ]),
      );
      await tester.pump();

      // Collapsed by the chunk; the post-chunk frame is accepted but
      // unrendered; the legacy indicator stays superseded.
      expect(find.byKey(const ValueKey('agent-activity-line')), findsNothing);
      expect(
        find.byKey(const ValueKey('agent-activity-op-read_source')),
        findsNothing,
      );
      expect(find.byKey(const ValueKey('streaming-indicator')), findsNothing);
      // The answer renders in the bubble (the selectable markdown surface).
      expect(find.textContaining('The answer'), findsOneWidget);

      await controller.close();
      await tester.pumpAndSettle();
    },
  );

  testWidgets(
    'an operation with no catalogue entry renders the generic label under the raw-name handle',
    (tester) async {
      final controller = await mountStreaming(tester);

      controller.add(
        _frames([
          {
            'type': 'agent_activity',
            'version': 1,
            'status': 'started',
            'operation': 'summarize_foo',
            'callId': 'c9',
          },
        ]),
      );
      await tester.pump();

      expect(find.text('Working…'), findsOneWidget);
      expect(
        find.byKey(const ValueKey('agent-activity-op-summarize_foo')),
        findsOneWidget,
      );

      await controller.close();
    },
  );

  testWidgets(
    'a turn with no agent_activity frame keeps the legacy indicator byte-for-byte',
    (tester) async {
      final controller = await mountStreaming(tester);

      controller.add(
        _frames([
          {'type': 'chunk', 'content': 'Plain answer'},
        ]),
      );
      await tester.pump();

      expect(find.byKey(const ValueKey('agent-activity-line')), findsNothing);
      expect(find.byKey(const ValueKey('streaming-indicator')), findsOneWidget);

      await controller.close();
      await tester.pumpAndSettle();
      expect(find.textContaining('Plain answer'), findsOneWidget);
    },
  );

  testWidgets(
    'the unverified verdict renders the neutral note, never the ungrounded warning',
    (tester) async {
      final controller = await mountStreaming(tester);

      controller.add(
        _frames([
          {'type': 'chunk', 'content': 'Answer'},
          {
            'type': 'agent_verdict',
            'version': 1,
            'grounding_status': 'unverified',
            'is_grounded': false,
          },
          {
            'type': 'metadata',
            'source_documents': <dynamic>[],
            'confidence_score': 0.9,
            'grounding_status': 'unverified',
            'is_grounded': false,
          },
          {'type': 'done', 'queryId': 'q1'},
        ]),
      );
      await controller.close();
      await tester.pumpAndSettle();

      expect(
        find.text('Response verification could not be completed.'),
        findsOneWidget,
      );
      expect(
        find.text('AI-generated — not based on library documents'),
        findsNothing,
      );
    },
  );

  testWidgets('the ungrounded verdict keeps the existing warning', (
    tester,
  ) async {
    final controller = await mountStreaming(tester);

    controller.add(
      _frames([
        {'type': 'chunk', 'content': 'Answer'},
        {
          'type': 'metadata',
          'source_documents': <dynamic>[],
          'confidence_score': 0.9,
          'grounding_status': 'ungrounded',
          'is_grounded': false,
        },
        {'type': 'done', 'queryId': 'q1'},
      ]),
    );
    await controller.close();
    await tester.pumpAndSettle();

    expect(
      find.text('AI-generated — not based on library documents'),
      findsOneWidget,
    );
    expect(
      find.text('Response verification could not be completed.'),
      findsNothing,
    );
  });

  testWidgets('an unknown verdict state falls back to the is_grounded rule', (
    tester,
  ) async {
    final controller = await mountStreaming(tester);

    // A future verdict state this client does not know: it must never
    // silently retire the answer-level warning — is_grounded decides.
    controller.add(
      _frames([
        {'type': 'chunk', 'content': 'Answer'},
        {
          'type': 'metadata',
          'source_documents': <dynamic>[],
          'confidence_score': 0.9,
          'grounding_status': 'exempt',
          'is_grounded': false,
        },
        {'type': 'done', 'queryId': 'q1'},
      ]),
    );
    await controller.close();
    await tester.pumpAndSettle();

    expect(
      find.text('AI-generated — not based on library documents'),
      findsOneWidget,
    );
    expect(
      find.text('Response verification could not be completed.'),
      findsNothing,
    );
  });

  testWidgets('a grounded English turn renders no verdict note and no caption', (
    tester,
  ) async {
    final controller = await mountStreaming(tester);

    controller.add(
      _frames([
        {'type': 'chunk', 'content': 'Answer'},
        {
          'type': 'metadata',
          'source_documents': <dynamic>[],
          'confidence_score': 0.9,
          'grounding_status': 'grounded',
          'is_grounded': true,
        },
        {'type': 'done', 'queryId': 'q1'},
      ]),
    );
    await controller.close();
    await tester.pumpAndSettle();

    expect(
      find.text('AI-generated — not based on library documents'),
      findsNothing,
    );
    expect(
      find.text('Response verification could not be completed.'),
      findsNothing,
    );
    // EN UI: no translation was delivered, no scope caption.
    expect(
      find.text(
        'Grounding was verified on the original-language answer — this translation is not covered by that check.',
      ),
      findsNothing,
    );
  });

  testWidgets(
    'the translated-grounded caption renders when a delivery mode rode the stream',
    (tester) async {
      // Delivered translation (streaming units relayed, no failure): the
      // verdict frame annotates the mode, the caption shows — the answer
      // the user reads is the French translation, not the verified
      // English text. The same words the web locale ships.
      await I18nService().changeLanguage('fr');
      final controller = await mountStreaming(tester);

      controller.add(
        _frames([
          {'type': 'chunk', 'content': 'Réponse'},
          {
            'type': 'agent_verdict',
            'version': 1,
            'grounding_status': 'grounded',
            'is_grounded': true,
            'translation_mode': 'streaming-units',
          },
          {
            'type': 'metadata',
            'source_documents': <dynamic>[],
            'confidence_score': 0.9,
            'grounding_status': 'grounded',
            'is_grounded': true,
          },
          {'type': 'done', 'queryId': 'q1'},
        ]),
      );
      await controller.close();
      await tester.pumpAndSettle();

      expect(
        find.text(
          'La vérification a porté sur la réponse dans la langue d’origine — la traduction n’a pas été vérifiée.',
        ),
        findsOneWidget,
      );
    },
  );

  testWidgets('a post-stream translation frame marks the delivery too', (
    tester,
  ) async {
    // Streaming translation off: the whole answer arrives untranslated,
    // then ONE translation frame delivers it — the mode marker of the
    // second carrier.
    await I18nService().changeLanguage('fr');
    final controller = await mountStreaming(tester);

    controller.add(
      _frames([
        {'type': 'chunk', 'content': 'The verified English answer'},
        {
          'type': 'agent_verdict',
          'version': 1,
          'grounding_status': 'grounded',
          'is_grounded': true,
          'translation_mode': 'none',
        },
        {
          'type': 'metadata',
          'source_documents': <dynamic>[],
          'confidence_score': 0.9,
          'grounding_status': 'grounded',
          'is_grounded': true,
        },
        {'type': 'translation', 'content': 'La réponse vérifiée'},
        {'type': 'done', 'queryId': 'q1'},
      ]),
    );
    await controller.close();
    await tester.pumpAndSettle();

    expect(
      find.text(
        'La vérification a porté sur la réponse dans la langue d’origine — la traduction n’a pas été vérifiée.',
      ),
      findsOneWidget,
    );
  });

  testWidgets(
    'a failed translation leaves the verified English original on screen — no caption',
    (tester) async {
      await I18nService().changeLanguage('fr');
      final controller = await mountStreaming(tester);

      controller.add(
        _frames([
          {'type': 'chunk', 'content': 'Answer'},
          {
            'type': 'metadata',
            'source_documents': <dynamic>[],
            'confidence_score': 0.9,
            'grounding_status': 'grounded',
            'is_grounded': true,
          },
          {'type': 'done', 'queryId': 'q1', 'translationFailed': true},
        ]),
      );
      await controller.close();
      await tester.pumpAndSettle();

      expect(
        find.text(
          'La vérification a porté sur la réponse dans la langue d’origine — la traduction n’a pas été vérifiée.',
        ),
        findsNothing,
      );
      // The existing translation-failed caption still renders.
      expect(
        find.text(
          'Traduction indisponible — cette réponse peut contenir du texte non traduit.',
        ),
        findsOneWidget,
      );
    },
  );

  /// Mounts the saving mock, feeds [frames], saves the conversation and
  /// returns the assistant message's saved metadata map — the record the
  /// restore reads (isTranslationFailed).
  Future<Map<String, dynamic>> savedMetadataOf(
    WidgetTester tester,
    List<Map<String, dynamic>> frames,
  ) async {
    final chatKey = GlobalKey<ChatBotComponentState>();
    final saving = _SavingStreamMockClient(tree);
    final controller = await mountStreaming(
      tester,
      mock: saving,
      chatKey: chatKey,
    );

    controller.add(_frames(frames));
    await controller.close();
    await tester.pumpAndSettle();

    await chatKey.currentState!.saveConversation();
    await tester.pumpAndSettle();

    final assistantBodies = saving.savedMessageBodies
        .where((body) => body['metadata'] != null)
        .toList();
    expect(assistantBodies, hasLength(1));
    return assistantBodies.single['metadata'] as Map<String, dynamic>;
  }

  testWidgets(
    'the save omits translation_status when no translation was delivered',
    (tester) async {
      // The field is PRESENCE-KEYED: the key is present only when a
      // translation was actually attempted. A turn that never translated
      // (an English UI, a skipped translation) carries no key at all —
      // stamping 'ok' there claimed a translation that never happened.
      final metadata = await savedMetadataOf(tester, [
        {'type': 'chunk', 'content': 'Answer'},
        {
          'type': 'metadata',
          'source_documents': <dynamic>[],
          'confidence_score': 0.9,
          'grounding_status': 'grounded',
          'is_grounded': true,
        },
        {'type': 'done', 'queryId': 'q-no-translation'},
      ]);

      expect(metadata.containsKey('translation_status'), isFalse);
    },
  );

  testWidgets(
    'the save carries the query-translation status the done frame reported',
    (tester) async {
      // The V05 status rides the DONE frame: the metadata frame is written
      // before the translation settles (the sources must reach the client
      // with the answer), so the terminal frame is the live carrier.
      final metadata = await savedMetadataOf(tester, [
        {'type': 'chunk', 'content': 'Answer'},
        {
          'type': 'metadata',
          'source_documents': <dynamic>[],
          'confidence_score': 0.9,
          'grounding_status': 'grounded',
          'is_grounded': true,
        },
        {
          'type': 'done',
          'queryId': 'q-status',
          'queryTranslationStatus': 'fallback_timeout',
        },
      ]);

      expect(metadata['query_translation_status'], 'fallback_timeout');
    },
  );

  testWidgets('the save stamps ok when the translation was delivered', (
    tester,
  ) async {
    // The whole-answer translation frame IS the delivery ('post-stream').
    final metadata = await savedMetadataOf(tester, [
      {'type': 'chunk', 'content': 'The verified English answer'},
      {
        'type': 'metadata',
        'source_documents': <dynamic>[],
        'confidence_score': 0.9,
        'grounding_status': 'grounded',
        'is_grounded': true,
      },
      {'type': 'translation', 'content': 'La réponse vérifiée'},
      {'type': 'done', 'queryId': 'q-translated'},
    ]);

    expect(metadata['translation_status'], 'ok');
  });

  testWidgets(
    'the save stamps ok when the verdict reported relayed translated units',
    (tester) async {
      // The relay path: the translated units were the delivery
      // ('streaming-units' on the verdict frame).
      final metadata = await savedMetadataOf(tester, [
        {'type': 'chunk', 'content': 'Réponse'},
        {
          'type': 'agent_verdict',
          'version': 1,
          'grounding_status': 'grounded',
          'is_grounded': true,
          'translation_mode': 'streaming-units',
        },
        {
          'type': 'metadata',
          'source_documents': <dynamic>[],
          'confidence_score': 0.9,
          'grounding_status': 'grounded',
          'is_grounded': true,
        },
        {'type': 'done', 'queryId': 'q-streaming-units'},
      ]);

      expect(metadata['translation_status'], 'ok');
    },
  );

  testWidgets(
    'the save uploads the answer-translation outcome the restore reads',
    (tester) async {
      await I18nService().changeLanguage('fr');
      // The saving mock serves the same stream route and captures the
      // messages-post bodies the save uploads: the record the save
      // carries must hold the outcome the restore reads — the agent
      // lane's server-side doc does not persist it.
      final chatKey = GlobalKey<ChatBotComponentState>();
      final saving = _SavingStreamMockClient(tree);
      final controller = await mountStreaming(
        tester,
        mock: saving,
        chatKey: chatKey,
      );

      controller.add(
        _frames([
          {'type': 'chunk', 'content': 'Answer'},
          {
            'type': 'metadata',
            'source_documents': <dynamic>[],
            'confidence_score': 0.9,
            'grounding_status': 'grounded',
            'is_grounded': true,
          },
          {'type': 'done', 'queryId': 'q2', 'translationFailed': true},
        ]),
      );
      await controller.close();
      await tester.pumpAndSettle();
      // The reader half: the live turn shows the untranslated caption.
      expect(
        find.text(
          'Traduction indisponible — cette réponse peut contenir du texte non traduit.',
        ),
        findsOneWidget,
      );

      // The save flow itself (the dialog is not the surface under test):
      // the established state-key call the restored suites use.
      await chatKey.currentState!.saveConversation();
      await tester.pumpAndSettle();

      final assistantBodies = saving.savedMessageBodies
          .where((body) => body['metadata'] != null)
          .toList();
      expect(assistantBodies, hasLength(1));
      expect(
        assistantBodies.single['metadata']['translation_status'],
        'failed',
      );
    },
  );

  testWidgets(
    'a restored failed translation renders the untranslated caption, never the scope caption',
    (tester) async {
      // The persisted record says the translation broke (status != 'ok'):
      // the answer on screen IS the verified English original, so the
      // scope caption must not claim otherwise — and the untranslated
      // caption must come back with the message.
      await I18nService().changeLanguage('fr');
      mockChatbotConfigAsset(tester, config);
      final mock = _RestoredVerdictMockClient(
        tree,
        messageMetadata: {
          'sources': <dynamic>[],
          'confidence_score': 0.9,
          'grounding_status': 'grounded',
          'is_grounded': true,
          'translation_status': 'failed',
        },
      );
      final chatKey = GlobalKey<ChatBotComponentState>();
      await pumpChatBot(tester, mock, chatKey: chatKey);
      await chatKey.currentState!.loadConversation('conv-1');
      await tester.pumpAndSettle();

      expect(
        find.text(
          'Traduction indisponible — cette réponse peut contenir du texte non traduit.',
        ),
        findsOneWidget,
      );
      expect(
        find.text(
          'La vérification a porté sur la réponse dans la langue d’origine — la traduction n’a pas été vérifiée.',
        ),
        findsNothing,
      );
    },
  );

  testWidgets(
    'a restored conversation renders the truth table from its persisted metadata',
    (tester) async {
      mockChatbotConfigAsset(tester, config);
      final mock = _RestoredVerdictMockClient(
        tree,
        messageMetadata: {
          'sources': <dynamic>[],
          'confidence_score': 0.9,
          'grounding_status': 'unverified',
          'is_grounded': false,
        },
      );
      final chatKey = GlobalKey<ChatBotComponentState>();
      await pumpChatBot(tester, mock, chatKey: chatKey);
      await chatKey.currentState!.loadConversation('conv-1');
      await tester.pumpAndSettle();

      expect(find.textContaining('Restored answer text'), findsOneWidget);
      expect(
        find.text('Response verification could not be completed.'),
        findsOneWidget,
      );
      expect(
        find.text('AI-generated — not based on library documents'),
        findsNothing,
      );
    },
  );

  testWidgets(
    'a restored ungrounded message renders the warning (the web restore rule)',
    (tester) async {
      mockChatbotConfigAsset(tester, config);
      final mock = _RestoredVerdictMockClient(
        tree,
        messageMetadata: {
          'sources': <dynamic>[],
          'confidence_score': 0.9,
          'is_grounded': false,
        },
      );
      final chatKey = GlobalKey<ChatBotComponentState>();
      await pumpChatBot(tester, mock, chatKey: chatKey);
      await chatKey.currentState!.loadConversation('conv-1');
      await tester.pumpAndSettle();

      expect(
        find.text('AI-generated — not based on library documents'),
        findsOneWidget,
      );
    },
  );

  testWidgets(
    'a restored grounded answer with a persisted delivery mode shows the scope caption',
    (tester) async {
      // The web folds the delivery mode into the saved metadata
      // (storableMetadata); the restore scopes the verdict exactly like
      // a live turn — the English UI shows it too (the mode, not the UI
      // language, is the signal).
      mockChatbotConfigAsset(tester, config);
      final mock = _RestoredVerdictMockClient(
        tree,
        messageMetadata: {
          'sources': <dynamic>[],
          'confidence_score': 0.9,
          'grounding_status': 'grounded',
          'is_grounded': true,
          'translation_mode': 'streaming-units',
        },
      );
      final chatKey = GlobalKey<ChatBotComponentState>();
      await pumpChatBot(tester, mock, chatKey: chatKey);
      await chatKey.currentState!.loadConversation('conv-1');
      await tester.pumpAndSettle();

      expect(
        find.text(
          'The verification covered the original-language answer — the translation was not verified.',
        ),
        findsOneWidget,
      );
    },
  );

  testWidgets(
    'the line honors the a11y floor: live region, reduced-motion static marker',
    (tester) async {
      tester.binding.platformDispatcher.accessibilityFeaturesTestValue =
          const FakeAccessibilityFeatures(disableAnimations: true);
      addTearDown(() {
        tester.binding.platformDispatcher.clearAccessibilityFeaturesTestValue();
      });

      const line = AgentActivityLine(
        status: 'started',
        operation: 'search_knowledge',
      );
      await tester.pumpWidget(testApp(line));
      await tester.pumpAndSettle();

      // Reduced motion: the static marker replaces the DsSpinner.
      expect(find.byType(DsSpinner), findsNothing);
      expect(find.text('Searching knowledge…'), findsOneWidget);

      // The container is the polite live region.
      final semanticsNodes = find
          .ancestor(
            of: find.byKey(const ValueKey('agent-activity-line')),
            matching: find.byType(Semantics),
          )
          .evaluate();
      expect(
        semanticsNodes.any(
          (element) =>
              (element.widget as Semantics).properties.liveRegion == true,
        ),
        isTrue,
      );

      // With motion enabled the DS spinner renders (a pump, not a
      // settle: the spinner animates forever).
      tester.binding.platformDispatcher.accessibilityFeaturesTestValue =
          const FakeAccessibilityFeatures();
      await tester.pump();
      expect(find.byType(DsSpinner), findsOneWidget);
    },
  );

  testWidgets(
    'the failed label wraps instead of truncating; running truncates',
    (tester) async {
      const failed = AgentActivityLine(
        status: 'failed',
        operation: 'read_source',
      );
      await tester.pumpWidget(testApp(failed));
      await tester.pumpAndSettle();
      expect(
        tester.widget<Text>(find.text('Reading the source failed.')).maxLines,
        isNull,
      );

      const running = AgentActivityLine(
        status: 'started',
        operation: 'read_source',
      );
      await tester.pumpWidget(testApp(running));
      // A pump: the running marker (DsSpinner) animates forever, a
      // settle would never return.
      await tester.pump();
      expect(tester.widget<Text>(find.text('Reading source…')).maxLines, 1);
    },
  );

  testWidgets(
    'the JSON lane never stamps ok when the backend recorded no translation',
    (tester) async {
      // The backend's own key is presence-keyed: it carries 'ok' when a
      // translation was delivered and stays ABSENT when none was. The
      // mobile must not write an 'ok' on its own — that would claim a
      // translation that never happened (the streaming path's rule).
      usePhoneSurface(tester);
      mockChatbotConfigAsset(tester, config);
      final chatKey = GlobalKey<ChatBotComponentState>();
      final jsonMock = _SavingJsonMockClient(tree, translationFailed: null);
      await pumpChatBot(
        tester,
        jsonMock,
        chatKey: chatKey,
        queriesApi: QueriesApi(ApiClient()..client = jsonMock),
      );
      await tester.tap(find.text('Births Card'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField).first, 'question');
      await tester.tap(find.byIcon(Icons.send));
      await tester.pumpAndSettle();

      await chatKey.currentState!.saveConversation();
      await tester.pumpAndSettle();

      final assistantBodies = jsonMock.savedMessageBodies
          .where((body) => body['metadata'] != null)
          .toList();
      expect(assistantBodies, hasLength(1));
      final metadata =
          assistantBodies.single['metadata'] as Map<String, dynamic>;
      expect(metadata.containsKey('translation_status'), isFalse);
    },
  );

  testWidgets(
    'the non-streaming path sets isGrounded and reads the 2.4b translation latch',
    (tester) async {
      await I18nService().changeLanguage('fr');
      // No httpClient: the non-streaming JSON path. The response carries
      // the legacy is_grounded fallback input (no grounding_status) and
      // the agent lane's root translationFailed latch (its
      // metadata does not carry translation_status).
      usePhoneSurface(tester);
      mockChatbotConfigAsset(tester, config);
      final jsonMock = _QueriesJsonMockClient(tree);
      await pumpChatBot(
        tester,
        jsonMock,
        queriesApi: QueriesApi(ApiClient()..client = jsonMock),
      );
      // The scoped-card tap first: it shifts the composer up so the send
      // control is tappable (the pattern mountStreaming uses).
      await tester.tap(find.text('Births Card'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField).first, 'question');
      await tester.tap(find.byIcon(Icons.send));
      await tester.pumpAndSettle();

      // The is_grounded fallback fires on the JSON path too (the FR
      // wording — the UI under test is French).
      expect(
        find.text(
          'Généré par IA — non basé sur les documents de la bibliothèque',
        ),
        findsOneWidget,
      );
      // The root latch is read: the untranslated caption shows.
      expect(
        find.text(
          'Traduction indisponible — cette réponse peut contenir du texte non traduit.',
        ),
        findsOneWidget,
      );
      // And the scope caption cannot claim a translation that never was
      // (the JSON path carries no delivery mode).
      expect(
        find.text(
          'La vérification a porté sur la réponse dans la langue d’origine — la traduction n’a pas été vérifiée.',
        ),
        findsNothing,
      );
    },
  );
}
