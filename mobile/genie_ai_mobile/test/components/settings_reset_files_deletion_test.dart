import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:openapi/api.dart';

import 'package:genie_ai_mobile/components/settings/settings_component.dart';
import 'package:genie_ai_mobile/providers/api_providers.dart';
import 'package:genie_ai_mobile/services/i18n_service.dart';

import '../helpers/test_app.dart';
import '../helpers/theme_helper.dart';

/// The reset-data confirmation must surface the backend's
/// `filesDeletionFailed` flag: when the uploads directory could not be
/// removed after the committed reset, the user gets a warning SnackBar
/// instead of silence, because files that may contain personal data are
/// still on disk. When the flag is absent (backends without it) or false,
/// the behaviour is unchanged (no notification). A failed reset call shows
/// the failure SnackBar and clears the loading state.
class MockCurrentUserApi implements CurrentUserApi {
  MockCurrentUserApi({
    this.resetBody = const {},
    this.resetStatus = 200,
    this.resetGate,
  });

  final Map<String, dynamic> resetBody;
  final int resetStatus;

  /// When set, the reset call only completes once the test resolves it —
  /// used to hold the reset in flight while asserting on the loading state.
  final Completer<void>? resetGate;

  /// How many times the reset endpoint was called — lets a test observe
  /// that the reset flow actually ran instead of only what it left behind.
  int resetCalls = 0;

  @override
  Future<http.Response> apiMeGetWithHttpInfo({String? data}) async {
    return http.Response(
      jsonEncode({
        'id': 'user-1',
        'name': 'Test User',
        'email': 'test@example.test',
      }),
      200,
    );
  }

  @override
  Future<http.Response> apiMeResetDataPostWithHttpInfo() async {
    resetCalls++;
    final gate = resetGate;
    if (gate != null) await gate.future;
    return http.Response(jsonEncode(resetBody), resetStatus);
  }

  @override
  Future<http.Response> apiMePutWithHttpInfo({
    String? data,
    List<http.MultipartFile>? files,
  }) async {
    return http.Response(jsonEncode({'ok': true}), 200);
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => null;
}

void main() {
  tearDown(() {
    resetThemeManager();
    I18nService().changeLanguage('en');
  });

  /// Pumps a bounded number of frames instead of pumpAndSettle: this test's
  /// tree never settles in the test environment (the loading spinner's
  /// replacement keeps a frame scheduled on every pump), so pumpAndSettle
  /// never returns. A fixed frame budget still flushes the modal's enter and
  /// leave animations and the reset's microtasks.
  Future<void> pumpFrames(WidgetTester tester, {int frames = 20}) async {
    for (var i = 0; i < frames; i++) {
      await tester.pump(const Duration(milliseconds: 50));
    }
  }

  /// Drives the real user path: opens the settings screen, taps the reset
  /// tile, confirms the modal, and lets the reset flow complete. Returns
  /// once the reset's outcome SnackBar (if any) has been pumped in.
  Future<void> driveResetFlow(
    WidgetTester tester,
    MockCurrentUserApi api,
  ) async {
    setupLightTokens();
    I18nService().changeLanguage('en');

    await tester.pumpWidget(
      ProviderScope(
        overrides: [currentUserApiProvider.overrideWithValue(api)],
        child: testApp(
          SettingsComponent(
            user: {'name': 'Test User', 'email': 'test@example.test'},
          ),
        ),
      ),
    );
    await pumpFrames(tester);

    final resetTile = find.byKey(const Key('settings_reset_data_button'));
    await tester.ensureVisible(resetTile);
    await pumpFrames(tester);
    await tester.tap(resetTile);
    await pumpFrames(tester);

    await tester.tap(find.byKey(const Key('settings_reset_confirm_button')));
    await pumpFrames(tester);
  }

  /// Unmounts the screen after the assertions: removing the tree dismisses
  /// the SnackBar, so this must not run before the outcome is checked.
  Future<void> unmount(WidgetTester tester) async {
    await tester.pumpWidget(const SizedBox.shrink());
    await pumpFrames(tester);
  }

  testWidgets('shows a warning SnackBar when filesDeletionFailed is true', (
    tester,
  ) async {
    await driveResetFlow(
      tester,
      MockCurrentUserApi(resetBody: {'filesDeletionFailed': true}),
    );

    final warningText = I18nService().translate(
      'settings.userDataResetFilesFailed',
    );
    expect(find.widgetWithText(SnackBar, warningText), findsOneWidget);
    // The loading state was cleared after the reset flow.
    expect(find.byType(CircularProgressIndicator), findsNothing);
    await unmount(tester);
  });

  testWidgets('shows no notification when the flag is absent (older backend)', (
    tester,
  ) async {
    await driveResetFlow(tester, MockCurrentUserApi());

    final warningText = I18nService().translate(
      'settings.userDataResetFilesFailed',
    );
    expect(find.widgetWithText(SnackBar, warningText), findsNothing);
    await unmount(tester);
  });

  testWidgets(
    'shows no warning when the flag is explicitly false (clean reset)',
    (tester) async {
      await driveResetFlow(
        tester,
        MockCurrentUserApi(resetBody: {'filesDeletionFailed': false}),
      );

      final warningText = I18nService().translate(
        'settings.userDataResetFilesFailed',
      );
      expect(find.widgetWithText(SnackBar, warningText), findsNothing);
      await unmount(tester);
    },
  );

  testWidgets('does not re-open the reset flow while a reset is in flight', (
    tester,
  ) async {
    final gate = Completer<void>();
    final api = MockCurrentUserApi(
      resetBody: {'filesDeletionFailed': true},
      resetGate: gate,
    );
    setupLightTokens();
    I18nService().changeLanguage('en');

    await tester.pumpWidget(
      ProviderScope(
        overrides: [currentUserApiProvider.overrideWithValue(api)],
        child: testApp(
          SettingsComponent(
            user: {'name': 'Test User', 'email': 'test@example.test'},
          ),
        ),
      ),
    );
    await pumpFrames(tester);

    final resetTile = find.byKey(const Key('settings_reset_data_button'));
    await tester.ensureVisible(resetTile);
    await pumpFrames(tester);
    await tester.tap(resetTile);
    await pumpFrames(tester);
    await tester.tap(find.byKey(const Key('settings_reset_confirm_button')));
    // Let the confirm handler start the reset call, which is now parked
    // on the gate: the screen is in its loading state.
    await tester.pump();
    expect(find.byType(CircularProgressIndicator), findsOneWidget);

    // A second tap on the still-rendered Reset card must be a no-op: no
    // second confirm modal may open for one in-flight reset.
    await tester.tap(resetTile);
    await pumpFrames(tester);
    expect(
      find.byKey(const Key('settings_reset_confirm_button')),
      findsNothing,
    );

    gate.complete();
    await pumpFrames(tester);
    final warningText = I18nService().translate(
      'settings.userDataResetFilesFailed',
    );
    expect(find.widgetWithText(SnackBar, warningText), findsOneWidget);
    await unmount(tester);
  });

  testWidgets(
    'shows the failure SnackBar and clears loading when the reset call fails',
    (tester) async {
      await driveResetFlow(tester, MockCurrentUserApi(resetStatus: 500));

      final failureText = I18nService().translate(
        'settings.failedToResetUserData',
      );
      expect(find.widgetWithText(SnackBar, failureText), findsOneWidget);
      expect(find.byType(CircularProgressIndicator), findsNothing);
      await unmount(tester);
    },
  );
}
