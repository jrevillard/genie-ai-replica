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
