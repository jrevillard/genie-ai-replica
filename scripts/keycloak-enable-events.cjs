/* eslint-disable */
/**
 * scripts/keycloak-enable-events.cjs — enable the Keycloak audit trail AT RUNTIME.
 *
 * Why this exists as a script and not just a yaml edit: `configs/keycloak/
 * genie-realm.yaml` is COPY-baked into the keycloak-config image
 * (Dockerfile.config-cli) and that service has NO volume mount, so editing the
 * yaml changes nothing until a rebuild + recreate. Until then the running realm
 * keeps every flag false and NOTHING is written to event_entity /
 * admin_event_entity — which is why the 2026-10-09 silent genie-admin deletion
 * and the 2026-10-11 mid-wizard logout were both unprovable.
 *
 * Usage (from inside the docker network, e.g. main-backend-1):
 *   docker exec -e KEYCLOAK_PASSWORD=... main-backend-1 node /tmp/keycloak-enable-events.cjs
 *
 * Env: KEYCLOAK_PASSWORD (master admin), SMOKE_AUTH (default http://keycloak:8080),
 *      KC_REALM_NAME (default genie).
 * Safe to re-run: it GETs the FULL realm representation, merges only the four
 * event fields, and PUTs it back — a partial PUT merges unpredictably.
 */
const AUTH = process.env.SMOKE_AUTH || 'http://keycloak:8080';
const REALM = process.env.KC_REALM_NAME || 'genie';
const PW = process.env.KEYCLOAK_PASSWORD || '';
if (!PW) {
  console.error('KEYCLOAK_PASSWORD is required');
  process.exit(2);
}

const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64');

(async () => {
  const tokRes = await fetch(`${AUTH}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: 'admin-cli', username: 'admin', password: PW, grant_type: 'password' }).toString()
  });
  const tok = await tokRes.json();
  if (!tok.access_token) {
    console.error('token mint failed:', JSON.stringify(tok).slice(0, 300));
    process.exit(1);
  }
  const H = { Authorization: `Bearer ${tok.access_token}`, 'Content-Type': 'application/json' };
  const url = `${AUTH}/admin/realms/${REALM}`;

  const before = await (await fetch(url, { headers: H })).json();
  console.log(
    'BEFORE eventsEnabled=%s adminEventsEnabled=%s adminEventsDetailsEnabled=%s eventsExpiration=%s',
    before.eventsEnabled,
    before.adminEventsEnabled,
    before.adminEventsDetailsEnabled,
    before.eventsExpiration
  );

  const desired = {
    ...before,
    eventsEnabled: true,
    adminEventsEnabled: true,
    adminEventsDetailsEnabled: true,
    eventsExpiration: 7776000 // 90 days, seconds
  };
  const put = await fetch(url, { method: 'PUT', headers: H, body: JSON.stringify(desired) });
  if (!put.ok) {
    console.error('PUT failed:', put.status, (await put.text()).slice(0, 400));
    process.exit(1);
  }
  console.log('PUT accepted (HTTP %s)', put.status);

  const after = await (await fetch(url, { headers: H })).json();
  console.log(
    'AFTER  eventsEnabled=%s adminEventsEnabled=%s adminEventsDetailsEnabled=%s eventsExpiration=%s',
    after.eventsEnabled,
    after.adminEventsEnabled,
    after.adminEventsDetailsEnabled,
    after.eventsExpiration
  );
  const ok =
    after.eventsEnabled === true &&
    after.adminEventsEnabled === true &&
    after.adminEventsDetailsEnabled === true &&
    Number(after.eventsExpiration) === 7776000;
  console.log(ok ? 'AUDIT TRAIL ENABLED' : 'VERIFY FAILED');
  void b;
  process.exit(ok ? 0 : 1);
})().catch((e) => {
  console.error('FATAL', e.message);
  process.exit(1);
});