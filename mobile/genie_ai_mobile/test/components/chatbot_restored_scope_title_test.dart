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

  // The REAL bundled configuration, with the buttons replaced by the
  // card the button-scope test restores. Encoded ONCE: the mock serves
  // the same bytes for every request.
  late Uint8List configBytes;

  /// Holds the config re-read of a forced reload until released — the
  /// ordering the re-apply's title rule is about: the localized fetch
  /// lands FIRST, the reload's re-resolve runs SECOND.
  Completer<ByteData>? heldConfig;
  bool failConfigLoads = false;

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
  ///
  /// With [failLoads] every config read FAILS (a transient load error)
  /// until [stopFailingConfigLoads]: the load is not cached, so the
  /// locale switch's forced reload re-reads the asset — and
  /// [holdConfigAsset] can hold THAT read, ordering the reload after the
  /// drift fetch has landed.
  void mockConfigAsset(WidgetTester tester, {bool failLoads = false}) {
    failConfigLoads = failLoads;
    tester.binding.defaultBinaryMessenger.setMockMessageHandler(
      'flutter/assets',
      (ByteData? message) async {
        if (message == null) return null;
        final key = utf8.decode(message.buffer.asUint8List());
        if (key != 'assets/config/genie-ai-config.json') return null;
        if (heldConfig != null) return heldConfig!.future;
        if (failConfigLoads) return null;
        return ByteData.sublistView(configBytes);
      },
    );
    rootBundle.evict('assets/config/genie-ai-config.json');
  }

  void stopFailingConfigLoads() {
    failConfigLoads = false;
  }

  void holdConfigAsset(WidgetTester tester) {
    // The bundle caches the FAILED reads too: without the eviction the
    // reload's re-read throws from the cache and never reaches the
    // handler — no hold, no ordering.
    rootBundle.evict('assets/config/genie-ai-config.json');
    heldConfig = Completer<ByteData>();
  }

  void releaseConfigAsset() {
    heldConfig?.complete(ByteData.sublistView(configBytes));
    heldConfig = null;
  }

  /// The mock the CURRENT test mounted — the tearDown releases its held
  /// responses even when an assertion failed before the test could.
  _RestoredScopeMockClient? activeMock;

  Future<void> pumpChat(
    WidgetTester tester,
    _RestoredScopeMockClient mock, {
    GlobalKey<ChatBotComponentState>? chatKey,
  }) async {
    activeMock = mock;
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
    // A test that FAILED while a response was still held must not take
    // the held fetches to its grave: an in-flight future never settles,
    // the next pumpAndSettle hangs, and the one-line assertion failure
    // that actually regressed is masked by a timeout. Releasing here is
    // a no-op for tests that released their own holds.
    releaseConfigAsset();
    activeMock?.releaseHeld();
    activeMock = null;
  });

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
    // ONE fetch: the drift's own. The config reload's re-resolve
    // re-applies the SAME restored scope, and a re-apply of an unchanged
    // title source must not re-install the resolver's ENGLISH spelling
    // over the localized name the drift fetch commits — that clobber
    // used to force a repair fetch on every switch.
    expect(mock.requestsByLocale['es'], 1);
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
    'a category the EN tree cannot name but the key addresses is localized',
    (tester) async {
      // The EN tree carries the category's nameEN but no display `name`:
      // the scope is wire-healthy (the follow-up filters on the nameEN)
      // while the restore cannot install an English title. The key still
      // addresses the category, so the localized tree names the bar —
      // the bar must not stay hidden for a scope the conversation uses.
      I18nService().changeLanguage('es');
      final mock = _RestoredScopeMockClient(
        treesByLocale: {
          'en': <dynamic>[
            {'catKey': '2', 'nameEN': 'Civil Registry'},
          ],
          'es': esTree,
        },
      );
      final chatKey = GlobalKey<ChatBotComponentState>();
      mockConfigAsset(tester);
      await pumpChat(tester, mock, chatKey: chatKey);

      await chatKey.currentState!.loadConversation('conv-1');
      await tester.pumpAndSettle();

      expect(find.text('Contexto: Registro Civil'), findsOneWidget);
      expect(mock.requestsByLocale['es'], 1);
    },
  );

  testWidgets(
    'a re-apply of an unchanged scope never downgrades a localized title',
    (tester) async {
      // The first config load FAILS (a transient startup error), so the
      // locale switch's forced reload re-reads the asset — held until the
      // drift fetch has landed. The reload's re-resolve then re-applies
      // the SAME restored scope while the bar already carries the
      // localized name.
      final mock = _RestoredScopeMockClient(
        treesByLocale: {'en': enTree, 'es': esTree},
      );
      final chatKey = GlobalKey<ChatBotComponentState>();
      mockConfigAsset(tester, failLoads: true);
      await pumpChat(tester, mock, chatKey: chatKey);

      await chatKey.currentState!.loadConversation('conv-1');
      await tester.pumpAndSettle();
      expect(find.text('Context: Civil Registry'), findsOneWidget);

      // The hold is armed BEFORE the switch: the forced reload's asset
      // re-read is what must be held, or the reload beats the fetch and
      // the ordering under test never happens.
      holdConfigAsset(tester);
      I18nService().changeLanguage('es');
      // The drift fetch is independent of the config: it lands while the
      // reload waits on the held asset.
      for (
        var i = 0;
        i < 20 && find.text('Contexto: Registro Civil').evaluate().isEmpty;
        i++
      ) {
        await tester.pump();
      }
      expect(find.text('Contexto: Registro Civil'), findsOneWidget);

      // NOW the reload lands and re-applies the unchanged scope: the bar
      // must keep the localized name — re-installing the resolver's
      // ENGLISH spelling here would downgrade it for the rest of the
      // session (the fetch that named it already succeeded).
      stopFailingConfigLoads();
      releaseConfigAsset();
      await tester.pumpAndSettle();
      expect(find.text('Contexto: Registro Civil'), findsOneWidget);
      expect(find.text('Context: Civil Registry'), findsNothing);
    },
  );

  testWidgets(
    'a scope-less conversation fetches no localized tree on restore',
    (tester) async {
      // 'general' is the no-scope placeholder the cleared selections
      // were saved under: it names no category, and the localized tree
      // has nothing to re-title.
      I18nService().changeLanguage('es');
      final mock = _RestoredScopeMockClient(
        treesByLocale: {'en': enTree, 'es': esTree},
        conversationTags: <String>[],
        conversationCategoryId: 'general',
      );
      final chatKey = GlobalKey<ChatBotComponentState>();
      mockConfigAsset(tester);
      await pumpChat(tester, mock, chatKey: chatKey);

      await chatKey.currentState!.loadConversation('conv-1');
      await tester.pumpAndSettle();

      // No context bar (no scope) and no localized fetch: recording the
      // placeholder key would schedule a lookup that can never name
      // anything, at restore and on every locale switch.
      expect(find.text('Contexto: Registro Civil'), findsNothing);
      expect(mock.requestsByLocale['es'] ?? 0, 0);
    },
  );

  testWidgets(
    'a live selection mid-fetch is not re-titled by the stale response',
    (tester) async {
      // The 'es' response is HELD: the restore's localized fetch is
      // genuinely in flight while the user picks a live scope.
      I18nService().changeLanguage('es');
      final mock = _RestoredScopeMockClient(
        treesByLocale: {'en': enTree, 'es': esTree},
        holdFromCounts: {'es': 1},
      );
      final chatKey = GlobalKey<ChatBotComponentState>();
      mockConfigAsset(tester);
      await pumpChat(tester, mock, chatKey: chatKey);

      await chatKey.currentState!.loadConversation('conv-1');
      for (var i = 0; i < 10 && (mock.requestsByLocale['es'] ?? 0) < 1; i++) {
        await tester.pump();
      }
      expect(mock.requestsByLocale['es'], 1);

      // The page's own mapping (main.dart's _onServiceSelected): a live
      // pick replaces the restored scope and installs its own localized
      // title.
      chatKey.currentState!.setCategoryContext(
        '2',
        'Nacimientos',
        categoryNameEn: 'Civil Registry',
        serviceLabelsEn: const ['Births'],
        serviceCount: 1,
      );
      await tester.pump();
      expect(find.text('Contexto: Nacimientos'), findsOneWidget);

      // Release the held response: the restored scope is gone — a commit
      // would overwrite the live join with the restored category's name.
      mock.releaseHeld();
      await tester.pumpAndSettle();
      expect(find.text('Contexto: Nacimientos'), findsOneWidget);
      expect(find.text('Contexto: Registro Civil'), findsNothing);
    },
  );

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

  testWidgets(
    'a live selection is replaced by a restore the hierarchy cannot key',
    (tester) async {
      // The EN tree carries the category's display name but an EMPTY
      // nameEN: the scope is not wire-healthy (the send guard refuses
      // it), and no key is recorded — but the restore still OWNS the
      // bar: the live pick's join must be replaced by the restored
      // category's name, whatever language it is in.
      I18nService().changeLanguage('es');
      final mock = _RestoredScopeMockClient(
        treesByLocale: {
          'en': <dynamic>[
            {'catKey': '2', 'name': 'Civil Registry', 'nameEN': ''},
          ],
          'es': esTree,
        },
      );
      final chatKey = GlobalKey<ChatBotComponentState>();
      mockConfigAsset(tester);
      await pumpChat(tester, mock, chatKey: chatKey);

      // The page's own live pick: a localized join names the bar.
      chatKey.currentState!.setCategoryContext(
        '2',
        'Nacimientos',
        categoryNameEn: 'Civil Registry',
        serviceLabelsEn: const ['Births'],
        serviceCount: 1,
      );
      await tester.pump();
      expect(find.text('Contexto: Nacimientos'), findsOneWidget);

      await chatKey.currentState!.loadConversation('conv-1');
      await tester.pumpAndSettle();

      expect(find.text('Contexto: Civil Registry'), findsOneWidget);
      expect(find.text('Contexto: Nacimientos'), findsNothing);
    },
  );

  testWidgets('two unkeyable restores replace each other’s titles', (
    tester,
  ) async {
    // Two conversations in two DIFFERENT categories the EN tree cannot
    // address on the wire: the second restore must install its own
    // category's name — a guard that compares derived keys alone
    // collapses both to "no key" and leaves the first title up.
    I18nService().changeLanguage('es');
    final mock = _RestoredScopeMockClient(
      treesByLocale: {
        'en': <dynamic>[
          {'catKey': '7', 'name': 'Alpha', 'nameEN': ''},
          {'catKey': '9', 'name': 'Beta', 'nameEN': ''},
        ],
        'es': <dynamic>[
          {'catKey': '7', 'name': 'Alfa', 'nameEN': ''},
          {'catKey': '9', 'name': 'Beta', 'nameEN': ''},
        ],
      },
      conversationsById: {
        'conv-1': (tags: const <String>[], categoryId: '7'),
        'conv-2': (tags: const <String>[], categoryId: '9'),
      },
    );
    final chatKey = GlobalKey<ChatBotComponentState>();
    mockConfigAsset(tester);
    await pumpChat(tester, mock, chatKey: chatKey);

    await chatKey.currentState!.loadConversation('conv-1');
    await tester.pumpAndSettle();
    expect(find.text('Contexto: Alpha'), findsOneWidget);

    await chatKey.currentState!.loadConversation('conv-2');
    await tester.pumpAndSettle();
    expect(find.text('Contexto: Beta'), findsOneWidget);
    expect(find.text('Contexto: Alpha'), findsNothing);
  });

  testWidgets(
    'a tree that arrives late re-resolves the restore and names the bar',
    (tester) async {
      // The FIRST EN fetch fails (a transient error): the restore
      // resolves against an empty hierarchy — no key, no name — and can
      // only install an empty title. The next need for the hierarchy
      // retries it; when the tree lands, the scope gains its key and
      // the bar its name — the localized fetch follows. A guard that
      // compares the scope's identity without the key sees the same
      // category on both loads and never installs. TWO failures: the
      // mount's own fetch consumes the first, the restore's the second.
      I18nService().changeLanguage('es');
      final mock = _RestoredScopeMockClient(
        treesByLocale: {'en': enTree, 'es': esTree},
        failFirstCounts: const {'en': 2},
      );
      final chatKey = GlobalKey<ChatBotComponentState>();
      mockConfigAsset(tester);
      await pumpChat(tester, mock, chatKey: chatKey);

      await chatKey.currentState!.loadConversation('conv-1');
      await tester.pumpAndSettle();
      expect(find.text('Contexto: Registro Civil'), findsNothing);

      // The retry: the same conversation reloaded now finds the tree.
      await chatKey.currentState!.loadConversation('conv-1');
      await tester.pumpAndSettle();

      expect(find.text('Contexto: Registro Civil'), findsOneWidget);
      expect(mock.requestsByLocale['es'], 1);
    },
  );
}

class _RestoredScopeMockClient extends http.BaseClient {
  _RestoredScopeMockClient({
    required this.treesByLocale,
    this.conversationTags = const ['Births'],
    this.conversationCategoryId = '2',
    Map<String, ({List<String> tags, String categoryId})>? conversationsById,
    this.failFirstCounts = const {},
    this.holdFromCounts = const {},
  }) : conversationsById =
           conversationsById ??
           {
             'conv-1': (
               tags: conversationTags,
               categoryId: conversationCategoryId,
             ),
           };

  final Map<String, List<dynamic>> treesByLocale;
  final List<String> conversationTags;
  final String conversationCategoryId;

  /// Per locale: the FIRST N tree requests fail with a 500 (a transient
  /// hierarchy outage) and every later one serves the tree. The failure
  /// is what arms `_treeUnavailable` and clears the cached EN fetch, so
  /// the next need for the hierarchy retries it.
  final Map<String, int> failFirstCounts;

  /// Saved conversations by id — a test that loads TWO conversations
  /// (a restore followed by another restore, or by a scope-less one)
  /// serves each edge here; the single-conversation fields above feed
  /// the default 'conv-1' entry.
  final Map<String, ({List<String> tags, String categoryId})> conversationsById;

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
      final failFirst = failFirstCounts[locale];
      if (failFirst != null && (requestsByLocale[locale] ?? 0) <= failFirst) {
        return _json(<String, dynamic>{}, 500);
      }
      final holdFrom = holdFromCounts[locale];
      if (holdFrom != null && (requestsByLocale[locale] ?? 0) >= holdFrom) {
        final completer = Completer<http.StreamedResponse>();
        _held.add((locale: locale, completer: completer));
        return completer.future;
      }
      return _json(treesByLocale[locale] ?? [], 200);
    }
    if (request.method == 'GET' && path.contains('/api/chat/conversations/')) {
      final id = path.split('/api/chat/conversations/').last;
      final conversation = conversationsById[id];
      if (conversation == null) return _json(<String, dynamic>{}, 404);
      return _json(<String, dynamic>{
        '_key': id,
        'title': 'Saved conversation',
        'categoryId': conversation.categoryId,
        'tags': conversation.tags,
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
