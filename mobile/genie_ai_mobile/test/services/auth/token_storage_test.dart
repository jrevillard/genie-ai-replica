import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/services/auth/token_storage.dart';

void main() {
  late InMemoryTokenStorage storage;

  setUp(() {
    storage = InMemoryTokenStorage();
  });

  group('InMemoryTokenStorage', () {
    group('save and read tokens', () {
      test('saves and reads access token', () async {
        await storage.saveTokens(
          accessToken: 'at_123',
          idToken: 'id_456',
          refreshToken: 'rt_789',
          accessTokenExpiration: DateTime(2026, 4, 23, 15, 30),
        );

        expect(await storage.getAccessToken(), 'at_123');
      });

      test('saves and reads id token', () async {
        await storage.saveTokens(
          accessToken: 'at_123',
          idToken: 'id_456',
          refreshToken: 'rt_789',
          accessTokenExpiration: DateTime(2026, 4, 23, 15, 30),
        );

        expect(await storage.getIdToken(), 'id_456');
      });

      test('saves and reads refresh token', () async {
        await storage.saveTokens(
          accessToken: 'at_123',
          idToken: 'id_456',
          refreshToken: 'rt_789',
          accessTokenExpiration: DateTime(2026, 4, 23, 15, 30),
        );

        expect(await storage.getRefreshToken(), 'rt_789');
      });
    });

    group('getAccessTokenExpiration', () {
      test('returns correct DateTime', () async {
        final expiration = DateTime(2026, 4, 23, 15, 30);
        await storage.saveTokens(
          accessToken: 'at',
          idToken: 'id',
          refreshToken: 'rt',
          accessTokenExpiration: expiration,
        );

        final result = await storage.getAccessTokenExpiration();
        expect(result, isNotNull);
        // Compare as UTC ISO string to avoid local timezone drift
        expect(
          result!.toUtc().toIso8601String(),
          equals(expiration.toUtc().toIso8601String()),
        );
      });

      test('returns ~1 hour from now when expiresIn=3600', () async {
        final now = DateTime.now();
        await storage.saveTokens(
          accessToken: 'at',
          idToken: 'id',
          refreshToken: 'rt',
          accessTokenExpiration: now.add(const Duration(seconds: 3600)),
        );

        final result = await storage.getAccessTokenExpiration();
        expect(result, isNotNull);
        final diff = result!.difference(now);
        expect(diff.inSeconds, greaterThanOrEqualTo(3599));
        expect(diff.inSeconds, lessThanOrEqualTo(3601));
      });
    });

    group('deleteAll', () {
      test('clears all tokens', () async {
        await storage.saveTokens(
          accessToken: 'at',
          idToken: 'id',
          refreshToken: 'rt',
          accessTokenExpiration: DateTime(2026, 4, 23),
        );

        await storage.deleteAll();

        expect(await storage.getAccessToken(), isNull);
        expect(await storage.getIdToken(), isNull);
        expect(await storage.getRefreshToken(), isNull);
        expect(await storage.getAccessTokenExpiration(), isNull);
      });

      test('subsequent reads return null after deleteAll', () async {
        await storage.saveTokens(
          accessToken: 'at',
          idToken: 'id',
          refreshToken: 'rt',
          accessTokenExpiration: DateTime(2026, 4, 23),
        );
        await storage.deleteAll();

        // Multiple reads all return null
        expect(await storage.getAccessToken(), isNull);
        expect(await storage.getAccessToken(), isNull);
      });
    });

    group('getters before save', () {
      test('getAccessToken returns null before save', () async {
        expect(await storage.getAccessToken(), isNull);
      });

      test('getIdToken returns null before save', () async {
        expect(await storage.getIdToken(), isNull);
      });

      test('getRefreshToken returns null before save', () async {
        expect(await storage.getRefreshToken(), isNull);
      });

      test('getAccessTokenExpiration returns null before save', () async {
        expect(await storage.getAccessTokenExpiration(), isNull);
      });
    });
  });
}
