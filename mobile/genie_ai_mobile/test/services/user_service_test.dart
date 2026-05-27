import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:openapi/api.dart';
import 'package:genie_ai_mobile/services/user_service.dart';

/// Manual mock for CurrentUserApi following existing project pattern.
class MockCurrentUserApi implements CurrentUserApi {
  final Map<String, dynamic> _config;

  MockCurrentUserApi(this._config);

  @override
  Future<http.Response> apiMeGetWithHttpInfo({String? data}) async {
    return _makeResponse('apiMeGet');
  }

  @override
  Future<http.Response> apiMePutWithHttpInfo({
    String? data,
    List<http.MultipartFile>? files,
  }) async {
    return _makeResponse('apiMePut');
  }

  @override
  Future<http.Response> apiMeDeletePostWithHttpInfo() async {
    return _makeResponse('apiMeDeletePost');
  }

  @override
  Future<http.Response> apiMeResetDataPostWithHttpInfo() async {
    return _makeResponse('apiMeResetDataPost');
  }

  http.Response _makeResponse(String method) {
    final int statusCode = _config['${method}Status'] as int? ?? 200;
    final Map<String, dynamic> body =
        _config['${method}Body'] as Map<String, dynamic>? ??
        {'id': 'user-1', 'name': 'Test User'};
    return http.Response(jsonEncode(body), statusCode);
  }

  // Unused methods — return empty responses
  @override
  dynamic noSuchMethod(Invocation invocation) => null;
}

void main() {
  group('UserService', () {
    group('getCurrentUserInfo', () {
      test('returns user map on success', () async {
        final mockApi = MockCurrentUserApi({
          'apiMeGetBody': {'id': '123', 'email': 'test@example.com'},
        });
        final service = UserService(userApi: mockApi);

        final result = await service.getCurrentUserInfo();

        expect(result['id'], '123');
        expect(result['email'], 'test@example.com');
      });

      test('throws on non-200 status', () async {
        final mockApi = MockCurrentUserApi({
          'apiMeGetStatus': 500,
          'apiMeGetBody': {'error': 'Internal Server Error'},
        });
        final service = UserService(userApi: mockApi);

        expect(
          () => service.getCurrentUserInfo(),
          throwsA(
            isA<Exception>().having(
              (e) => e.toString(),
              'message',
              contains('Failed to fetch info'),
            ),
          ),
        );
      });

      test('throws on 404 status', () async {
        final mockApi = MockCurrentUserApi({
          'apiMeGetStatus': 404,
          'apiMeGetBody': {'error': 'Not Found'},
        });
        final service = UserService(userApi: mockApi);

        expect(
          () => service.getCurrentUserInfo(),
          throwsA(
            isA<Exception>().having(
              (e) => e.toString(),
              'message',
              contains('Failed to fetch info'),
            ),
          ),
        );
      });
    });

    group('getProfile', () {
      test('returns profile map on success', () async {
        final mockApi = MockCurrentUserApi({
          'apiMeGetBody': {'id': 'u1', 'firstName': 'John', 'lastName': 'Doe'},
        });
        final service = UserService(userApi: mockApi);

        final result = await service.getProfile();

        expect(result['firstName'], 'John');
        expect(result['lastName'], 'Doe');
      });

      test('throws on non-200 status', () async {
        final mockApi = MockCurrentUserApi({
          'apiMeGetStatus': 401,
          'apiMeGetBody': {'error': 'Unauthorized'},
        });
        final service = UserService(userApi: mockApi);

        expect(
          () => service.getProfile(),
          throwsA(
            isA<Exception>().having(
              (e) => e.toString(),
              'message',
              contains('Failed to load profile'),
            ),
          ),
        );
      });
    });

    group('refreshUserData', () {
      test('completes without error', () async {
        final mockApi = MockCurrentUserApi({
          'apiMeGetBody': {'id': '123'},
        });
        final service = UserService(userApi: mockApi);

        await service.refreshUserData();
        // No exception = success
      });
    });

    group('updateAccountSettings', () {
      test('returns updated settings on success', () async {
        final mockApi = MockCurrentUserApi({
          'apiMePutBody': {'id': 'u1', 'firstName': 'Updated'},
        });
        final service = UserService(userApi: mockApi);

        final result = await service.updateAccountSettings({
          'firstName': 'Updated',
        });

        expect(result['firstName'], 'Updated');
      });

      test('throws on non-200 status', () async {
        final mockApi = MockCurrentUserApi({
          'apiMePutStatus': 400,
          'apiMePutBody': {'error': 'Bad Request'},
        });
        final service = UserService(userApi: mockApi);

        expect(
          () => service.updateAccountSettings({'invalid': 'data'}),
          throwsA(
            isA<Exception>().having(
              (e) => e.toString(),
              'message',
              contains('Failed to update account settings'),
            ),
          ),
        );
      });
    });

    group('resetUserData', () {
      test('returns response on success', () async {
        final mockApi = MockCurrentUserApi({
          'apiMeResetDataPostBody': {'message': 'Data reset successfully'},
        });
        final service = UserService(userApi: mockApi);

        final result = await service.resetUserData();

        expect(result['message'], 'Data reset successfully');
      });

      test('throws on non-200 status', () async {
        final mockApi = MockCurrentUserApi({
          'apiMeResetDataPostStatus': 403,
          'apiMeResetDataPostBody': {'error': 'Forbidden'},
        });
        final service = UserService(userApi: mockApi);

        expect(
          () => service.resetUserData(),
          throwsA(
            isA<Exception>().having(
              (e) => e.toString(),
              'message',
              contains('Failed to reset user data'),
            ),
          ),
        );
      });
    });

    group('deleteAccount', () {
      test('returns response on success', () async {
        final mockApi = MockCurrentUserApi({
          'apiMeDeletePostBody': {'message': 'Account deleted'},
        });
        final service = UserService(userApi: mockApi);

        final result = await service.deleteAccount();

        expect(result['message'], 'Account deleted');
      });

      test('throws on non-200 status', () async {
        final mockApi = MockCurrentUserApi({
          'apiMeDeletePostStatus': 500,
          'apiMeDeletePostBody': {'error': 'Server Error'},
        });
        final service = UserService(userApi: mockApi);

        expect(
          () => service.deleteAccount(),
          throwsA(
            isA<Exception>().having(
              (e) => e.toString(),
              'message',
              contains('Failed to delete account'),
            ),
          ),
        );
      });
    });

    group('error edge cases', () {
      test('getCurrentUserInfo handles empty response body', () async {
        final mockApi = MockCurrentUserApi({
          'apiMeGetBody': <String, dynamic>{},
        });
        final service = UserService(userApi: mockApi);

        final result = await service.getCurrentUserInfo();
        expect(result, isA<Map<String, dynamic>>());
      });

      test('getCurrentUserInfo throws on server error with message', () async {
        final mockApi = MockCurrentUserApi({
          'apiMeGetStatus': 500,
          'apiMeGetBody': {'error': 'Internal Server Error'},
        });
        final service = UserService(userApi: mockApi);

        expect(
          () => service.getCurrentUserInfo(),
          throwsA(
            isA<Exception>().having(
              (e) => e.toString(),
              'message',
              contains('Failed to fetch info'),
            ),
          ),
        );
      });

      test('updateAccountSettings throws on auth failure', () async {
        final mockApi = MockCurrentUserApi({
          'apiMePutStatus': 401,
          'apiMePutBody': {'error': 'Unauthorized'},
        });
        final service = UserService(userApi: mockApi);

        expect(
          () => service.updateAccountSettings({'firstName': 'X'}),
          throwsA(
            isA<Exception>().having(
              (e) => e.toString(),
              'message',
              contains('Failed to update account settings'),
            ),
          ),
        );
      });
    });
  });
}
