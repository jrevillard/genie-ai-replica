import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/components/sidebar/service_tree_panel.dart';
import 'package:genie_ai_mobile/providers/api_providers.dart';
import 'package:genie_ai_mobile/services/i18n_service.dart';
import 'package:http/http.dart' as http;
import 'package:openapi/api.dart';

import '../helpers/test_app.dart';
import '../helpers/theme_helper.dart';

// The stored selection must survive a locale switch WITHOUT carrying the
// old locale into the next emission, and the tree reload must not let a
// response of a locale the user already left win the race.
//
// Three properties, one per test:
//  1. after a locale switch the stored rows are re-titled from the new
//     tree, so the next toggle emits a single-locale join;
//  2. a locale-only reload emits NOTHING (a re-emit would re-install a
//     sidebar scope the chat already replaced with a Quick Help button —
//     this one is GREEN by design today and exists to fail a re-emit
//     regression);
//  3. a fetch of a superseded locale (its response lands after a newer
//     locale's fetch already completed) does not install its tree —
//     success or failure.
void main() {
  final enTree = [
    {
      'catKey': '2',
      'name': 'Civil status',
      'nameEN': 'Civil Registry',
      'children': [
        {'_key': 'svc-1', 'name': 'Births', 'nameEN': 'Births'},
        {'_key': 'svc-2', 'name': 'Marriage', 'nameEN': 'Marriage'},
      ],
    },
  ];

  final esTree = [
    {
      'catKey': '2',
      'name': 'Estado civil',
      'nameEN': 'Civil Registry',
      'children': [
        {'_key': 'svc-1', 'name': 'Nacimientos', 'nameEN': 'Births'},
        {'_key': 'svc-2', 'name': 'Matrimonio', 'nameEN': 'Marriage'},
      ],
    },
  ];

  tearDown(() {
    I18nService().changeLanguage('en');
  });

  Widget buildPanel(
    _LocaleClient client,
    void Function(Map<String, dynamic>) onSelectionChange,
  ) {
    return ProviderScope(
      overrides: [
        serviceCategoriesApiProvider.overrideWithValue(
          ServiceCategoriesApi(ApiClient()..client = client),
        ),
      ],
      child: testApp(ServiceTreePanel(onSelectionChange: onSelectionChange)),
    );
  }

  Future<void> pumpPanel(
    WidgetTester tester,
    _LocaleClient client,
    void Function(Map<String, dynamic>) onSelectionChange,
  ) async {
    await tester.pumpWidget(buildPanel(client, onSelectionChange));
    // A second frame: the locale-drift check schedules its reload in a
    // post-frame callback, and the fetch resolves across frames.
    await tester.pump();
  }

  testWidgets(
    'a locale switch re-titles the stored rows, so the next toggle emits one locale',
    (tester) async {
      final emissions = <Map<String, dynamic>>[];
      resetThemeManager();
      final client = _LocaleClient({
        'en': jsonEncode(enTree),
        'es': jsonEncode(esTree),
      });
      await pumpPanel(tester, client, emissions.add);
      await tester.pumpAndSettle();

      await tester.tap(find.text('Civil status'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Births'));
      await tester.pumpAndSettle();
      expect(emissions.single['name'], 'Births');

      // Switch to Spanish: the panel re-fetches its tree and must re-read
      // the stored row's display name from it. The WIRE fields stay
      // English — only the display name follows the locale.
      I18nService().changeLanguage('es');
      await pumpPanel(tester, client, emissions.add);
      await tester.pumpAndSettle();

      await tester.tap(find.text('Matrimonio'));
      await tester.pumpAndSettle();

      expect(emissions, hasLength(2));
      // The pre-fix panel emitted 'Births, Matrimonio' here — the stored
      // row kept the name it was picked under.
      expect(emissions.last['name'], 'Nacimientos, Matrimonio');
      expect(emissions.last['serviceLabelsEn'], ['Births', 'Marriage']);
      expect(emissions.last['serviceCount'], 2);
    },
  );

  testWidgets('a locale-only reload does not re-emit the selection', (
    tester,
  ) async {
    final emissions = <Map<String, dynamic>>[];
    resetThemeManager();
    final client = _LocaleClient({
      'en': jsonEncode(enTree),
      'es': jsonEncode(esTree),
    });
    await pumpPanel(tester, client, emissions.add);
    await tester.pumpAndSettle();

    await tester.tap(find.text('Civil status'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Births'));
    await tester.pumpAndSettle();
    expect(emissions, hasLength(1));

    // The chat clears its sidebar fields when a Quick Help button is
    // pressed while this panel keeps its rows — an automatic re-emit on
    // a locale switch would re-install the sidebar scope OVER the
    // button's. The reload must re-title the rows in silence.
    I18nService().changeLanguage('es');
    await pumpPanel(tester, client, emissions.add);
    await tester.pumpAndSettle();

    expect(emissions, hasLength(1));
  });

  testWidgets(
    'a tree edited between the fetches moves the highlight with the entity',
    (tester) async {
      // The es tree REORDERS the category's children: the picked entity
      // now sits at child index 0, and the row that inherited index 1 is
      // a different service.
      final reorderedEsTree = [
        {
          'catKey': '2',
          'name': 'Estado civil',
          'nameEN': 'Civil Registry',
          'children': [
            {'_key': 'svc-2', 'name': 'Matrimonio', 'nameEN': 'Marriage'},
            {'_key': 'svc-1', 'name': 'Nacimientos', 'nameEN': 'Births'},
          ],
        },
      ];
      final emissions = <Map<String, dynamic>>[];
      resetThemeManager();
      final client = _LocaleClient({
        'en': jsonEncode(enTree),
        'es': jsonEncode(reorderedEsTree),
      });
      await pumpPanel(tester, client, emissions.add);
      await tester.pumpAndSettle();

      await tester.tap(find.text('Civil status'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Marriage'));
      await tester.pumpAndSettle();
      expect(emissions.single['name'], 'Marriage');

      I18nService().changeLanguage('es');
      await pumpPanel(tester, client, emissions.add);
      await tester.pumpAndSettle();

      // The highlight followed the entity to its NEW index: it paints
      // 'Matrimonio' (now child index 0), not the row that inherited
      // index 1 ('Nacimientos').
      Finder rowHighlight(String rowText) => find.descendant(
        of: find.ancestor(
          of: find.text(rowText),
          matching: find.byType(ListTile),
        ),
        matching: find.byIcon(Icons.check_circle),
      );
      expect(rowHighlight('Matrimonio'), findsOneWidget);
      expect(rowHighlight('Nacimientos'), findsNothing);

      // And the highlighted row still toggles by identity: tapping it
      // deselects the picked entity — the only one — clearing the scope.
      await tester.tap(find.text('Matrimonio'));
      await tester.pumpAndSettle();
      expect(emissions.last['serviceLabelsEn'], isEmpty);
      expect(emissions.last['serviceCount'], 0);
    },
  );

  testWidgets(
    'a child the new locale cannot display still pins its category\'s highlight map',
    (tester) async {
      // The es tree REORDERS the children AND drops the picked entity's
      // display name entirely: the render hides that row, but its KEY is
      // display-independent — the realignment must still find it at its
      // new index, or the category's whole map stays stale and paints the
      // row that inherited the old index.
      final esTreeWithoutDisplay = [
        {
          'catKey': '2',
          'name': 'Estado civil',
          'nameEN': 'Civil Registry',
          'children': [
            {'_key': 'svc-2', 'name': 'Matrimonio', 'nameEN': 'Marriage'},
            {'_key': 'svc-1', 'name': null, 'nameEN': 'Births'},
          ],
        },
      ];
      final emissions = <Map<String, dynamic>>[];
      resetThemeManager();
      final client = _LocaleClient({
        'en': jsonEncode(enTree),
        'es': jsonEncode(esTreeWithoutDisplay),
      });
      await pumpPanel(tester, client, emissions.add);
      await tester.pumpAndSettle();

      await tester.tap(find.text('Civil status'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Births'));
      await tester.pumpAndSettle();
      expect(emissions.single['name'], 'Births');

      I18nService().changeLanguage('es');
      await pumpPanel(tester, client, emissions.add);
      await tester.pumpAndSettle();

      // 'Births' (svc-1) is hidden in es and sits at index 1 now: the
      // visible 'Matrimonio' row (index 0) must NOT inherit the highlight.
      Finder rowHighlight(String rowText) => find.descendant(
        of: find.ancestor(
          of: find.text(rowText),
          matching: find.byType(ListTile),
        ),
        matching: find.byIcon(Icons.check_circle),
      );
      expect(rowHighlight('Matrimonio'), findsNothing);

      // The hidden row's name was kept (no locale names it), and its
      // label still speaks on the wire when another service is picked.
      await tester.tap(find.text('Matrimonio'));
      await tester.pumpAndSettle();
      expect(emissions.last['name'], 'Births, Matrimonio');
      expect(emissions.last['serviceLabelsEn'], ['Births', 'Marriage']);
      expect(emissions.last['serviceCount'], 2);
    },
  );

  testWidgets(
    'a stale response landing before the newer fetch is scheduled does not install its tree',
    (tester) async {
      final emissions = <Map<String, dynamic>>[];
      resetThemeManager();
      final gates = <String, Completer<http.StreamedResponse>>{
        'en': Completer<http.StreamedResponse>(),
      };
      final client = _LocaleClient({
        'en': jsonEncode(enTree),
        'es': jsonEncode(esTree),
      }, gates: gates);
      await pumpPanel(tester, client, emissions.add);
      // The initial (en) fetch is gated and still in flight.
      await tester.pump();

      I18nService().changeLanguage('es');
      // The stale en response lands in the window BEFORE the es reload
      // is scheduled — that reload runs on the next frame. The response
      // names a locale the UI has already left. The assertion runs after
      // the FIRST frame only: the stale tree would render exactly there
      // (the es reload has not landed yet), and a later assertion would
      // read the recovered state instead.
      gates['en']!.complete(_response(200, jsonEncode(enTree)));
      await tester.pumpWidget(buildPanel(client, emissions.add));
      expect(find.text('Civil status'), findsNothing);

      await tester.pumpAndSettle();
      expect(find.text('Estado civil'), findsOneWidget);
      expect(find.text('Civil status'), findsNothing);
    },
  );

  testWidgets(
    'a tree of a locale left mid-fetch does not win the race once the newer locale loaded',
    (tester) async {
      final emissions = <Map<String, dynamic>>[];
      resetThemeManager();
      final gates = <String, Completer<http.StreamedResponse>>{
        'en': Completer<http.StreamedResponse>(),
      };
      final client = _LocaleClient({
        'en': jsonEncode(enTree),
        'es': jsonEncode(esTree),
      }, gates: gates);
      await pumpPanel(tester, client, emissions.add);
      // The initial (en) fetch is gated and still in flight.
      await tester.pump();

      // The user switches to Spanish while the en fetch hangs: a second,
      // immediate fetch starts and completes.
      I18nService().changeLanguage('es');
      await pumpPanel(tester, client, emissions.add);
      await tester.pumpAndSettle();
      expect(find.text('Estado civil'), findsOneWidget);

      // The stale en response lands LAST — it must not install its tree.
      gates['en']!.complete(_response(200, jsonEncode(enTree)));
      await tester.pumpAndSettle();

      expect(find.text('Estado civil'), findsOneWidget);
      expect(find.text('Civil status'), findsNothing);
    },
  );

  testWidgets(
    'a FAILED response of a superseded locale does not paint its error over the newer tree',
    (tester) async {
      final emissions = <Map<String, dynamic>>[];
      resetThemeManager();
      final gates = <String, Completer<http.StreamedResponse>>{
        'en': Completer<http.StreamedResponse>(),
      };
      final client = _LocaleClient({
        'en': jsonEncode(enTree),
        'es': jsonEncode(esTree),
      }, gates: gates);
      await pumpPanel(tester, client, emissions.add);
      await tester.pump();

      I18nService().changeLanguage('es');
      await pumpPanel(tester, client, emissions.add);
      await tester.pumpAndSettle();
      expect(find.text('Estado civil'), findsOneWidget);

      // The stale en fetch ends in a server error AFTER the es tree is
      // shown: the error belongs to a fetch the UI already left.
      gates['en']!.complete(_response(500, 'server error'));
      await tester.pumpAndSettle();

      expect(find.text('Estado civil'), findsOneWidget);
    },
  );
}

http.StreamedResponse _response(int status, String body) {
  final bytes = utf8.encode(body);
  return http.StreamedResponse(
    http.ByteStream.fromBytes(bytes),
    status,
    headers: {'content-type': 'application/json'},
  );
}

/// Serves a per-locale canned body; a gated locale's response waits until
/// the test completes its completer, so the response order is controlled.
class _LocaleClient extends http.BaseClient {
  _LocaleClient(this.bodiesByLocale, {this.gates = const {}});

  final Map<String, String> bodiesByLocale;
  final Map<String, Completer<http.StreamedResponse>> gates;

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    final locale = request.url.queryParameters['locale'] ?? 'en';
    final gate = gates[locale];
    if (gate != null && !gate.isCompleted) {
      return gate.future;
    }
    return _response(200, bodiesByLocale[locale] ?? bodiesByLocale['en']!);
  }
}
