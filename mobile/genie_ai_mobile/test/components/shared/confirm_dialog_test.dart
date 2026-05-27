import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/components/shared/confirm_dialog.dart';
import 'package:genie_ai_mobile/services/i18n_service.dart';

import '../../helpers/test_app.dart';
import '../../helpers/theme_helper.dart';

void main() {
  setUp(() {
    setupLightTokens();
    I18nService().changeLanguage('en');
  });
  tearDown(() {
    resetThemeManager();
    I18nService().changeLanguage('en');
  });

  group('ConfirmDialog', () {
    group('visibility', () {
      testWidgets('visible: false renders SizedBox.shrink', (tester) async {
        await tester.pumpWidget(
          testApp(
            ConfirmDialog(
              visible: false,
              onConfirm: () {},
              onCancel: () {},
            ),
          ),
        );
        expect(find.byType(SizedBox), findsOneWidget);
        // SizedBox.shrink has zero size
        final sizedBox = tester.widget<SizedBox>(find.byType(SizedBox));
        expect(sizedBox.width, 0);
        expect(sizedBox.height, 0);
      });

      testWidgets('visible: true renders dialog content', (tester) async {
        await tester.pumpWidget(
          testApp(
            ConfirmDialog(
              visible: true,
              title: 'Confirm',
              message: 'Are you sure?',
              onConfirm: () {},
              onCancel: () {},
            ),
          ),
        );
        expect(find.text('Confirm'), findsOneWidget);
        expect(find.text('Are you sure?'), findsOneWidget);
      });
    });

    group('default i18n texts', () {
      testWidgets('uses i18n for default texts when no custom provided', (tester) async {
        await tester.pumpWidget(
          testApp(
            ConfirmDialog(
              visible: true,
              onConfirm: () {},
              onCancel: () {},
            ),
          ),
        );
        // Default title comes from tr('common.confirm'), message from "Are you sure?"
        // Default confirm = tr('common.ok'), cancel = tr('common.cancel')
        expect(find.text('Are you sure?'), findsOneWidget);
      });
    });

    group('custom texts', () {
      testWidgets('custom title and message', (tester) async {
        await tester.pumpWidget(
          testApp(
            ConfirmDialog(
              visible: true,
              title: 'Delete Item',
              message: 'This cannot be undone.',
              onConfirm: () {},
              onCancel: () {},
            ),
          ),
        );
        expect(find.text('Delete Item'), findsOneWidget);
        expect(find.text('This cannot be undone.'), findsOneWidget);
      });

      testWidgets('custom confirmText and cancelText', (tester) async {
        await tester.pumpWidget(
          testApp(
            ConfirmDialog(
              visible: true,
              confirmText: 'Yes, Delete',
              cancelText: 'Keep It',
              onConfirm: () {},
              onCancel: () {},
            ),
          ),
        );
        expect(find.text('Yes, Delete'), findsOneWidget);
        expect(find.text('Keep It'), findsOneWidget);
      });
    });

    group('callbacks', () {
      testWidgets('onConfirm fires on confirm button tap', (tester) async {
        var confirmed = false;
        await tester.pumpWidget(
          testApp(
            ConfirmDialog(
              visible: true,
              title: 'Title',
              confirmText: 'Yes',
              cancelText: 'No',
              onConfirm: () => confirmed = true,
              onCancel: () {},
            ),
          ),
        );
        await tester.tap(find.text('Yes'));
        expect(confirmed, isTrue);
      });

      testWidgets('onCancel fires on cancel button tap', (tester) async {
        var cancelled = false;
        await tester.pumpWidget(
          testApp(
            ConfirmDialog(
              visible: true,
              title: 'Title',
              confirmText: 'Yes',
              cancelText: 'Nope',
              onConfirm: () {},
              onCancel: () => cancelled = true,
            ),
          ),
        );
        await tester.tap(find.text('Nope'));
        expect(cancelled, isTrue);
      });

      testWidgets('secondary button renders and fires callback', (tester) async {
        var secondaryFired = false;
        await tester.pumpWidget(
          testApp(
            ConfirmDialog(
              visible: true,
              secondaryText: 'Save Draft',
              onConfirm: () {},
              onCancel: () {},
              onSecondary: () => secondaryFired = true,
            ),
          ),
        );
        expect(find.text('Save Draft'), findsOneWidget);
        await tester.tap(find.text('Save Draft'));
        expect(secondaryFired, isTrue);
      });
    });
  });
}
