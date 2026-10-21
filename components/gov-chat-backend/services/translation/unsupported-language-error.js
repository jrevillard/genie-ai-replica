'use strict';

/**
 * A language the loaded backend does not know.
 *
 * The language arrives in the request body, so it is caller-controlled: an
 * unsupported one is a bad request (HTTP 400), not a server error. The
 * message names the side that was refused ("target" / "source") and never the
 * caller's value, so nothing a caller wrote is echoed back into the response
 * or into the logs.
 */
class UnsupportedLanguageError extends Error {
  constructor(side) {
    super(`Unsupported ${side} language`);
    this.name = 'UnsupportedLanguageError';
    this.code = 'UNSUPPORTED_LANGUAGE';
    this.side = side;
  }
}

module.exports = UnsupportedLanguageError;
