import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/components/chat/export_chat_dialog.dart';
import 'package:genie_ai_mobile/services/i18n_service.dart';

import '../../helpers/test_app.dart';
import '../../helpers/theme_helper.dart';

Widget _dialog(
  Future<bool> Function(String) onExport,
  void Function(bool?) onDismiss,
) {
  return testApp(
    Center(
      child: ExportChatDialog(
        initialFilename: 'chat_2026-09-19',
        onExport: onExport,
        onDismiss: onDismiss,
      ),
    ),
  );
}

void main() {
  setUp(() {
    setupLightTokens();
    I18nService().changeLanguage('en');
  });
  tearDown(resetThemeManager);

  testWidgets('prefills the name, exports on confirm and reports true', (
    tester,
  ) async {
    String? exported;
    final results = <bool?>[];
    await tester.pumpWidget(
      _dialog((n) async {
        exported = n;
        return true;
      }, results.add),
    );
    await tester.pumpAndSettle();

    expect(find.text('Export Chat to PDF'), findsOneWidget);
    expect(find.byKey(const Key('export_dialog_cancel')), findsOneWidget);
    await tester.tap(find.byKey(const Key('export_dialog_export')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    expect(exported, 'chat_2026-09-19');
    expect(results, [true]);
  });

  testWidgets('empty name disables Export; Cancel false, close null', (
    tester,
  ) async {
    var calls = 0;
    final results = <bool?>[];
    await tester.pumpWidget(
      _dialog((_) async {
        calls++;
        return true;
      }, results.add),
    );
    await tester.pumpAndSettle();

    await tester.enterText(
      find.byKey(const Key('export_dialog_filename')),
      '   ',
    );
    await tester.pump();
    await tester.tap(find.byKey(const Key('export_dialog_export')));
    await tester.pumpAndSettle();
    expect(calls, 0);

    await tester.tap(find.byKey(const Key('export_dialog_cancel')));
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('ds-modal-close')));
    await tester.pump();
    expect(results, [false, null]);
  });
}
