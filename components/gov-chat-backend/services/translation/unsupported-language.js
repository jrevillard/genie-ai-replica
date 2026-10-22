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

/**
 * Tells whether an error is the refusal of a language.
 *
 * The check accepts the code as well as the class: the error crosses a
 * module boundary (a service throws it, a route reads it), and a code that
 * survived the crossing still says what happened.
 *
 * @param {*} error - The error to classify.
 * @returns {boolean} True when the error is a refused language.
 */
function isUnsupportedLanguage(error) {
  return error instanceof UnsupportedLanguageError || error?.code === 'UNSUPPORTED_LANGUAGE';
}

module.exports = { UnsupportedLanguageError, isUnsupportedLanguage };
