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
const { ADMIN_FIXTURES } = require('./helpers/fixtures');
const { ensureUser } = require('./helpers/keycloak-admin');
const { getAdminToken } = require('./helpers/auth');

const REALM = 'genie';

(async () => {
  const adminToken = process.env.ADMIN_TOKEN || (await getAdminToken());
  // The fixtures are independent of each other (distinct usernames, one
  // realm), so they are provisioned concurrently.
  await Promise.all(ADMIN_FIXTURES.map((fixture) => ensureUser(adminToken, REALM, fixture)));
  console.log(`admin fixtures ready: ${ADMIN_FIXTURES.map((f) => f.username).join(', ')}`);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
