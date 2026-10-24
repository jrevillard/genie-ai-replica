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

/// The first `{...}` block following [signature], comments stripped — the
/// body of the ObjC method declared by [signature], or null.
String? _methodBody(String source, Pattern signature) {
  final match = signature.allMatches(source).toList();
  if (match.isEmpty) return null;
  final open = source.indexOf('{', match.first.end);
  if (open < 0) return null;
  // Brace-match on the raw source.
  var depth = 0;
  for (var i = open; i < source.length; i++) {
    if (source[i] == '{') {
      depth++;
    } else if (source[i] == '}') {
      depth--;
      if (depth == 0) {
        final body = source.substring(open + 1, i);
        return body
            .replaceAll(RegExp(r'/\*.*?\*/', dotAll: true), ' ')
            .replaceAll(RegExp(r'//[^\n]*'), ' ');
      }
    }
  }
  return null;
}

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
  });

  group('GuardScanner.blockAfter', () {
    // Synthetic sources: the comment- and string-skipping between a
    // signature and its body brace is dead code on the current fork layout,
    // so it is exercised against sources built for it.
    test('skips comments and strings when locating the body', () {
      const source = r"""
          String sig(Map<String, Object> a) /* {"decoy": 1} */ {
            return "no brace { inside";
          }

          String other() { return "x"; }
        """;
      final scanner = GuardScanner(source);
      final body = scanner.blockAfter(RegExp(r'sig\('));
      expect(body, isNotNull);
      expect(body, contains('no brace'));
      expect(body, isNot(contains('decoy')));
      expect(body, isNot(contains('other')));
    });

    test('returns null when the signature is absent', () {
      expect(GuardScanner('int x = 3;').blockAfter('nope'), isNull);
    });
  });

  group('Android flag plumbing', () {
    test('no processor keeps the flag in a local', () {
      // getConnectionBuilder() and getAuthorizationService() both read the
      // `allowInsecureConnections` field. A local of that name in any
      // request processor would shadow the field, and that request would
      // use whatever the previous call had set — an exchange that asked
      // for TLS verification could still be intercepted.
      final scanner = GuardScanner(File(_javaPluginPath).readAsStringSync());
      for (final processor in const [
        'AuthorizationTokenRequestParameters\\s+'
            'processAuthorizationTokenRequestArguments',
        'TokenRequestParameters\\s+processTokenRequestArguments',
        'EndSessionRequestParameters\\s+processEndSessionRequestArguments',
      ]) {
        final signature = RegExp(processor);
        // A comment that mentions a signature would make it ambiguous
        // which occurrence blockAfter resolves; the test would then
        // police the wrong method without saying so.
        expect(
          scanner.count(signature),
          1,
          reason: 'the signature of $processor is ambiguous',
        );
        final body = scanner.blockAfter(signature);
        expect(body, isNotNull, reason: 'a request processor moved');
        // The body must process the arguments map — a canary for the
        // block extraction: if the scanner ever resolves the wrong
        // block, this is what fails, not a flag assertion below.
        expect(body, contains('arguments.get('));
        // Any local declaration shadows the field, whichever way it is
        // spelled: boolean, boxed Boolean, or var, final or not.
        expect(
          body,
          isNot(
            contains(
              RegExp(
                r'\b(?:final\s+)?(?:Boolean|boolean|var)\s+'
                r'allowInsecureConnections\b',
              ),
            ),
          ),
          reason:
              'a local shadows the field: the request would ignore '
              'its own flag and reuse the previous call\'s',
        );
      }
    });

    test('end-session reads its flag from the arguments map', () {
      // The field write must take the value from the request arguments —
      // a hard-coded right-hand side would silently drop the insecure
      // option. The check is about the source of the value, not its
      // spelling: == Boolean.TRUE, a helper, or extra spaces all pass.
      final scanner = GuardScanner(File(_javaPluginPath).readAsStringSync());
      final body = scanner.blockAfter(
        RegExp(
          r'EndSessionRequestParameters\s+processEndSessionRequestArguments',
        ),
      );
      expect(body, isNotNull, reason: 'the end-session processor moved');
      expect(
        body,
        contains(
          RegExp(
            r'allowInsecureConnections\s*=[^;]*'
            r'arguments\.get\(\s*"allowInsecureConnections"',
          ),
        ),
        reason: 'the flag is not read from the end-session arguments',
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

  group('Apple protocol host scoping', () {
    // While registered, the trust-all protocol is consulted by every
    // NSURLSession in the process. canInitWithRequest must therefore only
    // intercept the armed provider's host and port — and each registration
    // must arm that host, or the interception would refuse everything (fail
    // closed, but the insecure exchange would break).
    for (final (label, path) in <(String, String)>[
      ('iOS', _iosPluginPath),
      ('macOS', _macosPluginPath),
    ]) {
      group(label, () {
        test('canInitWithRequest intercepts only the armed host:port', () {
          final source = File(path).readAsStringSync();
          final body = _methodBody(
            source,
            RegExp(r'\+\s*\(BOOL\)\s*canInitWithRequest'),
          );
          expect(body, isNotNull, reason: 'canInitWithRequest moved');
          expect(
            body,
            contains('containsObject:InsecureHostKey'),
            reason:
                'the interception is not scoped to the armed providers: '
                'while registered it would trust unrelated traffic too',
          );
          expect(body, contains('request.URL.host'));
          // The key carries the port: a second TLS service on the provider's
          // host at another port must not be intercepted.
          final keyBody = _methodBody(
            source,
            RegExp(r'NSString\s*\*?\s*InsecureHostKey\(NSURL'),
          );
          expect(keyBody, isNotNull, reason: 'InsecureHostKey moved');
          expect(
            keyBody,
            contains('port'),
            reason:
                'the interception key ignores the port: every TLS service '
                'on the provider host would be trusted',
          );
        });

        test('every registration arms the host right before it', () {
          final source = File(path).readAsStringSync();
          final registrations = _protocolRegistration.allMatches(source).length;
          expect(registrations, greaterThan(0));
          final armed = RegExp(
            r'armForIssuer:[^;]*;\s*\[\s*NSURLProtocol\s+registerClass:',
            dotAll: true,
          ).allMatches(source).length;
          expect(
            armed,
            registrations,
            reason:
                'a registration without arming trusts nothing: the exchange '
                'itself would fail, or a stale host from another exchange '
                'would be trusted',
          );
          // Arming must sit behind the flag like the registration itself.
          final scanner = GuardScanner(source);
          final unguarded = scanner.unguarded(
            RegExp(r'\[\s*InsecureURLProtocol\s+armForIssuer:'),
            'allowInsecureConnections',
          );
          expect(
            unguarded,
            isEmpty,
            reason: 'arming ran without allowInsecureConnections',
          );
        });

        test(
          'arming resolves the provider from the serviceConfiguration too',
          () {
            // The app passes serviceConfiguration and leaves issuer and
            // discoveryUrl nil: an arming path that only read those two
            // would arm nothing, and the insecure exchange itself would
            // fail its certificate check.
            final source = File(path).readAsStringSync();
            final body = _methodBody(
              source,
              RegExp(r'armForIssuer:\(NSString \*\)issuer'),
            );
            expect(body, isNotNull, reason: 'armForIssuer moved');
            expect(
              body,
              contains('tokenEndpoint'),
              reason:
                  'arming ignores the serviceConfiguration endpoints: the '
                  'app passes those, so the host would arm nil',
            );
            expect(body, contains('authorizationEndpoint'));
          },
        );
      });
    }
  });
}
