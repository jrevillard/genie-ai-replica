import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/okf/concept_browser_repository.dart';
import 'package:genie_ai_mobile/okf/concept_browser_screen.dart';
import 'package:genie_ai_mobile/okf/okf_citation_open.dart';
import 'package:genie_ai_mobile/services/i18n_service.dart';
import 'package:genie_ai_mobile/utils/theme_manager.dart';

import 'helpers/browser_fakes.dart';

/// The ONE citation-open action (the /simplify review unified two
/// hand-copied ladders that had drifted). Pins the unified rule: an OKF
/// row that cannot be browsed answers the notice — NEVER an external
/// launch, no matter what url the row carries.
///
/// #2169 added the live repository resolution: a citation row that names a
/// concept but carries NO repository identity (the backend did not resolve
/// it) resolves the repository through okf-server and opens the concept
/// browser anyway.
void main() {
  setUpAll(() {
    final tm = ThemeManager();
    tm.setTheme('light');
    tm.setFontSize(50.0);
    tm.setConfiguration({});
  });

  Future<BuildContext> pumpHost(
    WidgetTester tester, {
    ConceptBrowserRepository? repository,
  }) async {
    late BuildContext captured;
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          if (repository != null)
            conceptBrowserRepositoryProvider.overrideWithValue(repository),
        ],
        child: MaterialApp(
          home: Builder(
            builder: (context) {
              captured = context;
              return const Scaffold(body: SizedBox.shrink());
            },
          ),
        ),
      ),
    );
    return captured;
  }

  testWidgets(
    'an OKF row whose repository cannot be resolved answers the notice — never an external launch',
    (tester) async {
      // The drift the review found: this exact row launched externally from
      // the chatbot and got the notice from the sidebar. The launcher never
      // being stubbed is the pin — a launch here throws MissingPluginException
      // and fails the test.
      final fake = FakeConceptBrowserRepository();
      // The concept resolves to nothing: no visible repository holds it.
      final context = await pumpHost(tester, repository: fake);
      final handled = await openOkfCitation(context, {
        'source': 'okf-concept',
        'document_id': 'legacy-concept',
        'url': 'https://example.com/report.pdf',
      }, logTag: 'test.citation');
      await tester.pump();
      expect(handled, isTrue);
      expect(fake.resolveCalls, 1);
      expect(find.byType(SnackBar), findsOneWidget);
      expect(find.text(tr('chatbot.sourceUnavailable')), findsOneWidget);
      expect(find.byType(ConceptBrowserScreen), findsNothing);
      expect(tester.takeException(), isNull);
    },
    timeout: const Timeout(Duration(seconds: 30)),
  );

  testWidgets('a non-OKF row is not handled — the caller keeps its URL rung', (
    tester,
  ) async {
    final context = await pumpHost(tester);
    final handled = await openOkfCitation(context, {
      'document_id': 'plain-file.pdf',
      'url': 'https://example.com/x.pdf',
    }, logTag: 'test.citation');
    await tester.pump();
    expect(handled, isFalse);
    expect(find.byType(SnackBar), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a browsable OKF row pushes the concept browser', (tester) async {
    final fake = FakeConceptBrowserRepository();
    fake.pagesByRepo['repo-9'] = page(2, [
      row('index', isIndex: true),
      row('svc'),
    ]);
    fake.cardsByRepo['repo-9'] = {'svc': card('repo-9', 'svc')};
    late BuildContext captured;
    await tester.pumpWidget(
      ProviderScope(
        overrides: [conceptBrowserRepositoryProvider.overrideWithValue(fake)],
        child: MaterialApp(
          home: Builder(
            builder: (context) {
              captured = context;
              return const Scaffold(body: SizedBox.shrink());
            },
          ),
        ),
      ),
    );
    final handled = await openOkfCitation(captured, {
      'source': 'okf-concept',
      'document_id': 'svc',
      'repo_id': 'repo-9',
      'concept_id': 'svc',
    }, logTag: 'test.citation');
    await tester.pumpAndSettle();
    expect(handled, isTrue);
    expect(find.byType(ConceptBrowserScreen), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'a concept row WITHOUT a repository resolves it live and opens the browser',
    (tester) async {
      // The #2169 defect: chatqna's citation row carried the concept id but
      // no repo_id (the backend did not resolve the repository). The row used
      // to dead-end on the "source unavailable" notice.
      final fake = FakeConceptBrowserRepository();
      fake.repoByConcept['svc'] = 'repo-7';
      fake.pagesByRepo['repo-7'] = page(1, [row('svc')]);
      fake.cardsByRepo['repo-7'] = {'svc': card('repo-7', 'svc')};
      final context = await pumpHost(tester, repository: fake);

      final handled = await openOkfCitation(context, {
        'source': 'okf-concept',
        'document_id': 'svc',
        'concept_id': 'svc',
      }, logTag: 'test.citation');
      await tester.pumpAndSettle();

      expect(handled, isTrue);
      expect(fake.resolveCalls, 1);
      final screen = tester.widget<ConceptBrowserScreen>(
        find.byType(ConceptBrowserScreen),
      );
      expect(screen.repoId, 'repo-7');
      expect(screen.initialConceptId, 'svc');
      expect(find.byType(SnackBar), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'a failed live resolution keeps the unavailable notice — never an external launch',
    (tester) async {
      final fake = FakeConceptBrowserRepository();
      // The server refuses (404 CONCEPT_NOT_FOUND / a dead session / a
      // network failure): the row stays unopenable and says so.
      fake.resolveThrows['svc'] = Exception('404 CONCEPT_NOT_FOUND');
      final context = await pumpHost(tester, repository: fake);

      final handled = await openOkfCitation(context, {
        'source': 'okf-concept',
        'document_id': 'svc',
        'concept_id': 'svc',
        'url': 'https://example.com/report.pdf',
      }, logTag: 'test.citation');
      await tester.pump();

      expect(handled, isTrue);
      expect(fake.resolveCalls, 1); // the resolution WAS attempted
      expect(find.byType(SnackBar), findsOneWidget);
      expect(find.text(tr('chatbot.sourceUnavailable')), findsOneWidget);
      expect(find.byType(ConceptBrowserScreen), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );
}
