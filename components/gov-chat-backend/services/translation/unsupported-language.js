'use strict';

const { ValidationError } = require('../../middleware/errors');

/**
 * A language the loaded backend does not know.
 *
 * The language arrives in the request body, so it is caller-controlled: an
 * unsupported one is a bad request (HTTP 400), not a server error. The
 * message names the side that was refused ("target" / "source") and never the
 * caller's value, so nothing a caller wrote is echoed back into the response
 * or into the logs.
 *
 * It is a `ValidationError` so the status code lives with the error: a route
 * that hands it to the error middleware answers 400 without knowing the
 * number, and a route that answers it itself cannot answer it with another.
 */
class UnsupportedLanguageError extends ValidationError {
  constructor(side) {
    super(`Unsupported ${side} language`);
    this.code = 'UNSUPPORTED_LANGUAGE';
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

/**
 * The body a refused language is answered with.
 *
 * The message names the side that was refused and never the value the caller
 * sent: a value that came back in the answer could be handed on to a model.
 * The code says the request was refused — not that it failed — so the client
 * can tell the two apart without reading the message.
 *
 * Every route that refuses a language answers with this body: one shape, so
 * a client parses one thing.
 *
 * @param {Error} error - The refusal.
 * @returns {{message: string, code: string}} The body to answer with.
 */
function unsupportedLanguageBody(error) {
  return { message: error.message, code: error.code };
}

module.exports = { UnsupportedLanguageError, isUnsupportedLanguage, unsupportedLanguageBody };
