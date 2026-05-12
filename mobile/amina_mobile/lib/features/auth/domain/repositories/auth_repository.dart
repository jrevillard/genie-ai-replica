import '../entities/session_status.dart';
import '../entities/user.dart';

abstract class AuthRepository {
  Future<User> login(String email, String password, {bool rememberMe});
  Future<User> register({
    required String name,
    required String email,
    required String password,
    String phone = '',
    int age = 0,
    String gender = '',
    String region = '',
    List<String> conditions = const [],
  });
  Future<void> logout();
  Future<String?> sendPasswordReset(String email);
  Future<void> confirmPasswordReset({required String token, required String newPassword});
  Future<SessionStatus> getSession();
}
