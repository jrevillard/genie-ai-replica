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

/// Serves the prepared configuration over the asset bundle's RAW
/// messenger (a ByteData key in, a ByteData asset out — a MethodChannel
/// mock never sees it). Every other key returns null, which degrades a
/// card icon to its neutral fallback instead of failing the test. The
/// bundle CACHES asset reads, so the eviction is what makes the mock
/// visible.
void mockChatbotConfigAsset(WidgetTester tester, Uint8List configBytes) {
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

/// Tears the chatbot tests' singletons down: the font scale and theme
/// the test raised (ThemeManager is a singleton — its state must not
/// name the next test's mount), the locale, and the asset mock (the
/// handler AND the bundle's CACHE of the mutated bytes — a later test
/// reading the real asset must not get a cache hit serving them).
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
/// them here. It receives the MOUNTED chatbot, so the constructor's
/// arguments stay in [chatBotUnderTest] and a builder that wants the
/// chatbot under test mounts THIS widget — not a second copy. It is a
/// BUILDER, not a widget: the harness rebuilds the
/// screen on every locale change, and a widget instance reused across
/// rebuilds is not rebuilt at all.
Future<void> pumpChatBot(
  WidgetTester tester,
  http.BaseClient mock, {
  GlobalKey<ChatBotComponentState>? chatKey,
  List<Locale> supportedLocales = const [Locale('en')],
  Widget Function(Widget chatbot)? buildHome,
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
      ],
      child: AnimatedBuilder(
        animation: I18nService(),
        builder: (context, _) => MaterialApp(
          theme: ThemeManager().lightTheme,
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
  await tester.pumpAndSettle();
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
