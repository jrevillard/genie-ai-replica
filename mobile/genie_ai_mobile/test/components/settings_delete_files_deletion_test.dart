import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:genie_ai_mobile/components/settings/settings_component.dart';
import 'package:genie_ai_mobile/providers/api_providers.dart';
import 'package:genie_ai_mobile/services/auth/auth_notifier.dart';
import 'package:genie_ai_mobile/services/auth/auth_providers.dart';
import 'package:genie_ai_mobile/services/auth/auth_state.dart';
import 'package:genie_ai_mobile/services/i18n_service.dart';

import '../helpers/mock_current_user_api.dart';
import '../helpers/pump_frames.dart';
import '../helpers/test_app.dart';
import '../helpers/theme_helper.dart';

/// The account-deletion confirmation must surface the backend's
/// `filesDeletionFailed` flag: when the uploads directory could not be
/// removed after the committed erasure, the user gets a warning SnackBar
/// after the logout, on the way to the login screen, because files that may
/// contain personal data are still on disk (firing it before the logout
/// would expire the SnackBar during the Keycloak end-session round trip).
/// When the flag is absent (backends without it) or false, the behaviour is
/// unchanged (no notification). A non-200 deletion shows the failure
/// SnackBar instead.
void main() {
  tearDown(() {
    resetThemeManager();
    I18nService().changeLanguage('en');
  });

  /// Drives the real user path: opens the settings screen, taps the delete
  /// tile, confirms the modal, and lets the deletion flow complete — logout
  /// included, against a no-op notifier. Returns once the outcome SnackBar
  /// (if any) has been pumped in.
  Future<void> driveDeleteFlow(
    WidgetTester tester,
    MockCurrentUserApi api,
  ) async {
    setupLightTokens();
    I18nService().changeLanguage('en');

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          currentUserApiProvider.overrideWithValue(api),
          authProvider.overrideWith(() => _NoopAuthNotifier()),
        ],
        child: testApp(
          SettingsComponent(
            user: {'name': 'Test User', 'email': 'test@example.test'},
          ),
          routes: {'/login': (_) => const Scaffold(body: Text('login'))},
        ),
      ),
    );
    await pumpFrames(tester);

    final deleteTile = find.byKey(const Key('settings_delete_account_button'));
    await tester.ensureVisible(deleteTile);
    await pumpFrames(tester);
    await tester.tap(deleteTile);
    await pumpFrames(tester);

    await tester.tap(find.byKey(const Key('settings_delete_confirm_button')));
    await pumpFrames(tester);
  }

  /// Unmounts the screen after the assertions: removing the tree dismisses
  /// the SnackBar, so this must not run before the outcome is checked.
  Future<void> unmount(WidgetTester tester) async {
    await tester.pumpWidget(const SizedBox.shrink());
    await pumpFrames(tester);
  }

  testWidgets(
    'shows a warning SnackBar on the way to the login screen when filesDeletionFailed is true',
    (tester) async {
      final api = MockCurrentUserApi(
        deleteBody: {'success': true, 'filesDeletionFailed': true},
      );
      await driveDeleteFlow(tester, api);

      final warningText = I18nService().translate(
        'settings.accountDeletedFilesFailed',
      );
      expect(find.widgetWithText(SnackBar, warningText), findsOneWidget);
      // The deletion actually ran, and the flow completed: the warning was
      // shown on the way to the login screen, not instead of it.
      expect(api.deleteCalls, 1);
      await unmount(tester);
    },
  );

  testWidgets('shows the failure SnackBar when the deletion call fails', (
    tester,
  ) async {
    await driveDeleteFlow(
      tester,
      MockCurrentUserApi(deleteStatus: 500, deleteBody: {'error': 'boom'}),
    );

    final failureText = I18nService().translate(
      'settings.accountDeletionFailed',
    );
    expect(find.widgetWithText(SnackBar, failureText), findsOneWidget);
    expect(find.widgetWithText(SnackBar, 'login'), findsNothing);
    await unmount(tester);
  });

  testWidgets('shows no notification when the flag is absent (older backend)', (
    tester,
  ) async {
    await driveDeleteFlow(tester, MockCurrentUserApi());

    final warningText = I18nService().translate(
      'settings.accountDeletedFilesFailed',
    );
    expect(find.widgetWithText(SnackBar, warningText), findsNothing);
    await unmount(tester);
  });

  testWidgets(
    'shows no warning when the flag is explicitly false (clean deletion)',
    (tester) async {
      await driveDeleteFlow(
        tester,
        MockCurrentUserApi(
          deleteBody: {'success': true, 'filesDeletionFailed': false},
        ),
      );

      final warningText = I18nService().translate(
        'settings.accountDeletedFilesFailed',
      );
      expect(find.widgetWithText(SnackBar, warningText), findsNothing);
      await unmount(tester);
    },
  );
}

/// The deletion flow logs out after the API call — against the real
/// notifier that means Keycloak end-session network calls. A no-op keeps
/// the test on the component's own behaviour.
class _NoopAuthNotifier extends AuthNotifier {
  @override
  AuthState build() => const AuthState.authenticated(userId: 'user-1');

  @override
  Future<void> logout() async {}
}
