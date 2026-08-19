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

KeycloakConfig getConfig() {
  // When adding a new deployment flavor, add a case below and import its config.
  const flavor = String.fromEnvironment('FLAVOR', defaultValue: 'dev');
  switch (flavor) {
    case 'itu':
      return flavors.config;
    case 'staging':
      return stagingConfig;
    case 'e2e':
      return e2eConfig;
    case 'dev':
      return devConfig;
    default:
      throw ArgumentError(
        'Unknown FLAVOR: "$flavor". Expected: dev, staging, e2e, or itu.',
      );
  }
}
