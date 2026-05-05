import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/config/keycloak_config.dart';
import 'package:genie_ai_mobile/config/dev_config.dart';
import 'package:genie_ai_mobile/config/staging_config.dart';
import 'package:genie_ai_mobile/config/e2e_config.dart';
import 'package:genie_ai_mobile/config/flavors/itu.dart' as flavors;

void main() {
  group('KeycloakConfig', () {
    test('holds all 6 fields correctly', () {
      const config = KeycloakConfig(
        keycloakUrl: 'https://example.com',
        realm: 'genie',
        clientId: 'test-client',
        redirectScheme: 'com.example.app',
        backendUrl: 'https://api.example.com',
      );
      expect(config.keycloakUrl, 'https://example.com');
      expect(config.realm, 'genie');
      expect(config.clientId, 'test-client');
      expect(config.redirectScheme, 'com.example.app');
      expect(config.backendUrl, 'https://api.example.com');
      expect(config.allowInsecureConnections, isFalse);
    });

    test('has const constructor', () {
      const config = KeycloakConfig(
        keycloakUrl: '',
        realm: '',
        clientId: '',
        redirectScheme: '',
        backendUrl: '',
      );
      expect(config, isA<KeycloakConfig>());
    });

    test('computes realmUrl from keycloakUrl and realm', () {
      const config = KeycloakConfig(
        keycloakUrl: 'https://example.com',
        realm: 'myrealm',
        clientId: 'c',
        redirectScheme: 's',
        backendUrl: 'b',
      );
      expect(config.realmUrl, equals('https://example.com/realms/myrealm'));
    });
  });

  group('devConfig', () {
    test('is accessible and has expected field structure', () {
      expect(devConfig, isA<KeycloakConfig>());
      expect(devConfig.keycloakUrl, isNotEmpty);
      expect(devConfig.clientId, isNotEmpty);
      expect(devConfig.redirectScheme, isNotEmpty);
      expect(devConfig.backendUrl, isNotEmpty);
    });

    test('has dev-specific values', () {
      expect(devConfig.keycloakUrl, equals('https://10.0.2.2:8443/auth'));
      expect(devConfig.realm, equals('genie'));
      expect(devConfig.realmUrl, equals('https://10.0.2.2:8443/auth/realms/genie'));
      expect(devConfig.clientId, equals('genie-mobile-dev'));
      expect(devConfig.redirectScheme, equals('com.itu.genieai.dev'));
      expect(devConfig.backendUrl, equals('https://10.0.2.2:8443/api'));
    });
  });

  group('stagingConfig', () {
    test('is accessible and has expected field structure', () {
      expect(stagingConfig, isA<KeycloakConfig>());
      expect(stagingConfig.keycloakUrl, isNotEmpty);
      expect(stagingConfig.clientId, isNotEmpty);
      expect(stagingConfig.redirectScheme, isNotEmpty);
      expect(stagingConfig.backendUrl, isNotEmpty);
    });

    test('has staging-specific values', () {
      expect(stagingConfig.keycloakUrl, equals('https://staging-keycloak.example.com'));
      expect(stagingConfig.realm, equals('genie'));
      expect(stagingConfig.realmUrl, equals('https://staging-keycloak.example.com/realms/genie'));
      expect(stagingConfig.clientId, equals('genie-mobile-staging'));
      expect(stagingConfig.redirectScheme, equals('com.itu.genieai.staging'));
      expect(stagingConfig.backendUrl, equals('https://staging-api.example.com'));
    });
  });

  group('e2eConfig', () {
    test('is accessible and has expected field structure', () {
      expect(e2eConfig, isA<KeycloakConfig>());
      expect(e2eConfig.keycloakUrl, isNotEmpty);
      expect(e2eConfig.clientId, isNotEmpty);
      expect(e2eConfig.redirectScheme, isNotEmpty);
      expect(e2eConfig.backendUrl, isNotEmpty);
    });

    test('has e2e-specific values', () {
      expect(e2eConfig.keycloakUrl, equals('https://localhost:8443/auth'));
      expect(e2eConfig.realm, equals('genie'));
      expect(e2eConfig.realmUrl, equals('https://localhost:8443/auth/realms/genie'));
      expect(e2eConfig.clientId, equals('genie-mobile-e2e'));
      expect(e2eConfig.redirectScheme, equals('com.itu.genieai.e2e'));
      expect(e2eConfig.backendUrl, equals('https://localhost:8443/api'));
      expect(e2eConfig.allowInsecureConnections, isTrue);
    });
  });

  group('itu flavor config', () {
    test('is accessible and has expected field structure', () {
      expect(flavors.config, isA<KeycloakConfig>());
      expect(flavors.config.keycloakUrl, isNotEmpty);
      expect(flavors.config.clientId, isNotEmpty);
      expect(flavors.config.redirectScheme, isNotEmpty);
      expect(flavors.config.backendUrl, isNotEmpty);
    });

    test('has ITU-specific values', () {
      expect(flavors.config.keycloakUrl, equals('https://keycloak.itu.int'));
      expect(flavors.config.realm, equals('genie'));
      expect(flavors.config.realmUrl, equals('https://keycloak.itu.int/realms/genie'));
      expect(flavors.config.clientId, equals('genie-mobile-itu'));
      expect(flavors.config.redirectScheme, equals('com.itu.genieai'));
      expect(flavors.config.backendUrl, equals('https://api.itu.int'));
    });
  });
}
