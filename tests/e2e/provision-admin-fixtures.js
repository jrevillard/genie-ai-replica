#!/usr/bin/env node
/**
 * Provision the admin-surface E2E fixtures (testadmin, testplain).
 *
 * Both fixtures are needed by tests/e2e/admin/: an admin-role login and
 * a role-less one (the backend gate answers 403 for the latter). The
 * helper converges an existing account (password reset, fixture-health
 * check, role assignment), so the script is safe to re-run.
 *
 * Usage (from the repository root):
 *   ADMIN_TOKEN=<master admin token> BASE_URL=<edge> node tests/e2e/provision-admin-fixtures.js
 * or, without a token:
 *   KEYCLOAK_ADMIN_PASSWORD=<password> BASE_URL=<edge> node tests/e2e/provision-admin-fixtures.js
 *
 * BASE_URL points at the stack's edge (defaults to https://localhost; the
 * k8s dev cluster is https://genieai.local:4443). The helper scripts
 * resolve @playwright/test from the root node_modules — run `npm install`
 * at the repository root first.
 */
const { ADMIN_FIXTURES } = require('./helpers/admin-fixtures');
const { ensureUser, removeRealmRoles } = require('./helpers/keycloak-admin');
const { getAdminToken } = require('./helpers/auth');

const REALM = 'genie';

// The admin-granting role the non-admin fixture must NOT carry: the
// backend gate (requireAdmin) reads the realm role, so a fixture that
// kept it would answer 200 where the spec expects 403.
const ADMIN_ROLE = 'admin';

(async () => {
  const adminToken = process.env.ADMIN_TOKEN || (await getAdminToken());
  // Sequential: both fixtures live in the same realm, and a failure must
  // not leave one half-provisioned behind a process exit.
  for (const fixture of ADMIN_FIXTURES) {
    const userId = await ensureUser(adminToken, REALM, fixture);
    if (!fixture.realmRoles || fixture.realmRoles.length === 0) {
      // The role-less fixture: "nothing was assigned" is not "carries
      // none" — a role granted once (by hand, or by an earlier fixture
      // revision) would silently turn the non-admin half of the authz
      // spec into an admin session.
      const removed = await removeRealmRoles(adminToken, REALM, userId, [ADMIN_ROLE]);
      if (removed.length > 0) {
        console.log(`${fixture.username}: removed the drifted role(s) ${removed.join(', ')}`);
      }
    }
  }
  console.log(`admin fixtures ready: ${ADMIN_FIXTURES.map((f) => f.username).join(', ')}`);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
