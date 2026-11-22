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

import '../helpers/chatbot_harness.dart';
import '../helpers/test_app.dart';

// The agent activity line's mobile contract (issue #1966): the line
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
  _AgentStreamMockClient(super.tree, this.controller);

  final StreamController<Uint8List> controller;

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

Uint8List _frames(List<Map<String, dynamic>> frames) => Uint8List.fromList(
  utf8.encode(frames.map((f) => 'data: ${jsonEncode(f)}\n\n').join()),
);

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
  Future<StreamController<Uint8List>> mountStreaming(WidgetTester tester) async {
    final controller = StreamController<Uint8List>();
    final mock = _AgentStreamMockClient(tree, controller);
    // The phone surface: the composer's send control is tappable at the
    // phone-sized viewport the Quick Help suites use (the default test
    // surface obscures it).
    usePhoneSurface(tester);
    mockChatbotConfigAsset(tester, config);
    await pumpChatBot(
      tester,
      mock,
      httpClient: mock,
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

      controller.add(_frames([{'type': 'chunk', 'content': 'Plain answer'}]));
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

  testWidgets(
    'the ungrounded verdict keeps the existing warning',
    (tester) async {
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
    },
  );

  testWidgets(
    'a grounded English turn renders no verdict note and no caption',
    (tester) async {
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
    },
  );

  testWidgets(
    'the translated-grounded caption renders in a non-English UI and a failed translation suppresses it',
    (tester) async {
      await I18nService().changeLanguage('fr');
      final controller = await mountStreaming(tester);

      // Delivered translation: the caption shows (the answer the user
      // reads is the French translation, not the verified English text).
      controller.add(
        _frames([
          {'type': 'chunk', 'content': 'Réponse'},
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
          "La vérification de l'ancrage a été effectuée sur la réponse dans sa langue d'origine — cette traduction n'est pas couverte par cette vérification.",
        ),
        findsOneWidget,
      );
    },
  );

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
          "La vérification de l'ancrage a été effectuée sur la réponse dans sa langue d'origine — cette traduction n'est pas couverte par cette vérification.",
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
    'the line honors the a11y floor: live region, reduced-motion static marker',
    (tester) async {
      tester.binding.platformDispatcher.accessibilityFeaturesTestValue =
          const FakeAccessibilityFeatures(disableAnimations: true);
      addTearDown(() {
        tester.binding.platformDispatcher.clearAccessibilityFeaturesTestValue();
      });

      const line = AgentActivityLine(status: 'started', operation: 'search_knowledge');
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
      const failed = AgentActivityLine(status: 'failed', operation: 'read_source');
      await tester.pumpWidget(testApp(failed));
      await tester.pumpAndSettle();
      expect(
        tester
            .widget<Text>(find.text('Reading the source failed.'))
            .maxLines,
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
      expect(
        tester.widget<Text>(find.text('Reading source…')).maxLines,
        1,
      );
    },
  );
}
