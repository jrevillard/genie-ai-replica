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
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import '../config/app_config.dart';
import '../providers/session_expired_provider.dart';

const _kTokenKey = 'amina_access_token';

Dio _buildDio(Ref ref) {
  final dio = Dio(
    BaseOptions(
      baseUrl: AppConfig.baseUrl,
      connectTimeout: const Duration(seconds: 10),
      receiveTimeout: const Duration(seconds: 30),
      headers: const {'Content-Type': 'application/json'},
    ),
  );

  const storage = FlutterSecureStorage();
  dio.interceptors.add(
    InterceptorsWrapper(
      onRequest: (options, handler) async {
        final token = await storage.read(key: _kTokenKey);
        if (token != null) {
          options.headers['Authorization'] = 'Bearer $token';
        }
        handler.next(options);
      },
      onError: (e, handler) async {
        if (e.response?.statusCode == 401) {
          final path = e.requestOptions.path;
          // Only force logout when auth or agent endpoints return 401 —
          // those indicate a genuinely expired/invalid token.
          // Role-gated endpoints (/caregiver/, /admin/, /cg-apply/, etc.)
          // return 401 when the user lacks the required role; the token
          // itself is still valid so we must not end the session.
          final isSessionEndpoint = path.startsWith('/api/v1/auth/') ||
              path.startsWith('/api/v1/agent/');
          if (isSessionEndpoint) {
            await storage.delete(key: _kTokenKey);
            ref.read(sessionExpiredProvider.notifier).state = true;
          }
        }
        handler.next(e);
      },
    ),
  );

  return dio;
}

final dioProvider = Provider<Dio>((ref) => _buildDio(ref));
