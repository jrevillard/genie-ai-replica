// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
/**
 * The post-run ROPC posture gate (#1727).
 *
 * The venue's auth posture is part of a run's outcome: `genie/genie-app`
 * carries NO direct access grants — the realm refuses ROPC by design, and
 * a flip any script forgot to revert widens the auth surface silently
 * (a password grant becomes mintable by anyone who reads the script).
 * The posture's assertion lives in ONE place
 * (`helpers/keycloak-admin.js` → `assertDirectAccessGrantsDisabled`); this
 * runner reads the venue's own state through it and exits non-zero when
 * the posture does not hold, with the violation's remedy in the message.
 *
 * `run-local-e2e.sh` runs it AFTER the suite: a run that leaves the venue
 * wider than it found it fails, loudly — even when every spec is green.
 * The two scripts that legitimately flip the grant
 * (`data/okf/smoke-test/mint-tokens.mjs`, the rag-benchmarks anchor
 * wrapper) run against the venue this run books, and a leftover from them
 * lands here — as long as they ran on the DEFAULT pair: the anchor wrapper
 * honors EVAL_KC_REALM / EVAL_KC_CLIENT_ID, so an overridden eval set must
 * set ROPC_POSTURE_REALM / ROPC_POSTURE_CLIENT in tandem, or the gate
 * checks a pair nobody flipped and the widened surface stays open.
 *
 * Reads `BASE_URL` (through helpers/auth, the one edge definition) and
 * the Keycloak admin password the run script exports. `ROPC_POSTURE_REALM`
 * / `ROPC_POSTURE_CLIENT` name the checked pair (defaults `genie` /
 * `genie-app`) — a venue that names them differently overrides here, the
 * assertion itself stays generic.
 */
const { getAdminToken } = require('../helpers/auth');
const { assertDirectAccessGrantsDisabled } = require('../helpers/keycloak-admin');

const REALM = process.env.ROPC_POSTURE_REALM || 'genie';
const CLIENT = process.env.ROPC_POSTURE_CLIENT || 'genie-app';

(async () => {
  const token = await getAdminToken();
  await assertDirectAccessGrantsDisabled(token, REALM, CLIENT);
  console.log(`ROPC posture: ${CLIENT}@${REALM} carries no direct access grants — OK`);
})().catch((e) => {
  console.error(`ROPC posture gate FAILED: ${e.message}`);
  // Exit 1: the run wrapper maps any gate failure to ITS own code (5), so
  // this code only surfaces on a standalone run — where it must not read
  // as the run script's venue-lock contention (3).
  process.exit(1);
});
