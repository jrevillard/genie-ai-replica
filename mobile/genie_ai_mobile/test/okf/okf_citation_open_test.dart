import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/okf/concept_browser_repository.dart';
import 'package:genie_ai_mobile/okf/concept_browser_screen.dart';
import 'package:genie_ai_mobile/okf/okf_citation_open.dart';
import 'package:genie_ai_mobile/utils/theme_manager.dart';

import 'helpers/browser_fakes.dart';

/// The ONE citation-open action (the /simplify review unified two
/// hand-copied ladders that had drifted). Pins the unified rule: an OKF
/// row that cannot be browsed answers the notice — NEVER an external
/// launch, no matter what url the row carries.
void main() {
  setUpAll(() {
    final tm = ThemeManager();
    tm.setTheme('light');
    tm.setFontSize(50.0);
    tm.setConfiguration({});
  });

  Future<BuildContext> pumpHost(WidgetTester tester) async {
    late BuildContext captured;
    await tester.pumpWidget(
      ProviderScope(
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
    'an OKF row without repo identity answers the notice — never an external launch',
    (tester) async {
      // The drift the review found: this exact row launched externally from
      // the chatbot and got the notice from the sidebar. The launcher never
      // being stubbed is the pin — a launch here throws MissingPluginException
      // and fails the test.
      final context = await pumpHost(tester);
      final handled = openOkfCitation(context, {
        'source': 'okf-concept',
        'document_id': 'legacy-concept',
        'url': 'https://example.com/report.pdf',
      }, logTag: 'test.citation');
      await tester.pump();
      expect(handled, isTrue);
      expect(find.byType(SnackBar), findsOneWidget);
      expect(
        find.text('This source is not available to view.'),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
    },
    timeout: const Timeout(Duration(seconds: 30)),
  );

  testWidgets('a non-OKF row is not handled — the caller keeps its URL rung', (
    tester,
  ) async {
    final context = await pumpHost(tester);
    final handled = openOkfCitation(context, {
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
    final handled = openOkfCitation(captured, {
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
}
