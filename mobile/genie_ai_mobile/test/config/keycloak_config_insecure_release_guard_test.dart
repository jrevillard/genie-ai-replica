import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:genie_ai_mobile/config/keycloak_config.dart';

/// The insecure-release half of the flavor contract.
///
/// `getConfig()` refuses, in a release compilation, any configuration with
/// `allowInsecureConnections` on — today the `dev` and `e2e` flavors. The
/// rationale and the profile exemption are stated at the guard, in
/// `lib/config/keycloak_config.dart`.
///
/// FLAVOR is a compile-time constant, so each case below executes under
/// exactly one compile-time combination and skips under every other. No CI
/// job runs these combinations yet (#1249); exercise them locally with:
///
/// ```
/// flutter test --dart-define=dart.vm.product=true --dart-define=FLAVOR=dev \
///   test/config/keycloak_config_insecure_release_guard_test.dart
/// flutter test --dart-define=dart.vm.product=true --dart-define=FLAVOR=e2e \
///   test/config/keycloak_config_insecure_release_guard_test.dart
/// flutter test --dart-define=dart.vm.product=true --dart-define=FLAVOR=staging \
///   test/config/keycloak_config_insecure_release_guard_test.dart
/// flutter test --dart-define=dart.vm.profile=true --dart-define=FLAVOR=dev \
///   test/config/keycloak_config_insecure_release_guard_test.dart
/// ```
///
/// In a normal debug run every test skips itself.
void main() {
  const flavor = String.fromEnvironment('FLAVOR');

  for (final insecureFlavor in const ['dev', 'e2e']) {
    test(
      'a release build of the "$insecureFlavor" flavor fails at startup',
      () {
        expect(() => getConfig(), throwsA(isA<FlavorConfigError>()));
      },
      skip: !kReleaseMode
          ? 'this case needs a release compilation: run this file with '
                '--dart-define=dart.vm.product=true '
                '--dart-define=FLAVOR=$insecureFlavor'
          : flavor != insecureFlavor
          ? 'this case compiles with FLAVOR=$insecureFlavor'
          : null,
    );
  }

  test(
    'a release build of a deployment flavor still resolves its config',
    () {
      expect(getConfig(), isA<KeycloakConfig>());
      expect(getConfig().allowInsecureConnections, isFalse);
    },
    skip: !kReleaseMode
        ? 'this case needs a release compilation: run this file with '
              '--dart-define=dart.vm.product=true --dart-define=FLAVOR=staging'
        : flavor != 'staging'
        ? 'this case compiles with FLAVOR=staging'
        : null,
  );

  test(
    'a profile build of the dev flavor still resolves its config',
    () {
      expect(getConfig(), isA<KeycloakConfig>());
    },
    skip: !kProfileMode
        ? 'this case compiles with dart.vm.profile=true'
        : flavor != 'dev'
        ? 'this case compiles with FLAVOR=dev'
        : null,
  );
}
