import 'package:flutter/foundation.dart';

import 'dev_config.dart';
import 'staging_config.dart';
import 'e2e_config.dart';
import 'flavors/itu.dart' as flavors;

/// The full set of locale codes shipped in every build. A deployment flavor
/// exposes a subset via [KeycloakConfig.supportedLocaleCodes].
const List<String> allSupportedLocaleCodes = <String>[
  'ar',
  'bn',
  'zh',
  'en',
  'fr',
  'de',
  'id',
  'man',
  'pt',
  'ru',
  'st',
  'es',
  'sw',
  'th',
];

class KeycloakConfig {
  final String keycloakUrl;
  final String realm;
  final String clientId;
  final String redirectScheme;
  final String backendUrl;
  final bool allowInsecureConnections;

  /// Locale codes active for this deployment's flavor. Defaults to all shipped
  /// locales; a flavor may restrict this (e.g. el-salvador → ['en', 'es']).
  final List<String> supportedLocaleCodes;

  KeycloakConfig({
    required this.keycloakUrl,
    required this.realm,
    required this.clientId,
    required this.redirectScheme,
    required this.backendUrl,
    this.allowInsecureConnections = false,
    this.supportedLocaleCodes = allSupportedLocaleCodes,
  }) : assert(
         redirectScheme.isNotEmpty &&
             RegExp(
               r'^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)*$',
             ).hasMatch(redirectScheme),
         'redirectScheme must be a non-empty reverse-domain string '
         '(e.g. "com.itu.genieai"), got: "$redirectScheme"',
       );

  String get realmUrl => '$keycloakUrl/realms/$realm';

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is KeycloakConfig &&
          runtimeType == other.runtimeType &&
          keycloakUrl == other.keycloakUrl &&
          realm == other.realm &&
          clientId == other.clientId &&
          redirectScheme == other.redirectScheme &&
          backendUrl == other.backendUrl &&
          allowInsecureConnections == other.allowInsecureConnections &&
          listEquals(supportedLocaleCodes, other.supportedLocaleCodes);

  @override
  int get hashCode => Object.hash(
    keycloakUrl,
    realm,
    clientId,
    redirectScheme,
    backendUrl,
    allowInsecureConnections,
    Object.hashAll(supportedLocaleCodes),
  );
}

/// The startup failure when the deployment configuration cannot be resolved.
///
/// [main] renders [message] on a diagnostic screen; there is nothing else to
/// do with a build whose flavor is missing or unknown.
class FlavorConfigError implements Exception {
  const FlavorConfigError(this.message);

  final String message;

  @override
  String toString() => message;
}

final _flavorTable = <String, KeycloakConfig>{
  'dev': devConfig,
  'staging': stagingConfig,
  'e2e': e2eConfig,
  'itu': flavors.config,
};

String get _knownFlavors => _flavorTable.keys.join(', ');

KeycloakConfig getConfig() {
  const flavor = String.fromEnvironment('FLAVOR');
  if (flavor.isEmpty) {
    // No FLAVOR dart-define. A debug `flutter run` keeps the dev default for
    // convenience; a release or profile build must not — it would silently
    // resolve devConfig, pointing every endpoint at localhost and arming the
    // trust-all TLS client in a release artifact. Fail at startup instead.
    if (kReleaseMode || kProfileMode) {
      throw FlavorConfigError(
        'No FLAVOR dart-define: build with '
        '--flavor <name> --dart-define=FLAVOR=<name> ($_knownFlavors).',
      );
    }
    return devConfig;
  }
  final config = _flavorTable[flavor];
  if (config == null) {
    throw FlavorConfigError(
      'Unknown FLAVOR: "$flavor". Expected: $_knownFlavors.',
    );
  }
  // A release artifact must never ship a configuration that arms the
  // trust-all TLS client. dev and e2e keep it on for local development; a
  // release build of them is either broken (localhost endpoints) or — with
  // DEV_SERVER repointed — a working app that accepts any certificate.
  // Profile builds are excluded: they never leave the developer's machine,
  // and profiling a dev build against a self-signed server is legitimate.
  // build-release.ps1 refuses these flavors too; this is the in-app gate.
  if (kReleaseMode && config.allowInsecureConnections) {
    throw FlavorConfigError(
      'The "$flavor" configuration enables allowInsecureConnections and '
      'cannot be built into a release artifact. Build a deployment flavor '
      'instead: --flavor <name> --dart-define=FLAVOR=<name> ($_knownFlavors).',
    );
  }
  return config;
}
