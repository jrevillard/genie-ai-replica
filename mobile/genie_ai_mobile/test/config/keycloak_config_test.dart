import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/config/keycloak_config.dart';
import 'package:genie_ai_mobile/config/dev_config.dart';
import 'package:genie_ai_mobile/config/staging_config.dart';
import 'package:genie_ai_mobile/config/e2e_config.dart';
import 'package:genie_ai_mobile/config/flavors/itu.dart' as flavors;

void main() {
  group('KeycloakConfig', () {
    test('holds all 4 fields correctly', () {
      const config = KeycloakConfig(
        keycloakUrl: 'https://example.com',
        clientId: 'test-client',
        redirectScheme: 'com.example.app',
        backendUrl: 'https://api.example.com',
      );
      expect(config.keycloakUrl, 'https://example.com');
      expect(config.clientId, 'test-client');
      expect(config.redirectScheme, 'com.example.app');
      expect(config.backendUrl, 'https://api.example.com');
    });

    test('has const constructor', () {
      const config = KeycloakConfig(
        keycloakUrl: '',
        clientId: '',
        redirectScheme: '',
        backendUrl: '',
      );
      expect(config, isA<KeycloakConfig>());
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
      expect(devConfig.keycloakUrl, equals('http://localhost:8080'));
      expect(devConfig.clientId, equals('genie-mobile-dev'));
      expect(devConfig.redirectScheme, equals('com.itu.genieai.dev'));
      expect(devConfig.backendUrl, equals('http://localhost:3000'));
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
      expect(e2eConfig.keycloakUrl, equals('http://localhost:8080'));
      expect(e2eConfig.clientId, equals('genie-mobile-e2e'));
      expect(e2eConfig.redirectScheme, equals('com.itu.genieai.e2e'));
      expect(e2eConfig.backendUrl, equals('http://localhost:3000'));
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
      expect(flavors.config.clientId, equals('genie-mobile-itu'));
      expect(flavors.config.redirectScheme, equals('com.itu.genieai'));
      expect(flavors.config.backendUrl, equals('https://api.itu.int'));
    });
  });
}
