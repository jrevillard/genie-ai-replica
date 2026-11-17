import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/components/chat/right_sidebar_component.dart';
import 'package:genie_ai_mobile/design_system/components/ds_button.dart';
import 'package:genie_ai_mobile/design_system/components/ds_modal.dart';
import 'package:genie_ai_mobile/okf/concept_browser_screen.dart';
import 'package:genie_ai_mobile/services/i18n_service.dart';
import 'package:genie_ai_mobile/utils/theme_manager.dart';

void main() {
  setUp(() {
    final tm = ThemeManager();
    tm.setTheme('light');
    tm.setFontSize(50.0);
    tm.setConfiguration({});
  });

  Future<void> pumpSidebar(WidgetTester tester) async {
    await tester.pumpWidget(
      const ProviderScope(
        child: MaterialApp(home: Scaffold(body: RightSidebarComponent(relatedDocuments: []))),
      ),
    );
    await tester.pump();
  }

  testWidgets('the drawer carries the browse-repository entry', (tester) async {
    await pumpSidebar(tester);
    expect(find.text(tr('okfBrowser.drawerEntry')), findsOneWidget);
  });

  testWidgets('tapping the entry opens the typed-repo-id prompt', (tester) async {
    await pumpSidebar(tester);
    await tester.tap(find.text(tr('okfBrowser.drawerEntry')));
    await tester.pump();
    expect(find.byType(DsModal), findsOneWidget);
    expect(find.text(tr('okfBrowser.drawerPrompt')), findsOneWidget);
  });

  testWidgets('a blank repository id cannot confirm — the prompt stays', (tester) async {
    await pumpSidebar(tester);
    await tester.tap(find.text(tr('okfBrowser.drawerEntry')));
    await tester.pump();
    final confirm = tester.widget<DsButton>(
      find.byKey(const ValueKey('okf-browser-drawer-confirm')),
    );
    expect(confirm.disabled, isTrue);
    expect(find.byType(DsModal), findsOneWidget); // still open
  });

  testWidgets('a typed repository id pushes the browser screen', (tester) async {
    await pumpSidebar(tester);
    await tester.tap(find.text(tr('okfBrowser.drawerEntry')));
    await tester.pump();
    await tester.enterText(find.byType(TextField), 'my-smoke-repo');
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('okf-browser-drawer-confirm')));
    await tester.pump(); // the dialog pops
    await tester.pump(); // the pushed route builds
    expect(find.byType(ConceptBrowserScreen), findsOneWidget);
  });
}
