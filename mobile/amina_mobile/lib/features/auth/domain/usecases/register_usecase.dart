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

class RegisterUsecase {
  const RegisterUsecase(this._repository);

  final AuthRepository _repository;

  static final _emailRx = RegExp(r'^[\w.+-]+@[\w-]+\.[a-zA-Z]{2,}$');

  Future<User> call({
    required String name,
    required String email,
    required String password,
    required String confirm,
    String phone = '',
    int age = 0,
    String gender = '',
    String region = '',
    List<String> conditions = const [],
  }) async {
    if (name.trim().isEmpty) throw const AuthException('Full name is required.');
    if (email.trim().isEmpty) throw const AuthException('Email is required.');
    if (!_emailRx.hasMatch(email.trim())) {
      throw const AuthException('Enter a valid email address.');
    }
    if (password.isEmpty) throw const AuthException('Password is required.');
    if (password.length < 6) {
      throw const AuthException('Password must be at least 6 characters.');
    }
    if (password != confirm) throw const AuthException('Passwords do not match.');

    return _repository.register(
      name:       name.trim(),
      email:      email.trim(),
      password:   password,
      phone:      phone.trim(),
      age:        age,
      gender:     gender,
      region:     region,
      conditions: conditions,
    );
  }
}
