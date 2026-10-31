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
// carries one) tags its title — never nothing, which is what the
// id-only identity saved before the fix. The tag is asserted at the
// HTTP boundary (the conversation-create request the save sends), so
// the test covers the whole user path: tap, install, save.
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

  setUp(() {
    resetThemeManager();
  });

  // The REAL bundled configuration, read OUTSIDE the widget test's fake
  // async (an asset load awaited inside testWidgets never completes).
  late Map<String, dynamic> baseConfig;

  setUpAll(() async {
    final raw = await rootBundle.loadString(
      'assets/config/genie-ai-config.json',
    );
    baseConfig = jsonDecode(raw) as Map<String, dynamic>;
  });

  tearDown(() {
    // The locale is a singleton: a test that switched it must not name
    // the next test's mount.
    I18nService().changeLanguage('en');
  });

  /// Serves a MODIFIED copy of the real bundled configuration — the
  /// shipped file's own shape, with the buttons replaced by the two
  /// cards the test taps (an id-less one and an id'd one, neither
  /// carrying an action, so a tap installs the scope without sending).
  /// The mock intercepts the asset channel: every other key returns
  /// null, which degrades a card icon to its neutral fallback instead
  /// of failing the test.
  Future<void> mockConfigButtons(
    WidgetTester tester,
    List<Map<String, dynamic>> buttons,
  ) async {
    final config = jsonDecode(jsonEncode(baseConfig)) as Map<String, dynamic>;
    (config['features']['chat']['quickHelp']['buttons'] as List<dynamic>)
        .clear();
    (config['features']['chat']['quickHelp']['buttons'] as List<dynamic>)
        .addAll(buttons);
    // The asset bundle reads its keys over the RAW 'flutter/assets'
    // messenger (a ByteData key in, a ByteData asset out) — a
    // MethodChannel mock never sees it.
    tester.binding.defaultBinaryMessenger.setMockMessageHandler(
      'flutter/assets',
      (ByteData? message) async {
        final key = utf8.decode(message!.buffer.asUint8List());
        if (key != 'assets/config/genie-ai-config.json') return null;
        final bytes = utf8.encode(jsonEncode(config));
        return ByteData.sublistView(Uint8List.fromList(bytes));
      },
    );
    // The bundle CACHES the real asset (the setUpAll read primed it):
    // without the eviction the widget's load is served from the cache
    // and the mock never sees it.
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
            supportedLocales: const [Locale('en'), Locale('es')],
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

  testWidgets(
    'an id-less Quick Help card tags the saved conversation with its title',
    (tester) async {
      final mock = _ConversationMockClient(tree);
      final chatKey = GlobalKey<ChatBotComponentState>();
      await mockConfigButtons(tester, [
        // No id, no action: the press installs the scope and asks for
        // the question instead of sending one.
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
      ]);
      await pumpChat(tester, mock, chatKey: chatKey);

      await tester.tap(find.text('Registry Card'));
      await tester.pumpAndSettle();
      // The press installed the scope: the context bar carries the
      // card's title (the same name the tag must carry).
      expect(find.textContaining('Registry Card'), findsWidgets);

      await chatKey.currentState!.saveConversation();
      await tester.pumpAndSettle();

      expect(mock.conversationBody, isNotNull);
      expect(mock.conversationBody!['tags'], ['Registry Card']);
      expect(mock.conversationBody!['categoryId'], '2');
    },
  );

  testWidgets('an id-carrying card still tags the conversation with its id', (
    tester,
  ) async {
    final mock = _ConversationMockClient(tree);
    final chatKey = GlobalKey<ChatBotComponentState>();
    await mockConfigButtons(tester, [
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
    ]);
    await pumpChat(tester, mock, chatKey: chatKey);

    await tester.tap(find.text('Births Card'));
    await tester.pumpAndSettle();

    await chatKey.currentState!.saveConversation();
    await tester.pumpAndSettle();

    expect(mock.conversationBody, isNotNull);
    expect(mock.conversationBody!['tags'], ['births-id']);
  });
}

class _ConversationMockClient extends http.BaseClient {
  _ConversationMockClient(this.tree);

  final List<dynamic> tree;
  Map<String, dynamic>? conversationBody;

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    final path = request.url.path;
    if (path.contains('/api/service-categories/categories')) {
      return _json(tree, 200);
    }
    if (request.method == 'POST' && path.endsWith('/api/chat/conversations')) {
      conversationBody =
          jsonDecode((request as http.Request).body) as Map<String, dynamic>;
      return _json(<String, dynamic>{'_key': 'conv-1', 'title': 't'}, 201);
    }
    if (request.method == 'POST' && path.contains('/messages')) {
      return _json(<String, dynamic>{}, 201);
    }
    return _json(<String, dynamic>{}, 404);
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
