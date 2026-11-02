import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/components/chat/chatbot_component.dart';
import 'package:genie_ai_mobile/utils/theme_manager.dart';
import 'package:http/http.dart' as http;

import '../helpers/chatbot_harness.dart';

// A RESTORED conversation whose scope tag is DEAD — the live hierarchy
// can no longer carry it (an unknown sidebar label, or the title tag of
// an id-less Quick Help card) — must name the fact on the restored
// screen. The web restores such a tag as an unresolved chip naming the
// tag and refusing every send; the mobile refused the same send but
// showed nothing until then. The context bar carries the caption.
void main() {
  final tree = quickHelpTreeFixture();

  // A conversation saved with a tag the live configuration/hierarchy
  // cannot carry: the title tag of an id-less card ('Registry Card')
  // that no longer exists beside its LIVE category edge.
  const deadTag = 'Registry Card';

  late Uint8List configBytes;
  late Uint8List configBytesWithLiveCard;

  setUpAll(() async {
    configBytes = await chatbotConfigBytesWithButtons(const [
      {
        'title': {'en': 'Unrelated Card'},
        'category': '2',
        'serviceLabels': ['Births'],
      },
    ]);
    configBytesWithLiveCard = await chatbotConfigBytesWithButtons(const [
      {
        'title': {'en': 'Births Card'},
        'category': '2',
        'serviceLabels': ['Births'],
      },
    ]);
  });

  setUp(resetChatbotTestState);
  tearDown(resetChatbotTestState);

  Future<void> pumpChat(
    WidgetTester tester,
    _DeadScopeMockClient mock, {
    GlobalKey<ChatBotComponentState>? chatKey,
  }) {
    return pumpChatBot(tester, mock, chatKey: chatKey);
  }

  testWidgets('a dead scope tag names itself in the context bar on restore', (
    tester,
  ) async {
    final mock = _DeadScopeMockClient(tree, conversationTags: [deadTag]);
    final chatKey = GlobalKey<ChatBotComponentState>();
    mockChatbotConfigAsset(tester, configBytes);
    await pumpChat(tester, mock, chatKey: chatKey);

    await chatKey.currentState!.loadConversation('conv-1');
    await tester.pumpAndSettle();

    // The bar keeps the conversation's (live) category title, and the
    // caption NAMES the tag the hierarchy cannot carry.
    expect(find.text('Context: Civil Registry'), findsOneWidget);
    final caption = tester.widget<Text>(
      find.textContaining('no longer carries'),
    );
    expect(caption.data, contains(deadTag));
    // The caption reads as a failure: the same danger token the broken
    // Quick Help cards render their diagnosis in.
    expect(caption.style?.color, ThemeManager().tokens.danger);
    // The bar's icon follows the caption — the broken cards' warning,
    // not the hint bulb.
    expect(find.byIcon(Icons.warning_amber_rounded), findsOneWidget);
    expect(find.byIcon(Icons.lightbulb_outline), findsNothing);
  });

  testWidgets('a live restore shows no caption', (tester) async {
    final mock = _DeadScopeMockClient(tree, conversationTags: ['Births']);
    final chatKey = GlobalKey<ChatBotComponentState>();
    mockChatbotConfigAsset(tester, configBytes);
    await pumpChat(tester, mock, chatKey: chatKey);

    await chatKey.currentState!.loadConversation('conv-1');
    await tester.pumpAndSettle();

    expect(find.text('Context: Civil Registry'), findsOneWidget);
    expect(find.textContaining('no longer carries'), findsNothing);
    // A live scope keeps the hint bulb.
    expect(find.byIcon(Icons.lightbulb_outline), findsOneWidget);
    expect(find.byIcon(Icons.warning_amber_rounded), findsNothing);
  });

  testWidgets('a dead tag with no live category edge still names itself', (
    tester,
  ) async {
    // No category edge at all: the bar would be hidden entirely (the
    // title gate), and the caption alone must keep it — and the clear
    // button — on the screen.
    final mock = _DeadScopeMockClient(
      tree,
      conversationTags: [deadTag],
      conversationCategoryId: null,
    );
    final chatKey = GlobalKey<ChatBotComponentState>();
    mockChatbotConfigAsset(tester, configBytes);
    await pumpChat(tester, mock, chatKey: chatKey);

    await chatKey.currentState!.loadConversation('conv-1');
    await tester.pumpAndSettle();

    expect(find.textContaining('Context:'), findsNothing);
    expect(find.textContaining('no longer carries'), findsOneWidget);
  });

  testWidgets(
    'the outage stays quiet and the recovered tree names the dead tag',
    (tester) async {
      // Against an outage's empty tree EVERY tag reads as dropped —
      // naming them dead would be a guess, and the outage is already
      // visible (the grid's unavailable cards, the send refusal). The
      // retry that recovers the tree re-resolves the restore, and the
      // caption appears with the REAL verdict. TWO failures: the
      // mount's own fetch consumes the first, the restore's the second.
      final mock = _DeadScopeMockClient(
        tree,
        conversationTags: [deadTag],
        failFirstCounts: const {'en': 2},
      );
      final chatKey = GlobalKey<ChatBotComponentState>();
      mockChatbotConfigAsset(tester, configBytes);
      await pumpChat(tester, mock, chatKey: chatKey);

      await chatKey.currentState!.loadConversation('conv-1');
      await tester.pumpAndSettle();
      expect(find.textContaining('no longer carries'), findsNothing);

      await chatKey.currentState!.loadConversation('conv-1');
      await tester.pumpAndSettle();

      expect(find.text('Context: Civil Registry'), findsOneWidget);
      expect(find.textContaining('no longer carries'), findsOneWidget);
    },
  );

  testWidgets(
    'a Quick Help config outage stays quiet and the recovery names the tag',
    (tester) async {
      // The tree loads but the CONFIG asset read fails: the restore
      // loses the button index, and the button tag falls to the sidebar
      // branch — naming it dead would misread a raw config id as a
      // hierarchy change. The caption stays quiet (the title, judged by
      // the healthy tree, stands); the recovery re-restores with the
      // config back and names the genuinely absent tag.
      final mock = _DeadScopeMockClient(tree, conversationTags: [deadTag]);
      final chatKey = GlobalKey<ChatBotComponentState>();
      tester.binding.defaultBinaryMessenger.setMockMessageHandler(
        'flutter/assets',
        (ByteData? message) async {
          if (message == null) return null;
          final key = utf8.decode(message.buffer.asUint8List());
          if (key != 'assets/config/genie-ai-config.json') return null;
          return null; // the failed read
        },
      );
      rootBundle.evict('assets/config/genie-ai-config.json');
      await pumpChat(tester, mock, chatKey: chatKey);

      await chatKey.currentState!.loadConversation('conv-1');
      await tester.pumpAndSettle();
      expect(find.text('Context: Civil Registry'), findsOneWidget);
      expect(find.textContaining('no longer carries'), findsNothing);

      mockChatbotConfigAsset(tester, configBytes);
      await chatKey.currentState!.loadConversation('conv-1');
      await tester.pumpAndSettle();
      expect(find.textContaining('no longer carries'), findsOneWidget);
    },
  );

  testWidgets('a sidebar selection replaces the dead-scope caption', (
    tester,
  ) async {
    final mock = _DeadScopeMockClient(tree, conversationTags: [deadTag]);
    final chatKey = GlobalKey<ChatBotComponentState>();
    mockChatbotConfigAsset(tester, configBytes);
    await pumpChat(tester, mock, chatKey: chatKey);

    await chatKey.currentState!.loadConversation('conv-1');
    await tester.pumpAndSettle();
    expect(find.textContaining('no longer carries'), findsOneWidget);

    // The user picks a live scope in the sidebar: the caption of the
    // scope it replaces must not survive it.
    chatKey.currentState!.setCategoryContext(
      '2',
      'Civil Registry',
      categoryNameEn: 'Civil Registry',
      serviceLabelsEn: ['Births'],
      serviceCount: 1,
    );
    await tester.pumpAndSettle();

    expect(find.text('Context: Civil Registry'), findsOneWidget);
    expect(find.textContaining('no longer carries'), findsNothing);
  });

  testWidgets('a card press replaces the dead-scope caption', (tester) async {
    final mock = _DeadScopeMockClient(tree, conversationTags: [deadTag]);
    final chatKey = GlobalKey<ChatBotComponentState>();
    mockChatbotConfigAsset(tester, configBytesWithLiveCard);
    await pumpChat(tester, mock, chatKey: chatKey);

    await chatKey.currentState!.loadConversation('conv-1');
    await tester.pumpAndSettle();
    expect(find.textContaining('no longer carries'), findsOneWidget);

    // The saved conversation carries no user messages, so the Quick
    // Help grid is up: pressing a LIVE card installs its scope.
    await tester.tap(find.text('Births Card'));
    await tester.pumpAndSettle();

    expect(find.text('Context: Births Card'), findsOneWidget);
    expect(find.textContaining('no longer carries'), findsNothing);
  });
}

class _DeadScopeMockClient extends http.BaseClient {
  _DeadScopeMockClient(
    this.tree, {
    this.conversationTags = const [],
    this.conversationCategoryId = '2',
    this.failFirstCounts = const {},
  });

  final List<dynamic> tree;
  final List<String> conversationTags;
  final String? conversationCategoryId;

  /// Per locale: the FIRST N tree requests fail with a 500 (a transient
  /// hierarchy outage) and every later one serves the tree.
  final Map<String, int> failFirstCounts;
  int _treeRequests = 0;

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    final path = request.url.path;
    final locale = request.url.queryParameters['locale'] ?? 'en';
    if (path.contains('/api/service-categories/categories')) {
      _treeRequests += 1;
      final failFirst = failFirstCounts[locale];
      if (failFirst != null && _treeRequests <= failFirst) {
        return httpResponseJson(<String, dynamic>{}, 500);
      }
      return httpResponseJson(tree, 200);
    }
    if (request.method == 'GET' && path.contains('/api/chat/conversations/')) {
      final id = path.split('/api/chat/conversations/').last;
      return httpResponseJson(<String, dynamic>{
        '_key': id,
        'title': 'Saved conversation',
        if (conversationCategoryId != null)
          'categoryId': conversationCategoryId,
        'tags': conversationTags,
        'messages': <dynamic>[],
      }, 200);
    }
    return httpResponseJson(<String, dynamic>{}, 404);
  }
}
