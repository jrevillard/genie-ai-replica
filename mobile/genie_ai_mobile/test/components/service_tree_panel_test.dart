import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/components/sidebar/service_tree_panel.dart';
import 'package:genie_ai_mobile/providers/api_providers.dart';
import '../helpers/theme_helper.dart';
import 'package:http/http.dart' as http;
import 'package:openapi/api.dart';

// The selection the tree panel hands to the chat: the category id must be
// the tree's own catKey — the chat resolves the scope through it, and an
// empty id reads as "no scope", which sends the query unfiltered (the
// whole corpus answering while the context bar shows a scope).
void main() {
  final tree = [
    {
      'catKey': '2',
      'name': 'Estado civil',
      'nameEN': 'Civil Registry',
      'children': [
        {'name': 'Nacimientos', 'nameEN': 'Births'},
        // No display name in this locale: the web hides it, and offering
        // it would let the user pick a scope guaranteed to fail the send.
        {'name': null, 'nameEN': null},
      ],
    },
  ];

  testWidgets(
    'two same-named services in DIFFERENT categories are two scopes',
    (tester) async {
      // The children carry no id/key — their identity is the (category,
      // ENGLISH label) pair, the spelling the wire speaks. Matching on the
      // DISPLAY name alone crossed the categories: tapping B's 'Registro'
      // found A's entry, DESELECTED A's scope while A's highlight stayed,
      // and B's own tap never selected B.
      final dupTree = [
        {
          'catKey': '2',
          'name': 'Estado civil',
          'nameEN': 'Civil Registry',
          'children': [
            {'name': 'Registro', 'nameEN': 'Registry Births'},
          ],
        },
        {
          'catKey': '3',
          'name': 'Impuestos',
          'nameEN': 'Taxes',
          'children': [
            {'name': 'Registro', 'nameEN': 'Registry Taxes'},
          ],
        },
      ];
      Map<String, dynamic>? emitted;
      resetThemeManager();
      final api = ServiceCategoriesApi(
        ApiClient()..client = _MockClient(jsonEncode(dupTree)),
      );

      await tester.pumpWidget(
        ProviderScope(
          overrides: [serviceCategoriesApiProvider.overrideWithValue(api)],
          child: MaterialApp(
            home: Scaffold(
              body: ServiceTreePanel(onSelectionChange: (s) => emitted = s),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.text('Estado civil'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Registro').first);
      await tester.pumpAndSettle();
      await tester.tap(find.text('Impuestos'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Registro').last);
      await tester.pumpAndSettle();

      // BOTH selections live: the second tap selected B, it did not
      // deselect A.
      expect(emitted!['serviceLabelsEn'], [
        'Registry Births',
        'Registry Taxes',
      ]);
      expect(emitted!['serviceCount'], 2);

      // Deselecting B leaves A's scope intact.
      await tester.tap(find.text('Registro').last);
      await tester.pumpAndSettle();
      expect(emitted!['serviceLabelsEn'], ['Registry Births']);
      expect(emitted!['serviceCount'], 1);
    },
  );

  testWidgets('a service selection carries the category catKey', (
    tester,
  ) async {
    Map<String, dynamic>? emitted;
    resetThemeManager();
    final api = ServiceCategoriesApi(
      ApiClient()..client = _MockClient(jsonEncode(tree)),
    );

    await tester.pumpWidget(
      ProviderScope(
        overrides: [serviceCategoriesApiProvider.overrideWithValue(api)],
        child: MaterialApp(
          home: Scaffold(
            body: ServiceTreePanel(onSelectionChange: (s) => emitted = s),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('Estado civil'));
    await tester.pumpAndSettle();
    expect(find.text('Unknown Service'), findsNothing);
    await tester.tap(find.text('Nacimientos'));
    await tester.pumpAndSettle();

    expect(emitted, isNotNull);
    // The category id is the tree's catKey — not the 'id'/'key' fields the
    // tree does not publish (those read as empty, and every selection
    // carried one).
    expect(emitted!['category_id'], '2');
    expect(emitted!['categoryNameEn'], 'Civil Registry');
    expect(emitted!['serviceLabelsEn'], ['Births']);
  });

  testWidgets('two services that READ the same in this locale are two scopes', (
    tester,
  ) async {
    // The tree falls back to the English name for an entity the locale
    // has no translation for, so two entities in one category can carry
    // the same display name. The identity is the ENGLISH label — the
    // spelling the wire speaks — so picking one must not pick the other.
    final sameNames = [
      {
        'catKey': '2',
        'name': 'Estado civil',
        'nameEN': 'Civil Registry',
        'children': [
          // Untranslated in this locale: the tree publishes its English
          // name as the display name.
          {'name': 'Passport', 'nameEN': 'Passport'},
          // A service whose localized name reads the same.
          {'name': 'Passport', 'nameEN': 'Travel'},
        ],
      },
    ];
    Map<String, dynamic>? emitted;
    resetThemeManager();
    final api = ServiceCategoriesApi(
      ApiClient()..client = _MockClient(jsonEncode(sameNames)),
    );

    await tester.pumpWidget(
      ProviderScope(
        overrides: [serviceCategoriesApiProvider.overrideWithValue(api)],
        child: MaterialApp(
          home: Scaffold(
            body: ServiceTreePanel(onSelectionChange: (s) => emitted = s),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('Estado civil'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Passport').first);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Passport').last);
    await tester.pumpAndSettle();

    // BOTH are selected: the second tap did not toggle the first one
    // off, because their identities are their English labels.
    expect(emitted!['serviceLabelsEn'], ['Passport', 'Travel']);
    expect(emitted!['serviceCount'], 2);
  });

  testWidgets('a service with an English label is not toggled by one without', (
    tester,
  ) async {
    // Two rows that READ the same, one carrying an English label and
    // one carrying none (no EN translation row and no nameEN of its
    // own). The tapped row picks the key space, and the stored row
    // must answer in the SAME one: the second tap must not toggle the
    // first one off.
    final mixedLabels = [
      {
        'catKey': '2',
        'name': 'Estado civil',
        'nameEN': 'Civil Registry',
        'children': [
          {'name': 'Taxes', 'nameEN': 'Taxes'},
          {'name': 'Taxes', 'nameEN': null},
        ],
      },
    ];
    Map<String, dynamic>? emitted;
    resetThemeManager();
    final api = ServiceCategoriesApi(
      ApiClient()..client = _MockClient(jsonEncode(mixedLabels)),
    );

    await tester.pumpWidget(
      ProviderScope(
        overrides: [serviceCategoriesApiProvider.overrideWithValue(api)],
        child: MaterialApp(
          home: Scaffold(
            body: ServiceTreePanel(onSelectionChange: (s) => emitted = s),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('Estado civil'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Taxes').first);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Taxes').last);
    await tester.pumpAndSettle();

    // BOTH are picked: the second tap did not toggle the first one off.
    // Only the first carries an English label, so only it speaks.
    expect(emitted!['serviceCount'], 2);
    expect(emitted!['serviceLabelsEn'], ['Taxes']);
  });

  testWidgets(
    'two services sharing every name are two scopes once the tree carries keys',
    (tester) async {
      // The tree publishes each child's entity _key, and NEITHER spelling
      // of the name is unique inside a category: here both children read
      // 'Taxes' on the wire. The key is the identity — picking one must
      // never toggle the other.
      final keyedTree = [
        {
          'catKey': '2',
          'name': 'Estado civil',
          'nameEN': 'Civil Registry',
          'children': [
            {'_key': 'svc-a', 'name': 'Impuestos', 'nameEN': 'Taxes'},
            {'_key': 'svc-b', 'name': 'Taxes', 'nameEN': 'Taxes'},
          ],
        },
      ];
      Map<String, dynamic>? emitted;
      resetThemeManager();
      final api = ServiceCategoriesApi(
        ApiClient()..client = _MockClient(jsonEncode(keyedTree)),
      );

      await tester.pumpWidget(
        ProviderScope(
          overrides: [serviceCategoriesApiProvider.overrideWithValue(api)],
          child: MaterialApp(
            home: Scaffold(
              body: ServiceTreePanel(onSelectionChange: (s) => emitted = s),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.text('Estado civil'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Impuestos'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Taxes'));
      await tester.pumpAndSettle();

      // BOTH are selected — the second tap did not toggle the first off.
      expect(emitted!['serviceCount'], 2);

      // Deselecting the keyed twin removes ONLY that one.
      await tester.tap(find.text('Taxes'));
      await tester.pumpAndSettle();
      expect(emitted!['serviceCount'], 1);
      expect(emitted!['serviceLabelsEn'], ['Taxes']);
    },
  );
}

class _MockClient extends http.BaseClient {
  _MockClient(this.body);
  final String body;

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    final bytes = utf8.encode(body);
    return http.StreamedResponse(
      http.ByteStream.fromBytes(bytes),
      200,
      headers: {'content-type': 'application/json'},
    );
  }
}
