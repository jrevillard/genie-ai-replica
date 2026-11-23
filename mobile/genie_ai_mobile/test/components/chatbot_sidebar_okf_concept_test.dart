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

import '../helpers/pump_frames.dart';
import '../helpers/test_app.dart';
import '../helpers/theme_helper.dart';

/// The sidebar's OKF-concept routing (issue #2069): a citation row that
/// carries the okf-concept identity resolves through okf-server (the concept
/// route), never through the document-repository `/api/files/<id>/view` URL
/// — which 404s by construction for a concept (content-only chunking).

/// The longest run of letters and digits in a rendered body.
int _longestAlnumRun(String body) {
  int longest = 0;
  int run = 0;
  for (final unit in body.codeUnits) {
    final bool isAlnum =
        (unit >= 0x30 && unit <= 0x39) ||
        (unit >= 0x41 && unit <= 0x5A) ||
        (unit >= 0x61 && unit <= 0x7A);
    if (isAlnum) {
      run++;
      if (run > longest) longest = run;
    } else {
      run = 0;
    }
  }
  return longest;
}

/// Taps a citation row and lets the open settle.
Future<void> tapCitation(
  WidgetTester tester,
  String title, {
  int frames = 5,
}) async {
  await tester.tap(find.text(title));
  await pumpFrames(tester, frames: frames);
}

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

  testWidgets('a concept row opens the concept through okf-server', (
    tester,
  ) async {
    final requests = <Uri>[];
    await tester.pumpWidget(sidebar([conceptRow()], requests: requests));
    await pumpFrames(tester, frames: 5);

    await tapCitation(tester, 'hadith nawawi 36');

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

    // A body that fits whole is NOT truncated: the notice must not show.
    // Without this, a preview that always claims to be truncated passes.
    expect(
      find.text(
        'The preview is truncated — the document is longer than can be shown here.',
      ),
      findsNothing,
    );
  });

  testWidgets('a concept row without a repo id resolves the repo first', (
    tester,
  ) async {
    final requests = <Uri>[];
    await tester.pumpWidget(
      sidebar([conceptRow(withRepoId: false)], requests: requests),
    );
    await pumpFrames(tester, frames: 5);

    await tapCitation(tester, 'hadith nawawi 36');

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
    await pumpFrames(tester, frames: 5);

    await tapCitation(tester, 'hadith nawawi 36');

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
    await pumpFrames(tester, frames: 5);

    await tapCitation(tester, 'hadith nawawi 36');

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

  testWidgets('a body that only just fits but loses characters says so', (
    tester,
  ) async {
    final requests = <Uri>[];
    // A body just under the bound: the breaks the preview inserts count
    // against the same budget, so characters ARE dropped even though the
    // body is shorter than the bound. The notice must say so.
    final body = 'x' * 19970;
    await tester.pumpWidget(
      sidebar([conceptRow()], requests: requests, conceptBody: body),
    );
    await pumpFrames(tester, frames: 5);

    await tapCitation(tester, 'hadith nawawi 36');

    expect(
      find.text(
        'The preview is truncated — the document is longer than can be shown here.',
      ),
      findsOneWidget,
    );
  });

  testWidgets('a long unbroken run is broken so the renderer stays fast', (
    tester,
  ) async {
    final requests = <Uri>[];
    // One unbroken run (a base64 blob, a hex digest) is what makes the
    // markdown inline parser backtrack quadratically: 20 000 characters in
    // one run cost ~1.4 s on the UI thread, the same characters broken every
    // 500 cost ~4 ms. The preview therefore breaks the run itself.
    final blob = 'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo' * 1000;
    await tester.pumpWidget(
      sidebar([conceptRow()], requests: requests, conceptBody: blob),
    );
    await pumpFrames(tester, frames: 5);

    await tapCitation(tester, 'hadith nawawi 36');

    final MarkdownBody rendered = tester.widget<MarkdownBody>(
      find.descendant(
        of: find.byKey(const ValueKey('ds-modal')),
        matching: find.byType(MarkdownBody),
      ),
    );
    expect(_longestAlnumRun(rendered.data), lessThanOrEqualTo(500));
  });

  testWidgets('a cut that lands inside an emoji keeps the text well-formed', (
    tester,
  ) async {
    final requests = <Uri>[];
    // An emoji (a surrogate pair) straddling the render bound: cutting
    // between the halves leaves a lone surrogate, and the renderer throws
    // "string is not well-formed UTF-16" while it lays the text out. The
    // body is line-broken so the preview keeps the body one-for-one and the
    // cut lands exactly at the bound.
    final longBody = '${'ab ' * 6666}x\u{1F600}${'y' * 5000}';
    await tester.pumpWidget(
      sidebar([conceptRow()], requests: requests, conceptBody: longBody),
    );
    await pumpFrames(tester, frames: 5);

    await tapCitation(tester, 'hadith nawawi 36');

    expect(tester.takeException(), isNull);
    final MarkdownBody rendered = tester.widget<MarkdownBody>(
      find.descendant(
        of: find.byKey(const ValueKey('ds-modal')),
        matching: find.byType(MarkdownBody),
      ),
    );
    expect(rendered.data.length, lessThanOrEqualTo(20000));
  });

  testWidgets('a body whose trailing surrogate is dropped says so', (
    tester,
  ) async {
    final requests = <Uri>[];
    // The body ends with a LONE high surrogate (a half emoji): the preview
    // drops that code unit so the rendered text stays well-formed, so a body
    // character WAS dropped — the notice must say so.
    final body = '${'x' * 600}\uD800';
    await tester.pumpWidget(
      sidebar([conceptRow()], requests: requests, conceptBody: body),
    );
    await pumpFrames(tester, frames: 5);

    await tapCitation(tester, 'hadith nawawi 36');

    expect(tester.takeException(), isNull);
    expect(
      find.text(
        'The preview is truncated — the document is longer than can be shown here.',
      ),
      findsOneWidget,
    );
  });

  testWidgets('a second tap while the concept loads opens no second modal', (
    tester,
  ) async {
    final requests = <Uri>[];
    await tester.pumpWidget(
      sidebar(
        [conceptRow()],
        requests: requests,
        delay: const Duration(milliseconds: 300),
      ),
    );
    await pumpFrames(tester, frames: 5);

    await tester.tap(find.text('hadith nawawi 36'));
    await tester.pump();
    await tester.tap(find.text('hadith nawawi 36'));
    await pumpFrames(tester, frames: 12);

    // One fetch, one modal: the guard swallows the second tap while the
    // first is in flight.
    expect(
      requests
          .where((u) => u.path.endsWith('/concepts/hadith_nawawi_36'))
          .length,
      1,
    );
    expect(find.byKey(const ValueKey('ds-modal')), findsOneWidget);
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
    await pumpFrames(tester, frames: 5);

    await tester.tap(find.text('hadith nawawi 36 (repo-1)'));
    await tester.pump();
    await tester.tap(find.text('hadith nawawi 36 (repo-2)'));
    await pumpFrames(tester, frames: 12);

    expect(
      requests.map((u) => u.path),
      containsAll([
        '/api/okf/repos/repo-1/concepts/hadith_nawawi_36',
        '/api/okf/repos/repo-2/concepts/hadith_nawawi_36',
      ]),
    );
  });

  testWidgets('a legacy row is handled by the legacy path, not by okf-server', (
    tester,
  ) async {
    final requests = <Uri>[];
    // A legacy row with no document id: the legacy path answers it with a
    // notice. The notice is the proof the tap was HANDLED — without it, a
    // swallowed tap and a legacy path look the same from okf-server's side.
    await tester.pumpWidget(
      sidebar([
        {'document_name': 'Report.pdf', 'file_name': 'Report.pdf', 'url': ''},
      ], requests: requests),
    );
    await pumpFrames(tester, frames: 5);

    await tapCitation(tester, 'Report.pdf');

    expect(requests, isEmpty);
    expect(find.byType(SnackBar), findsOneWidget);
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
    await pumpFrames(tester, frames: 5);

    await tapCitation(tester, 'Report.pdf');

    // A legacy document row keeps the document-repository path: it never
    // asks okf-server for anything, and it opens no concept modal.
    expect(requests, isEmpty);
    expect(find.byKey(const ValueKey('ds-modal')), findsNothing);
  });
}
