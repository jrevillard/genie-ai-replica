/**
 * JIT (Just-In-Time) provisioning field constants, plus the reset
 * preservation sets built from them.
 *
 * The JIT_* fields are managed by Keycloak during authentication and should
 * NOT be written directly to ArangoDB by user-facing profile update endpoints.
 *
 * JIT_FORWARD_FIELDS: Fields that should be forwarded to Keycloak Account API
 *   when a user updates their profile (e.g. email, firstName, lastName).
 *
 * JIT_PROTECTED_FIELDS: All JIT-managed fields that are stripped from ArangoDB
 *   writes. This is a superset of JIT_FORWARD_FIELDS and includes system-managed
 *   fields like iss, sub, roles, timestamps, etc.
 *
 * SYSTEM_PRESERVED_FIELDS / USER_PREFERENCE_FIELDS: the fields a destructive
 *   user-document operation (user-profile-service resetUserData) must carry
 *   over — the JIT set plus soft-delete/GDPR audit markers, and the client
 *   display/notification preference fields.
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
  'pendingEmailChange',
  // Soft-delete / GDPR audit markers — system-owned, never user-writable: a
  // self-service write of erased_key would defeat the tombstone (provisioning
  // matches the digest exactly) and forge the deleted/erased audit trail.
  'deletedAt',
  'erasedAt',
  'erased_key'
];

// Every backend-owned field a destructive user-document operation must carry
// over: the JIT-managed fields plus the soft-delete and GDPR erase audit
// markers (deletedAt, erasedAt, erased_key — all three are members of the
// strip list above, so the plain spread carries them; losing erased_key
// would let a still-valid token re-provision an erased identity, the #1432
// class). Deliberately derived from JIT_PROTECTED_FIELDS rather than listed
// independently: a field added to the strip list but missed here would let a
// reset destroy system state (the bug this set exists to prevent), while the
// reverse (preserved but not strip-relevant) is benign.
const SYSTEM_PRESERVED_FIELDS = [...JIT_PROTECTED_FIELDS];

// Client display/notification preference fields the reset must carry over.
// PUT /api/me stores them top-level on the user document (the mobile client
// persists theme, fontSize, language, emailUpdates and soundNotifications
// this way); they are the user's look-and-feel, not profile data, so a
// destructive reset keeps them — the server-side mirror of the web client's
// DISPLAY_PREF_KEYS preserve list (which keeps the same keys in localStorage).
const USER_PREFERENCE_FIELDS = ['theme', 'fontSize', 'language', 'emailUpdates', 'soundNotifications'];

// The complete set a destructive user-document operation carries over: the
// merge of the two sets above, exported so the reset iterates the same name
// the contract is described by.
const RESET_PRESERVED_FIELDS = [...SYSTEM_PRESERVED_FIELDS, ...USER_PREFERENCE_FIELDS];

// Gov-profile sections the profile-update endpoint writes onto the users
// document (user-profile-service). Single source for the writer and the GDPR
// erasure nuller (keycloak-proxy-service): a section added here is written
// AND erased — one missed copy is PII surviving account deletion.
const GOV_PROFILE_SECTIONS = [
  'personalIdentification',
  'civilRegistration',
  'addressResidency',
  'identityTravel',
  'healthMedical',
  'employment',
  'financialTax',
  'criminalLegal',
  'transportation'
];

module.exports = {
  JIT_FORWARD_FIELDS,
  JIT_PROTECTED_FIELDS,
  SYSTEM_PRESERVED_FIELDS,
  USER_PREFERENCE_FIELDS,
  RESET_PRESERVED_FIELDS,
  GOV_PROFILE_SECTIONS
};
