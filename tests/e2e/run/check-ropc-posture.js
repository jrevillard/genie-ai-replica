// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
/**
 * The post-run ROPC posture gate (#1727, swept realm-wide by #1846).
 *
 * The venue's auth posture is part of a run's outcome: the primary realm
 * refuses ROPC by design — a flip any script forgot to revert widens the
 * auth surface silently (a password grant becomes mintable by anyone who
 * reads the script). The posture's assertion lives in ONE place
 * (`helpers/keycloak-admin.js` → `assertNoDirectAccessGrants`); this
 * runner reads the venue's own state through it and exits non-zero when
 * the posture does not hold, with the violation's remedy in the message.
 *
 * `run-local-e2e.sh` runs it AFTER the suite: a run that leaves the venue
 * wider than it found it fails, loudly — even when every spec is green.
 * The gate sweeps EVERY client of the realm(s) named below, not one
 * pair: a script that flips a non-default pair (the rag-benchmarks
 * anchor wrapper honors `EVAL_KC_REALM` / `EVAL_KC_CLIENT_ID`) leaves its
 * leftover on the same realm, where the sweep sees it — no mirror
 * convention to maintain. A realm whose standing posture legitimately
 * carries ROPC (the test-only `genie2`) stays out of the sweep: it is
 * not a leftover when the grant is the provisioned state.
 *
 * Reads `BASE_URL` (through helpers/auth, the one edge definition) and
 * the Keycloak admin password the run script exports. `ROPC_POSTURE_REALMS`
 * names the swept realms, comma-separated (default `genie`) — a venue
 * whose primary realm is named differently overrides here; the assertion
 * itself stays generic.
 */
const { getAdminToken } = require('../helpers/auth');
const { assertNoDirectAccessGrants } = require('../helpers/keycloak-admin');

const REALMS = (process.env.ROPC_POSTURE_REALMS || 'genie')
  .split(',')
  .map((realm) => realm.trim())
  .filter(Boolean);

(async () => {
  const token = await getAdminToken();
  for (const realm of REALMS) {
    await assertNoDirectAccessGrants(token, realm);
    console.log(`ROPC posture: realm ${realm} carries no direct access grants — OK`);
  }
})().catch((e) => {
  console.error(`ROPC posture gate FAILED: ${e.message}`);
  // Exit 1: the run wrapper maps any gate failure to ITS own code (5), so
  // this code only surfaces on a standalone run — where it must not read
  // as the run script's venue-lock contention (3).
  process.exit(1);
});
