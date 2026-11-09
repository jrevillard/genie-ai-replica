'use strict';

/**
 * The shared scaffolding of the real-ArangoDB integration suites: the
 * lifecycle both suites need (wait for the server, recreate a throwaway
 * database, drop it) and the arangojs 8 connection config. Parameterized
 * by database name and credentials — the suites differ in nothing else.
 *
 * The lifecycle is the HARDENED variant everywhere: the server is waited
 * for (a CI service container is RUNNING long before ArangoDB serves), a
 * database left behind by an interrupted run is dropped FIRST with the
 * result checked (a drop that silently failed would surface later as an
 * opaque duplicate error), and ANY create error is fatal — the stale
 * database was just dropped, so a tolerated 'duplicate' here would mean
 * a concurrent run racing the same throwaway name, which must not be
 * won by whoever got there second.
 */

// The server wait's own budget must fit inside Jest's hook timeout, or
// the hook dies with a generic timeout and the wait's diagnostic never
// prints — each suite passes HOOK_TIMEOUT_MS as the beforeAll hook
// timeout (the hook that waits is what needs the budget; the per-test
// timeout stays at the component default).
const WAIT_BUDGET_MS = 120000;
const HOOK_TIMEOUT_MS = WAIT_BUDGET_MS * 1.5;

// The HTTP lifecycle calls carry the same credentials the driver does.
// No user (the local no-auth database): no header at all.
function authHeader(user, password) {
  if (!user) {
    return {};
  }
  return {
    Authorization: `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`
  };
}

// The service container is RUNNING long before ArangoDB answers: the CI
// job must wait for the server, not for the container. Bounded, and it
// fails loudly instead of skipping. Every poll is bounded TOO (a fetch
// with no signal can stall on the headers far past the deadline — the
// poll that hangs must not outlive the wait).
async function waitForServer(url, headers, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/_api/version`, {
        headers,
        // A negative remaining (a scheduling stall between the loop check
        // and this call) would wrap to an effectively-never timeout.
        signal: AbortSignal.timeout(Math.max(0, deadline - Date.now()))
      });
      if (response.ok) {
        return;
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`ArangoDB at ${url} did not answer within ${timeoutMs}ms: ${lastError?.message}`);
}

// The body of an HTTP lifecycle answer, guarded: an intermediate proxy
// answering 502 with an HTML page must surface as a named status, not as
// a JSON parse error that hides it. Exported: the suites' own HTTP calls
// (the collection creations) read JSON answers too.
async function jsonBody(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`HTTP ${response.status} returned a non-JSON body: ${text.slice(0, 120)}`, { cause: err });
  }
}

// The database lifecycle the suites open with: drop a database left
// behind by an interrupted run (the test must be repeatable), then
// create it fresh. Both halves checked — see the module comment.
async function recreateDatabase(url, name, headers) {
  const dropped = await fetch(`${url}/_api/database/${name}`, { method: 'DELETE', headers });
  if (!dropped.ok && dropped.status !== 404) {
    throw new Error(
      `dropping a stale ${name} failed (HTTP ${dropped.status}) — remove it by hand ` +
        `on ${url} and re-run this suite.`
    );
  }
  const created = await fetch(`${url}/_api/database`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ name })
  });
  const createdBody = await jsonBody(created);
  if (createdBody.error) {
    throw new Error(`creating ${name}: ${JSON.stringify(createdBody)}`);
  }
}

// The afterAll drop. A failure here leaves a database behind — caught
// loudly by the next run's checked stale-drop above.
async function dropDatabase(url, name, headers) {
  await fetch(`${url}/_api/database/${name}`, { method: 'DELETE', headers });
}

// The arangojs 8 connection config: auth lives in the `auth` option
// (the legacy top-level username/password keys are ignored by arangojs
// 8). No user: the config stays anonymous.
function databaseConfig(url, databaseName, user, password) {
  const config = { url, databaseName };
  if (user) {
    config.auth = { username: user, password };
  }
  return config;
}

module.exports = {
  WAIT_BUDGET_MS,
  HOOK_TIMEOUT_MS,
  authHeader,
  waitForServer,
  recreateDatabase,
  dropDatabase,
  databaseConfig,
  jsonBody
};
