import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/config/e2e_config.dart';
import 'package:patrol/patrol.dart';

import 'helpers/auth_helper.dart';
import 'helpers/keycloak_admin_helper.dart';
import 'helpers/native_commands.dart';
import 'helpers/test_app.dart';
import 'e2e_secrets.dart';

void main() {
  group('LoginE2E', () {
    late AuthHelper auth;
    late KeycloakAdminHelper admin;

    const testUsername = 'e2e-test-user';
    const testEmail = 'e2e-test-user@test.local';
    const testPassword = 'E2ETestPass123!';

    patrolTest('deep-link token injection', ($) async {
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
        // 1. Obtain tokens via ROPC
        final tokens = await auth.getRopcToken(
          clientId: e2eConfig.clientId,
          username: testUsername,
          password: testPassword,
        );

        // 2. Launch app (unauthenticated — no tokens)
        final container = ProviderContainer(overrides: testProviderOverrides);
        await $.pumpWidgetAndSettle(TestApp(container: container));

        // 3. Send deep link with tokens — main.dart handler saves them
        //    and sets authenticated state.
        final deepLink = Uri(
          scheme: 'genie-e2e-test',
          host: 'test-auth',
          queryParameters: {
            'access_token': tokens['access_token'],
            'id_token': tokens['id_token'],
            'refresh_token': tokens['refresh_token'],
            'expires_at': tokens['expires_at'],
          },
        ).toString();
        await $.platformAutomator.mobile.openUrl(deepLink);

        // 4. Pump to let the deep link handler process and UI rebuild
        for (var i = 0; i < 20; i++) {
          await $.pumpAndSettle();
          if ($(#navbar_logout_button).exists) break;
          await Future<void>.delayed(const Duration(milliseconds: 200));
        }

        // 5. Verify authenticated state
        await $(
          #navbar_logout_button,
        ).waitUntilVisible(timeout: Duration(seconds: 10));
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
