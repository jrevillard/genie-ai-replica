import '../entities/auth_exception.dart';
import '../repositories/auth_repository.dart';

class SendPasswordResetUsecase {
  const SendPasswordResetUsecase(this._repository);

  final AuthRepository _repository;

  static final _emailRx = RegExp(r'^[\w.+-]+@[\w-]+\.[a-zA-Z]{2,}$');

  Future<String?> call(String email) async {
    if (email.trim().isEmpty) throw const AuthException('Email is required.');
    if (!_emailRx.hasMatch(email.trim())) {
      throw const AuthException('Enter a valid email address.');
    }

    return _repository.sendPasswordReset(email.trim());
  }
}
