import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/components/chat/chatbot_component.dart';
import 'package:genie_ai_mobile/services/i18n_service.dart';
import 'package:genie_ai_mobile/utils/theme_manager.dart';
import 'package:http/http.dart' as http;

import '../helpers/chatbot_harness.dart';

// A RESTORED conversation carrying the web's one RESERVED tag,
// 'just-chat': the plain-composer scope of NONE, unfiltered by design.
// The web rebuilds the chip from the id alone — the configuration is
// irrelevant to it — so the mobile restores the scope whatever the
// loaded buttons say, titles the bar with the reserved entry's own
// localized name, and refuses nothing. Without the reserved rule the
// tag fell to the sidebar branch: an unknown tag, a refusal caption,
// every follow-up refused.
void main() {
  final tree = quickHelpTreeFixture();

  late Uint8List configBytes;
  late Uint8List configBytesWithJustChatEntry;

  setUpAll(() async {
    // No just-chat entry: the deployment dropped or hid it — the exact
    // case the reserved rule exists for.
    configBytes = await chatbotConfigBytesWithButtons(const [
      {
        'title': {'en': 'Registry Card'},
        'category': '2',
        'serviceLabels': ['Births'],
      },
    ]);
    // A configuration that still declares the entry — with its own title
    // and a scope: the reserved restore must not bind to it.
    configBytesWithJustChatEntry = await chatbotConfigBytesWithButtons(const [
      {
        'id': 'just-chat',
        'title': {'en': 'Composer'},
        'category': '2',
        'serviceLabels': ['Births'],
      },
    ]);
  });

  setUp(resetChatbotTestState);
  tearDown(resetChatbotTestState);

  testWidgets('a saved just-chat tag restores the plain-chat scope', (
    tester,
  ) async {
    final mock = _JustChatMockClient(tree, conversationTags: ['just-chat']);
    final chatKey = GlobalKey<ChatBotComponentState>();
    mockChatbotConfigAsset(tester, configBytes);
    await pumpChatBot(tester, mock, chatKey: chatKey);

    await chatKey.currentState!.loadConversation('conv-1');
    await tester.pumpAndSettle();

    // The bar carries the reserved entry's own localized name — the
    // chip the web restores from the id alone.
    expect(find.text('Context: Just Chat'), findsOneWidget);
    // The scope is not a failure: no dead-tag caption, no warning icon
    // — the follow-ups answer unfiltered, as on the web.
    expect(find.textContaining('carries any more'), findsNothing);
    expect(find.byIcon(Icons.warning_amber_rounded), findsNothing);
    expect(find.byIcon(Icons.lightbulb_outline), findsOneWidget);
    expect(
      tester.widget<Icon>(find.byIcon(Icons.lightbulb_outline)).color,
      ThemeManager().tokens.accent,
    );
  });

  testWidgets('the reserved restore ignores a config entry that declares one', (
    tester,
  ) async {
    final mock = _JustChatMockClient(tree, conversationTags: ['just-chat']);
    final chatKey = GlobalKey<ChatBotComponentState>();
    mockChatbotConfigAsset(tester, configBytesWithJustChatEntry);
    await pumpChatBot(tester, mock, chatKey: chatKey);

    await chatKey.currentState!.loadConversation('conv-1');
    await tester.pumpAndSettle();

    // The configuration's own title and scope stay out of it: the chip
    // is titled from the reserved name, never from the entry. (The
    // entry's card still renders in the grid — config content, not the
    // restored scope.)
    expect(find.text('Context: Just Chat'), findsOneWidget);
    expect(find.text('Context: Composer'), findsNothing);
    expect(find.textContaining('carries any more'), findsNothing);
  });

  testWidgets('the reserved scope shows without a category edge', (
    tester,
  ) async {
    // A just-chat conversation carries no category edge (the press
    // cleared it): the title alone must keep the bar on the screen.
    final mock = _JustChatMockClient(
      tree,
      conversationTags: ['just-chat'],
      conversationCategoryId: null,
    );
    final chatKey = GlobalKey<ChatBotComponentState>();
    mockChatbotConfigAsset(tester, configBytes);
    await pumpChatBot(tester, mock, chatKey: chatKey);

    await chatKey.currentState!.loadConversation('conv-1');
    await tester.pumpAndSettle();

    expect(find.text('Context: Just Chat'), findsOneWidget);
    expect(find.textContaining('carries any more'), findsNothing);
  });

  testWidgets(
    'a reserved restore committed during the double outage survives the settle',
    (tester) async {
      // The reserved rule needs NO source (the scope does not depend on
      // the config), so the restore answers during an outage of both.
      // The re-resolve that runs when the sources settle must re-apply
      // the SAME scope — the epoch gate let a different verdict clobber
      // a restored bar once; this pins the reserved one against it.
      // TWO failures of each source: the mount's fetch consumes the
      // first, the restore's the second.
      final mock = _JustChatMockClient(
        tree,
        conversationTags: ['just-chat'],
        failFirstCounts: const {'en': 2},
      );
      final chatKey = GlobalKey<ChatBotComponentState>();
      tester.binding.defaultBinaryMessenger.setMockMessageHandler(
        'flutter/assets',
        (ByteData? message) async => null, // every config read fails
      );
      rootBundle.evict('assets/config/genie-ai-config.json');
      await pumpChatBot(tester, mock, chatKey: chatKey);

      await chatKey.currentState!.loadConversation('conv-1');
      await tester.pumpAndSettle();
      expect(find.text('Context: Just Chat'), findsOneWidget);

      // Both sources settle: the next restore re-resolves over the real
      // hierarchy and the loaded buttons — same verdict.
      mockChatbotConfigAsset(tester, configBytes);
      await chatKey.currentState!.loadConversation('conv-1');
      await tester.pumpAndSettle();

      expect(find.text('Context: Just Chat'), findsOneWidget);
      expect(find.textContaining('carries any more'), findsNothing);
      expect(find.byIcon(Icons.warning_amber_rounded), findsNothing);
    },
  );

  testWidgets(
    'a locale switch re-titles the reserved scope from a config entry that declares one',
    (tester) async {
      // The reserved chip is titled tr('chatbot.justChat') at restore;
      // after a locale switch the config-reload re-title treats it like
      // any Quick Help chip (the web's own chip-id remap): an entry that
      // declares the id re-titles the bar, in the entry's own language.
      final mock = _JustChatMockClient(tree, conversationTags: ['just-chat']);
      final chatKey = GlobalKey<ChatBotComponentState>();
      mockChatbotConfigAsset(tester, configBytesWithJustChatEntry);
      // The app's own supportedLocales: MaterialApp resolves an
      // unsupported locale back to the first supported one, and the
      // component's drift detection reads Localizations.localeOf —
      // without 'es' here the switch never reaches the component.
      await pumpChatBot(
        tester,
        mock,
        chatKey: chatKey,
        supportedLocales: const [Locale('en'), Locale('es')],
      );

      await chatKey.currentState!.loadConversation('conv-1');
      await tester.pumpAndSettle();
      expect(find.text('Context: Just Chat'), findsOneWidget);

      I18nService().changeLanguage('es');
      await tester.pumpAndSettle();

      // The entry's title (its 'en'-only map, so the en text) — not the
      // es reserved key ('Solo chat'), which would hide the config swap.
      // The bar is one Text of prefix + title; the grid card carries the
      // same title text, so the BAR is asserted by its full es string.
      expect(find.text('Contexto: Composer'), findsOneWidget);
      expect(find.textContaining('Just Chat'), findsNothing);
      expect(find.textContaining('carries any more'), findsNothing);
    },
  );

  testWidgets('a locale switch keeps the reserved title the config dropped', (
    tester,
  ) async {
    // With no declaring entry the re-title keeps the installed title —
    // the same stale-language chip the web keeps (quickHelpTitleFor
    // falls back to the stored title when the id has no button). The
    // kept title must be the reserved one, never a failure caption.
    final mock = _JustChatMockClient(tree, conversationTags: ['just-chat']);
    final chatKey = GlobalKey<ChatBotComponentState>();
    mockChatbotConfigAsset(tester, configBytes);
    await pumpChatBot(
      tester,
      mock,
      chatKey: chatKey,
      supportedLocales: const [Locale('en'), Locale('es')],
    );

    await chatKey.currentState!.loadConversation('conv-1');
    await tester.pumpAndSettle();
    expect(find.text('Context: Just Chat'), findsOneWidget);

    I18nService().changeLanguage('es');
    await tester.pumpAndSettle();

    expect(find.textContaining('Just Chat'), findsOneWidget);
    expect(find.textContaining('carries any more'), findsNothing);
  });
}

class _JustChatMockClient extends http.BaseClient {
  _JustChatMockClient(
    this.tree, {
    this.conversationTags = const [],
    this.conversationCategoryId = '2',
    this.failFirstCounts = const {},
  });

  final List<dynamic> tree;
  final List<String> conversationTags;
  final String? conversationCategoryId;

  /// Per locale: the FIRST N tree requests fail with a 500 (a transient
  /// hierarchy outage) and every later one serves the tree — the same
  /// shape the dead-scope mock uses (a localized fetch inside the outage
  /// window must not consume another locale's failure budget).
  final Map<String, int> failFirstCounts;
  final Map<String, int> _treeRequestsByLocale = {};

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
        'messages': <dynamic>[],
      }, 200);
    }
    return httpResponseJson(<String, dynamic>{}, 404);
  }
}
