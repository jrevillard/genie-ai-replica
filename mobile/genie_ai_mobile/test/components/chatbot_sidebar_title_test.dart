import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/components/chat/chatbot_component.dart';
import 'package:genie_ai_mobile/components/sidebar/service_tree_panel.dart';
import 'package:genie_ai_mobile/providers/api_providers.dart';
import 'package:genie_ai_mobile/services/fallback_localizations.dart';
import 'package:genie_ai_mobile/services/i18n_service.dart';
import 'package:http/http.dart' as http;
import 'package:openapi/api.dart';

import '../helpers/theme_helper.dart';

// The sidebar scope's context-bar title across a locale switch. The title
// is the JOIN of the localized service names the panel installed it with,
// so a switch that re-fetches the panel's tree but leaves the chatbot's
// copy alone shows a scope named in the language it was picked under.
// The chatbot must re-title it from a hierarchy fetched in the CURRENT
// locale — the web re-maps its chips the same way.
void main() {
  final enTree = <dynamic>[
    {
      'catKey': '2',
      'name': 'Civil Registry',
      'nameEN': 'Civil Registry',
      'children': [
        {'_key': 'svc-1', 'name': 'Births', 'nameEN': 'Births'},
        // A row whose entity carries no ENGLISH translation: pickable,
        // but it contributes no label to the selection's wire scope.
        {'_key': 'svc-2', 'name': 'Mystery'},
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
        {'_key': 'svc-2', 'name': 'Misterio'},
      ],
    },
  ];

  setUp(() {
    resetThemeManager();
  });

  tearDown(() {
    // The locale is a singleton: a test that switched it must not name
    // the next test's mount.
    I18nService().changeLanguage('en');
  });

  Future<void> pumpChatWithTree(
    WidgetTester tester,
    _LocaleMockClient mock, {
    GlobalKey<ChatBotComponentState>? chatKey,
  }) async {
    final api = ServiceCategoriesApi(ApiClient()..client = mock);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [serviceCategoriesApiProvider.overrideWithValue(api)],
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
              body: Column(
                children: [
                  SizedBox(
                    height: 300,
                    child: ServiceTreePanel(
                      onSelectionChange: (selection) {
                        // The page's own mapping (main.dart's
                        // _onServiceSelected): display name and EN
                        // wire labels travel to the chat together.
                        chatKey?.currentState?.setCategoryContext(
                          selection['category_id'] ?? selection['id'] ?? '',
                          selection['name'] ?? '',
                          categoryNameEn:
                              selection['categoryNameEn']?.toString() ?? '',
                          serviceLabelsEn:
                              (selection['serviceLabelsEn'] as List<dynamic>? ??
                                      const <dynamic>[])
                                  .map((e) => e.toString())
                                  .where((e) => e.isNotEmpty)
                                  .toList(),
                          serviceCount:
                              (selection['serviceCount'] as num?)?.toInt() ?? 0,
                        );
                      },
                    ),
                  ),
                  Expanded(
                    child: ChatBotComponent(
                      key: chatKey,
                      userId: 'user-1',
                      onRefreshSidebar: () {},
                      onRelatedDocumentsUpdate: (_) {},
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  testWidgets(
    'a sidebar scope re-titles its context bar when the locale switches',
    (tester) async {
      final mock = _LocaleMockClient(
        treesByLocale: {'en': enTree, 'es': esTree},
      );
      final chatKey = GlobalKey<ChatBotComponentState>();
      await pumpChatWithTree(tester, mock, chatKey: chatKey);

      // Pick the one labelled service: the context bar installs the
      // selection's localized name.
      await tester.tap(find.text('Civil Registry'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Births'));
      await tester.pumpAndSettle();
      expect(find.textContaining('Births'), findsWidgets);

      // Switch the app locale: the context bar must follow the tree the
      // panel re-fetched, not keep the picked language.
      I18nService().changeLanguage('es');
      await tester.pumpAndSettle();

      // The scope is named in the new language: the panel's row AND the
      // context bar read it. The picked language is gone from the screen
      // — a context bar that still reads 'Births' is the defect.
      expect(find.textContaining('Nacimientos'), findsWidgets);
      expect(find.textContaining('Births'), findsNothing);
      // The chatbot fetched the localized hierarchy of its own: the
      // panel's re-fetch is the other one.
      expect(mock.requestsByLocale['es'], 2);
    },
  );

  testWidgets('a locale switch with no sidebar scope fetches no chatbot tree', (
    tester,
  ) async {
    final mock = _LocaleMockClient(treesByLocale: {'en': enTree, 'es': esTree});
    await pumpChatWithTree(tester, mock);

    // At mount the panel and the chatbot each fetch the 'en' tree.
    expect(mock.requestsByLocale['en'], 2);

    I18nService().changeLanguage('es');
    await tester.pumpAndSettle();

    // Only the panel re-fetches: the chatbot holds no sidebar scope,
    // and the localized tree names nothing for it.
    expect(mock.requestsByLocale['es'], 1);
  });

  testWidgets('a failed localized fetch keeps the installed title', (
    tester,
  ) async {
    // The response body is a VALID tree: a fetch that skips the status
    // check would re-title the bar from it — the check is what turns a
    // server error into "keep the title", not the JSON decode.
    final mock = _LocaleMockClient(
      treesByLocale: {'en': enTree, 'es': esTree},
      statusByLocale: {'es': 503},
    );
    final chatKey = GlobalKey<ChatBotComponentState>();
    await pumpChatWithTree(tester, mock, chatKey: chatKey);

    await tester.tap(find.text('Civil Registry'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Births'));
    await tester.pumpAndSettle();

    I18nService().changeLanguage('es');
    await tester.pumpAndSettle();

    // The title stays the one the selection installed; the retry is
    // scoped to the next locale change. The bar's own Text is the
    // context prefix joined to the scope — asserted exactly, so a row
    // of the panel's tree cannot satisfy it.
    expect(find.text('Contexto: Births'), findsOneWidget);
    expect(find.textContaining('Nacimientos'), findsNothing);

    // The failed attempt marked its locale: the NEXT locale change (and
    // only that) starts one new chatbot fetch — the marker did not stay
    // at the old locale, and the failure did not turn every subsequent
    // dependency change into a fetch. 'fr' names an empty tree: the
    // title keeps its language, and the fetch is still exactly one.
    I18nService().changeLanguage('fr');
    await tester.pumpAndSettle();
    expect(mock.requestsByLocale['fr'], 2);
    expect(find.text('Contexte : Births'), findsOneWidget);
  });

  testWidgets(
    'a slower superseded fetch never re-titles over the newer locale',
    (tester) async {
      // Every 'es' response is held: after the round trip to 'en', the
      // chatbot's 'es' fetch is still genuinely in flight.
      final mock = _LocaleMockClient(
        treesByLocale: {'en': enTree, 'es': esTree},
        holdFromCounts: {'es': 1},
      );
      final chatKey = GlobalKey<ChatBotComponentState>();
      await pumpChatWithTree(tester, mock, chatKey: chatKey);

      await tester.tap(find.text('Civil Registry'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Births'));
      await tester.pumpAndSettle();

      // Two switches inside one fetch's window: the 'es' fetch is still
      // in flight when the app is back to 'en'. Plain pumps while the
      // held responses keep the panel's spinner spinning.
      I18nService().changeLanguage('es');
      await tester.pump();
      I18nService().changeLanguage('en');
      // The two 'en' fetches of the switch-back (panel + chatbot) are
      // served normally: the count reaches the mount pair's 2 plus these
      // 2, and the panel's spinner stops with them.
      for (var i = 0; i < 10 && (mock.requestsByLocale['en'] ?? 0) < 4; i++) {
        await tester.pump();
      }
      await tester.pumpAndSettle();
      // Release the held 'es' responses: the chatbot's late one must be
      // superseded, the panel's late tree is display-only.
      mock.releaseHeld();
      await tester.pump();
      await tester.pump();

      // The bar reads the locale the UI is in, not the one a stale fetch
      // answered for. The bar's own Text is asserted exactly — the
      // panel's own late 'es' rows (its reload has no supersession
      // guard) must not satisfy it.
      expect(find.text('Context: Births'), findsOneWidget);
    },
  );

  testWidgets(
    'a selection that grows mid-flight is not re-titled by the stale fetch',
    (tester) async {
      // Hold from the SECOND 'es' request on: the panel's re-fetch is
      // served normally (its rows re-render in 'es'), the CHATBOT's
      // re-title fetch is held in flight.
      final mock = _LocaleMockClient(
        treesByLocale: {'en': enTree, 'es': esTree},
        holdFromCounts: {'es': 2},
      );
      final chatKey = GlobalKey<ChatBotComponentState>();
      await pumpChatWithTree(tester, mock, chatKey: chatKey);

      await tester.tap(find.text('Civil Registry'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Births'));
      await tester.pumpAndSettle();

      I18nService().changeLanguage('es');
      for (var i = 0; i < 10 && (mock.requestsByLocale['es'] ?? 0) < 2; i++) {
        await tester.pump();
      }
      expect(mock.requestsByLocale['es'], 2);
      await tester.pump();

      // While the chatbot's localized fetch is held in flight: a second,
      // UNTRANSLATED pick. The labels stay ['Births'] but the scope grew
      // — the held response must not commit its join over it.
      await tester.tap(find.text('Misterio'));
      await tester.pump();
      expect(find.text('Contexto: Births, Misterio'), findsOneWidget);

      // Release the held response: the count re-check drops the join.
      mock.releaseHeld();
      await tester.pump();
      await tester.pump();

      // The grown selection's own names stand; the bar's own Text is
      // asserted exactly — the panel's tree rows must not satisfy it.
      expect(find.text('Contexto: Births, Misterio'), findsOneWidget);
    },
  );
}

class _LocaleMockClient extends http.BaseClient {
  _LocaleMockClient({
    required this.treesByLocale,
    this.statusByLocale = const {},
    this.holdFromCounts = const {},
  });

  final Map<String, List<dynamic>> treesByLocale;
  final Map<String, int> statusByLocale;

  /// Per locale: the response of the Nth request (and every later one)
  /// is HELD until [releaseHeld] — a fetch is genuinely in flight while
  /// the test moves the app underneath it.
  final Map<String, int> holdFromCounts;
  final Map<String, int> requestsByLocale = {};
  final List<({String locale, Completer<http.StreamedResponse> completer})>
  _held = [];

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    debugPrint('[MOCK] ${request.method} ${request.url.path}');
    final locale =
        Uri.parse(request.url.toString()).queryParameters['locale'] ?? 'en';
    requestsByLocale[locale] = (requestsByLocale[locale] ?? 0) + 1;
    final holdFrom = holdFromCounts[locale];
    if (holdFrom != null && (requestsByLocale[locale] ?? 0) >= holdFrom) {
      final completer = Completer<http.StreamedResponse>();
      _held.add((locale: locale, completer: completer));
      return completer.future;
    }
    return _respond(locale);
  }

  /// Releases every held response, in arrival order.
  void releaseHeld() {
    final held = List.of(_held);
    _held.clear();
    for (final entry in held) {
      entry.completer.complete(_respond(entry.locale));
    }
  }

  http.StreamedResponse _respond(String locale) {
    final bytes = utf8.encode(jsonEncode(treesByLocale[locale] ?? []));
    return http.StreamedResponse(
      http.ByteStream.fromBytes(bytes),
      statusByLocale[locale] ?? 200,
      headers: {'content-type': 'application/json'},
    );
  }
}
