// ropc-verify-revert.js — one-shot: mint a FRESH master token, check
// directAccessGrantsEnabled on the genie-app client, force it off, verify.
// Exists because the pre-hardening ragas-compare exited via its timeout path
// with a stale admin token and an unchecked PUT — the exact gap the 2026-10-23
// review fixed. Secrets are never printed.
const https = require('https');
const fs = require('fs');

const env = {};
const ENV_FILE = ['./.env', 'C:/Dev/builds/main/.env'].find((p) => fs.existsSync(p));
if (!ENV_FILE) {
  console.error('FATAL: no .env found');
  process.exit(1);
}
for (const line of fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^"|"$/g, '');
}
const ADMIN_PW = env.KEYCLOAK_ADMIN_PASSWORD;
const AUTH_BASE = 'https://localhost/auth';
const REALM = env.KEYCLOAK_REALM || 'genie';
const CLIENT_ID = env.KEYCLOAK_CLIENT_ID || 'genie-app';

function req(method, url, { token, form, json } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const body = json ? JSON.stringify(json) : form ? new URLSearchParams(form).toString() : null;
    const r = https.request(
      {
        method,
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        rejectUnauthorized: false,
        timeout: 20000,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body
            ? {
                'Content-Type': json ? 'application/json' : 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(body)
              }
            : {})
        }
      },
      (res) => {
        const chunks = [];
        res.on('error', reject);
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
      }
    );
    r.on('error', reject);
    r.on('timeout', () => r.destroy(new Error('timeout')));
    if (body) r.write(body);
    r.end();
  });
}
const j = (r) => JSON.parse(r.body.toString());

async function main() {
  const at = j(
    await req('POST', `${AUTH_BASE}/realms/master/protocol/openid-connect/token`, {
      form: { client_id: 'admin-cli', username: 'admin', password: ADMIN_PW, grant_type: 'password' }
    })
  );
  if (!at.access_token) throw new Error('no master token');
  const token = at.access_token;

  const clients = j(
    await req('GET', `${AUTH_BASE}/admin/realms/${REALM}/clients?clientId=${CLIENT_ID}`, { token })
  );
  const client = clients[0];
  if (!client) throw new Error('client not found');
  const before = client.directAccessGrantsEnabled === true;
  console.log(`${CLIENT_ID}: directAccessGrantsEnabled=${before}`);

  if (before) {
    const put = await req('PUT', `${AUTH_BASE}/admin/realms/${REALM}/clients/${client.id}`, {
      token,
      json: { directAccessGrantsEnabled: false }
    });
    console.log(`revert PUT -> HTTP ${put.status}`);
    if (put.status !== 204) throw new Error(`revert failed — VERIFY MANUALLY`);
  }

  const check = j(
    await req('GET', `${AUTH_BASE}/admin/realms/${REALM}/clients?clientId=${CLIENT_ID}`, { token })
  );
  const after = check[0] && check[0].directAccessGrantsEnabled === true;
  console.log(`verified after: directAccessGrantsEnabled=${after}`);
  if (after) {
    console.error('ROPC STILL ENABLED — manual action required');
    process.exit(1);
  }
  console.log('ROPC OFF — realm clean');
}

main().catch((e) => {
  console.error('FATAL', e.message);
  process.exit(1);
});
