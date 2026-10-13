import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_appauth/flutter_appauth.dart';
import 'package:genie_ai_mobile/services/auth/app_auth.dart';

void main() {
  group('AppAuth', () {
    test('is an abstract interface type', () {
      // Verify FlutterAppAuthAdapter can be assigned to AppAuth
      final AppAuth adapter = FlutterAppAuthAdapter();
      expect(adapter, isNotNull);
      expect(adapter, isA<AppAuth>());
    });
  });

  group('FlutterAppAuthAdapter', () {
    test('implements AppAuth', () {
      final adapter = FlutterAppAuthAdapter();
      expect(adapter, isA<AppAuth>());
    });

    test('uses provided FlutterAppAuth instance', () {
      final mockAppAuth = FlutterAppAuth();
      final adapter = FlutterAppAuthAdapter(mockAppAuth);
      expect(adapter, isA<AppAuth>());
    });

    test('creates default FlutterAppAuth when none provided', () {
      final adapter = FlutterAppAuthAdapter();
      expect(adapter, isNotNull);
    });

    test('has authorizeAndExchangeCode method', () {
      final adapter = FlutterAppAuthAdapter();
      expect(adapter.authorizeAndExchangeCode, isA<Function>());
    });

    test('has token method', () {
      final adapter = FlutterAppAuthAdapter();
      expect(adapter.token, isA<Function>());
    });

    test('const constructor works', () {
      const adapter = FlutterAppAuthAdapter();
      expect(adapter, isA<FlutterAppAuthAdapter>());
    });
  });

  group('AuthorizationTokenRequest', () {
    test('can be constructed with required fields', () {
      final request = AuthorizationTokenRequest(
        'clientId',
        'redirectUri',
        discoveryUrl: 'https://example.com/.well-known/openid-configuration',
      );
      expect(request.clientId, 'clientId');
      expect(request.redirectUrl, 'redirectUri');
    });
  });

  group('TokenRequest', () {
    test('can be constructed with required fields', () {
      final request = TokenRequest(
        'clientId',
        'redirectUri',
        discoveryUrl: 'https://example.com/.well-known/openid-configuration',
        refreshToken: 'refreshToken123',
      );
      expect(request.clientId, 'clientId');
      expect(request.redirectUrl, 'redirectUri');
    });
  });
}
