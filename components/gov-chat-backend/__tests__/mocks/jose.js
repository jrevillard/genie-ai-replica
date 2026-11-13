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
 * must be a plain object.
 *
 * It is STRICTER than every jose build in this area: production accepts a
 * segment with whitespace, with one trailing `=`, or with non-canonical
 * trailing bits, and this mock refuses them. That direction is the safe
 * one — the mocked trial path fails closed more often. The opposite is
 * not: the mock never accepts a segment production refuses (checked
 * against the shared lib's jose build; the check was a one-off review
 * probe, not a committed test).
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
  let header;
  try {
    header = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
  } catch {
    // jose raises a TypeError for a header it cannot parse.
    throw new TypeError('Invalid Token or Protected Header formatting');
  }
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
