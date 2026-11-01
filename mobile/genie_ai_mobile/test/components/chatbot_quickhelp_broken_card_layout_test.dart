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

import '../helpers/theme_helper.dart';

// The LAYOUT of the Quick Help failure presentation (issue #1224). The
// grid tile's height is the delegate's childAspectRatio (default 3.5 —
// a wide, short tile): a broken card's diagnosis caption gets a box
// smaller than one textXs line at the shipped default layout, and the
// text is hard-clipped mid-glyph — the ellipsis of the clamp can never
// render. The icon+title row above it is a non-flex child, so at an
// extreme accessibility font scale it alone can outgrow the fixed tile
// and the build throws a RenderFlex overflow.
//
// These tests assert STRUCTURE and RESOLVED GEOMETRY on a phone-sized
// surface (360×740 logical — the shipped 2-column default gives a
// ~159×45 tile): the diagnosis must leave the fixed-aspect grid (its
// row's height follows its text), and the healthy tile must survive a
// font scale no user-set value exceeds. The rendered pixels in both
// themes are verified by a human on a device — the mobile Visual
// Fidelity rule; no widget harness asserts them here.
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

  // One healthy card: an id'd scoped card whose title resolves under
  // every scenario's locale. A second with a DIFFERENT id — the load
  // dedupes on the id, so two same-id cards are one card.
  final healthyCard = <String, dynamic>{
    'id': 'births-id',
    'title': {'en': 'Births Card'},
    'category': '2',
    'serviceLabels': ['Births'],
  };

  final healthyCard2 = <String, dynamic>{
    'id': 'births-2-id',
    'title': {'en': 'Births Card'},
    'category': '2',
    'serviceLabels': ['Births'],
  };

  // The hand-edited-config defect: a card whose title is EMPTY in the
  // loaded language — the card is broken (quickHelpCardBroken) while
  // its neighbours are healthy.
  final emptyTitleCard = <String, dynamic>{
    'id': 'broken-id',
    'title': {'en': ''},
    'category': '2',
    'serviceLabels': ['Births'],
  };

  setUp(() {
    resetThemeManager();
  });

  tearDown(() {
    // The font scale is a singleton read (tokens.textXs) — a test that
    // raised it must not name the next test's mount.
    resetThemeManager();
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
  // with the buttons replaced by the cards each scenario needs.
  // Encoded ONCE per scenario: the mock serves the same bytes for every
  // request.
  Future<Uint8List> configWithButtons(
    List<Map<String, dynamic>> buttons,
  ) async {
    final raw = await rootBundle.loadString(
      'assets/config/genie-ai-config.json',
    );
    final config = jsonDecode(raw) as Map<String, dynamic>;
    final configButtons =
        config['features']['chat']['quickHelp']['buttons'] as List<dynamic>;
    configButtons
      ..clear()
      ..addAll(buttons);
    return Uint8List.fromList(utf8.encode(jsonEncode(config)));
  }

  late Uint8List mixedConfig;
  late Uint8List pairConfig;
  late Uint8List singleConfig;

  setUpAll(() async {
    // ThemeManager persists every set through the shared_preferences
    // plugin; without an in-memory mock the unhandled MissingPluginException
    // of a previous test's persist lands on the NEXT test ("failed after
    // it had already completed").
    SharedPreferences.setMockInitialValues(<String, Object>{});
    mixedConfig = await configWithButtons([healthyCard, emptyTitleCard]);
    pairConfig = await configWithButtons([healthyCard, healthyCard2]);
    singleConfig = await configWithButtons([healthyCard]);
  });

  /// Serves the prepared configuration over the asset bundle's RAW
  /// messenger (a ByteData key in, a ByteData asset out — a
  /// MethodChannel mock never sees it). Every other key returns null,
  /// which degrades a card icon to its neutral fallback instead of
  /// failing the test. The bundle CACHES asset reads, so the eviction
  /// is what makes the mock visible.
  void mockConfigAsset(WidgetTester tester, Uint8List configBytes) {
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

  /// The phone-sized surface: at the desktop-sized default the tiles
  /// are wide enough to hide the defect the issue reports.
  void usePhoneSurface(WidgetTester tester) {
    tester.view.physicalSize = const Size(360, 740);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);
  }

  Future<void> pumpChat(WidgetTester tester, _TreeMockClient mock) async {
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
            // The app's OWN ThemeData, not Material's defaults — a
            // widget under a plain MaterialApp resolves text themes the
            // shipped theme does not carry (the trap the mobile Visual
            // Fidelity rule names).
            theme: ThemeManager().lightTheme,
            locale: I18nService().currentLocale,
            supportedLocales: const [Locale('en')],
            localizationsDelegates: const [
              FallbackMaterialLocalizationsDelegate(),
              FallbackWidgetsLocalizationsDelegate(),
              GlobalCupertinoLocalizations.delegate,
            ],
            home: Scaffold(
              body: ChatBotComponent(
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
    'a broken card leaves the grid and presents its diagnosis with real height',
    (tester) async {
      usePhoneSurface(tester);
      mockConfigAsset(tester, mixedConfig);
      await pumpChat(tester, _TreeMockClient(tree));

      // The title-missing card is broken: its caption names the config
      // defect. The healthy card is not broken and carries no caption.
      final caption = find.textContaining('no title in this language');
      expect(caption, findsOneWidget);

      // The diagnosis is NOT a fixed-aspect grid tile: the caption
      // lives outside the GridView, whose cells cannot grow with it.
      expect(
        find.ancestor(of: caption, matching: find.byType(GridView)),
        findsNothing,
      );

      // Real vertical room: at least ONE full textXs line (11.2 * 1.0,
      // line height above the glyph box) — the box the old grid cell
      // gave the caption was smaller than that, clipping mid-glyph.
      expect(tester.getSize(caption).height, greaterThanOrEqualTo(14.0));

      // The whole diagnosis, not a capped prefix: the row's height
      // follows the text, so the caption carries NO maxLines — and it
      // renders in the danger token, the card's failure colour.
      final captionWidget = caption.evaluate().single.widget as Text;
      expect(captionWidget.maxLines, isNull);
      expect(captionWidget.style?.color, ThemeManager().tokens.danger);

      // The healthy card stayed a grid tile.
      expect(
        find.ancestor(
          of: find.text('Births Card'),
          matching: find.byType(GridView),
        ),
        findsOneWidget,
      );
    },
  );

  testWidgets(
    'when the hierarchy is out, every card is broken and no diagnosis sits in the grid',
    (tester) async {
      usePhoneSurface(tester);
      mockConfigAsset(tester, pairConfig);
      // A tree the fetch refuses: every scope is unverifiable, every
      // card broken.
      await pumpChat(tester, _TreeMockClient(tree, categoriesStatus: 500));

      final caption = find.textContaining('hierarchy could not be loaded');
      expect(caption, findsNWidgets(2));
      expect(
        find.ancestor(of: caption, matching: find.byType(GridView)),
        findsNothing,
      );
      // The grid still exists for the healthy case, but hosts no card:
      // a card the outage broke is not a fixed-aspect tile anymore.
      expect(find.byType(GridView), findsOneWidget);
      expect(
        find.descendant(
          of: find.byType(GridView),
          matching: find.text('Births Card'),
        ),
        findsNothing,
      );
    },
  );

  testWidgets(
    'the diagnosis keeps one full line at a raised accessibility font scale',
    (tester) async {
      usePhoneSurface(tester);
      // fontScale = fontSize / 50 → 100 renders text at 2.0×.
      ThemeManager().setFontSize(100.0);
      mockConfigAsset(tester, pairConfig);
      await pumpChat(tester, _TreeMockClient(tree, categoriesStatus: 500));

      final caption = find.textContaining('hierarchy could not be loaded');
      expect(caption, findsNWidgets(2));
      // One textXs line at 2.0× (11.2 * 2.0): the row's height follows
      // the scaled text instead of clipping it. The HEIGHT alone is the
      // claim — an ordering matcher over a whole Size has no meaning.
      for (final element in caption.evaluate()) {
        expect(element.size!.height, greaterThanOrEqualTo(22.0));
      }
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('the healthy tile survives an extreme accessibility font scale', (
    tester,
  ) async {
    usePhoneSurface(tester);
    // fontScale 3.0: the icon+title row alone outgrows the fixed
    // tile when it is not a flex child — the tile's build must not
    // throw a RenderFlex overflow.
    ThemeManager().setFontSize(150.0);
    mockConfigAsset(tester, singleConfig);
    await pumpChat(tester, _TreeMockClient(tree));

    // The build survived: no overflow exception surfaced.
    expect(tester.takeException(), isNull);
    // The clamp is structural: the header is a FLEX child of the
    // tile's column, so the fixed tile bounds it instead of the row
    // forcing the column past the tile.
    expect(
      find.ancestor(
        of: find.text('Births Card'),
        matching: find.byType(Flexible),
      ),
      findsWidgets,
    );
  });
}

class _TreeMockClient extends http.BaseClient {
  _TreeMockClient(this.tree, {this.categoriesStatus = 200});

  final List<dynamic> tree;
  final int categoriesStatus;

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    final path = request.url.path;
    if (path.contains('/api/service-categories/categories')) {
      return _json(tree, categoriesStatus);
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
