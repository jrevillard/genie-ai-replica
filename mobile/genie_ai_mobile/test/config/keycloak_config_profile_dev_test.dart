import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:genie_ai_mobile/config/dev_config.dart';
import 'package:genie_ai_mobile/config/keycloak_config.dart';

/// The profile exemption of the insecure-release guard.
///
/// `getConfig()` refuses release builds of the flavors that arm the
/// trust-all TLS client (dev, e2e) but deliberately exempts profile builds:
/// they never leave the developer's machine, and profiling a dev build
/// against a self-signed server is legitimate. The rationale is stated at
/// the guard, in `lib/config/keycloak_config.dart`; this case fails if the
/// guard is ever extended to profile compilations.
///
/// FLAVOR is a compile-time constant, so this case executes under exactly
/// one combination — `--dart-define=dart.vm.profile=true
/// --dart-define=FLAVOR=dev` — and skips under every other. The
/// `test:flutter` CI job runs exactly that invocation behind a zero-skip
/// gate (#1249); in a normal debug run the test skips itself.
void main() {
  const flavor = String.fromEnvironment('FLAVOR');

  test(
    'a profile build of the dev flavor still resolves its config',
    () {
      expect(getConfig(), same(devConfig));
    },
    skip: !kProfileMode
        ? 'this case needs a profile compilation: run this file with '
              '--dart-define=dart.vm.profile=true --dart-define=FLAVOR=dev'
        : flavor != 'dev'
        ? 'this case compiles with FLAVOR=dev'
        : null,
  );
}
