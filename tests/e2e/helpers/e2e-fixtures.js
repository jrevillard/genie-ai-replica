/**
 * The E2E venue fixtures, in one place.
 *
 * The specs log in as them (username + password), and the provisioning
 * script creates them (email + realm roles). Every venue provisions them
 * through tests/e2e/provision-e2e-fixtures.js — the CI e2e job and the
 * Phase 0 procedure in docs/e2e-tests/00-clean-start.md — so a credential
 * change is one edit, not one per venue.
 */
const E2E_FIXTURES = [
  {
    // The primary login user (loginViaUI's default). Carries the admin
    // realm role: the documents suites drive ADMIN_ONLY surfaces on the
    // document-repository — a plain user's upload is 403 by design.
    username: 'testuser',
    email: 'testuser@e2e.test',
    firstName: 'Test',
    lastName: 'User',
    password: 'TestPass123!',
    realmRoles: ['admin'],
  },
  {
    // The documents/admin-surface login (the same admin role, a distinct
    // account so the primary user's data stays out of the admin suites).
    username: 'testadmin',
    email: 'testadmin@e2e.test',
    firstName: 'Test',
    lastName: 'Admin',
    password: 'TestAdmin123!',
    realmRoles: ['admin'],
  },
  {
    // No realm role: the non-admin half of the requireAdmin contract.
    username: 'testplain',
    email: 'testplain@e2e.test',
    firstName: 'Test',
    lastName: 'Plain',
    password: 'TestPlain123!',
  },
];

module.exports = { E2E_FIXTURES };
