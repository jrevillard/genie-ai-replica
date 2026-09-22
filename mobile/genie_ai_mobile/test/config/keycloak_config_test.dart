import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/config/keycloak_config.dart';
import 'package:genie_ai_mobile/config/dev_config.dart';
import 'package:genie_ai_mobile/config/staging_config.dart';
import 'package:genie_ai_mobile/config/e2e_config.dart';
import 'package:genie_ai_mobile/config/flavors/itu.dart' as flavors;

import 'support/guard_scan.dart';

/// A construction of the app's own trust-all HTTP client.
final _insecureClientUse = RegExp(r'InsecureHttpClient\s*\(');

void main() {
  group('KeycloakConfig', () {
    test('holds all 6 fields correctly', () {
      final config = KeycloakConfig(
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

    test('rejects empty redirectScheme with AssertionError', () {
      expect(
        () => KeycloakConfig(
          keycloakUrl: 'https://example.com',
          realm: 'genie',
          clientId: 'test',
          redirectScheme: '',
          backendUrl: 'https://api.example.com',
        ),
        throwsA(isA<AssertionError>()),
      );
    });

    test('rejects invalid redirectScheme format', () {
      expect(
        () => KeycloakConfig(
          keycloakUrl: 'https://example.com',
          realm: 'genie',
          clientId: 'test',
          redirectScheme: 'INVALID-SCHEME',
          backendUrl: 'https://api.example.com',
        ),
        throwsA(isA<AssertionError>()),
      );
    });

    test('accepts valid reverse-domain redirectScheme', () {
      final config = KeycloakConfig(
        keycloakUrl: 'https://example.com',
        realm: 'genie',
        clientId: 'test',
        redirectScheme: 'com.itu.genieai',
        backendUrl: 'https://api.example.com',
      );
      expect(config.redirectScheme, 'com.itu.genieai');
    });

    test('computes realmUrl from keycloakUrl and realm', () {
      final config = KeycloakConfig(
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
      // devConfig uses dart-defines DEV_SERVER/DEV_PORT. The default target is
      // the project dev server 10.0.0.101 (no dart-defines needed to test
      // against it); override with --dart-define=DEV_SERVER=localhost.
      expect(devConfig.keycloakUrl, equals('https://10.0.0.101:443/auth'));
      expect(devConfig.realm, equals('genie'));
      expect(
        devConfig.realmUrl,
        equals('https://10.0.0.101:443/auth/realms/genie'),
      );
      expect(devConfig.clientId, equals('genie-mobile-dev'));
      expect(devConfig.redirectScheme, equals('com.itu.genieai.dev'));
      expect(devConfig.backendUrl, equals('https://10.0.0.101:443'));
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
      expect(
        stagingConfig.keycloakUrl,
        equals('https://staging-keycloak.example.com'),
      );
      expect(stagingConfig.realm, equals('genie'));
      expect(
        stagingConfig.realmUrl,
        equals('https://staging-keycloak.example.com/realms/genie'),
      );
      expect(stagingConfig.clientId, equals('genie-mobile-staging'));
      expect(stagingConfig.redirectScheme, equals('com.itu.genieai.staging'));
      expect(
        stagingConfig.backendUrl,
        equals('https://staging-api.example.com'),
      );
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
      // e2eConfig is hardcoded to emulator host 10.0.2.2
      expect(e2eConfig.keycloakUrl, equals('https://10.0.2.2:8443/auth'));
      expect(e2eConfig.realm, equals('genie'));
      expect(
        e2eConfig.realmUrl,
        equals('https://10.0.2.2:8443/auth/realms/genie'),
      );
      expect(e2eConfig.clientId, equals('genie-mobile-e2e'));
      expect(e2eConfig.redirectScheme, equals('com.itu.genieai.e2e'));
      expect(e2eConfig.backendUrl, equals('https://10.0.2.2:8443'));
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
      expect(
        flavors.config.realmUrl,
        equals('https://keycloak.itu.int/realms/genie'),
      );
      expect(flavors.config.clientId, equals('genie-mobile-itu'));
      expect(flavors.config.redirectScheme, equals('com.itu.genieai'));
      expect(flavors.config.backendUrl, equals('https://api.itu.int'));
    });
  });

  group('insecure connections', () {
    test('deployment flavor configs keep them off', () {
      // The vendored flutter_appauth fork disables TLS verification when this
      // flag is on. That is acceptable for the dev and e2e flavors, which talk
      // to a self-signed Keycloak, and unacceptable for any flavor that reaches
      // a real deployment, so the deployment configs must keep it off.
      expect(flavors.config.allowInsecureConnections, isFalse);
      expect(stagingConfig.allowInsecureConnections, isFalse);
    });

    test('no config but the dev and e2e ones turns them on', () {
      // The exemption is exactly dev and e2e, and the claim is checked
      // against every config file in the tree rather than against the two
      // known ones: a new per-institution flavor is copied from the template
      // and lands in lib/config/flavors/, so it has to be covered by the same
      // rule or it is not covered at all.
      //
      // The files are read as source, not imported: a per-institution config
      // has a placeholder redirect scheme, which is not a valid reverse-domain
      // string, so importing it trips the KeycloakConfig assertion.
      final turningItOn = <String>[];
      for (final file in sourceFilesUnder('lib/config', {'.dart'})) {
        final content = file.readAsStringSync();
        if (RegExp(r'allowInsecureConnections\s*:\s*true').hasMatch(content)) {
          turningItOn.add(relativePath(file));
        }
      }
      expect(
        turningItOn,
        unorderedEquals(<String>[
          'lib/config/dev_config.dart',
          'lib/config/e2e_config.dart',
        ]),
      );
    });

    test('the exemption is exactly the dev and e2e configs', () {
      // Asserted in both directions: a future flavor that turns the flag on is
      // a deliberate act, and the two flavors that may do it stay the only ones.
      expect(devConfig.allowInsecureConnections, isTrue);
      expect(e2eConfig.allowInsecureConnections, isTrue);
    });

    test('the trust-all HTTP client is selected only behind the flag', () {
      // The app owns a second trust-all client — a Dart one, next to the one
      // in the vendored fork. It accepts any certificate, so it must be
      // unreachable unless the flag is on. The selection sites are checked
      // structurally, so a reformatting of the provider does not break the
      // test and an inverted condition does.
      final implementation = 'lib/services/auth/insecure_http_client.dart';
      final unguarded = <String>[];
      var selections = 0;
      for (final file in sourceFilesUnder('lib', {'.dart'})) {
        if (relativePath(file) == implementation) {
          // The class declares its own constructor; only the call sites
          // elsewhere decide whether it is ever built.
          continue;
        }
        final scanner = GuardScanner(file.readAsStringSync());
        selections += scanner.count(_insecureClientUse);
        for (final use in scanner.unguarded(
          _insecureClientUse,
          'allowInsecureConnections',
        )) {
          unguarded.add('${relativePath(file)} $use');
        }
      }
      expect(
        unguarded,
        isEmpty,
        reason:
            'the trust-all HTTP client is built without '
            'allowInsecureConnections',
      );
      expect(selections, greaterThan(0));
    });

    test('the effective config follows the FLAVOR define', () {
      // getConfig() resolves the flavor from the FLAVOR dart-define. With the
      // define set — the release recipe, exercised in CI by a second test run
      // with --dart-define=FLAVOR=itu — the named flavor wins, and the
      // deployment flavors keep the trust-all client off.
      const flavor = String.fromEnvironment('FLAVOR');
      if (flavor.isEmpty) {
        // Without the define, getConfig() falls back to the dev flavor. That
        // is the gap of #1099, and the assertion below is deliberately about
        // reachability only: the fallback may only ever point at the dev
        // server, never at a deployment. Which flavor it resolves to is a
        // routing detail that #1099 is free to change.
        final effective = getConfig();
        const devServer = String.fromEnvironment(
          'DEV_SERVER',
          defaultValue: 'localhost',
        );
        expect(effective.keycloakUrl, contains(devServer));
        expect(effective.backendUrl, contains(devServer));
        return;
      }
      if (flavor == 'itu') {
        expect(getConfig(), equals(flavors.config));
        expect(getConfig().allowInsecureConnections, isFalse);
      } else if (flavor == 'staging') {
        expect(getConfig(), equals(stagingConfig));
        expect(getConfig().allowInsecureConnections, isFalse);
      } else if (flavor == 'e2e') {
        expect(getConfig(), equals(e2eConfig));
      } else if (flavor == 'dev') {
        expect(getConfig(), equals(devConfig));
      } else {
        fail('unknown FLAVOR "$flavor"');
      }
    });
  });

  group('equality & locale whitelist', () {
    test('allSupportedLocaleCodes lists every shipped locale', () {
      expect(allSupportedLocaleCodes, hasLength(14));
      expect(
        allSupportedLocaleCodes,
        containsAll(<String>[
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
        ]),
      );
    });

    test('supportedLocaleCodes defaults to all shipped locales', () {
      final KeycloakConfig config = KeycloakConfig(
        keycloakUrl: 'u',
        realm: 'r',
        clientId: 'c',
        redirectScheme: 's',
        backendUrl: 'b',
      );
      expect(config.supportedLocaleCodes, allSupportedLocaleCodes);
    });

    test('supportedLocaleCodes can be restricted per flavor', () {
      final KeycloakConfig restricted = KeycloakConfig(
        keycloakUrl: 'u',
        realm: 'r',
        clientId: 'c',
        redirectScheme: 's',
        backendUrl: 'b',
        supportedLocaleCodes: ['en', 'es'],
      );
      expect(restricted.supportedLocaleCodes, <String>['en', 'es']);
    });

    test('an instance equals itself', () {
      final KeycloakConfig a = KeycloakConfig(
        keycloakUrl: 'u',
        realm: 'r',
        clientId: 'c',
        redirectScheme: 's',
        backendUrl: 'b',
      );
      expect(a == a, isTrue);
    });

    test(
      'distinct instances with identical fields are equal and share hashCode',
      () {
        // Non-const local prevents const canonicalization so the field-by-field
        // equality path (incl. listEquals) is actually exercised.
        final String url = 'https://example.com';
        final KeycloakConfig a = KeycloakConfig(
          keycloakUrl: url,
          realm: 'genie',
          clientId: 'c',
          redirectScheme: 's',
          backendUrl: 'b',
        );
        final KeycloakConfig b = KeycloakConfig(
          keycloakUrl: url,
          realm: 'genie',
          clientId: 'c',
          redirectScheme: 's',
          backendUrl: 'b',
        );
        expect(identical(a, b), isFalse);
        expect(a == b, isTrue);
        expect(a.hashCode, equals(b.hashCode));
      },
    );

    test('configs differing only in supportedLocaleCodes are not equal', () {
      final KeycloakConfig def = KeycloakConfig(
        keycloakUrl: 'u',
        realm: 'r',
        clientId: 'c',
        redirectScheme: 's',
        backendUrl: 'b',
      );
      final KeycloakConfig restricted = KeycloakConfig(
        keycloakUrl: 'u',
        realm: 'r',
        clientId: 'c',
        redirectScheme: 's',
        backendUrl: 'b',
        supportedLocaleCodes: ['en'],
      );
      expect(def == restricted, isFalse);
    });

    test('is not equal to an unrelated object', () {
      final KeycloakConfig a = KeycloakConfig(
        keycloakUrl: 'u',
        realm: 'r',
        clientId: 'c',
        redirectScheme: 's',
        backendUrl: 'b',
      );
      expect(a == Object(), isFalse);
    });
  });
}
