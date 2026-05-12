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
