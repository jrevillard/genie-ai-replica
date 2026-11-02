import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:genie_ai_mobile/config/keycloak_config.dart';
import 'package:genie_ai_mobile/config/staging_config.dart';

/// The control half of the insecure-release guard: a deployment flavor.
///
/// The guard must refuse exactly the flavors that arm the trust-all TLS
/// client (dev, e2e) — not every release build. A release compilation of
/// `staging`, whose `allowInsecureConnections` is off, still resolves its
/// configuration; this case fails if the guard is ever broadened into an
/// over-refusal that breaks release builds of deployment flavors. The
/// rationale is stated at the guard, in `lib/config/keycloak_config.dart`.
///
/// FLAVOR is a compile-time constant, so this case executes under exactly
/// one combination — `--dart-define=dart.vm.product=true
/// --dart-define=FLAVOR=staging` — and skips under every other. The
/// `test:flutter` CI job runs exactly that invocation behind a zero-skip
/// gate (#1249); in a normal debug run the test skips itself.
void main() {
  const flavor = String.fromEnvironment('FLAVOR');

  test(
    'a release build of the "staging" flavor still resolves its config',
    () {
      final config = getConfig();
      expect(config, equals(stagingConfig));
      // The equality above self-compares: getConfig() returns the same
      // instance the flavor table maps "staging" to. This assert names the
      // deployment contract directly — staging keeps the trust-all TLS
      // client off — instead of relying on the guard to fail first.
      expect(config.allowInsecureConnections, isFalse);
    },
    skip: !kReleaseMode
        ? 'this case needs a release compilation: run this file with '
              '--dart-define=dart.vm.product=true --dart-define=FLAVOR=staging'
        : flavor != 'staging'
        ? 'this case compiles with FLAVOR=staging'
        : null,
  );
}
