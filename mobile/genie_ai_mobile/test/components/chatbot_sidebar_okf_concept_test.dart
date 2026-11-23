import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
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
    Duration delay = Duration.zero,
  }) {
    final client = MockClient((request) async {
      requests.add(request.url);
      if (delay > Duration.zero) await Future<void>.delayed(delay);
      if (request.url.path.endsWith('/resolve-repo')) {
        return http.Response.bytes(
          utf8.encode(jsonEncode({'repo_id': 'repo-1', 'bundle_version': 2})),
          200,
          headers: {'content-type': 'application/json; charset=utf-8'},
        );
      }
      // UTF-8 bytes, the way okf-server answers: `http.Response(String)`
      // encodes as latin1 and cannot carry an emoji at all.
      return http.Response.bytes(
        utf8.encode(
          jsonEncode({
            'concept_id': 'hadith_nawawi_36',
            'title': 'Hadith Nawawi 36',
            'body': conceptBody,
          }),
        ),
        conceptStatus,
        headers: {'content-type': 'application/json; charset=utf-8'},
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
    // The CUT itself, not only the flag: a renderer that hands the whole
    // body to MarkdownBody passes the notice assertion above and freezes the
    // phone — the length of what is actually rendered is the invariant.
    final MarkdownBody rendered = tester.widget<MarkdownBody>(
      find.descendant(
        of: find.byKey(const ValueKey('ds-modal')),
        matching: find.byType(MarkdownBody),
      ),
    );
    expect(rendered.data.length, lessThanOrEqualTo(20000));
    expect(rendered.data.length, lessThan(longBody.length));
  });

  testWidgets('a cut that lands inside an emoji keeps the text well-formed', (
    tester,
  ) async {
    final requests = <Uri>[];
    // An emoji (a surrogate pair) straddling the render bound: cutting
    // between the halves leaves a lone surrogate, and the renderer throws
    // "string is not well-formed UTF-16" while it lays the text out.
    final longBody = '${'x' * 19999}\u{1F600}${'y' * 5000}';
    await tester.pumpWidget(
      sidebar([conceptRow()], requests: requests, conceptBody: longBody),
    );
    await settle(tester);

    await tester.tap(find.text('hadith nawawi 36'));
    await settle(tester);

    expect(tester.takeException(), isNull);
    final MarkdownBody rendered = tester.widget<MarkdownBody>(
      find.descendant(
        of: find.byKey(const ValueKey('ds-modal')),
        matching: find.byType(MarkdownBody),
      ),
    );
    expect(rendered.data.length, lessThanOrEqualTo(20000));
  });

  testWidgets('the same concept id in two repositories opens twice', (
    tester,
  ) async {
    final requests = <Uri>[];
    // The concept id alone is not an identity: okf-server resolves a concept
    // against every candidate repository, so the same id can live in two of
    // them. The in-flight guard must not swallow the second one.
    Map<String, dynamic> row(String repoId) => {
      'source': 'okf-concept',
      'document_id': 'hadith_nawawi_36',
      'document_name': 'hadith nawawi 36 ($repoId)',
      'concept_id': 'hadith_nawawi_36',
      'repo_id': repoId,
      'url': '',
    };
    await tester.pumpWidget(
      sidebar(
        [row('repo-1'), row('repo-2')],
        requests: requests,
        delay: const Duration(milliseconds: 300),
      ),
    );
    await settle(tester);

    await tester.tap(find.text('hadith nawawi 36 (repo-1)'));
    await tester.pump();
    await tester.tap(find.text('hadith nawawi 36 (repo-2)'));
    for (var i = 0; i < 12; i++) {
      await tester.pump(const Duration(milliseconds: 50));
    }

    expect(
      requests.map((u) => u.path),
      containsAll([
        '/api/okf/repos/repo-1/concepts/hadith_nawawi_36',
        '/api/okf/repos/repo-2/concepts/hadith_nawawi_36',
      ]),
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
