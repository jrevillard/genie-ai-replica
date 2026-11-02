import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/components/chat/chatbot_component.dart';
import 'package:genie_ai_mobile/utils/theme_manager.dart';
import 'package:http/http.dart' as http;

import '../helpers/chatbot_harness.dart';

// A RESTORED conversation carrying the web's one RESERVED tag,
// 'just-chat': the plain-composer scope of NONE, unfiltered by design.
// The web rebuilds the chip from the id alone — the configuration is
// irrelevant to it — so the mobile restores the scope whatever the
// loaded buttons say, titles the bar with the reserved entry's own
// localized name, and refuses nothing. Without the reserved rule the
// tag fell to the sidebar branch: an unknown tag, a refusal caption,
// every follow-up refused.
void main() {
  final tree = quickHelpTreeFixture();

  late Uint8List configBytes;
  late Uint8List configBytesWithJustChatEntry;

  setUpAll(() async {
    // No just-chat entry: the deployment dropped or hid it — the exact
    // case the reserved rule exists for.
    configBytes = await chatbotConfigBytesWithButtons(const [
      {
        'title': {'en': 'Registry Card'},
        'category': '2',
        'serviceLabels': ['Births'],
      },
    ]);
    // A configuration that still declares the entry — with its own title
    // and a scope: the reserved restore must not bind to it.
    configBytesWithJustChatEntry = await chatbotConfigBytesWithButtons(const [
      {
        'id': 'just-chat',
        'title': {'en': 'Composer'},
        'category': '2',
        'serviceLabels': ['Births'],
      },
    ]);
  });

  setUp(resetChatbotTestState);
  tearDown(resetChatbotTestState);

  testWidgets('a saved just-chat tag restores the plain-chat scope', (
    tester,
  ) async {
    final mock = _JustChatMockClient(tree, conversationTags: ['just-chat']);
    final chatKey = GlobalKey<ChatBotComponentState>();
    mockChatbotConfigAsset(tester, configBytes);
    await pumpChatBot(tester, mock, chatKey: chatKey);

    await chatKey.currentState!.loadConversation('conv-1');
    await tester.pumpAndSettle();

    // The bar carries the reserved entry's own localized name — the
    // chip the web restores from the id alone.
    expect(find.text('Context: Just Chat'), findsOneWidget);
    // The scope is not a failure: no dead-tag caption, no warning icon
    // — the follow-ups answer unfiltered, as on the web.
    expect(find.textContaining('no longer carries'), findsNothing);
    expect(find.byIcon(Icons.warning_amber_rounded), findsNothing);
    expect(find.byIcon(Icons.lightbulb_outline), findsOneWidget);
    expect(
      tester.widget<Icon>(find.byIcon(Icons.lightbulb_outline)).color,
      ThemeManager().tokens.accent,
    );
  });

  testWidgets('the reserved restore ignores a config entry that declares one', (
    tester,
  ) async {
    final mock = _JustChatMockClient(tree, conversationTags: ['just-chat']);
    final chatKey = GlobalKey<ChatBotComponentState>();
    mockChatbotConfigAsset(tester, configBytesWithJustChatEntry);
    await pumpChatBot(tester, mock, chatKey: chatKey);

    await chatKey.currentState!.loadConversation('conv-1');
    await tester.pumpAndSettle();

    // The configuration's own title and scope stay out of it: the chip
    // is titled from the reserved name, never from the entry. (The
    // entry's card still renders in the grid — config content, not the
    // restored scope.)
    expect(find.text('Context: Just Chat'), findsOneWidget);
    expect(find.text('Context: Composer'), findsNothing);
    expect(find.textContaining('no longer carries'), findsNothing);
  });

  testWidgets('the reserved scope shows without a category edge', (
    tester,
  ) async {
    // A just-chat conversation carries no category edge (the press
    // cleared it): the title alone must keep the bar on the screen.
    final mock = _JustChatMockClient(
      tree,
      conversationTags: ['just-chat'],
      conversationCategoryId: null,
    );
    final chatKey = GlobalKey<ChatBotComponentState>();
    mockChatbotConfigAsset(tester, configBytes);
    await pumpChatBot(tester, mock, chatKey: chatKey);

    await chatKey.currentState!.loadConversation('conv-1');
    await tester.pumpAndSettle();

    expect(find.text('Context: Just Chat'), findsOneWidget);
    expect(find.textContaining('no longer carries'), findsNothing);
  });
}

class _JustChatMockClient extends http.BaseClient {
  _JustChatMockClient(
    this.tree, {
    this.conversationTags = const [],
    this.conversationCategoryId = '2',
  });

  final List<dynamic> tree;
  final List<String> conversationTags;
  final String? conversationCategoryId;

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    final path = request.url.path;
    if (path.contains('/api/service-categories/categories')) {
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
