import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

import 'support/guard_scan.dart';

/// Guards on the vendored flutter_appauth fork.
///
/// The fork disables TLS certificate verification — Android through
/// `InsecureConnectionBuilder`, Apple platforms through `InsecureURLProtocol`.
/// That is acceptable only because every call site that can reach it sits
/// behind the `allowInsecureConnections` flag, which the app sets from
/// `KeycloakConfig.allowInsecureConnections`.
///
/// The fork's tree is excluded from the static-analysis scan (see
/// `.gitlab-ci.yml` → `SAST_EXCLUDED_PATHS`), so no analyzer checks those
/// guards any more, and the fork is rebased onto upstream from time to time. A
/// rebase that drops the GENIE.AI patch would reinstate an unconditional
/// trust-all client in every build, and the only signal would be a TLS
/// interception in the field.
///
/// These assertions are the compensating control for that exclusion. They are
/// structural, not textual: they check that the trust-all code exists and that
/// every reference to it is guarded. A re-indented, re-wrapped or renamed
/// condition still passes; a reference that becomes reachable without the flag
/// fails.

const _forkRoot = 'flutter_appauth';
const _javaPluginPath =
    'flutter_appauth/flutter_appauth/android/src/main/java/'
    'io/crossingthestreams/flutterappauth/FlutterAppauthPlugin.java';
const _javaBuilderPath =
    'flutter_appauth/flutter_appauth/android/src/main/java/'
    'io/crossingthestreams/flutterappauth/InsecureConnectionBuilder.java';
const _iosPluginPath =
    'flutter_appauth/flutter_appauth/ios/flutter_appauth/Sources/'
    'flutter_appauth/FlutterAppauthPlugin.m';
const _macosPluginPath =
    'flutter_appauth/flutter_appauth/macos/flutter_appauth/Sources/'
    'flutter_appauth/FlutterAppauthPlugin.m';

/// The trust-all singleton on Android. The class it belongs to has a private
/// constructor, so this qualified reference is the only way to reach it.
final _trustAllBuilder = RegExp(r'InsecureConnectionBuilder\s*\.\s*INSTANCE');

/// Any registration of a URL protocol, whichever protocol it is.
final _protocolRegistration = RegExp(r'\[\s*NSURLProtocol\s+registerClass:');

/// Any removal of a URL protocol registration.
final _protocolUnregistration = RegExp(
  r'\[\s*NSURLProtocol\s+unregisterClass:',
);

void main() {
  group('vendored flutter_appauth fork', () {
    test('is vendored where the app expects it', () {
      // The guards below are read from these files; if the fork moves or
      // disappears, they must fail loudly rather than pass vacuously.
      expect(File(_javaPluginPath).existsSync(), isTrue);
      expect(File(_javaBuilderPath).existsSync(), isTrue);
      expect(File(_iosPluginPath).existsSync(), isTrue);
      expect(File(_macosPluginPath).existsSync(), isTrue);
    });

    test('still ships the trust-all code it is forked for', () {
      // Upstream ignores allowInsecureConnections on iOS (issue #386), so the
      // fork had to add the NSURLProtocol interception; the Android builder is
      // upstream's. If either disappears the fork no longer does what this
      // repository forked it for.
      expect(
        File(_javaBuilderPath).readAsStringSync(),
        contains('class InsecureConnectionBuilder'),
      );
      for (final path in <String>[_iosPluginPath, _macosPluginPath]) {
        expect(
          File(path).readAsStringSync(),
          contains('InsecureURLProtocol : NSURLProtocol'),
          reason: '$path no longer implements the trust-all protocol',
        );
      }
    });
  });

  group('Android trust-all builder', () {
    test('is referenced only behind the flag, in every JVM source', () {
      // The claim is tree-wide, so the check is tree-wide: every JVM source of
      // the fork is read, not only the plugin. A rebase that adds a helper
      // using the trust-all builder would otherwise slip past a single-file
      // check — and nothing else scans this tree any more.
      final unguarded = <String>[];
      var references = 0;
      for (final file in sourceFilesUnder(_forkRoot, {'.java', '.kt'})) {
        final scanner = GuardScanner(file.readAsStringSync());
        references += scanner.count(_trustAllBuilder);
        for (final use in scanner.unguarded(
          _trustAllBuilder,
          'allowInsecureConnections',
        )) {
          unguarded.add('${relativePath(file)} $use');
        }
      }
      expect(
        unguarded,
        isEmpty,
        reason:
            'the trust-all builder is reachable without allowInsecureConnections',
      );
      expect(references, greaterThan(0));
    });

    test('end-session reads the flag into the field, not a local', () {
      // getConnectionBuilder() and getAuthorizationService() both read the
      // `allowInsecureConnections` field. If the end-session processor kept
      // the flag in a local — as it once did — the end-session request would
      // use whatever the previous authorize or token call had set, so an
      // exchange that asked for TLS verification could still be intercepted.
      final scanner = GuardScanner(File(_javaPluginPath).readAsStringSync());
      final body = scanner.blockAfter(
        RegExp(
          r'EndSessionRequestParameters\s+processEndSessionRequestArguments',
        ),
      );
      expect(body, isNotNull, reason: 'the end-session processor moved');
      expect(
        body,
        isNot(contains(RegExp(r'\bboolean\s+allowInsecureConnections\b'))),
        reason:
            'a local shadows the field: end-session would ignore its '
            'own flag and reuse the previous call\'s',
      );
      expect(
        body,
        contains(RegExp(r'\ballowInsecureConnections\s*=(?!=)')),
        reason: 'the flag is never read from the arguments',
      );
    });
  });

  group('Apple trust-all protocol', () {
    for (final (label, path) in <(String, String)>[
      ('iOS', _iosPluginPath),
      ('macOS', _macosPluginPath),
    ]) {
      group(label, () {
        test('is registered and unregistered only behind the flag', () {
          // The registration is process-global: it covers every request the
          // app makes, not only the Keycloak ones. An unguarded registration
          // would therefore disable certificate checking for the whole app.
          //
          // Every Apple source of the fork is scanned, so an unguarded
          // registration added anywhere in the tree is caught.
          final unguarded = <String>[];
          for (final file in sourceFilesUnder(_forkRoot, {'.m', '.mm'})) {
            final scanner = GuardScanner(file.readAsStringSync());
            for (final use in scanner.unguarded(
              _protocolRegistration,
              'allowInsecureConnections',
            )) {
              unguarded.add('${relativePath(file)} $use');
            }
            for (final use in scanner.unguarded(
              _protocolUnregistration,
              'allowInsecureConnections',
            )) {
              unguarded.add('${relativePath(file)} $use');
            }
          }
          expect(
            unguarded,
            isEmpty,
            reason:
                'the trust-all protocol is installed without '
                'allowInsecureConnections',
          );
        });

        test('registers and unregisters as many times as it installs', () {
          // Every registration has to be undone when the exchange ends,
          // otherwise the protocol stays installed for the life of the
          // process. The counts are compared to each other rather than to a
          // fixed number, so a rebase that adds a guarded call site does not
          // break the test.
          final scanner = GuardScanner(File(path).readAsStringSync());
          expect(scanner.count(_protocolRegistration), greaterThan(0));
          expect(
            scanner.count(_protocolUnregistration),
            scanner.count(_protocolRegistration),
          );
        });
      });
    }
  });
}
