import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/components/chat/chatbot_component.dart';
import 'package:genie_ai_mobile/services/i18n_service.dart';
import 'package:genie_ai_mobile/utils/theme_manager.dart';

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
  late Uint8List configBytesWithCivilButton;
  late Uint8List configBytesWithCivilAndAgri;

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
    // The CO-TAGGED button of the reverse-order restore: an ID'D card —
    // the restore resolves button tags by id, on both platforms (an
    // id-less card contributes no entry to the restore index).
    configBytesWithCivilButton = await chatbotConfigBytesWithButtons(const [
      {
        'id': 'civil',
        'title': {'en': 'Registry Card'},
        'category': '2',
        'serviceLabels': ['Births'],
      },
    ]);
    // TWO category-carrying buttons: the positional last-writer tests —
    // the web's restore forEach ends on the LAST category-writing tag,
    // whatever kind it is, so a later button must override an earlier
    // one exactly as an earlier legacy tag must not override a later
    // button.
    configBytesWithCivilAndAgri = await chatbotConfigBytesWithButtons(const [
      {
        'id': 'civil',
        'title': {'en': 'Registry Card'},
        'category': '2',
        'serviceLabels': ['Births'],
      },
      {
        'id': 'agri',
        'title': {'en': 'Agri Advisory'},
        'category': '1',
        'serviceLabels': ['Harvest'],
      },
    ]);
  });

  setUp(resetChatbotTestState);
  tearDown(resetChatbotTestState);

  testWidgets('a saved just-chat tag restores the plain-chat scope', (
    tester,
  ) async {
    final mock = ChatbotMockClient(tree, conversationTags: ['just-chat']);
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
    final mock = ChatbotMockClient(tree, conversationTags: ['just-chat']);
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
    final mock = ChatbotMockClient(
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
      final mock = ChatbotMockClient(
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
      final mock = ChatbotMockClient(tree, conversationTags: ['just-chat']);
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
    final mock = ChatbotMockClient(tree, conversationTags: ['just-chat']);
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

  testWidgets('a co-tagged button restores its category in reverse tag order', (
    tester,
  ) async {
    // The saved order is not guaranteed: a LEGACY conversation can
    // carry the reserved chip FIRST and the button tag AFTER it
    // (['just-chat', 'civil']). The web's restore forEach keeps
    // processing after the reserved chip and sets currentCategoryId
    // from the button's category — last-writer-wins — so the
    // conversation stays scoped to category 2. No category EDGE is
    // served here: with one, the conversation's own category already
    // restores, and the button tag is the ONLY carrier of the saved
    // category. A reserved branch that reads no button category
    // widens the restore to label-only.
    // The category is asserted at the HTTP boundary (the save's PATCH
    // carries the restored scope's category), the way the tag test
    // asserts the saved tags.
    final mock = ChatbotMockClient(
      tree,
      conversationTags: const ['just-chat', 'civil'],
      conversationCategoryId: null,
      conversationMessages: const [
        {'_id': 'm-1', 'sender': 'user', 'content': 'Saved question'},
        {'_id': 'm-2', 'sender': 'assistant', 'content': 'Saved answer'},
      ],
    );
    final chatKey = GlobalKey<ChatBotComponentState>();
    mockChatbotConfigAsset(tester, configBytesWithCivilButton);
    await pumpChatBot(tester, mock, chatKey: chatKey);

    await chatKey.currentState!.loadConversation('conv-1');
    await tester.pumpAndSettle();
    // The reserved chip is still the bar's title; the co-tagged
    // button's category rides BENEATH it (the web keeps 'Just Chat'
    // too, scoped to the button's category).
    expect(find.text('Context: Just Chat'), findsOneWidget);
    expect(find.textContaining('no longer carries'), findsNothing);

    // The next save persists the restored scope: its categoryId is
    // what the wire receives.
    await chatKey.currentState!.saveConversation();
    await tester.pumpAndSettle();

    expect(mock.savedCategoryIds, hasLength(1));
    expect(mock.savedCategoryIds.single, '2');
  });

  testWidgets('a legacy tag mid-list does not override a later button', (
    tester,
  ) async {
    // POSITIONAL parity, not precedence parity: the web's restore
    // forEach writes currentCategoryId from every category-writing tag
    // in SAVED ORDER — a legacy 'category.<id>' writes, and so does a
    // button — so ['just-chat', 'category.1', 'civil'] ends on civil
    // (category 2), not on the legacy category 1. A legacy-first chain
    // answers from category 1, a wider corpus than the web uses.
    // Same two-category tree: the legacy 'category.1' must name a
    // category the tree carries, or the restore refuses instead of
    // answering — the test exercises POSITIONAL precedence between a
    // known legacy tag and a known later button, not the dead-chip
    // refusal.
    final twoCategoryTree = <dynamic>[
      {
        'catKey': '2',
        'name': 'Civil Registry',
        'nameEN': 'Civil Registry',
        'children': [
          {'_key': 'svc-1', 'name': 'Births', 'nameEN': 'Births'},
        ],
      },
      {
        'catKey': '1',
        'name': 'Agriculture',
        'nameEN': 'Agriculture',
        'children': [
          {'_key': 'svc-2', 'name': 'Harvest', 'nameEN': 'Harvest'},
        ],
      },
    ];
    final mock = ChatbotMockClient(
      twoCategoryTree,
      conversationTags: const ['just-chat', 'category.1', 'civil'],
      conversationCategoryId: null,
      conversationMessages: const [
        {'_id': 'm-1', 'sender': 'user', 'content': 'Saved question'},
        {'_id': 'm-2', 'sender': 'assistant', 'content': 'Saved answer'},
      ],
    );
    final chatKey = GlobalKey<ChatBotComponentState>();
    mockChatbotConfigAsset(tester, configBytesWithCivilAndAgri);
    await pumpChatBot(tester, mock, chatKey: chatKey);

    await chatKey.currentState!.loadConversation('conv-1');
    await tester.pumpAndSettle();
    expect(find.textContaining('no longer carries'), findsNothing);

    await chatKey.currentState!.saveConversation();
    await tester.pumpAndSettle();

    expect(mock.savedCategoryIds, hasLength(1));
    expect(mock.savedCategoryIds.single, '2');
  });

  testWidgets('a later button overrides the first in a button-only save', (
    tester,
  ) async {
    // The FIRST recognized tag being a button changes nothing: the web's
    // forEach keeps processing, so ['civil', 'agri'] ends on agri — a
    // button branch that returned its own card's category would answer
    // from civil while the web answers from agri.
    // The tree must KNOW both buttons' categories and labels, or the
    // scope refuses (a category nothing can name is a visible refusal,
    // never a silent widening) and the save never PATCHes. The harness
    // fixture knows category 2 only, so this scenario carries its own
    // two-category tree.
    final twoCategoryTree = <dynamic>[
      {
        'catKey': '2',
        'name': 'Civil Registry',
        'nameEN': 'Civil Registry',
        'children': [
          {'_key': 'svc-1', 'name': 'Births', 'nameEN': 'Births'},
        ],
      },
      {
        'catKey': '1',
        'name': 'Agriculture',
        'nameEN': 'Agriculture',
        'children': [
          {'_key': 'svc-2', 'name': 'Harvest', 'nameEN': 'Harvest'},
        ],
      },
    ];
    final mock = ChatbotMockClient(
      twoCategoryTree,
      conversationTags: const ['civil', 'agri'],
      conversationCategoryId: null,
      conversationMessages: const [
        {'_id': 'm-1', 'sender': 'user', 'content': 'Saved question'},
        {'_id': 'm-2', 'sender': 'assistant', 'content': 'Saved answer'},
      ],
    );
    final chatKey = GlobalKey<ChatBotComponentState>();
    mockChatbotConfigAsset(tester, configBytesWithCivilAndAgri);
    await pumpChatBot(tester, mock, chatKey: chatKey);

    await chatKey.currentState!.loadConversation('conv-1');
    await tester.pumpAndSettle();
    expect(find.textContaining('no longer carries'), findsNothing);

    await chatKey.currentState!.saveConversation();
    await tester.pumpAndSettle();

    expect(mock.savedCategoryIds, hasLength(1));
    expect(mock.savedCategoryIds.single, '1');
  });
}
