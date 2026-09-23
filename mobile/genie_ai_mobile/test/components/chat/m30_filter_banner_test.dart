/// M30 — zero-doc retrieval is ungrounded AND a filter was active at the time
/// of the request. The user must be able to see WHY the answer was
/// generated without library grounding, otherwise it looks like a normal
/// confident answer and they think the KB doesn't have the content.
///
/// The banner is rendered inside the assistant message column. Full widget
/// render needs the AppAuth/Keycloak providers in scope (heavy scaffolding),
/// so this test pins the i18n key in the two user-facing locales (en/es)
/// per the project's EN/ES selector rule.
library;

import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

Map<String, dynamic> _readLocaleAsMap(String path) {
  final raw = File(path).readAsStringSync();
  // Locale files are `const Map<String, dynamic> xxLocale = {...};`.
  // Strip the `const ... =` prefix and the trailing `;`, then wrap the
  // remainder as a string and re-parse via Dart at runtime is overkill —
  // read the file as raw text and assert on substring presence instead.
  return {'_raw': raw};
}

bool _hasKey(String raw, String key) {
  // Match "  \"key\":" with optional whitespace, then a non-empty string.
  final pattern = RegExp('"${RegExp.escape(key)}"\\s*:\\s*"');
  return pattern.hasMatch(raw);
}

void main() {
  group('M30: noDocsMatchingFilter i18n key', () {
    test('exists in en.dart', () {
      final raw = File('lib/i18n/locales/en.dart').readAsStringSync();
      expect(_hasKey(raw, 'noDocsMatchingFilter'), isTrue);
    });

    test('exists in es.dart with the same key', () {
      final raw = File('lib/i18n/locales/es.dart').readAsStringSync();
      expect(_hasKey(raw, 'noDocsMatchingFilter'), isTrue);
    });
  });

  // _readLocaleAsMap is referenced to keep the import-driven linter quiet
  // for any future test that needs the parsed map; suppressing it here is
  // intentional and will be removed when M30 grows.
  // ignore: unused_local_variable
  final _ = _readLocaleAsMap;
}
