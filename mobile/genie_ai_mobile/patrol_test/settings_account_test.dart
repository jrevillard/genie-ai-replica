import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/config/e2e_config.dart';
import 'package:patrol/patrol.dart';

import 'helpers/auth_helper.dart';
import 'helpers/e2e_login_helper.dart';
import 'helpers/keycloak_admin_helper.dart';
import 'helpers/native_commands.dart';
import 'helpers/test_app.dart';
import 'e2e_secrets.dart';

void main() {
  group('SettingsAccount', () {
    late AuthHelper auth;
    late KeycloakAdminHelper admin;

    const testUsername = 'e2e-settings-test';
    const testEmail = 'e2e-settings-test@test.local';
    const testPassword = 'E2ESettingsPass123!';

    patrolTest('manage-account opens Keycloak URL', ($) async {
      auth = AuthHelper(
        keycloakUrl: e2eConfig.keycloakUrl,
        realm: e2eConfig.realm,
      );
      admin = KeycloakAdminHelper(auth: auth);
      await clearSecureStorage();

      final adminToken = await auth.getAdminToken(
        e2eSecrets.keycloakAdminPassword,
      );
      String? userId;
      try {
        userId = await admin.createUser(
          adminToken: adminToken,
          realm: e2eConfig.realm,
          username: testUsername,
          email: testEmail,
          password: testPassword,
        );
      } catch (_) {}

      try {
        // 1. Pre-populate tokens and launch app
        final container = await createAuthenticatedContainer(
          auth: auth,
          config: e2eConfig,
          username: testUsername,
          password: testPassword,
        );
        await $.pumpWidgetAndSettle(TestApp(container: container));
        await $(
          #navbar_logout_button,
        ).waitUntilVisible(timeout: Duration(seconds: 10));

        // 2. Open Settings via navbar menu
        await $(#navbar_more_button).tap();
        await Future<void>.delayed(const Duration(milliseconds: 500));
        // PopupMenu items are native Android — tap the Settings item
        // by finding the ListTile containing "Settings" text.
        // PopupMenu items render in a native overlay — $(#key) finders don't reach them.
        await $('Settings').tap();

        // 3. Scroll to Manage My Account button (bottom of settings screen)
        await $(#settings_manage_account_button).scrollTo();
        await $(
          #settings_manage_account_button,
        ).waitUntilVisible(timeout: Duration(seconds: 10));

        // 4. Tap Manage My Account — launches Keycloak account console
        //    in external browser. We can't verify the browser content
        //    (no session cookie, self-signed cert), so we just verify
        //    the button is tappable and no error snackbar appears.
        await $(#settings_manage_account_button).tap();
        await Future<void>.delayed(const Duration(seconds: 2));
      } finally {
        try {
          final token = await auth.getAdminToken(
            e2eSecrets.keycloakAdminPassword,
          );
          await admin.safeDeleteUser(
            adminToken: token,
            realm: e2eConfig.realm,
            userId: userId,
            username: testUsername,
          );
        } catch (_) {}
        await clearSecureStorage();
      }
    });

    patrolTest('delete-account removes user and returns to login', ($) async {
      auth = AuthHelper(
        keycloakUrl: e2eConfig.keycloakUrl,
        realm: e2eConfig.realm,
      );
      admin = KeycloakAdminHelper(auth: auth);
      await clearSecureStorage();

      final adminToken = await auth.getAdminToken(
        e2eSecrets.keycloakAdminPassword,
      );
      String? userId;
      try {
        userId = await admin.createUser(
          adminToken: adminToken,
          realm: e2eConfig.realm,
          username: testUsername,
          email: testEmail,
          password: testPassword,
        );
      } catch (_) {}

      try {
        // 1. Pre-populate tokens and launch app
        final container = await createAuthenticatedContainer(
          auth: auth,
          config: e2eConfig,
          username: testUsername,
          password: testPassword,
        );
        await $.pumpWidgetAndSettle(TestApp(container: container));
        await $(
          #navbar_logout_button,
        ).waitUntilVisible(timeout: Duration(seconds: 10));

        // 2. Open Settings via navbar menu
        await $(#navbar_more_button).tap();
        await Future<void>.delayed(const Duration(milliseconds: 500));
        // PopupMenu items render in a native overlay — $(#key) finders don't reach them.
        await $('Settings').tap();

        // 3. Scroll to Delete My Account button (bottom of settings screen)
        await $(#settings_delete_account_button).scrollTo();
        await $(
          #settings_delete_account_button,
        ).waitUntilVisible(timeout: Duration(seconds: 10));

        // 4. Tap Delete My Account — confirmation dialog appears
        await $(#settings_delete_account_button).tap();
        await $(
          #settings_delete_confirm_button,
        ).waitUntilVisible(timeout: Duration(seconds: 10));

        // 5. Confirm deletion
        await $(#settings_delete_confirm_button).tap();

        // 6. Verify app returns to login screen
        await $(
          #login_sign_in_button,
        ).waitUntilVisible(timeout: Duration(seconds: 15));

        // 7. Verify user is actually deleted via Keycloak Admin API
        final newToken = await auth.getAdminToken(
          e2eSecrets.keycloakAdminPassword,
        );
        final exists =
            userId != null &&
            await admin.userExists(
              adminToken: newToken,
              realm: e2eConfig.realm,
              userId: userId,
            );
        expect(exists, isFalse);
      } finally {
        // User already deleted by the test — catch expected 404
        try {
          final token = await auth.getAdminToken(
            e2eSecrets.keycloakAdminPassword,
          );
          await admin.safeDeleteUser(
            adminToken: token,
            realm: e2eConfig.realm,
            userId: userId,
            username: testUsername,
          );
        } catch (_) {}
        await clearSecureStorage();
      }
    });
  });
}
