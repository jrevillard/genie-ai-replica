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
