// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
const { test, expect } = require('@playwright/test');
const { execFileSync } = require('child_process');
const path = require('path');

/**
 * Unit spec for the gate script's own env handling.
 *
 * The gate is a thin runner — the posture assertion lives in the tested
 * helper — but its env parsing is the run's last line of defense, and
 * both failure shapes here were real review findings (#1846): a value
 * parsing to no realm used to green an UNCHECKED venue (the empty loop
 * exited 0), and the pre-rename pair variables used to degrade silently
 * into the default sweep. Both paths exit before any venue call, so the
 * spec spawns the real script — no venue, no credentials, no browser.
 */
const script = path.join(__dirname, 'check-ropc-posture.js');

const runGate = (extraEnv) => {
  const env = { ...process.env };
  // A credential left in the driver's shell must not change which
  // failure the child reaches. ADMIN_TOKEN is the documented password
  // bypass (helpers/auth reads it FIRST) — a token here would send the
  // child to the venue instead of the credential error.
  delete env.KEYCLOAK_ADMIN_PASSWORD;
  delete env.ADMIN_TOKEN;
  delete env.ROPC_POSTURE_REALM;
  delete env.ROPC_POSTURE_CLIENT;
  delete env.ROPC_POSTURE_REALMS;
  Object.assign(env, extraEnv);
  let stderr = '';
  let code = 0;
  try {
    execFileSync(process.execPath, [script], {
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch (e) {
    stderr = String(e.stderr || '');
    code = e.status;
  }
  return { stderr, code };
};

test.describe('the posture gate refuses to green an unchecked venue', () => {
  test('a ROPC_POSTURE_REALMS parsing to no realm exits 1 with the remedy', () => {
    const { stderr, code } = runGate({ ROPC_POSTURE_REALMS: ' , ' });
    // The vacuous pass is the failure class: zero realms swept would
    // otherwise read as a clean verdict.
    expect(code).toBe(1);
    expect(stderr).toContain('parsed to no realm');
    expect(stderr).toContain('refusing to green an unchecked venue');
  });

  test('the pre-rename pair variables warn instead of degrading silently', () => {
    const { stderr } = runGate({ ROPC_POSTURE_REALM: 'genie', ROPC_POSTURE_CLIENT: 'genie-app' });
    // The warning names the rename and the replacement — a caller still
    // carrying the old pair must be able to diagnose from the message.
    expect(stderr).toContain('no longer read');
    expect(stderr).toContain('ROPC_POSTURE_REALMS');
  });

  test('clean env reaches the credential check, not a realm error', () => {
    // The default sweep is 'genie': with the realm parsing passed, the
    // first thing the gate cannot do here is fetch the admin token —
    // the credential error is the proof the env layer let a good
    // configuration through to the venue call.
    const { stderr } = runGate({});
    expect(stderr).toContain('KEYCLOAK_ADMIN_PASSWORD');
    expect(stderr).not.toContain('parsed to no realm');
    expect(stderr).not.toContain('no longer read');
    // And it got no further than the credential check: a venue call's
    // verdict names the client list it could not read — none may appear.
    expect(stderr).not.toContain('client list');
  });
});
