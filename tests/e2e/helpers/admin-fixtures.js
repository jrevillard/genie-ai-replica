/**
 * The admin-surface E2E fixtures, in one place.
 *
 * The specs log in as them (username + password), and the provisioning
 * script creates them (email + realm roles). Every venue provisions them
 * through tests/e2e/provision-admin-fixtures.js — the CI e2e job and the
 * Phase 0 procedure in docs/e2e-tests/00-clean-start.md — so a credential
 * change is one edit, not one per venue.
 */
const ADMIN_FIXTURES = [
  {
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

module.exports = { ADMIN_FIXTURES };
