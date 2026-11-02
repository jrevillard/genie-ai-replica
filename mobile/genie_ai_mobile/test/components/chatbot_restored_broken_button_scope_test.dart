import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/components/chat/chatbot_component.dart';
import 'package:genie_ai_mobile/services/notification_service.dart';
import 'package:genie_ai_mobile/utils/theme_manager.dart';
import 'package:http/http.dart' as http;

import '../helpers/chatbot_harness.dart';

// A restored conversation whose Quick Help BUTTON scope is broken AT
// RESTORE time — the tag names a live button, but the button's declared
// labels or category have left the hierarchy — must show the failure on
// the restored screen, not only announce it as a one-shot toast at the
// first send. The context bar carries the same caption the send guard
// uses (no new i18n key); quiet during a hierarchy outage, where the
// grid already shows the unavailable verdict.
void main() {
  final tree = quickHelpTreeFixture();

  // The REAL bundled configuration with the scenario's cards, encoded
  // OUTSIDE the widget tests' fake async — an asset load awaited inside
  // testWidgets never completes.
  late Uint8List brokenLabelBytes;
  late Uint8List brokenCategoryBytes;
  late Uint8List liveBytes;
  setUpAll(() async {
    brokenLabelBytes = await chatbotConfigBytesWithButtons(const [
      {
        'id': 'births-card',
        'title': {'en': 'Births Card'},
        'category': '2',
        'serviceLabels': ['Marriages'],
      },
    ]);
    brokenCategoryBytes = await chatbotConfigBytesWithButtons(const [
      {
        'id': 'gone-card',
        'title': {'en': 'Gone Card'},
        'category': '9',
        'serviceLabels': ['Births'],
      },
    ]);
    liveBytes = await chatbotConfigBytesWithButtons(const [
      {
        'id': 'births-card',
        'title': {'en': 'Births Card'},
        'category': '2',
        'serviceLabels': ['Births'],
      },
    ]);
  });

  setUp(resetChatbotTestState);
  tearDown(resetChatbotTestState);

  testWidgets('a broken declared label shows the caption in the bar', (
    tester,
  ) async {
    // The button exists (its tag resolves), but its declared label has
    // left the hierarchy: the verdict is broken at restore time.
    final mock = _BrokenScopeMockClient(
      tree,
      conversationTags: ['births-card'],
      withHistory: true,
    );
    final chatKey = GlobalKey<ChatBotComponentState>();
    mockChatbotConfigAsset(tester, brokenLabelBytes);
    await pumpChatBot(tester, mock, chatKey: chatKey);

    await chatKey.currentState!.loadConversation('conv-1');
    await tester.pumpAndSettle();

    // The bar names the dead label — the send guard's own caption. The
    // saved history hides the Quick Help grid, so this caption is the
    // BAR's alone.
    expect(find.textContaining('Marriages'), findsOneWidget);
    expect(
      tester.widget<Icon>(find.byIcon(Icons.warning_amber_rounded)).color,
      ThemeManager().tokens.danger,
    );
  });

  testWidgets('a broken declared category shows the caption in the bar', (
    tester,
  ) async {
    // The button's category (9) is not in the fixture tree: the verdict
    // is broken at restore time, and the caption names it.
    final mock = _BrokenScopeMockClient(
      tree,
      conversationTags: ['gone-card'],
      withHistory: true,
    );
    final chatKey = GlobalKey<ChatBotComponentState>();
    mockChatbotConfigAsset(tester, brokenCategoryBytes);
    await pumpChatBot(tester, mock, chatKey: chatKey);

    await chatKey.currentState!.loadConversation('conv-1');
    await tester.pumpAndSettle();

    expect(find.textContaining('category'), findsOneWidget);
    expect(find.byIcon(Icons.warning_amber_rounded), findsOneWidget);
  });

  testWidgets('a live restore shows no caption', (tester) async {
    final mock = _BrokenScopeMockClient(
      tree,
      conversationTags: ['births-card'],
    );
    final chatKey = GlobalKey<ChatBotComponentState>();
    mockChatbotConfigAsset(tester, liveBytes);
    await pumpChatBot(tester, mock, chatKey: chatKey);

    await chatKey.currentState!.loadConversation('conv-1');
    await tester.pumpAndSettle();

    expect(find.textContaining('Marriages'), findsNothing);
    expect(find.byIcon(Icons.lightbulb_outline), findsOneWidget);
    expect(find.byIcon(Icons.warning_amber_rounded), findsNothing);
  });

  testWidgets('an outage stays quiet', (tester) async {
    // The tree never loads (every EN request 500s): the restore runs
    // under the outage, the broken verdict is re-stamped, and the bar
    // shows the title with NO caption — the grid carries the verdict.
    final mock = _BrokenScopeMockClient(
      tree,
      conversationTags: ['births-card'],
      failEn: true,
    );
    final chatKey = GlobalKey<ChatBotComponentState>();
    mockChatbotConfigAsset(tester, brokenLabelBytes);
    await pumpChatBot(tester, mock, chatKey: chatKey);

    await chatKey.currentState!.loadConversation('conv-1');
    await tester.pumpAndSettle();

    expect(find.textContaining('Marriages'), findsNothing);
    expect(find.textContaining('category'), findsNothing);
  });

  testWidgets('the first send of a broken restored scope is refused', (
    tester,
  ) async {
    // Send parity: the caption in the bar does not replace the send
    // guard — the same refusal the one-shot toast used to carry still
    // happens, and the transcript never receives the question.
    final notifications = <String>[];
    final sub = NotificationService.events.listen(
      (event) => notifications.add(event.message),
    );
    addTearDown(sub.cancel);
    final mock = _BrokenScopeMockClient(
      tree,
      conversationTags: ['births-card'],
    );
    final chatKey = GlobalKey<ChatBotComponentState>();
    mockChatbotConfigAsset(tester, brokenLabelBytes);
    await pumpChatBot(tester, mock, chatKey: chatKey);

    await chatKey.currentState!.loadConversation('conv-1');
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField), 'Hello?');
    await tester.testTextInput.receiveAction(TextInputAction.done);
    await tester.pumpAndSettle();

    expect(notifications, isNotEmpty);
    expect(notifications.first, contains('Marriages'));
    // The refusal happens BEFORE the turn is committed: the question
    // stays in the composer (the send clears it only after committing).
    expect(find.text('Hello?'), findsOneWidget);
  });

  testWidgets(
    'an outage restore refuses the first send with the outage caption',
    (tester) async {
      // A restore tagged ['just-chat', '<button>'] that resolved under a
      // hierarchy outage carries a merged verdict computed over the EMPTY
      // tree. Replaying it would refuse the follow-up with a
      // configuration caption naming labels that may be alive; the
      // re-stamped verdict names the outage instead — the caption the
      // button-restore arm routes to.
      final notifications = <String>[];
      final sub = NotificationService.events.listen(
        (event) => notifications.add(event.message),
      );
      addTearDown(sub.cancel);
      final mock = _BrokenScopeMockClient(
        tree,
        conversationTags: ['just-chat', 'births-card'],
        failEn: true,
      );
      final chatKey = GlobalKey<ChatBotComponentState>();
      mockChatbotConfigAsset(tester, liveBytes);
      await pumpChatBot(tester, mock, chatKey: chatKey);

      await chatKey.currentState!.loadConversation('conv-1');
      await tester.pumpAndSettle();

      await tester.enterText(find.byType(TextField), 'Hello?');
      await tester.testTextInput.receiveAction(TextInputAction.done);
      await tester.pumpAndSettle();

      expect(notifications, isNotEmpty);
      expect(notifications.first, contains('could not be loaded'));
      // The turn was never committed: the question stays in the
      // composer.
      expect(find.text('Hello?'), findsOneWidget);
    },
  );
}

class _BrokenScopeMockClient extends http.BaseClient {
  _BrokenScopeMockClient(
    this.tree, {
    this.conversationTags = const [],
    this.failEn = false,
    this.withHistory = false,
  });

  final List<dynamic> tree;
  final List<String> conversationTags;

  /// When true, the saved conversation carries a previous assistant
  /// answer: the Quick Help grid is hidden (the interaction rule), so a
  /// rendered caption can only be the context bar's.
  final bool withHistory;

  /// When true, every EN tree request fails with a 500 — the hierarchy
  /// outage the caption must stay quiet under.
  final bool failEn;

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    final path = request.url.path;
    final locale = request.url.queryParameters['locale'] ?? 'en';
    if (path.contains('/api/service-categories/categories')) {
      if (failEn && locale == 'en') {
        return httpResponseJson(<String, dynamic>{}, 500);
      }
      return httpResponseJson(tree, 200);
    }
    if (request.method == 'GET' && path.contains('/api/chat/conversations/')) {
      final id = path.split('/api/chat/conversations/').last;
      return httpResponseJson(<String, dynamic>{
        '_key': id,
        'title': 'Saved conversation',
        'categoryId': '2',
        'tags': conversationTags,
        'messages': withHistory
            ? <dynamic>[
                {
                  '_id': 'm1',
                  'sender': 'assistant',
                  'content': 'A previous answer.',
                  'timestamp': '2026-01-01T00:00:00Z',
                },
              ]
            : <dynamic>[],
      }, 200);
    }
    return httpResponseJson(<String, dynamic>{}, 404);
  }
}
