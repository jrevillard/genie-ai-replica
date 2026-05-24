// This file is part of Amina Care.
//
// Amina Care is free software: you can redistribute it and/or modify
// it under the terms of the GNU Lesser General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// Amina Care is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU Lesser General Public License for more details.
//
// You should have received a copy of the GNU Lesser General Public License
// along with Amina Care. If not, see <https://www.gnu.org/licenses/>.

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/network/app_exceptions.dart';
import '../../../../core/network/dio_client.dart';
import '../models/user_model.dart';

class AuthRemoteDatasource {
  const AuthRemoteDatasource(this._dio);

  final Dio _dio;

  Future<UserModel> login(String email, String password) async {
    try {
      final response = await _dio.post<Map<String, dynamic>>(
        '/api/v1/auth/login/email',
        data: {'email': email, 'password': password},
      );
      return UserModel.fromAuthResponse(response.data!);
    } on DioException catch (e) {
      throw _mapError(e);
    }
  }

  Future<UserModel> register({
    required String name,
    required String email,
    required String password,
    String phone = '',
    int age = 0,
    String gender = '',
    String region = '',
    List<String> conditions = const [],
  }) async {
    try {
      final response = await _dio.post<Map<String, dynamic>>(
        '/api/v1/auth/signup/email',
        data: {
          'name':       name,
          'email':      email,
          'password':   password,
          'phone':      phone,
          'age':        age,
          'gender':     gender,
          'region':     region,
          'conditions': conditions,
          'language':   'english',
        },
      );
      return UserModel.fromAuthResponse(response.data!);
    } on DioException catch (e) {
      throw _mapError(e);
    }
  }

  // Returns the dev_token if the backend has no SMTP configured; null otherwise.
  Future<String?> sendPasswordReset(String email) async {
    try {
      final res = await _dio.post<Map<String, dynamic>>(
        '/api/v1/auth/password/reset/request',
        data: {'email': email},
      );
      return res.data?['dev_token'] as String?;
    } on DioException catch (e) {
      throw _mapError(e);
    }
  }

  Future<void> confirmPasswordReset({
    required String token,
    required String newPassword,
  }) async {
    try {
      final res = await _dio.post<Map<String, dynamic>>(
        '/api/v1/auth/password/reset/confirm',
        data: {'token': token, 'new_password': newPassword},
      );
      final data = res.data ?? {};
      if (data['success'] == false) {
        throw ServerException(
            message: data['error'] as String? ??
                'Reset failed. The link may have expired.');
      }
    } on DioException catch (e) {
      throw _mapError(e);
    }
  }

  // ── Error mapping ──────────────────────────────────────────────────────────

  static AppException _mapError(DioException e) {
    if (e.response?.statusCode == 401) {
      return const UnauthorizedException();
    }
    if (e.type == DioExceptionType.connectionTimeout ||
        e.type == DioExceptionType.receiveTimeout ||
        e.type == DioExceptionType.sendTimeout ||
        e.type == DioExceptionType.connectionError) {
      return const NetworkException();
    }
    final data = e.response?.data;
    final message = (data is Map<String, dynamic>)
        ? (data['detail'] as String? ?? data['message'] as String? ?? 'Server error')
        : 'Server error';
    return ServerException(statusCode: e.response?.statusCode, message: message);
  }
}

final authRemoteDatasourceProvider = Provider<AuthRemoteDatasource>(
  (ref) => AuthRemoteDatasource(ref.read(dioProvider)),
);
