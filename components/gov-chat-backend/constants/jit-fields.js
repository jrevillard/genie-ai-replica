// Ported from upstream v2.0.1 components/gov-chat-backend/constants/jit-fields.js (Epic A5).
// Upstream: opensource.unicc.org/un/itu/genie-ai @ upstream-v2.0.1.
// A6 deltas: + 'status', 'role' (users cannot self-approve or self-promote via
// profile writes — only admin routes write them); the pending-email-change entry
// dropped with its dead machinery (A6 strip).

/**
 * JIT (Just-In-Time) provisioning field constants.
 *
 * These fields are managed by Keycloak during authentication and should NOT
 * be written directly to ArangoDB by user-facing profile update endpoints.
 *
 * JIT_FORWARD_FIELDS: Fields that should be forwarded to Keycloak Account API
 *   when a user updates their profile (e.g. email, firstName, lastName).
 *
 * JIT_PROTECTED_FIELDS: All JIT-managed fields that are stripped from ArangoDB
 *   writes. This is a superset of JIT_FORWARD_FIELDS and includes system-managed
 *   fields like iss, sub, roles, timestamps, etc.
 */

// Fields forwarded to Keycloak Account API on profile update
const JIT_FORWARD_FIELDS = ['email', 'firstName', 'lastName', 'username'];

// All JIT-provisioned fields that must not be written to ArangoDB
const JIT_PROTECTED_FIELDS = [
  'email',
  'firstName',
  'lastName',
  'username',
  'name',
  'roles',
  'enabled',
  'disabled',
  'active',
  'deleted',
  'iss',
  'iss_sub',
  'sub',
  'createdAt',
  'updatedAt',
  'emailVerified',
  'status',
  'role'
];

module.exports = { JIT_FORWARD_FIELDS, JIT_PROTECTED_FIELDS };
