import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/components/chat/chatbot_component.dart';
import 'package:genie_ai_mobile/services/auth/auth_interceptor.dart';

/// A failed chat stream must report WHY it failed. Previously both stream error
/// handlers hardcoded the opaque "Connection error", so a dead session and a
/// transient network blip were indistinguishable (issue #1001 / M32).
void main() {
  group('streamErrorKey', () {
    test('a dead session maps to the sign-in-again message', () {
      final error = AuthException(
        'Session expired',
        code: AuthException.sessionExpired,
      );

      expect(streamErrorKey(error), equals('auth.sessionExpired'));
    });

    test('a transient refresh failure maps to a retryable message', () {
      final error = AuthException(
        'Could not refresh the session',
        code: AuthException.transientFailure,
      );

      expect(streamErrorKey(error), equals('auth.timeout'));
    });

    test('an AuthException defaults to the session-expired message', () {
      // The default code is sessionExpired, so an unclassified auth failure is
      // treated as a dead session rather than silently retryable.
      expect(
        streamErrorKey(AuthException('boom')),
        equals('auth.sessionExpired'),
      );
    });

    test('a non-auth failure maps to the generic processing error', () {
      expect(
        streamErrorKey(Exception('socket closed')),
        equals('chatbot.processingError'),
      );
    });

    test('never returns a raw/hardcoded English message', () {
      // The regression guard for M32: whatever the failure, the result is an
      // i18n KEY (dotted, lowerCamel segments) and never prose.
      final samples = <Object>[
        AuthException('Session expired', code: AuthException.sessionExpired),
        AuthException('x', code: AuthException.transientFailure),
        AuthException('x'),
        Exception('boom'),
        StateError('boom'),
        'a raw string',
      ];

      for (final sample in samples) {
        final key = streamErrorKey(sample);
        expect(
          key,
          matches(RegExp(r'^[a-z][A-Za-z]*\.[a-zA-Z]+$')),
          reason: 'expected an i18n key for $sample, got "$key"',
        );
        expect(
          key.toLowerCase(),
          isNot(contains('connection error')),
          reason: 'the opaque "Connection error" string must never return',
        );
      }
    });
  });
}
