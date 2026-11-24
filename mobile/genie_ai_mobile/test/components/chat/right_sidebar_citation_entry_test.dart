import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/components/chat/right_sidebar_component.dart';
import 'package:genie_ai_mobile/okf/concept_browser_repository.dart';
import 'package:genie_ai_mobile/okf/concept_browser_screen.dart';
import 'package:genie_ai_mobile/services/i18n_service.dart';

import '../../okf/helpers/browser_fakes.dart';

/// Coverage restoration + the #1939 entry contract: the typed-repo-id
/// prompt that pumped this surface in its own test is GONE (removed with
/// the temp drawer entry), and with it went every test that built the
/// sidebar. What must hold now:
///
/// 1. the sidebar still renders its chrome and the empty related-docs arm;
/// 2. an OKF citation row opens the concept browser for the row's OWN
///    repository — the browser's only manual entry, one repository at a
///    time (the Vue citizen surface's entry, mirrored).
void main() {
  late FakeConceptBrowserRepository fake;
  late ProviderContainer container;

  setUp(() {
    fake = FakeConceptBrowserRepository();
    container = ProviderContainer(
      overrides: [conceptBrowserRepositoryProvider.overrideWithValue(fake)],
    );
    addTearDown(container.dispose);
  });

  Future<void> pumpSidebar(
    WidgetTester tester, {
    List<Map> documents = const [],
  }) async {
    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: MaterialApp(
          // NoSplash: the ink_sparkle fragment cannot decode on this host
          // (the machine-level flake); the contracts here are tap → route.
          theme: ThemeData(splashFactory: NoSplash.splashFactory),
          home: Scaffold(
            body: RightSidebarComponent(
              relatedDocuments: documents,
              accessToken: null,
            ),
          ),
        ),
      ),
    );
    await tester.pump();
    await tester.pump();
  }

  testWidgets('the sidebar renders its header and the empty docs arm', (
    tester,
  ) async {
    await pumpSidebar(tester);
    expect(find.text(tr('sidebar.title')), findsOneWidget);
    expect(find.text(tr('sidebar.relatedDocs')), findsOneWidget);
    expect(find.text(tr('sidebar.noDocuments')), findsOneWidget);
  });

  testWidgets('an OKF citation row opens the browser for its own repo', (
    tester,
  ) async {
    fake.pagesByRepo['repo-9'] = page(1, [row('svc')]);
    const doc = {
      'source': 'okf-concept',
      'repo_id': 'repo-9',
      'concept_id': 'svc',
      'document_name': 'Service Directory',
    };
    await pumpSidebar(tester, documents: [doc]);
    expect(find.text('Service Directory'), findsOneWidget);

    await tester.tap(find.text('Service Directory'));
    await tester.pumpAndSettle();
    final screen = tester.widget<ConceptBrowserScreen>(
      find.byType(ConceptBrowserScreen),
    );
    expect(screen.repoId, 'repo-9');
    expect(screen.initialConceptId, 'svc');
  });
}
