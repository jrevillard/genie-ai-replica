/**
 * Custom error classes with HTTP status codes.
 * Services throw these instead of generic Error — route handlers
 * pass them to next(error) and the global middleware sends the
 * correct response.
 */
class AppError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
    this.name = this.constructor.name;
  }
}

class NotFoundError extends AppError {
  constructor(message = "Resource not found") {
    super(message, 404);
  }
}

class ForbiddenError extends AppError {
  constructor(message = "Access denied") {
    super(message, 403);
  }
}

class ValidationError extends AppError {
  constructor(message = "Invalid input") {
    super(message, 400);
  }
}

module.exports = { AppError, NotFoundError, ForbiddenError, ValidationError };
