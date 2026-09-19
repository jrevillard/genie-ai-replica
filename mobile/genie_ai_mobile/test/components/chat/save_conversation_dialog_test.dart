import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/components/chat/save_conversation_dialog.dart';
import 'package:genie_ai_mobile/services/i18n_service.dart';

import '../../helpers/test_app.dart';
import '../../helpers/theme_helper.dart';

Widget _dialog({
  String initialTitle = 'Rice advice',
  Future<List<SaveFolder>> Function()? loadFolders,
  Future<bool> Function(String, String?)? onSave,
  required void Function(bool?) onDismiss,
}) {
  return testApp(
    Center(
      child: SaveConversationDialog(
        initialTitle: initialTitle,
        loadFolders: loadFolders ?? () async => const [],
        onSave: onSave ?? (_, _) async => true,
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

  testWidgets('mirrors the web dialog: labels, All Chats + folders, buttons', (
    tester,
  ) async {
    await tester.pumpWidget(
      _dialog(
        loadFolders: () async => const [
          SaveFolder(id: 'f1', name: 'Work'),
          SaveFolder(id: 'f2', name: 'Season 2026'),
        ],
        onDismiss: (_) {},
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Save Chat'), findsOneWidget);
    expect(find.byKey(const ValueKey('ds-modal-close')), findsOneWidget);
    expect(find.text('Chat Title'), findsOneWidget);
    expect(find.text('Select Folder'), findsOneWidget);
    expect(find.text('All Chats'), findsOneWidget);
    expect(
      tester
          .widget<TextField>(find.byKey(const Key('save_dialog_title')))
          .controller!
          .text,
      'Rice advice',
    );
    expect(find.byKey(const Key('save_dialog_cancel')), findsOneWidget);
    expect(find.byKey(const Key('save_dialog_save')), findsOneWidget);

    await tester.tap(find.byKey(const Key('save_dialog_folder')));
    await tester.pumpAndSettle();
    expect(find.text('Work'), findsWidgets);
    expect(find.text('Season 2026'), findsWidgets);
  });

  testWidgets('Save disabled on empty title; success reports true', (
    tester,
  ) async {
    String? savedTitle;
    String? savedFolder = 'unset';
    final results = <bool?>[];
    await tester.pumpWidget(
      _dialog(
        initialTitle: '',
        onSave: (t, f) async {
          savedTitle = t;
          savedFolder = f;
          return true;
        },
        onDismiss: results.add,
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('save_dialog_save')));
    await tester.pumpAndSettle();
    expect(savedTitle, isNull, reason: 'empty title must not save');
    expect(results, isEmpty);

    await tester.enterText(
      find.byKey(const Key('save_dialog_title')),
      '  Mango pests  ',
    );
    await tester.pump();
    await tester.tap(find.byKey(const Key('save_dialog_save')));
    // In the app the host unmounts the dialog on `true`; here it stays mounted
    // with its spinner running, so settle with bounded pumps.
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    expect(savedTitle, 'Mango pests');
    expect(savedFolder, isNull, reason: 'All Chats -> null folder');
    expect(results, [true]);
  });

  testWidgets('a picked folder is passed by id', (tester) async {
    String? savedFolder;
    await tester.pumpWidget(
      _dialog(
        loadFolders: () async => const [SaveFolder(id: 'f1', name: 'Work')],
        onSave: (_, f) async {
          savedFolder = f;
          return true;
        },
        onDismiss: (_) {},
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('save_dialog_folder')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Work').last);
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('save_dialog_save')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    expect(savedFolder, 'f1');
  });

  testWidgets(
    'while saving: indicator, Cancel and close inert; failure keeps it open',
    (tester) async {
      final pending = Completer<bool>();
      final results = <bool?>[];
      await tester.pumpWidget(
        _dialog(onSave: (_, _) => pending.future, onDismiss: results.add),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('save_dialog_save')));
      await tester.pump();
      expect(find.byKey(const Key('save_dialog_saving')), findsOneWidget);
      expect(find.text('Saving...'), findsOneWidget);

      // Spinner animates forever: bounded pumps, not pumpAndSettle.
      await tester.tap(find.byKey(const Key('save_dialog_cancel')));
      await tester.pump(const Duration(milliseconds: 300));
      await tester.tap(find.byKey(const ValueKey('ds-modal-close')));
      await tester.pump(const Duration(milliseconds: 300));
      expect(results, isEmpty);

      pending.complete(false);
      await tester.pump();
      await tester.pumpAndSettle();
      expect(results, isEmpty, reason: 'failed save must not dismiss');
      expect(find.byKey(const Key('save_dialog_saving')), findsNothing);
      expect(find.byKey(const Key('save_dialog_save')), findsOneWidget);
    },
  );

  testWidgets('Cancel reports false, close (x) reports null', (tester) async {
    final results = <bool?>[];
    await tester.pumpWidget(_dialog(onDismiss: results.add));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('save_dialog_cancel')));
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('ds-modal-close')));
    await tester.pump();
    expect(results, [false, null]);
  });
}
