import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:genie_ai_mobile/config/keycloak_config.dart';

/// The release-mode half of the flavor contract.
///
/// `getConfig()` resolves the deployment configuration from the FLAVOR
/// dart-define. In debug a missing define still resolves the dev flavor (a
/// plain `flutter run` stays convenient); in release or profile it must fail
/// at startup instead — a silent dev resolution ships a release artifact with
/// every endpoint pointed at localhost and the trust-all TLS client armed.
/// A release build whose define names dev or e2e must fail too: both keep
/// `allowInsecureConnections` on for local development, and a release build
/// of them is either broken (localhost endpoints) or — with DEV_SERVER
/// repointed — a working app that accepts any certificate.
///
/// The failure modes only exist in release/profile compilation. The test
/// runner has no `--release`, but `kReleaseMode` is the `dart.vm.product`
/// compile-time constant, so the guard is exercised with:
///
/// ```
/// flutter test --dart-define=dart.vm.product=true \
///   test/config/keycloak_config_release_guard_test.dart
/// ```
///
/// The `test:flutter` CI job runs exactly that command (no FLAVOR define, so
/// it covers the missing-define case). The dev/e2e cases need the define set
/// alongside the product flag:
///
/// ```
/// flutter test --dart-define=dart.vm.product=true --dart-define=FLAVOR=dev \
///   test/config/keycloak_config_release_guard_test.dart
/// ```
///
/// In a normal debug run every test skips itself.
void main() {
  const flavor = String.fromEnvironment('FLAVOR');
  const releaseLike = kReleaseMode || kProfileMode;
  // Only a true release compilation arms the refusal: profile builds never
  // leave the developer's machine, and profiling a dev build against a
  // self-signed server is legitimate.
  const release = kReleaseMode;

  test(
    'a release or profile build without the FLAVOR define fails at startup',
    () {
      expect(() => getConfig(), throwsA(isA<FlavorConfigError>()));
    },
    skip: !releaseLike
        ? 'debug keeps the dev default; run this file with '
              '--dart-define=dart.vm.product=true (or dart.vm.profile=true) '
              'to exercise the guard'
        : flavor.isNotEmpty
        ? 'the FLAVOR define is set; the guard covers the missing-define case'
        : null,
  );

  for (final insecureFlavor in const ['dev', 'e2e']) {
    test(
      'a release build of the "$insecureFlavor" flavor fails at startup',
      () {
        expect(() => getConfig(), throwsA(isA<FlavorConfigError>()));
      },
      skip: !release
          ? 'profile keeps dev/e2e available for performance profiling; run '
                'this file with --dart-define=dart.vm.product=true '
                '--dart-define=FLAVOR=$insecureFlavor to exercise the guard'
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
    skip: !release
        ? 'deployment flavors are unrestricted in profile; run this file with '
              '--dart-define=dart.vm.product=true --dart-define=FLAVOR=staging '
              'to exercise the guard'
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
