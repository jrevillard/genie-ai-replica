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
  'pendingEmailChange'
];

// Every backend-owned field a destructive user-document operation must carry
// over: the JIT-managed set plus the soft-delete and GDPR erase audit
// markers (written by userProvisioningService / keycloak-proxy-service).
const SYSTEM_PRESERVED_FIELDS = [...JIT_PROTECTED_FIELDS, 'deletedAt', 'erasedAt'];

module.exports = { JIT_FORWARD_FIELDS, JIT_PROTECTED_FIELDS, SYSTEM_PRESERVED_FIELDS };
