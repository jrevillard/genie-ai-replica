#!/usr/bin/env node
/**
 * Provision the E2E venue fixtures (testuser, testadmin, testplain).
 *
 * testuser is the primary login user (the chat suites); testadmin
 * serves the admin surface (an admin-role login) and testplain the
 * role-less one (the backend gate answers 403 for it). The helper
 * converges an existing account (password reset, fixture-health check,
 * role assignment, and the admin realm role removed from any fixture
 * that does not declare it), so the script is safe to re-run.
 *
 * Usage (from the repository root):
 *   ADMIN_TOKEN=<master admin token> BASE_URL=<edge> node tests/e2e/provision-e2e-fixtures.js
 * or, without a token:
 *   KEYCLOAK_ADMIN_PASSWORD=<password> BASE_URL=<edge> node tests/e2e/provision-e2e-fixtures.js
 *
 * BASE_URL points at the stack's edge (defaults to https://localhost; the
 * k8s dev cluster is https://genieai.local:4443). The helper scripts
 * resolve @playwright/test from the root node_modules — run `npm install`
 * at the repository root first.
 */
const { E2E_FIXTURES } = require('./helpers/e2e-fixtures');
const { ensureUser, removeRealmRoles, effectiveRealmRoles } = require('./helpers/keycloak-admin');
const { getAdminToken } = require('./helpers/auth');

const REALM = 'genie';

// The admin-granting role a fixture must not carry unless it declares
// it: the backend gate (requireAdmin) reads the realm role, so a fixture
// that kept an undeclared admin role would answer 200 where the specs
// expect 403 (or hold a grant no consumer justifies — #1402).
const ADMIN_ROLE = 'admin';

(async () => {
  const adminToken = process.env.ADMIN_TOKEN || (await getAdminToken());
  // Sequential: the fixtures live in the same realm, and a failure must
  // not leave one half-provisioned behind a process exit.
  for (const fixture of E2E_FIXTURES) {
    const userId = await ensureUser(adminToken, REALM, fixture);
    if (!(fixture.realmRoles || []).includes(ADMIN_ROLE)) {
      // "Nothing was assigned" is not "carries none" — a role granted
      // once (by hand, or by an earlier fixture revision, e.g. testuser's
      // removed parity admin role) must be stripped here: convergence
      // never happens on its own for a role-carrying account.
      // The EFFECTIVE roles — the direct mappings plus the composites they
      // pull in (the realm's default role is one of them). Removing a
      // direct mapping cannot take away a role the realm's default
      // composite or a group grants, so the invariant is ASSERTED, not
      // assumed.
      const before = await effectiveRealmRoles(adminToken, REALM, userId);
      if (before.includes(ADMIN_ROLE)) {
        const removed = await removeRealmRoles(adminToken, REALM, userId, [ADMIN_ROLE]);
        console.log(
          `${fixture.username}: removed the drifted ${ADMIN_ROLE} role mapping (${removed.join(', ') || 'none accepted'})`
        );
      }
      const effective = await effectiveRealmRoles(adminToken, REALM, userId);
      if (effective.includes(ADMIN_ROLE)) {
        throw new Error(
          `${fixture.username} still holds the ${ADMIN_ROLE} realm role (effective roles: ${effective.join(', ')}) — ` +
            'the realm default role or a group grants it; the non-admin half of the admin spec needs a role-less account'
        );
      }
    }
  }
  console.log(`e2e fixtures ready: ${E2E_FIXTURES.map((f) => f.username).join(', ')}`);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
