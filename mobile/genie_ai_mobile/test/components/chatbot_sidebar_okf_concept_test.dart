import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/components/chat/right_sidebar_component.dart';
import 'package:genie_ai_mobile/providers/api_providers.dart';
import 'package:genie_ai_mobile/services/okf_concept_service.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import '../helpers/test_app.dart';
import '../helpers/theme_helper.dart';

/// The sidebar's OKF-concept routing (issue #2069): a citation row that
/// carries the okf-concept identity resolves through okf-server (the concept
/// route), never through the document-repository `/api/files/<id>/view` URL
/// — which 404s by construction for a concept (content-only chunking).
void main() {
  setUp(() {
    setupLightTokens();
  });

  tearDown(() {
    resetThemeManager();
  });

  /// The okf-server as a mock: it records every request it serves, so the
  /// test can prove WHICH flow a row took.
  Widget sidebar(
    List<dynamic> docs, {
    required List<Uri> requests,
    int conceptStatus = 200,
    String conceptBody = '# The concept body',
  }) {
    final client = MockClient((request) async {
      requests.add(request.url);
      if (request.url.path.endsWith('/resolve-repo')) {
        return http.Response(
          jsonEncode({'repo_id': 'repo-1', 'bundle_version': 2}),
          200,
        );
      }
      return http.Response(
        jsonEncode({
          'concept_id': 'hadith_nawawi_36',
          'title': 'Hadith Nawawi 36',
          'body': conceptBody,
        }),
        conceptStatus,
      );
    });
    return ProviderScope(
      overrides: [
        okfConceptServiceProvider.overrideWithValue(
          OkfConceptService(client: client, backendUrl: 'https://api.test'),
        ),
      ],
      child: testApp(
        RightSidebarComponent(relatedDocuments: docs, accessToken: 'a-token'),
      ),
    );
  }

  /// A restored okf-concept citation: the shape chatqna streams and the
  /// backend persists (snake_case stable ids).
  Map<String, dynamic> conceptRow({bool withRepoId = true}) => {
    'source': 'okf-concept',
    'document_id': 'hadith_nawawi_36',
    'document_name': 'hadith nawawi 36',
    'concept_id': 'hadith_nawawi_36',
    if (withRepoId) 'repo_id': 'repo-1',
    'bundle_version': 2,
    'url': '',
    'score': 0.8,
  };

  /// A bounded settle: the FAQ's loading spinner animates forever while the
  /// asset load is in flight, so pumpAndSettle never returns.
  Future<void> settle(WidgetTester tester) async {
    for (var i = 0; i < 5; i++) {
      await tester.pump(const Duration(milliseconds: 50));
    }
  }

  testWidgets('a concept row opens the concept through okf-server', (
    tester,
  ) async {
    final requests = <Uri>[];
    await tester.pumpWidget(sidebar([conceptRow()], requests: requests));
    await settle(tester);

    await tester.tap(find.text('hadith nawawi 36'));
    await settle(tester);

    // The concept route — NOT the document-repository URL family.
    expect(
      requests.map((u) => u.path),
      contains('/api/okf/repos/repo-1/concepts/hadith_nawawi_36'),
    );
    expect(
      requests.map((u) => u.path),
      isNot(contains(contains('/api/files/'))),
    );

    // The concept's markdown is what the user gets.
    expect(find.byKey(const ValueKey('ds-modal')), findsOneWidget);
    expect(find.text('Hadith Nawawi 36'), findsOneWidget);
    expect(find.text('The concept body'), findsOneWidget);
  });

  testWidgets('a concept row without a repo id resolves the repo first', (
    tester,
  ) async {
    final requests = <Uri>[];
    await tester.pumpWidget(
      sidebar([conceptRow(withRepoId: false)], requests: requests),
    );
    await settle(tester);

    await tester.tap(find.text('hadith nawawi 36'));
    await settle(tester);

    expect(
      requests.map((u) => u.path),
      contains('/api/okf/concepts/resolve-repo'),
    );
    expect(
      requests.map((u) => u.path),
      contains('/api/okf/repos/repo-1/concepts/hadith_nawawi_36'),
    );
    expect(find.byKey(const ValueKey('ds-modal')), findsOneWidget);
  });

  testWidgets('a concept that cannot be served says so — never a dead link', (
    tester,
  ) async {
    final requests = <Uri>[];
    await tester.pumpWidget(
      sidebar([conceptRow()], requests: requests, conceptStatus: 404),
    );
    await settle(tester);

    await tester.tap(find.text('hadith nawawi 36'));
    await settle(tester);

    expect(find.byKey(const ValueKey('ds-modal')), findsNothing);
    expect(find.text('This source is not available to view.'), findsOneWidget);
  });

  testWidgets('a concept longer than the render cap is truncated, and says so', (
    tester,
  ) async {
    final requests = <Uri>[];
    // A body past the render cap: the modal must not build all of it, and it
    // must say that the preview stops short.
    final longBody = 'x' * 25000;
    await tester.pumpWidget(
      sidebar([conceptRow()], requests: requests, conceptBody: longBody),
    );
    await settle(tester);

    await tester.tap(find.text('hadith nawawi 36'));
    await settle(tester);

    expect(find.byKey(const ValueKey('ds-modal')), findsOneWidget);
    expect(
      find.text(
        'The preview is truncated — the document is longer than can be shown here.',
      ),
      findsOneWidget,
    );
  });

  testWidgets('a legacy document row does not go through okf-server', (
    tester,
  ) async {
    final requests = <Uri>[];
    await tester.pumpWidget(
      sidebar([
        {
          'document_id': 'doc-9',
          'document_name': 'Report.pdf',
          'file_name': 'Report.pdf',
          'url': '',
        },
      ], requests: requests),
    );
    await settle(tester);

    await tester.tap(find.text('Report.pdf'));
    await settle(tester);

    // A legacy document row keeps the document-repository path: it never
    // asks okf-server for anything.
    expect(requests, isEmpty);
  });
}
