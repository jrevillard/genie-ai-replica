import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/components/chat/chatbot_component.dart';
import 'package:http/http.dart' as http;

import '../helpers/chatbot_harness.dart';

// The Quick Help conversation tag, as a card press writes it into a
// SAVED conversation. The tag carries the button's identity —
// `id || title` (#1194): an id'd card tags its id, an id-less card (a
// hand-edited deployment configuration; no shipped configuration
// carries one) tags its title — never nothing: an id-only identity
// leaves an id-less card's conversation without a Quick Help tag at
// all. The tag is asserted at the HTTP boundary (the conversation-write
// requests the saves send), so the test covers the whole user path:
// tap, install, save.
void main() {
  final tree = quickHelpTreeFixture();

  // The two cards the test taps: an id-less scoped one and an id'd one,
  // neither carrying an action, so a press installs the scope without
  // sending a question. The third declares a NUMERIC id — the shape the
  // cross-platform tag contract names.
  final twoCards = <Map<String, dynamic>>[
    {
      'title': {'en': 'Registry Card'},
      'category': '2',
      'serviceLabels': ['Births'],
    },
    {
      'id': 'births-id',
      'title': {'en': 'Births Card'},
      'category': '2',
      'serviceLabels': ['Births'],
    },
    {
      'id': 5.0,
      'title': {'en': 'Numeric Card'},
      'category': '2',
      'serviceLabels': ['Births'],
    },
  ];

  setUp(resetChatbotTestState);
  tearDown(resetChatbotTestState);

  // The REAL bundled configuration, with the buttons replaced by the
  // cards the test taps. Encoded ONCE: the mock serves the same bytes
  // for every request.
  late Uint8List configBytes;

  setUpAll(() async {
    configBytes = await chatbotConfigBytesWithButtons(twoCards);
  });

  Future<void> pumpChat(
    WidgetTester tester,
    _ConversationMockClient mock, {
    GlobalKey<ChatBotComponentState>? chatKey,
  }) {
    return pumpChatBot(tester, mock, chatKey: chatKey);
  }

  testWidgets('a card press tags the saved conversation with its identity', (
    tester,
  ) async {
    final mock = _ConversationMockClient(tree);
    final chatKey = GlobalKey<ChatBotComponentState>();
    mockChatbotConfigAsset(tester, configBytes);
    await pumpChat(tester, mock, chatKey: chatKey);

    // The id-less card: the tag is its TITLE — what the fix exists for.
    await tester.tap(find.text('Registry Card'));
    await tester.pumpAndSettle();
    // The press installed the scope: the context bar carries the card's
    // title (the same name the tag must carry).
    expect(find.textContaining('Registry Card'), findsWidgets);
    await chatKey.currentState!.saveConversation();
    await tester.pumpAndSettle();

    // The id'd card: the tag is its ID. A press closes the Quick Help
    // grid, so the second case runs on a fresh chat (startNewChat
    // re-shows it once the saved conversation has no pending turn).
    chatKey.currentState!.startNewChat();
    await tester.pumpAndSettle();
    await tester.tap(find.text('Births Card'));
    await tester.pumpAndSettle();
    await chatKey.currentState!.saveConversation();
    await tester.pumpAndSettle();

    expect(mock.conversationTags, hasLength(2));
    expect(mock.conversationTags.first, ['Registry Card']);
    expect(mock.conversationTags.last, ['births-id']);
    expect(mock.categoryIds.every((id) => id == '2'), isTrue);
  });

  testWidgets('a NUMERIC id is saved in the string form the web reads back', (
    tester,
  ) async {
    // The cross-platform tag contract: the conversation tag carries the
    // id in the form JavaScript serializes it — a JSON 5.0 becomes '5',
    // never Dart's '5.0'. The web now saves the same string form, so a
    // conversation saved here restores on the web and a web-saved one
    // restores here. The tag is asserted at the HTTP boundary, so the
    // whole path is covered: tap, install, save.
    final mock = _ConversationMockClient(tree);
    final chatKey = GlobalKey<ChatBotComponentState>();
    mockChatbotConfigAsset(tester, configBytes);
    await pumpChat(tester, mock, chatKey: chatKey);

    await tester.tap(find.text('Numeric Card'));
    await tester.pumpAndSettle();
    await chatKey.currentState!.saveConversation();
    await tester.pumpAndSettle();

    expect(mock.conversationTags, hasLength(1));
    expect(mock.conversationTags.single, ['5']);
  });
}

class _ConversationMockClient extends http.BaseClient {
  _ConversationMockClient(this.tree);

  final List<dynamic> tree;

  /// The `tags` of every conversation-create request, in arrival order
  /// (each case saves its own conversation).
  final List<List<dynamic>> conversationTags = [];
  final List<dynamic> categoryIds = [];

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    final path = request.url.path;
    if (path.contains('/api/service-categories/categories')) {
      return httpResponseJson(tree, 200);
    }
    if (request.method == 'POST' && path.endsWith('/api/chat/conversations')) {
      _capture(request);
      return httpResponseJson(<String, dynamic>{'_key': 'conv-1'}, 201);
    }
    if (request.method == 'POST' && path.contains('/messages')) {
      return httpResponseJson(<String, dynamic>{}, 201);
    }
    return httpResponseJson(<String, dynamic>{}, 404);
  }

  void _capture(http.BaseRequest request) {
    final body =
        jsonDecode((request as http.Request).body) as Map<String, dynamic>;
    conversationTags.add(body['tags'] as List<dynamic>? ?? <dynamic>[]);
    categoryIds.add(body['categoryId']);
  }
}
