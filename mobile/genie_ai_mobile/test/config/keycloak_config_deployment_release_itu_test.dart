import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:genie_ai_mobile/config/keycloak_config.dart';
import 'package:genie_ai_mobile/config/flavors/itu.dart' as flavors;

/// The production release recipe, executed.
///
/// The shipped recipe is `dart.vm.product=true` + `FLAVOR=itu`; through
/// `getConfig()` it must resolve the itu flavor with the trust-all TLS
/// client off. The other CI runs compile `getConfig()` in debug mode or
/// without a FLAVOR define; this is the combination that proves the recipe
/// an actual release artifact goes through (#1249). The rationale is stated
/// at the guard, in `lib/config/keycloak_config.dart`.
///
/// FLAVOR is a compile-time constant, so this case executes under exactly
/// one combination — `--dart-define=dart.vm.product=true
/// --dart-define=FLAVOR=itu` — and skips under every other. The
/// `test:flutter` CI job runs exactly that invocation behind a zero-skip
/// gate; in a normal debug run the test skips itself.
void main() {
  const flavor = String.fromEnvironment('FLAVOR');

  test(
    'the production release recipe resolves the itu flavor',
    () {
      final config = getConfig();
      expect(config, equals(flavors.config));
      // The equality above self-compares: getConfig() returns the same
      // instance the flavor table maps "itu" to. This assert names the
      // deployment contract directly — the production flavor keeps the
      // trust-all TLS client off.
      expect(config.allowInsecureConnections, isFalse);
    },
    skip: !kReleaseMode
        ? 'this case needs a release compilation: run this file with '
              '--dart-define=dart.vm.product=true --dart-define=FLAVOR=itu'
        : flavor != 'itu'
        ? 'this case compiles with FLAVOR=itu'
        : null,
  );
}
