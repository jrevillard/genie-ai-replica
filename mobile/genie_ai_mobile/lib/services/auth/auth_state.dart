enum AuthStatus { authenticated, unauthenticated, error }

class AuthState {
  final AuthStatus status;
  final String? userId;
  final String? displayName;
  final String? errorMessage;
  final bool retryable;

  const AuthState({
    this.status = AuthStatus.unauthenticated,
    this.userId,
    this.displayName,
    this.errorMessage,
    this.retryable = false,
  });

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is AuthState &&
          runtimeType == other.runtimeType &&
          status == other.status &&
          userId == other.userId &&
          displayName == other.displayName &&
          errorMessage == other.errorMessage &&
          retryable == other.retryable;

  @override
  int get hashCode =>
      Object.hash(status, userId, displayName, errorMessage, retryable);

  @override
  String toString() =>
      'AuthState(status: $status, userId: $userId, displayName: $displayName, '
      'errorMessage: $errorMessage, retryable: $retryable)';

  const AuthState.authenticated({this.userId, this.displayName})
      : status = AuthStatus.authenticated,
        errorMessage = null,
        retryable = false;

  const AuthState.unauthenticated()
      : status = AuthStatus.unauthenticated,
        userId = null,
        displayName = null,
        errorMessage = null,
        retryable = false;

  const AuthState.error({required String message, this.retryable = false})
      : status = AuthStatus.error,
        userId = null,
        displayName = null,
        errorMessage = message;
}
