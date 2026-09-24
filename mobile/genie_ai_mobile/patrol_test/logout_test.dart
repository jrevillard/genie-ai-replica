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
  group('Logout', () {
    late AuthHelper auth;
    late KeycloakAdminHelper admin;

    const testUsername = 'e2e-logout-test';
    const testEmail = 'e2e-logout-test@test.local';
    const testPassword = 'E2ELogoutPass123!';

    patrolTest('clears-tokens-returns-to-login', ($) async {
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

        // 2. Verify authenticated, then tap logout
        await $(
          #navbar_logout_button,
        ).waitUntilVisible(timeout: Duration(seconds: 10));
        await $(#navbar_logout_button).tap();

        // 3. Verify back to login screen
        await $(
          #login_sign_in_button,
        ).waitUntilVisible(timeout: Duration(seconds: 15));
        expect($(#login_sign_in_button), findsOneWidget);
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
  });
}
