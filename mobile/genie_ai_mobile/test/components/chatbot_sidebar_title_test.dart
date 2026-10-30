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

  setUp(() {
    resetThemeManager();
  });

  tearDown(() {
    // The locale is a singleton: a test that switched it must not name
    // the next test's mount.
    I18nService().changeLanguage('en');
  });

  testWidgets(
    'a sidebar scope re-titles its context bar when the locale switches',
    (tester) async {
      final mock = _LocaleMockClient({'en': enTree, 'es': esTree});
      final api = ServiceCategoriesApi(ApiClient()..client = mock);
      final chatKey = GlobalKey<ChatBotComponentState>();

      await tester.pumpWidget(
        ProviderScope(
          overrides: [serviceCategoriesApiProvider.overrideWithValue(api)],
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
                body: Column(
                  children: [
                    SizedBox(
                      height: 300,
                      child: ServiceTreePanel(
                        onSelectionChange: (selection) {
                          // The page's own mapping (main.dart's
                          // _onServiceSelected): display name and EN
                          // wire labels travel to the chat together.
                          chatKey.currentState?.setCategoryContext(
                            selection['category_id'] ?? selection['id'] ?? '',
                            selection['name'] ?? '',
                            categoryNameEn:
                                selection['categoryNameEn']?.toString() ?? '',
                            serviceLabelsEn:
                                (selection['serviceLabelsEn']
                                            as List<dynamic>? ??
                                        const <dynamic>[])
                                    .map((e) => e.toString())
                                    .where((e) => e.isNotEmpty)
                                    .toList(),
                            serviceCount:
                                (selection['serviceCount'] as num?)?.toInt() ??
                                0,
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

      // Pick the one service: the context bar installs the selection's
      // localized name.
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
    final mock = _LocaleMockClient({'en': enTree, 'es': esTree});
    final api = ServiceCategoriesApi(ApiClient()..client = mock);

    await tester.pumpWidget(
      ProviderScope(
        overrides: [serviceCategoriesApiProvider.overrideWithValue(api)],
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
              body: Column(
                children: [
                  SizedBox(
                    height: 300,
                    child: ServiceTreePanel(onSelectionChange: (_) {}),
                  ),
                  Expanded(
                    child: ChatBotComponent(
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

    // At mount the panel and the chatbot each fetch the 'en' tree.
    expect(mock.requestsByLocale['en'], 2);

    I18nService().changeLanguage('es');
    await tester.pumpAndSettle();

    // Only the panel re-fetches: the chatbot holds no sidebar scope,
    // and the localized tree names nothing for it.
    expect(mock.requestsByLocale['es'], 1);
  });
}

class _LocaleMockClient extends http.BaseClient {
  _LocaleMockClient(this.treesByLocale);
  final Map<String, List<dynamic>> treesByLocale;
  final Map<String, int> requestsByLocale = {};

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    final locale =
        Uri.parse(request.url.toString()).queryParameters['locale'] ?? 'en';
    requestsByLocale[locale] = (requestsByLocale[locale] ?? 0) + 1;
    final bytes = utf8.encode(jsonEncode(treesByLocale[locale] ?? []));
    return http.StreamedResponse(
      http.ByteStream.fromBytes(bytes),
      200,
      headers: {'content-type': 'application/json'},
    );
  }
}
