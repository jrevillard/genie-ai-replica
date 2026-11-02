import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:genie_ai_mobile/config/keycloak_config.dart';

/// The insecure-release guard for the `dev` flavor.
///
/// `getConfig()` refuses, in a release compilation, any configuration with
/// `allowInsecureConnections` on — `dev` is one of the two flavors that arm
/// the trust-all TLS client. The rationale and the profile exemption are
/// stated at the guard, in `lib/config/keycloak_config.dart`.
///
/// The refusal only exists in a release compilation and FLAVOR is a
/// compile-time constant, so this case executes under exactly one
/// combination — `--dart-define=dart.vm.product=true
/// --dart-define=FLAVOR=dev` — and skips under every other. The
/// `test:flutter` CI job runs exactly that invocation behind a zero-skip
/// gate (#1249); in a normal debug run the test skips itself.
void main() {
  const flavor = String.fromEnvironment('FLAVOR');

  test(
    'a release build of the "dev" flavor fails at startup',
    () {
      expect(() => getConfig(), throwsA(isA<FlavorConfigError>()));
    },
    skip: !kReleaseMode
        ? 'this case needs a release compilation: run this file with '
              '--dart-define=dart.vm.product=true --dart-define=FLAVOR=dev'
        : flavor != 'dev'
        ? 'this case compiles with FLAVOR=dev'
        : null,
  );
}
