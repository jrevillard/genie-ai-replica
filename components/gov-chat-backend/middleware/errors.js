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
  constructor(message = 'Resource not found') {
    super(message, 404);
  }
}

class ForbiddenError extends AppError {
  constructor(message = 'Access denied') {
    super(message, 403);
  }
}

class ValidationError extends AppError {
  constructor(message = 'Invalid input') {
    super(message, 400);
  }
}

/**
 * True when the error is a typed client outcome (an AppError below 500 —
 * the 404 of an unknown id, the 400 of a malformed payload, the 403 of a
 * denied access): an expected outcome, not a fault.
 *
 * The typed hierarchy is the discriminator, NOT a bare `statusCode < 500`:
 * a driver or upstream error that happens to carry a 4xx status is a fault
 * and must keep error-grade logging. Every layer that has to tell an
 * expected outcome from a fault grades with this one function, so the
 * layers cannot drift apart.
 *
 * @param {Error|Object} error - The caught error.
 * @returns {Boolean} True when the error is an expected client outcome.
 */
function isClientError(error) {
  return error instanceof AppError && error.statusCode < 500;
}

module.exports = { AppError, NotFoundError, ForbiddenError, ValidationError, isClientError };
