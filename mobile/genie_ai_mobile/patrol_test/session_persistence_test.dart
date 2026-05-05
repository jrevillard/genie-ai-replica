import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/config/e2e_config.dart';
import 'package:genie_ai_mobile/services/auth/token_storage.dart';
import 'package:patrol/patrol.dart';

import 'helpers/auth_helper.dart';
import 'helpers/e2e_login_helper.dart';
import 'helpers/keycloak_admin_helper.dart';
import 'helpers/native_commands.dart';
import 'helpers/test_app.dart';
import 'e2e_secrets.dart';


void main() {
  group('SessionPersistence', () {
    late AuthHelper auth;
    late KeycloakAdminHelper admin;

    const testUsername = 'e2e-session-test';
    const testEmail = 'e2e-session-test@test.local';
    const testPassword = 'E2ESessionPass123!';

    patrolTest(
      'auth survives background-foreground',
      ($) async {
        auth = AuthHelper(
          keycloakUrl: e2eConfig.keycloakUrl,
          realm: e2eConfig.realm,
        );
        admin = KeycloakAdminHelper(auth: auth);
        await clearSecureStorage();

        final adminToken = await auth.getAdminToken(e2eSecrets.keycloakAdminPassword);
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
          await $(#navbar_logout_button).waitUntilVisible(
            timeout: Duration(seconds: 10),
          );
          expect($(#navbar_logout_button), findsOneWidget);

          // 3. Background the app
          await $.platformAutomator.mobile.pressHome();
          await Future<void>.delayed(const Duration(seconds: 2));

          // 4. Foreground the app
          await $.platformAutomator.mobile.openApp(appId: 'com.example.genie_ai_mobile.e2e');
          await Future<void>.delayed(const Duration(seconds: 1));
          await $.pumpAndSettle();

          // 5. Verify still authenticated — AuthNotifier state persisted
          //    through the lifecycle transition.
          await $(#navbar_logout_button).waitUntilVisible(
            timeout: Duration(seconds: 10),
          );
          expect($(#navbar_logout_button), findsOneWidget);
        } finally {
          try {
            final token = await auth.getAdminToken(e2eSecrets.keycloakAdminPassword);
            await admin.safeDeleteUser(
              adminToken: token,
              realm: e2eConfig.realm,
              userId: userId,
              username: testUsername,
            );
          } catch (_) {}
          await clearSecureStorage();
        }
      },
    );

    patrolTest(
      'cold-start reloads tokens from storage',
      ($) async {
        auth = AuthHelper(
          keycloakUrl: e2eConfig.keycloakUrl,
          realm: e2eConfig.realm,
        );
        admin = KeycloakAdminHelper(auth: auth);
        await clearSecureStorage();

        final adminToken = await auth.getAdminToken(e2eSecrets.keycloakAdminPassword);
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
          // 1. Obtain tokens via ROPC and write them to the real
          //    SecureTokenStorage (simulates a previous authenticated session).
          final tokens = await auth.getRopcToken(
            clientId: e2eConfig.clientId,
            username: testUsername,
            password: testPassword,
          );
          final storage = SecureTokenStorage();
          final expiration = DateTime.tryParse(tokens['expires_at']!) ??
              DateTime.now().add(const Duration(seconds: 300));
          await storage.saveTokens(
            accessToken: tokens['access_token']!,
            idToken: tokens['id_token']!,
            refreshToken: tokens['refresh_token']!,
            accessTokenExpiration: expiration,
          );

          // 2. Launch app with a FRESH container (no token override — uses
          //    the real SecureTokenStorage). This simulates a cold start.
          //
          //    NOTE: A true app process kill (adb force-stop) cannot be
          //    triggered from within the Patrol test runner — Process.run()
          //    executes inside the emulator where adb is unavailable.
          //    The real cold-start path is validated by unit tests on
          //    TokenStorage and by manual QA.
          final container = ProviderContainer(overrides: testProviderOverrides);
          await $.pumpWidgetAndSettle(TestApp(container: container));

          // 3. Verify the app reads tokens from storage and is authenticated.
          await $(#navbar_logout_button).waitUntilVisible(
            timeout: Duration(seconds: 10),
          );
          expect($(#navbar_logout_button), findsOneWidget);
        } finally {
          try {
            final token = await auth.getAdminToken(e2eSecrets.keycloakAdminPassword);
            await admin.safeDeleteUser(
              adminToken: token,
              realm: e2eConfig.realm,
              userId: userId,
              username: testUsername,
            );
          } catch (_) {}
          await clearSecureStorage();
        }
      },
    );
  });
}
