import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/config/e2e_config.dart';
import 'package:genie_ai_mobile/services/auth/auth_providers.dart';
import 'package:genie_ai_mobile/services/auth/insecure_http_client.dart';
import 'package:genie_ai_mobile/services/keycloak/keycloak_service.dart';
import 'package:patrol/patrol.dart';

import 'helpers/auth_helper.dart';
import 'helpers/e2e_login_helper.dart';
import 'helpers/keycloak_admin_helper.dart';
import 'helpers/native_commands.dart';
import 'helpers/test_app.dart';
import 'e2e_secrets.dart';

void main() {
  group('NetworkError', () {
    late AuthHelper auth;
    late KeycloakAdminHelper admin;
    late FakeConnectivityChecker connectivity;

    const testUsername = 'e2e-network-test';
    const testEmail = 'e2e-network-test@test.local';
    const testPassword = 'E2ENetworkPass123!';

    patrolTest('error-state-recovers-on-relaunch', ($) async {
      auth = AuthHelper(
        keycloakUrl: e2eConfig.keycloakUrl,
        realm: e2eConfig.realm,
      );
      admin = KeycloakAdminHelper(auth: auth);
      connectivity = FakeConnectivityChecker();

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
        // 1. Launch app with controllable connectivity (starts online)
        final container = ProviderContainer(
          overrides: [
            connectivityCheckerProvider.overrideWithValue(connectivity),
            keycloakServiceProvider.overrideWithValue(
              KeycloakService(
                keycloakConfig: e2eConfig,
                httpClient: InsecureHttpClient(),
              ),
            ),
          ],
        );
        await $.pumpWidgetAndSettle(TestApp(container: container));
        await $(#login_sign_in_button).waitUntilVisible();

        // 2. Simulate network offline via the fake checker
        connectivity.setOnline(false);

        // 3. Tap sign in — AuthNotifier sees isOnline=false and shows error
        await $(#login_sign_in_button).tap();

        // 4. Verify error state
        await $(
          #login_error_icon,
        ).waitUntilVisible(timeout: Duration(seconds: 15));
        expect($(#login_error_icon), findsOneWidget);
        expect($(#login_error_message), findsOneWidget);
        expect($(#login_retry_button), findsOneWidget);

        // 5. Verify recovery by relaunching with pre-populated tokens.
        //    (Retry tap is not used — it would trigger the real OIDC flow
        //    via Chrome Custom Tab which is not automatable from E2E.)
        final container2 = await createAuthenticatedContainer(
          auth: auth,
          config: e2eConfig,
          username: testUsername,
          password: testPassword,
        );
        await $.pumpWidgetAndSettle(TestApp(container: container2));

        // 6. Verify successful authentication
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
