import 'dev_config.dart';
import 'staging_config.dart';
import 'e2e_config.dart';
import 'flavors/itu.dart' as flavors;

class KeycloakConfig {
  final String keycloakUrl;
  final String realm;
  final String clientId;
  final String redirectScheme;
  final String backendUrl;
  final bool allowInsecureConnections;

  const KeycloakConfig({
    required this.keycloakUrl,
    required this.realm,
    required this.clientId,
    required this.redirectScheme,
    required this.backendUrl,
    this.allowInsecureConnections = false,
  });

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
          allowInsecureConnections == other.allowInsecureConnections;

  @override
  int get hashCode => Object.hash(
    keycloakUrl,
    realm,
    clientId,
    redirectScheme,
    backendUrl,
    allowInsecureConnections,
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
