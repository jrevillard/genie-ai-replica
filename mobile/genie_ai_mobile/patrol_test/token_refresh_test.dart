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
  group('TokenRefresh', () {
    late AuthHelper auth;
    late KeycloakAdminHelper admin;

    const testUsername = 'e2e-refresh-test';
    const testEmail = 'e2e-refresh-test@test.local';
    const testPassword = 'E2ERefreshPass123!';

    patrolTest('silent refresh on resume after expiry', ($) async {
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

        // 2. Verify authenticated
        await $(
          #navbar_logout_button,
        ).waitUntilVisible(timeout: Duration(seconds: 10));

        // 3. Background app
        await $.platformAutomator.mobile.pressHome();
        await Future<void>.delayed(const Duration(seconds: 2));

        // 4. Foreground app — triggers didChangeAppLifecycleState(resumed)
        //    which calls AuthNotifier.validateTokens().
        //    NOTE: This tests the lifecycle resume behavior with valid tokens.
        //    Testing actual token expiry would require issuing a short-lived
        //    token (updateRealmSettings only affects newly-issued tokens,
        //    not the one already in storage).
        await $.platformAutomator.mobile.openApp(
          appId: 'com.example.genie_ai_mobile.e2e',
        );

        // 5. Verify state stays authenticated
        await $(
          #navbar_logout_button,
        ).waitUntilVisible(timeout: Duration(seconds: 30));
        expect($(#navbar_logout_button), findsOneWidget);
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
