'use strict';

/**
 * Shared jose mock for suites that transitively load keycloak-auth-service
 * (jose is ESM-only and cannot be required as CommonJS by Jest). Use with:
 *
 *   jest.mock('jose', () => require('../mocks/jose'));
 */
/**
 * Decode a compact JWS's protected header.
 *
 * The verifier reads the token's own header with jose's decoder, so a
 * mock without it fails closed — and the symptom (the token is rejected)
 * hides the incomplete mock.
 *
 * This is STRICT: a compact JWS has three parts, the header segment is
 * canonical base64url (Node's decoder drops a trailing partial group and
 * ignores padding and whitespace, so the segment is checked by decoding
 * it and encoding it back), the bytes are valid UTF-8 (Node's decoder
 * replaces invalid sequences, jose's refuses them), and the decoded value
 * must be a plain object. It is stricter than the oldest jose build on
 * the padding and whitespace, which is the safe direction: a case that
 * production would refuse then fails here too, instead of passing for
 * the wrong reason.
 */
const decodeProtectedHeader = (token) => {
  const parts = typeof token === 'string' ? token.split('.') : [];
  if (parts.length !== 3) {
    throw new TypeError('Invalid Compact JWS');
  }
  const raw = Buffer.from(parts[0], 'base64url');
  if (raw.toString('base64url') !== parts[0]) {
    throw new TypeError('Invalid Compact JWS');
  }
  const header = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
  if (typeof header !== 'object' || header === null || Array.isArray(header)) {
    throw new TypeError('Invalid Compact JWS');
  }
  return header;
};

module.exports = {
  jwtVerify: jest.fn(),
  createRemoteJWKSet: jest.fn(),
  decodeProtectedHeader
};
