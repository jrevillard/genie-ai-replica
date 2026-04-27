import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/services/auth/auth_state.dart';

void main() {
  group('AuthStatus', () {
    test('has exactly 3 values', () {
      expect(AuthStatus.values.length, 3);
      expect(AuthStatus.values, contains(AuthStatus.authenticated));
      expect(AuthStatus.values, contains(AuthStatus.unauthenticated));
      expect(AuthStatus.values, contains(AuthStatus.error));
    });
  });

  group('AuthState', () {
    test('default constructor creates unauthenticated state', () {
      const state = AuthState();
      expect(state.status, AuthStatus.unauthenticated);
      expect(state.userId, isNull);
      expect(state.displayName, isNull);
      expect(state.errorMessage, isNull);
      expect(state.retryable, isFalse);
    });

    test('equality: identical fields are equal', () {
      const a = AuthState(
        status: AuthStatus.authenticated,
        userId: 'user1',
        displayName: 'Test User',
      );
      const b = AuthState(
        status: AuthStatus.authenticated,
        userId: 'user1',
        displayName: 'Test User',
      );
      expect(a, equals(b));
      expect(a.hashCode, equals(b.hashCode));
    });

    test('equality: different fields are not equal', () {
      const a = AuthState(
        status: AuthStatus.authenticated,
        userId: 'user1',
      );
      const b = AuthState(
        status: AuthStatus.authenticated,
        userId: 'user2',
      );
      expect(a, isNot(equals(b)));
    });

    test('equality: different status is not equal', () {
      const a = AuthState(status: AuthStatus.authenticated);
      const b = AuthState(status: AuthStatus.unauthenticated);
      expect(a, isNot(equals(b)));
    });

    test('error state with retryable true', () {
      const state = AuthState.error(
        message: 'Network unreachable',
        retryable: true,
      );
      expect(state.status, AuthStatus.error);
      expect(state.errorMessage, 'Network unreachable');
      expect(state.retryable, isTrue);
      expect(state.userId, isNull);
      expect(state.displayName, isNull);
    });

    test('error state with retryable false', () {
      const state = AuthState.error(
        message: 'Session expired',
        retryable: false,
      );
      expect(state.status, AuthStatus.error);
      expect(state.errorMessage, 'Session expired');
      expect(state.retryable, isFalse);
    });

    test('error convenience constructor defaults retryable to false', () {
      const state = AuthState.error(message: 'Some error');
      expect(state.retryable, isFalse);
    });

    test('unauthenticated convenience constructor returns correct defaults', () {
      const state = AuthState.unauthenticated();
      expect(state.status, AuthStatus.unauthenticated);
      expect(state.userId, isNull);
      expect(state.displayName, isNull);
      expect(state.errorMessage, isNull);
      expect(state.retryable, isFalse);
    });

    test('authenticated convenience constructor sets fields', () {
      const state = AuthState.authenticated(
        userId: 'user1',
        displayName: 'Test User',
      );
      expect(state.status, AuthStatus.authenticated);
      expect(state.userId, 'user1');
      expect(state.displayName, 'Test User');
      expect(state.errorMessage, isNull);
      expect(state.retryable, isFalse);
    });

    test('authenticated convenience constructor without params', () {
      const state = AuthState.authenticated();
      expect(state.status, AuthStatus.authenticated);
      expect(state.userId, isNull);
      expect(state.displayName, isNull);
    });
  });
}
