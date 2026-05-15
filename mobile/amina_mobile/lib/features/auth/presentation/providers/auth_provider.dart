import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../data/repositories/auth_repository_impl.dart';
import '../../domain/entities/auth_exception.dart';
import '../../domain/entities/user.dart';
import '../../domain/repositories/auth_repository.dart';
import '../../domain/usecases/get_session_usecase.dart';
import '../../domain/usecases/login_usecase.dart';
import '../../domain/usecases/logout_usecase.dart';
import '../../domain/usecases/register_usecase.dart';
import '../../domain/usecases/send_password_reset_usecase.dart';
import '../../../chats/presentation/providers/chat_messages_provider.dart';

// ─── Usecase providers ────────────────────────────────────────────────────────

final loginUsecaseProvider = Provider<LoginUsecase>(
  (ref) => LoginUsecase(ref.read(authRepositoryProvider)),
);

final registerUsecaseProvider = Provider<RegisterUsecase>(
  (ref) => RegisterUsecase(ref.read(authRepositoryProvider)),
);

final logoutUsecaseProvider = Provider<LogoutUsecase>(
  (ref) => LogoutUsecase(ref.read(authRepositoryProvider)),
);

final sendPasswordResetUsecaseProvider = Provider<SendPasswordResetUsecase>(
  (ref) => SendPasswordResetUsecase(ref.read(authRepositoryProvider)),
);

final getSessionUsecaseProvider = Provider<GetSessionUsecase>(
  (ref) => GetSessionUsecase(ref.read(authRepositoryProvider)),
);

// ─── Auth state ───────────────────────────────────────────────────────────────

enum AuthStatus { idle, loading, success, error }

class AuthState {
  final AuthStatus status;
  final String? errorMessage;
  final User? user;

  const AuthState({
    this.status = AuthStatus.idle,
    this.errorMessage,
    this.user,
  });

  AuthState copyWith({AuthStatus? status, String? errorMessage, User? user}) {
    return AuthState(
      status: status ?? this.status,
      errorMessage: errorMessage ?? this.errorMessage,
      user: user ?? this.user,
    );
  }

  bool get isLoading => status == AuthStatus.loading;
  bool get hasError => status == AuthStatus.error;
  bool get isSuccess => status == AuthStatus.success;
}

// ─── Notifier ─────────────────────────────────────────────────────────────────

class AuthNotifier extends StateNotifier<AuthState> {
  AuthNotifier({
    required LoginUsecase login,
    required RegisterUsecase register,
    required LogoutUsecase logout,
    required SendPasswordResetUsecase sendPasswordReset,
    required AuthRepository repo,
    required Ref ref,
  })  : _login = login,
        _register = register,
        _logout = logout,
        _sendPasswordReset = sendPasswordReset,
        _repo = repo,
        _ref = ref,
        super(const AuthState());

  final LoginUsecase _login;
  final RegisterUsecase _register;
  final LogoutUsecase _logout;
  final SendPasswordResetUsecase _sendPasswordReset;
  final AuthRepository _repo;
  final Ref _ref;

  Future<String?> login(
    String email,
    String password, {
    bool rememberMe = false,
  }) async {
    state = state.copyWith(status: AuthStatus.loading);
    try {
      final user = await _login(email, password, rememberMe: rememberMe);
      state = AuthState(status: AuthStatus.success, user: user);
      return null;
    } on AuthException catch (e) {
      state = state.copyWith(status: AuthStatus.error, errorMessage: e.message);
      return e.message;
    } catch (_) {
      const msg = 'Something went wrong. Please try again.';
      state = state.copyWith(status: AuthStatus.error, errorMessage: msg);
      return msg;
    }
  }

  Future<String?> register({
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
    state = state.copyWith(status: AuthStatus.loading);
    try {
      final user = await _register(
        name:       name,
        email:      email,
        password:   password,
        confirm:    confirm,
        phone:      phone,
        age:        age,
        gender:     gender,
        region:     region,
        conditions: conditions,
      );
      state = AuthState(status: AuthStatus.success, user: user);
      return null;
    } on AuthException catch (e) {
      state = state.copyWith(status: AuthStatus.error, errorMessage: e.message);
      return e.message;
    } catch (_) {
      const msg = 'Registration failed. Please try again.';
      state = state.copyWith(status: AuthStatus.error, errorMessage: msg);
      return msg;
    }
  }

  // Returns (errorMessage, devToken). devToken is non-null when the backend
  // has no SMTP configured and exposes the token directly for local testing.
  Future<(String?, String?)> sendPasswordReset(String email) async {
    state = state.copyWith(status: AuthStatus.loading);
    try {
      final devToken = await _sendPasswordReset(email);
      state = state.copyWith(status: AuthStatus.success);
      return (null, devToken);
    } on AuthException catch (e) {
      state = state.copyWith(status: AuthStatus.error, errorMessage: e.message);
      return (e.message, null);
    } catch (_) {
      const msg = 'Could not send reset email. Please try again.';
      state = state.copyWith(status: AuthStatus.error, errorMessage: msg);
      return (msg, null);
    }
  }

  Future<String?> confirmPasswordReset({
    required String token,
    required String newPassword,
  }) async {
    state = state.copyWith(status: AuthStatus.loading);
    try {
      await _repo.confirmPasswordReset(token: token, newPassword: newPassword);
      state = state.copyWith(status: AuthStatus.success);
      return null;
    } on AuthException catch (e) {
      state = state.copyWith(status: AuthStatus.error, errorMessage: e.message);
      return e.message;
    } catch (_) {
      const msg = 'Reset failed. The token may have expired.';
      state = state.copyWith(status: AuthStatus.error, errorMessage: msg);
      return msg;
    }
  }

  Future<void> logout() async {
    await _logout();
    _ref.invalidate(chatSessionsProvider);
    state = const AuthState();
  }

  void reset() => state = const AuthState();
}

// ─── Provider ─────────────────────────────────────────────────────────────────

// Not autoDisposed: survives navigation so logout() works from any screen.
final authProvider = StateNotifierProvider<AuthNotifier, AuthState>(
  (ref) => AuthNotifier(
    login: ref.read(loginUsecaseProvider),
    register: ref.read(registerUsecaseProvider),
    logout: ref.read(logoutUsecaseProvider),
    sendPasswordReset: ref.read(sendPasswordResetUsecaseProvider),
    repo: ref.read(authRepositoryProvider),
    ref: ref,
  ),
);
