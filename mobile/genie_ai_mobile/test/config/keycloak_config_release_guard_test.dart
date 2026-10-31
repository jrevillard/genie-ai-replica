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
///
/// The failure mode only exists in release/profile compilation. The test
/// runner has no `--release`, but `kReleaseMode` is the `dart.vm.product`
/// compile-time constant, so the guard is exercised with:
///
/// ```
/// flutter test --dart-define=dart.vm.product=true \
///   test/config/keycloak_config_release_guard_test.dart
/// ```
///
/// The `test:flutter` CI job runs exactly that command; in a normal debug
/// run the test skips itself.
void main() {
  const flavor = String.fromEnvironment('FLAVOR');
  const releaseLike = kReleaseMode || kProfileMode;

  test(
    'a release build without the FLAVOR define fails at startup',
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
}
