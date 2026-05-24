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
