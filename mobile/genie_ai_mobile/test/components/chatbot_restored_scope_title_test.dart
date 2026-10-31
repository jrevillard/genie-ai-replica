import 'dart:async';
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

// A RESTORED sidebar scope's context-bar title. The restore resolves the
// scope against the ENGLISH hierarchy (the wire's vocabulary), so the
// title it installs names the category in English — while the web re-maps
// every context item to the UI's language at restore time and on every
// locale switch. The chatbot must re-title the restored scope from the
// localized tree, by the category key the conversation's edge carries.
void main() {
  final enTree = <dynamic>[
    {
      'catKey': '2',
      'name': 'Civil Registry',
      'nameEN': 'Civil Registry',
      'children': [
        {'_key': 'svc-1', 'name': 'Births', 'nameEN': 'Births'},
      ],
    },
  ];
  final esTree = <dynamic>[
    {
      'catKey': '2',
      'name': 'Registro Civil',
      'nameEN': 'Civil Registry',
      'children': [
        {'_key': 'svc-1', 'name': 'Nacimientos', 'nameEN': 'Births'},
      ],
    },
  ];
  // A tree whose category the live hierarchy DROPPED: the localized fetch
  // cannot name the restored scope's category, and the title must stay as
  // the restore installed it — never blank, never renamed to something
  // the tree no longer carries.
  final esTreeWithoutCategory = <dynamic>[
    {'catKey': '9', 'name': 'Otra categoría', 'nameEN': 'Other Category'},
  ];

  final cards = <Map<String, dynamic>>[
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

  // The REAL bundled configuration, with the buttons replaced by the
  // card the button-scope test restores. Encoded ONCE: the mock serves
  // the same bytes for every request.
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
      ..addAll(cards);
    configBytes = Uint8List.fromList(utf8.encode(jsonEncode(config)));
  });

  /// Serves the prepared configuration over the asset bundle's RAW
  /// messenger. The restore awaits the Quick Help config before it
  /// commits its scope, and an asset load awaited inside testWidgets
  /// never completes — the mock is what lets the restore finish.
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
    _RestoredScopeMockClient mock, {
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
            supportedLocales: const [Locale('en'), Locale('es'), Locale('fr')],
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

  testWidgets('a restored sidebar scope titles its bar in the UI locale', (
    tester,
  ) async {
    // The app is Spanish before the restore: the bar must not name the
    // category in English.
    I18nService().changeLanguage('es');
    final mock = _RestoredScopeMockClient(
      treesByLocale: {'en': enTree, 'es': esTree},
    );
    final chatKey = GlobalKey<ChatBotComponentState>();
    mockConfigAsset(tester);
    await pumpChat(tester, mock, chatKey: chatKey);

    await chatKey.currentState!.loadConversation('conv-1');
    await tester.pumpAndSettle();

    // The bar's own Text is asserted exactly, so a stray tree row
    // cannot satisfy it.
    expect(find.text('Contexto: Registro Civil'), findsOneWidget);
    expect(find.textContaining('Civil Registry'), findsNothing);
    // The localized tree of its own: the restore resolved the scope
    // against the EN tree and re-titled from the localized one.
    expect(mock.requestsByLocale['es'], 1);
  });

  testWidgets('a locale switch re-titles a restored sidebar scope', (
    tester,
  ) async {
    final mock = _RestoredScopeMockClient(
      treesByLocale: {'en': enTree, 'es': esTree},
    );
    final chatKey = GlobalKey<ChatBotComponentState>();
    mockConfigAsset(tester);
    await pumpChat(tester, mock, chatKey: chatKey);

    await chatKey.currentState!.loadConversation('conv-1');
    await tester.pumpAndSettle();
    expect(find.text('Context: Civil Registry'), findsOneWidget);
    // An English UI needs no localized fetch: the ENGLISH tree the
    // restore resolved against IS the localized tree for 'en', and the
    // title it installed is already the one an 'en' fetch would answer.
    expect(mock.requestsByLocale['en'], 1);

    I18nService().changeLanguage('es');
    await tester.pumpAndSettle();

    expect(find.text('Contexto: Registro Civil'), findsOneWidget);
    expect(find.textContaining('Civil Registry'), findsNothing);
    // Two fetches, both correct: the drift's own one, and the repair
    // the config reload's re-resolve needs — that re-resolve re-applies
    // the restored scope (re-installing the ENGLISH title the resolver
    // names), and the re-apply re-titles it from the localized tree
    // again.
    expect(mock.requestsByLocale['es'], 2);
  });

  testWidgets('a category the localized tree does not carry keeps its title', (
    tester,
  ) async {
    I18nService().changeLanguage('es');
    final mock = _RestoredScopeMockClient(
      treesByLocale: {'en': enTree, 'es': esTreeWithoutCategory},
    );
    final chatKey = GlobalKey<ChatBotComponentState>();
    mockConfigAsset(tester);
    await pumpChat(tester, mock, chatKey: chatKey);

    await chatKey.currentState!.loadConversation('conv-1');
    await tester.pumpAndSettle();

    // All-or-nothing: the tree cannot name the category, so the title
    // the restore installed stands — never blanked, never renamed.
    expect(find.text('Contexto: Civil Registry'), findsOneWidget);
  });

  testWidgets(
    'a scope replaced mid-fetch is not re-titled by the stale response',
    (tester) async {
      // Every 'es' response is HELD: the restore's localized fetch is
      // genuinely in flight while the user replaces the scope.
      I18nService().changeLanguage('es');
      final mock = _RestoredScopeMockClient(
        treesByLocale: {'en': enTree, 'es': esTree},
        holdFromCounts: {'es': 1},
      );
      final chatKey = GlobalKey<ChatBotComponentState>();
      mockConfigAsset(tester);
      await pumpChat(tester, mock, chatKey: chatKey);

      await chatKey.currentState!.loadConversation('conv-1');
      // Plain pumps while the held response keeps the fetch in flight.
      for (var i = 0; i < 10 && (mock.requestsByLocale['es'] ?? 0) < 1; i++) {
        await tester.pump();
      }
      expect(mock.requestsByLocale['es'], 1);

      // The user starts a NEW chat while the fetch is in flight: the
      // restored scope (and its category title) left with the
      // conversation.
      chatKey.currentState!.startNewChat();
      await tester.pumpAndSettle();
      expect(find.text('Contexto: Registro Civil'), findsNothing);

      // Release the held response: the capture guard must drop it — a
      // commit would reinstall a context bar the user just cleared.
      mock.releaseHeld();
      await tester.pumpAndSettle();
      expect(find.text('Contexto: Registro Civil'), findsNothing);
    },
  );

  testWidgets(
    'a restored Quick Help scope keeps its button title across a switch',
    (tester) async {
      I18nService().changeLanguage('es');
      final mock = _RestoredScopeMockClient(
        treesByLocale: {'en': enTree, 'es': esTree},
        conversationTags: ['births-id'],
      );
      final chatKey = GlobalKey<ChatBotComponentState>();
      mockConfigAsset(tester);
      await pumpChat(tester, mock, chatKey: chatKey);

      await chatKey.currentState!.loadConversation('conv-1');
      await tester.pumpAndSettle();
      expect(find.text('Contexto: Births Card'), findsOneWidget);

      I18nService().changeLanguage('fr');
      await tester.pumpAndSettle();

      // The button's title is re-resolved by the config reload, by id —
      // never through the category: the card's title is what the press
      // and the web show.
      expect(find.text('Contexte : Births Card'), findsOneWidget);
      expect(find.textContaining('Registro Civil'), findsNothing);
    },
  );
}

class _RestoredScopeMockClient extends http.BaseClient {
  _RestoredScopeMockClient({
    required this.treesByLocale,
    this.conversationTags = const ['Births'],
    this.holdFromCounts = const {},
  });

  final Map<String, List<dynamic>> treesByLocale;
  final List<String> conversationTags;

  /// Per locale: the response of the Nth request (and every later one)
  /// is HELD until [releaseHeld] — a fetch is genuinely in flight while
  /// the test moves the app underneath it.
  final Map<String, int> holdFromCounts;
  final Map<String, int> requestsByLocale = {};
  final List<({String locale, Completer<http.StreamedResponse> completer})>
  _held = [];

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    final path = request.url.path;
    final locale =
        Uri.parse(request.url.toString()).queryParameters['locale'] ?? 'en';
    if (path.contains('/api/service-categories/categories')) {
      requestsByLocale[locale] = (requestsByLocale[locale] ?? 0) + 1;
      final holdFrom = holdFromCounts[locale];
      if (holdFrom != null && (requestsByLocale[locale] ?? 0) >= holdFrom) {
        final completer = Completer<http.StreamedResponse>();
        _held.add((locale: locale, completer: completer));
        return completer.future;
      }
      return _json(treesByLocale[locale] ?? [], 200);
    }
    if (request.method == 'GET' &&
        path.contains('/api/chat/conversations/conv-1')) {
      return _json(<String, dynamic>{
        '_key': 'conv-1',
        'title': 'Saved conversation',
        'categoryId': '2',
        'tags': conversationTags,
        'messages': <dynamic>[],
      }, 200);
    }
    return _json(<String, dynamic>{}, 404);
  }

  /// Releases every held response, in arrival order.
  void releaseHeld() {
    final held = List.of(_held);
    _held.clear();
    for (final entry in held) {
      entry.completer.complete(_json(treesByLocale[entry.locale] ?? [], 200));
    }
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
