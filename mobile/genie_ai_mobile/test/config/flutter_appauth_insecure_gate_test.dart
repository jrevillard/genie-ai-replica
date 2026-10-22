import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// Guards on the vendored flutter_appauth fork.
///
/// The fork disables TLS certificate verification — Android through
/// `InsecureConnectionBuilder`, iOS through `InsecureURLProtocol`. That is
/// acceptable only because every call site that can reach it sits behind the
/// `allowInsecureConnections` flag, which the app sets from
/// `KeycloakConfig.allowInsecureConnections`.
///
/// The fork's tree is excluded from the static-analysis scan (see
/// `.gitlab-ci.yml` → `SAST_EXCLUDED_PATHS`), so no analyzer checks those
/// guards any more, and the fork is rebased onto upstream from time to time. A
/// rebase that drops the GENIE.AI patch would reinstate an unconditional
/// trust-all client in every build, and the only signal would be a TLS
/// interception in the field.
///
/// These assertions are the compensating control for that exclusion. They fail
/// when a guard disappears, when a call site is added that is not guarded, and
/// when the fork itself is removed.

const _forkRoot = 'flutter_appauth';
const _javaPluginPath =
    'flutter_appauth/flutter_appauth/android/src/main/java/'
    'io/crossingthestreams/flutterappauth/FlutterAppauthPlugin.java';
const _iosPluginPath =
    'flutter_appauth/flutter_appauth/ios/flutter_appauth/Sources/'
    'flutter_appauth/FlutterAppauthPlugin.m';

/// Every JVM source of the vendored fork, whatever file it lands in.
List<File> _jvmSources() {
  final root = Directory(_forkRoot);
  if (!root.existsSync()) {
    return const <File>[];
  }
  return root
      .listSync(recursive: true)
      .whereType<File>()
      .where((f) => f.path.endsWith('.java') || f.path.endsWith('.kt'))
      .toList();
}

void main() {
  group('vendored flutter_appauth fork', () {
    test('is vendored where the app expects it', () {
      // The guards below are read from these files; if the fork moves or
      // disappears, they must fail loudly rather than pass vacuously.
      expect(File(_javaPluginPath).existsSync(), isTrue);
      expect(File(_iosPluginPath).existsSync(), isTrue);
    });
  });

  group('Android trust-all builder', () {
    late String source;

    setUp(() {
      source = File(_javaPluginPath).readAsStringSync();
    });

    test('is only wired into a service built behind the flag', () {
      // The insecure AuthorizationService is constructed in
      // createAuthorizationServices(); the trust-all builder must be set on
      // that builder, and that builder must only be built when the flag is on.
      final guarded = RegExp(
        r'if\s*\(\s*allowInsecureConnections[^)]*\)\s*\{[^}]*'
        r'setConnectionBuilder\(\s*InsecureConnectionBuilder\.INSTANCE\s*\)',
        dotAll: true,
      );
      expect(source, matches(guarded));
    });

    test('is only selected by the flag at request time', () {
      // getConnectionBuilder() picks the connection builder per request; the
      // trust-all one must be the flagged branch of that choice.
      final guarded = RegExp(
        r'allowInsecureConnections\s*\?\s*InsecureConnectionBuilder\.INSTANCE\s*'
        r':\s*DefaultConnectionBuilder\.INSTANCE',
        dotAll: true,
      );
      expect(source, matches(guarded));
    });

    test('is referenced from no other site in the fork', () {
      // The claim is tree-wide, so the count is tree-wide: every JVM source of
      // the fork is read, not only the plugin. A rebase that adds a helper
      // using the trust-all builder would otherwise slip past a single-file
      // check — and nothing else scans this tree any more.
      final uses = <String, int>{};
      for (final file in _jvmSources()) {
        final content = file.readAsStringSync();
        final count = 'InsecureConnectionBuilder.INSTANCE'
            .allMatches(content)
            .length;
        if (count > 0) {
          uses[file.path] = count;
        }
      }
      expect(uses, <String, int>{_javaPluginPath: 2});
    });
  });

  group('iOS trust-all protocol', () {
    late String source;

    setUp(() {
      source = File(_iosPluginPath).readAsStringSync();
    });

    test('is registered and unregistered only behind the flag', () {
      // Each registration path (authorize, token exchange, end session) must
      // register the protocol inside a flag guard, and unregister it inside
      // one too — the registration is process-global, so an unguarded call
      // would affect every request in the app.
      //
      // The raw counts are anchored on the full statement so that the
      // `unregisterClass:` call is not counted as a registration.
      final register = RegExp(
        r'if\s*\(\s*requestParameters\.allowInsecureConnections\s*\)\s*\{\s*'
        r'\[NSURLProtocol registerClass:\[InsecureURLProtocol class\]\];\s*\}',
        dotAll: true,
      );
      final unregister = RegExp(
        r'if\s*\(\s*requestParameters\.allowInsecureConnections\s*\)\s*\{\s*'
        r'\[NSURLProtocol unregisterClass:\[InsecureURLProtocol class\]\];\s*\}',
        dotAll: true,
      );
      expect(
        register.allMatches(source).length,
        RegExp(
          r'\[NSURLProtocol registerClass:\[InsecureURLProtocol class\]\];',
        ).allMatches(source).length,
      );
      expect(
        unregister.allMatches(source).length,
        RegExp(
          r'\[NSURLProtocol unregisterClass:\[InsecureURLProtocol class\]\];',
        ).allMatches(source).length,
      );
      expect(register.allMatches(source), isNotEmpty);
    });

    test('implements the trust-all protocol itself', () {
      // The trust-all implementation is GENIE.AI's own code, not upstream's:
      // upstream ignores allowInsecureConnections on iOS (issue #386), so the
      // fork had to add the NSURLProtocol interception.
      expect(source, contains('InsecureURLProtocol : NSURLProtocol'));
      expect(source, contains('canInitWithRequest'));
    });
  });
}
