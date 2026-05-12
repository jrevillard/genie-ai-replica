/// Base class for all app-level network/API exceptions.
class AppException implements Exception {
  final String message;
  const AppException(this.message);

  @override
  String toString() => message;
}

/// 401 — token missing, invalid, or expired.
class UnauthorizedException extends AppException {
  const UnauthorizedException(
      [super.message = 'Session expired. Please log in again.']);
}

/// 4xx/5xx HTTP errors that are not 401.
class ServerException extends AppException {
  final int? statusCode;
  const ServerException({this.statusCode, String message = 'Server error'})
      : super(message);
}

/// No connectivity or timeout.
class NetworkException extends AppException {
  const NetworkException(
      [super.message = 'Network error. Check your connection.']);
}
