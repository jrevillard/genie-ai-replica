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

import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../domain/entities/auth_exception.dart';
import '../../domain/entities/session_status.dart';
import '../../domain/entities/user.dart';
import '../../domain/repositories/auth_repository.dart';
import '../datasources/auth_local_datasource.dart';
import '../datasources/auth_remote_datasource.dart';

class AuthRepositoryImpl implements AuthRepository {
  const AuthRepositoryImpl(this._remote, this._local);

  final AuthRemoteDatasource _remote;
  final AuthLocalDatasource _local;

  @override
  Future<User> login(
    String email,
    String password, {
    bool rememberMe = false,
  }) async {
    try {
      final user = await _remote.login(email, password);
      await _local.saveTokens(
        accessToken: user.accessToken,
        sessionId: user.sessionId,
        email: user.email,
        name: user.name,
      );
      if (rememberMe) {
        await _local.saveRememberMe(value: true);
      }
      return user;
    } catch (e) {
      throw AuthException(e.toString().replaceFirst('Exception: ', ''));
    }
  }

  @override
  Future<User> register({
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
      final user = await _remote.register(
        name:       name,
        email:      email,
        password:   password,
        phone:      phone,
        age:        age,
        gender:     gender,
        region:     region,
        conditions: conditions,
      );
      await _local.saveTokens(
        accessToken: user.accessToken,
        sessionId:   user.sessionId,
        email:       user.email,
        name:        user.name,
      );
      return user;
    } catch (e) {
      throw AuthException(e.toString().replaceFirst('Exception: ', ''));
    }
  }

  @override
  Future<void> logout() => _local.clearSession();

  @override
  Future<String?> sendPasswordReset(String email) async {
    try {
      return await _remote.sendPasswordReset(email);
    } catch (e) {
      throw AuthException(e.toString().replaceFirst('Exception: ', ''));
    }
  }

  @override
  Future<void> confirmPasswordReset({
    required String token,
    required String newPassword,
  }) async {
    try {
      await _remote.confirmPasswordReset(token: token, newPassword: newPassword);
    } catch (e) {
      throw AuthException(e.toString().replaceFirst('Exception: ', ''));
    }
  }

  @override
  Future<SessionStatus> getSession() async {
    final hasSession = await _local.hasSession();
    final appMode = await _local.loadAppMode();
    return SessionStatus(hasSession: hasSession, appMode: appMode);
  }
}

final authRepositoryProvider = Provider<AuthRepository>(
  (ref) => AuthRepositoryImpl(
    ref.read(authRemoteDatasourceProvider),
    ref.read(authLocalDatasourceProvider),
  ),
);
