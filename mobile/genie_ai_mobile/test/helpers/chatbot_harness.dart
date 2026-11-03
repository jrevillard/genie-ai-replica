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
import 'package:genie_ai_mobile/utils/theme_manager.dart';
import 'package:http/http.dart' as http;
import 'package:openapi/api.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'theme_helper.dart';

// The chatbot widget tests' shared harness: the Quick Help tree fixture,
// the config-asset mock (the REAL bundled configuration with the buttons
// replaced), the chatbot mount, and the singleton teardown. The blocks
// this module replaces lived verbatim in four test files; a fix to their
// mechanics (the bundle-cache eviction below, the app's own ThemeData in
// the mount) must land ONCE, not once per copy.

/// The Quick Help hierarchy the chatbot widget tests resolve scopes
/// against. A FRESH list per call: a test that mutates its tree must not
/// mutate the next test's.
List<dynamic> quickHelpTreeFixture() => <dynamic>[
  {
    'catKey': '2',
    'name': 'Civil Registry',
    'nameEN': 'Civil Registry',
    'children': [
      {'_key': 'svc-1', 'name': 'Births', 'nameEN': 'Births'},
    ],
  },
];

/// The REAL bundled configuration, read OUTSIDE the widget tests' fake
/// async — an asset load awaited inside testWidgets never completes —
/// with the buttons replaced by the cards the scenario needs. Encoded
/// ONCE per scenario: the mock serves the same bytes for every request.
Future<Uint8List> chatbotConfigBytesWithButtons(
  List<Map<String, dynamic>> buttons,
) async {
  final raw = await rootBundle.loadString('assets/config/genie-ai-config.json');
  final config = jsonDecode(raw) as Map<String, dynamic>;
  final configButtons =
      config['features']['chat']['quickHelp']['buttons'] as List<dynamic>;
  configButtons
    ..clear()
    ..addAll(buttons);
  return Uint8List.fromList(utf8.encode(jsonEncode(config)));
}

/// The phone-sized surface the Quick Help layout tests mount on (360×
/// 740 logical): at the desktop-sized default the tiles are wide
/// enough to hide the defects the suites report.
void usePhoneSurface(WidgetTester tester) {
  tester.view.physicalSize = const Size(360, 740);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);
}

/// Serves the prepared configuration over the asset bundle's RAW
/// messenger (a ByteData key in, a ByteData asset out — a MethodChannel
/// mock never sees it). Every other key returns null, which degrades a
/// card icon to its neutral fallback instead of failing the test. The
/// bundle CACHES asset reads, so the eviction is what makes the mock
/// visible.
void mockChatbotConfigAsset(
  WidgetTester tester,
  Uint8List configBytes, {
  Map<String, String> extraAssets = const {},
}) {
  // A re-mock in the same test replaces the served set: the PREVIOUS
  // set's keys are evicted up front, so bytes a stale cache holds
  // under a key the new handler no longer answers cannot resurface.
  for (final key in _mockedExtraAssetKeys) {
    rootBundle.evict(key);
  }
  _mockedExtraAssetKeys = extraAssets.keys.toSet();
  tester.binding.defaultBinaryMessenger.setMockMessageHandler(
    'flutter/assets',
    (ByteData? message) async {
      if (message == null) return null;
      final key = utf8.decode(message.buffer.asUint8List());
      if (key == 'assets/config/genie-ai-config.json') {
        return ByteData.sublistView(configBytes);
      }
      final extra = extraAssets[key];
      if (extra == null) return null;
      return ByteData.sublistView(utf8.encode(extra));
    },
  );
  rootBundle.evict('assets/config/genie-ai-config.json');
  for (final key in _mockedExtraAssetKeys) {
    rootBundle.evict(key);
  }
}

/// Tears the chatbot tests' singletons down: the font scale and theme
/// the test raised (ThemeManager is a singleton — its state must not
/// name the next test's mount), the locale, and the asset mock (the
/// handler AND the bundle's CACHE of the mutated bytes — a later test
/// reading the real asset must not get a cache hit serving them).
/// The extra asset keys the LAST mockChatbotConfigAsset call served —
/// the teardown evicts them, so a later test loading the same key
/// without mocking it gets the degradation path, not the previous
/// test's cached bytes.
Set<String> _mockedExtraAssetKeys = <String>{};

void resetChatbotTestState() {
  // ThemeManager persists every set through the shared_preferences
  // plugin; without an in-memory mock the unhandled MissingPluginException
  // of a previous test's persist lands on the NEXT test ("failed after
  // it had already completed").
  SharedPreferences.setMockInitialValues(<String, Object>{});
  resetThemeManager();
  I18nService().changeLanguage('en');
  TestWidgetsFlutterBinding.instance.defaultBinaryMessenger
      .setMockMessageHandler('flutter/assets', null);
  rootBundle.evict('assets/config/genie-ai-config.json');
  for (final key in _mockedExtraAssetKeys) {
    rootBundle.evict(key);
  }
  _mockedExtraAssetKeys = <String>{};
}

/// The chatbot widget the harness mounts. Its constructor's arguments
/// live HERE, so a change to [ChatBotComponent]'s constructor lands
/// once, not once per test file.
Widget chatBotUnderTest(GlobalKey<ChatBotComponentState>? key) =>
    ChatBotComponent(
      key: key,
      userId: 'user-1',
      onRefreshSidebar: () {},
      onRelatedDocumentsUpdate: (_) {},
    );

/// Mounts the chatbot under the harness every chatbot widget test
/// shares: the mocked APIs, the i18n singleton driving the locale, and
/// the app's OWN ThemeData — a widget under a plain MaterialApp
/// resolves text themes the shipped theme does not carry (the trap the
/// mobile Visual Fidelity rule names).
///
/// [buildHome] replaces the default screen — a test that mounts its own
/// widgets around the chatbot (a service tree panel above it) passes
/// them here. It receives the chatbot WIDGET to mount — the
/// constructor's arguments stay in [chatBotUnderTest], and a builder
/// that wants the chatbot under test mounts THIS widget, not a second
/// copy. It is a
/// BUILDER, not a widget: the harness rebuilds the
/// screen on every locale change, and a widget instance reused across
/// rebuilds is not rebuilt at all.
Future<void> pumpChatBot(
  WidgetTester tester,
  http.BaseClient mock, {
  GlobalKey<ChatBotComponentState>? chatKey,
  List<Locale> supportedLocales = const [Locale('en')],
  Widget Function(Widget chatbot)? buildHome,
  ThemeData? theme,
  QueriesApi? queriesApi,
  bool settle = true,
}) async {
  final homeWith = buildHome ?? (chatbot) => Scaffold(body: chatbot);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        serviceCategoriesApiProvider.overrideWithValue(
          ServiceCategoriesApi(ApiClient()..client = mock),
        ),
        chatHistoryApiProvider.overrideWithValue(
          ChatHistoryApi(ApiClient()..client = mock),
        ),
        if (queriesApi != null)
          queriesApiProvider.overrideWithValue(queriesApi),
      ],
      child: AnimatedBuilder(
        animation: I18nService(),
        builder: (context, _) => MaterialApp(
          theme: theme ?? ThemeManager().lightTheme,
          locale: I18nService().currentLocale,
          supportedLocales: supportedLocales,
          localizationsDelegates: const [
            FallbackMaterialLocalizationsDelegate(),
            FallbackWidgetsLocalizationsDelegate(),
            GlobalCupertinoLocalizations.delegate,
          ],
          home: homeWith(chatBotUnderTest(chatKey)),
        ),
      ),
    ),
  );
  if (settle) {
    await tester.pumpAndSettle();
  }
}

/// The tree-answer mock client the Quick Help grid tests share: the
/// categories endpoint answers with [tree] at [categoriesStatus],
/// every other path 404s.
class QuickHelpTreeMockClient extends http.BaseClient {
  QuickHelpTreeMockClient(this.tree, {this.categoriesStatus = 200});

  final List<dynamic> tree;
  final int categoriesStatus;

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    final path = request.url.path;
    if (path.contains('/api/service-categories/categories')) {
      return httpResponseJson(tree, categoriesStatus);
    }
    return httpResponseJson(<String, dynamic>{}, 404);
  }
}

/// The JSON response every chatbot test's mock client answers with —
/// one encoding of the shape (JSON body, content-type header).
http.StreamedResponse httpResponseJson(Object? body, int status) {
  final bytes = utf8.encode(jsonEncode(body));
  return http.StreamedResponse(
    http.ByteStream.fromBytes(bytes),
    status,
    headers: {'content-type': 'application/json'},
  );
}

/// The chatbot RESTORE tests' HTTP mock: the hierarchy tree — with a
/// PER-LOCALE transient-outage budget — and ONE saved conversation
/// carrying the tags, the category edge and the messages the scenario
/// needs; every other request 404s. The restore test files shared this
/// class verbatim as two private copies; the merge lives here so a
/// change to its mechanics lands once.
class ChatbotMockClient extends http.BaseClient {
  ChatbotMockClient(
    this.tree, {
    this.conversationTags = const [],
    this.conversationCategoryId = '2',
    this.conversationMessages = const <dynamic>[],
    this.failFirstCounts = const {},
  });

  final List<dynamic> tree;
  final List<String> conversationTags;
  final String? conversationCategoryId;
  final List<dynamic> conversationMessages;

  /// Per locale: the FIRST N tree requests fail with a 500 (a transient
  /// hierarchy outage) and every later one serves the tree. The counts
  /// are keyed by the REQUEST's locale — a localized fetch inside the
  /// outage window must not consume another locale's failure budget.
  final Map<String, int> failFirstCounts;
  final Map<String, int> _treeRequestsByLocale = {};

  /// The `categoryId` of every conversation-write request, in arrival
  /// order — the wire a test reads the restored scope's category off.
  final List<dynamic> savedCategoryIds = [];

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    final path = request.url.path;
    if (path.contains('/api/service-categories/categories')) {
      final locale = request.url.queryParameters['locale'] ?? 'en';
      _treeRequestsByLocale[locale] = (_treeRequestsByLocale[locale] ?? 0) + 1;
      final failFirst = failFirstCounts[locale];
      if (failFirst != null && _treeRequestsByLocale[locale]! <= failFirst) {
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
        'messages': conversationMessages,
      }, 200);
    }
    if (request.method == 'PATCH' &&
        path.contains('/api/chat/conversations/')) {
      _captureSave(request);
      return httpResponseJson(<String, dynamic>{'_key': 'conv-1'}, 200);
    }
    return httpResponseJson(<String, dynamic>{}, 404);
  }

  void _captureSave(http.BaseRequest request) {
    final body =
        jsonDecode((request as http.Request).body) as Map<String, dynamic>;
    savedCategoryIds.add(body['categoryId']);
  }
}
