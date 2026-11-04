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
// Deliberately derived from JIT_PROTECTED_FIELDS rather than listed
// independently: a field added to the strip list but missed here would let a
// reset destroy system state (the bug this set exists to prevent), while the
// reverse (preserved but not strip-relevant) is benign.
const SYSTEM_PRESERVED_FIELDS = [...JIT_PROTECTED_FIELDS, 'deletedAt', 'erasedAt'];

// Client display/notification preference fields the reset must carry over.
// PUT /api/me stores them top-level on the user document (the mobile client
// persists theme, fontSize, language, emailUpdates and soundNotifications
// this way); they are the user's look-and-feel, not profile data, so a
// destructive reset keeps them — the server-side mirror of the web client's
// DISPLAY_PREF_KEYS preserve list (which keeps the same keys in localStorage).
const USER_PREFERENCE_FIELDS = ['theme', 'fontSize', 'language', 'emailUpdates', 'soundNotifications'];

module.exports = { JIT_FORWARD_FIELDS, JIT_PROTECTED_FIELDS, SYSTEM_PRESERVED_FIELDS, USER_PREFERENCE_FIELDS };
