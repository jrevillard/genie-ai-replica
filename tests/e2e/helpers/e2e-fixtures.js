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
    // realm role in parity with the deleted inline CI assignment; no Playwright
    // spec or docs phase exercises it (the documents suites authenticate as
    // testadmin) — see #1402 before removing or relying on it.
    username: 'testuser',
    email: 'testuser@e2e.test',
    firstName: 'Test',
    lastName: 'User',
    password: 'TestPass123!',
    realmRoles: ['admin']
  },
  {
    // The documents/admin-surface login. Carries the admin realm role: the
    // documents suites drive ADMIN_ONLY surfaces on the document-repository —
    // a plain user's upload is 403 by design.
    username: 'testadmin',
    email: 'testadmin@e2e.test',
    firstName: 'Test',
    lastName: 'Admin',
    password: 'TestAdmin123!',
    realmRoles: ['admin']
  },
  {
    // No realm role: the non-admin half of the requireAdmin contract.
    username: 'testplain',
    email: 'testplain@e2e.test',
    firstName: 'Test',
    lastName: 'Plain',
    password: 'TestPlain123!'
  }
];

/**
 * The login credentials of a venue fixture.
 * @param {string} username - The fixture username
 * @returns {{username: string, password: string}}
 */
function credentialsOf(username) {
  const fixture = E2E_FIXTURES.find((f) => f.username === username);
  if (!fixture) {
    throw new Error(`Unknown E2E fixture: ${username}`);
  }
  return { username: fixture.username, password: fixture.password };
}

const TEST_USER = credentialsOf('testuser');
const TEST_ADMIN_USER = credentialsOf('testadmin');
const TEST_PLAIN_USER = credentialsOf('testplain');

module.exports = { E2E_FIXTURES, credentialsOf, TEST_USER, TEST_ADMIN_USER, TEST_PLAIN_USER };
