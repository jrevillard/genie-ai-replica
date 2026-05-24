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

import '../entities/auth_exception.dart';
import '../entities/user.dart';
import '../repositories/auth_repository.dart';

class LoginUsecase {
  const LoginUsecase(this._repository);

  final AuthRepository _repository;

  static final _emailRx = RegExp(r'^[\w.+-]+@[\w-]+\.[a-zA-Z]{2,}$');

  Future<User> call(
    String email,
    String password, {
    bool rememberMe = false,
  }) async {
    if (email.trim().isEmpty) throw const AuthException('Email is required.');
    if (!_emailRx.hasMatch(email.trim())) {
      throw const AuthException('Enter a valid email address.');
    }
    if (password.isEmpty) throw const AuthException('Password is required.');
    if (password.length < 6) {
      throw const AuthException('Password must be at least 6 characters.');
    }

    return _repository.login(email.trim(), password, rememberMe: rememberMe);
  }
}
