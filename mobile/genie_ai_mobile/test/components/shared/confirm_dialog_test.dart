import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/components/shared/confirm_dialog.dart';
import 'package:genie_ai_mobile/design_system/components/ds_button.dart';
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
        expect(find.byKey(const ValueKey('confirm-dialog-hidden')), findsOneWidget);
        final sizedBox = tester.widget<SizedBox>(
          find.byKey(const ValueKey('confirm-dialog-hidden')),
        );
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
        final title = tester.widget<Text>(
          find.byKey(const ValueKey('confirm-dialog-title')),
        );
        expect(title.data, 'Confirm');
        final message = tester.widget<Text>(
          find.byKey(const ValueKey('confirm-dialog-message')),
        );
        expect(message.data, 'Are you sure?');
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
        final expectedTitle = tr('common.confirm');
        final title = tester.widget<Text>(
          find.byKey(const ValueKey('confirm-dialog-title')),
        );
        expect(title.data, expectedTitle);
        final message = tester.widget<Text>(
          find.byKey(const ValueKey('confirm-dialog-message')),
        );
        expect(message.data, 'Are you sure?');
        final expectedOk = tr('common.ok');
        final expectedCancel = tr('common.cancel');
        final confirmBtn = tester.widget<DsButton>(
          find.byKey(const ValueKey('confirm-dialog-confirm-btn')),
        );
        expect(confirmBtn.label, expectedOk);
        final cancelBtn = tester.widget<DsButton>(
          find.byKey(const ValueKey('confirm-dialog-cancel-btn')),
        );
        expect(cancelBtn.label, expectedCancel);
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
        final title = tester.widget<Text>(
          find.byKey(const ValueKey('confirm-dialog-title')),
        );
        expect(title.data, 'Delete Item');
        final message = tester.widget<Text>(
          find.byKey(const ValueKey('confirm-dialog-message')),
        );
        expect(message.data, 'This cannot be undone.');
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
        final confirmBtn = tester.widget<DsButton>(
          find.byKey(const ValueKey('confirm-dialog-confirm-btn')),
        );
        expect(confirmBtn.label, 'Yes, Delete');
        final cancelBtn = tester.widget<DsButton>(
          find.byKey(const ValueKey('confirm-dialog-cancel-btn')),
        );
        expect(cancelBtn.label, 'Keep It');
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
        await tester.tap(find.byKey(const ValueKey('confirm-dialog-confirm-btn')));
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
        await tester.tap(find.byKey(const ValueKey('confirm-dialog-cancel-btn')));
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
        final secondaryBtn = tester.widget<DsButton>(
          find.byKey(const ValueKey('confirm-dialog-secondary-btn')),
        );
        expect(secondaryBtn.label, 'Save Draft');
        await tester.tap(find.byKey(const ValueKey('confirm-dialog-secondary-btn')));
        expect(secondaryFired, isTrue);
      });
    });
  });
}
