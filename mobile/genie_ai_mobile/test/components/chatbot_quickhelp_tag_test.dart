import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/components/chat/chatbot_component.dart';
import 'package:genie_ai_mobile/providers/api_providers.dart';
import 'package:genie_ai_mobile/services/fallback_localizations.dart';
import 'package:genie_ai_mobile/services/i18n_service.dart';
import 'package:http/http.dart' as http;
import 'package:openapi/api.dart';

import '../helpers/theme_helper.dart';

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
  final tree = <dynamic>[
    {
      'catKey': '2',
      'name': 'Civil Registry',
      'nameEN': 'Civil Registry',
      'children': [
        {'_key': 'svc-1', 'name': 'Births', 'nameEN': 'Births'},
      ],
    },
  ];

  // The two cards the test taps: an id-less scoped one and an id'd one,
  // neither carrying an action, so a press installs the scope without
  // sending a question.
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
  ];

  setUp(() {
    resetThemeManager();
  });

  tearDown(() {
    // The locale is a singleton: a test that switched it must not name
    // the next test's mount.
    I18nService().changeLanguage('en');
    // The asset mock must not outlive its test — neither the handler
    // (a later test would read the mutated config through it) nor the
    // bundle's CACHE of the mutated bytes (a later test reading the
    // real asset would get a cache hit serving them).
    TestWidgetsFlutterBinding.instance.defaultBinaryMessenger
        .setMockMessageHandler('flutter/assets', null);
    rootBundle.evict('assets/config/genie-ai-config.json');
  });

  // The REAL bundled configuration (read OUTSIDE the widget test's fake
  // async — an asset load awaited inside testWidgets never completes),
  // with the buttons replaced by the cards the test taps. Encoded ONCE:
  // the mock serves the same bytes for every request.
  late Uint8List configBytes;

  setUpAll(() async {
    final raw = await rootBundle.loadString(
      'assets/config/genie-ai-config.json',
    );
    final config = jsonDecode(raw) as Map<String, dynamic>;
    final buttons =
        config['features']['chat']['quickHelp']['buttons'] as List<dynamic>;
    buttons
      ..clear()
      ..addAll(twoCards);
    configBytes = Uint8List.fromList(utf8.encode(jsonEncode(config)));
  });

  /// Serves the prepared configuration over the asset bundle's RAW
  /// messenger (a ByteData key in, a ByteData asset out — a
  /// MethodChannel mock never sees it). Every other key returns null,
  /// which degrades a card icon to its neutral fallback instead of
  /// failing the test. The bundle CACHES asset reads (the setUpAll read
  /// primed it), so the eviction is what makes the mock visible.
  void mockConfigAsset(WidgetTester tester) {
    tester.binding.defaultBinaryMessenger.setMockMessageHandler(
      'flutter/assets',
      (ByteData? message) async {
        if (message == null) return null;
        final key = utf8.decode(message.buffer.asUint8List());
        if (key != 'assets/config/genie-ai-config.json') return null;
        return ByteData.sublistView(configBytes);
      },
    );
    rootBundle.evict('assets/config/genie-ai-config.json');
  }

  Future<void> pumpChat(
    WidgetTester tester,
    _ConversationMockClient mock, {
    GlobalKey<ChatBotComponentState>? chatKey,
  }) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          serviceCategoriesApiProvider.overrideWithValue(
            ServiceCategoriesApi(ApiClient()..client = mock),
          ),
          chatHistoryApiProvider.overrideWithValue(
            ChatHistoryApi(ApiClient()..client = mock),
          ),
        ],
        child: AnimatedBuilder(
          animation: I18nService(),
          builder: (context, _) => MaterialApp(
            locale: I18nService().currentLocale,
            supportedLocales: const [Locale('en')],
            localizationsDelegates: const [
              FallbackMaterialLocalizationsDelegate(),
              FallbackWidgetsLocalizationsDelegate(),
              GlobalCupertinoLocalizations.delegate,
            ],
            home: Scaffold(
              body: ChatBotComponent(
                key: chatKey,
                userId: 'user-1',
                onRefreshSidebar: () {},
                onRelatedDocumentsUpdate: (_) {},
              ),
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  testWidgets('a card press tags the saved conversation with its identity', (
    tester,
  ) async {
    final mock = _ConversationMockClient(tree);
    final chatKey = GlobalKey<ChatBotComponentState>();
    mockConfigAsset(tester);
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
      return _json(tree, 200);
    }
    if (request.method == 'POST' && path.endsWith('/api/chat/conversations')) {
      _capture(request);
      return _json(<String, dynamic>{'_key': 'conv-1'}, 201);
    }
    if (request.method == 'POST' && path.contains('/messages')) {
      return _json(<String, dynamic>{}, 201);
    }
    return _json(<String, dynamic>{}, 404);
  }

  void _capture(http.BaseRequest request) {
    final body =
        jsonDecode((request as http.Request).body) as Map<String, dynamic>;
    conversationTags.add(body['tags'] as List<dynamic>? ?? <dynamic>[]);
    categoryIds.add(body['categoryId']);
  }

  http.StreamedResponse _json(Object? body, int status) {
    final bytes = utf8.encode(jsonEncode(body));
    return http.StreamedResponse(
      http.ByteStream.fromBytes(bytes),
      status,
      headers: {'content-type': 'application/json'},
    );
  }
}
