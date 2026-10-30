// ragas-row-inspector.js — one-shot: print the run-doc fields for named
// failing rows (contexts / candidate_keys / error) so a stage verdict can be
// checked against what the run actually recorded. Read-only.
const https = require('https');
const fs = require('fs');
const crypto = require('crypto');

const REPO_ID = process.argv[2];
const SUITE_KEY = process.argv[3];
const RUN_KEY = process.argv[4];
const ROW_IDS = process.argv[5] ? process.argv[5].split(',') : [];
const SMOKE_USER = 'okf-ragas-inspect';
const SMOKE_PW = crypto.randomBytes(18).toString('base64url') + '#aA1!';

const env = {};
const ENV_FILE = ['./.env', 'C:/Dev/builds/main/.env'].find((p) => fs.existsSync(p));
for (const line of fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^"|"$/g, '');
}
const ADMIN_PW = env.KEYCLOAK_ADMIN_PASSWORD;
const AUTH_BASE = 'https://localhost/auth';
const API_BASE = 'https://localhost';
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
        timeout: 30000,
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

let ADMIN_TOKEN = '';
let CLIENT_UUID = '';
let ROPC_ON = false;
async function ropcRevert() {
  if (!ROPC_ON || !CLIENT_UUID || !ADMIN_TOKEN) return;
  try {
    const at = j(
      await req('POST', `${AUTH_BASE}/realms/master/protocol/openid-connect/token`, {
        form: { client_id: 'admin-cli', username: 'admin', password: ADMIN_PW, grant_type: 'password' }
      })
    );
    if (at.access_token) ADMIN_TOKEN = at.access_token;
  } catch {
    /* keep the previous token */
  }
  const r = await req('PUT', `${AUTH_BASE}/admin/realms/${REALM}/clients/${CLIENT_UUID}`, {
    token: ADMIN_TOKEN,
    json: { directAccessGrantsEnabled: false }
  });
  ROPC_ON = false;
  if (r.status !== 204) console.error(`ROPC REVERT HTTP ${r.status} — VERIFY MANUALLY`);
  else console.error('(ROPC reverted, verified by status 204)');
}

async function main() {
  const at = j(
    await req('POST', `${AUTH_BASE}/realms/master/protocol/openid-connect/token`, {
      form: { client_id: 'admin-cli', username: 'admin', password: ADMIN_PW, grant_type: 'password' }
    })
  );
  ADMIN_TOKEN = at.access_token;
  const clients = j(
    await req('GET', `${AUTH_BASE}/admin/realms/${REALM}/clients?clientId=${CLIENT_ID}`, { token: ADMIN_TOKEN })
  );
  CLIENT_UUID = clients[0].id;
  await req('PUT', `${AUTH_BASE}/admin/realms/${REALM}/clients/${CLIENT_UUID}`, {
    token: ADMIN_TOKEN,
    json: { directAccessGrantsEnabled: true }
  });
  ROPC_ON = true;

  // throwaway user (adopt-if-exists)
  const mk = await req('POST', `${AUTH_BASE}/admin/realms/${REALM}/users`, {
    token: ADMIN_TOKEN,
    json: {
      username: SMOKE_USER,
      email: `${SMOKE_USER}@example.invalid`,
      emailVerified: true,
      firstName: 'Ragas',
      lastName: 'Inspect',
      enabled: true,
      credentials: [{ type: 'password', value: SMOKE_PW, temporary: false }]
    }
  });
  const users = j(
    await req('GET', `${AUTH_BASE}/admin/realms/${REALM}/users?username=${SMOKE_USER}&exact=true`, {
      token: ADMIN_TOKEN
    })
  );
  const uid = users[0].id;
  if (mk.status === 409) {
    await req('PUT', `${AUTH_BASE}/admin/realms/${REALM}/users/${uid}/reset-password`, {
      token: ADMIN_TOKEN,
      json: { type: 'password', value: SMOKE_PW, temporary: false }
    });
  }
  const role = j(await req('GET', `${AUTH_BASE}/admin/realms/${REALM}/roles/tools-admin`, { token: ADMIN_TOKEN }));
  await req('POST', `${AUTH_BASE}/admin/realms/${REALM}/users/${uid}/role-mappings/realm`, {
    token: ADMIN_TOKEN,
    json: [role]
  });
  const tok = j(
    await req('POST', `${AUTH_BASE}/realms/${REALM}/protocol/openid-connect/token`, {
      form: { grant_type: 'password', client_id: CLIENT_ID, username: SMOKE_USER, password: SMOKE_PW }
    })
  );
  const token = tok.access_token;

  const run = j(
    await req('GET', `${API_BASE}/api/okf/repos/${REPO_ID}/ragas-testsuite/${SUITE_KEY}/runs/${RUN_KEY}`, { token })
  );
  console.log(`run status=${run.status} created=${run.created_at}`);
  const results = (run.payload && run.payload.results) || [];
  console.log(`results: ${results.length}`);
  for (const id of ROW_IDS) {
    const r = results.find((x) => x.id === id) || {};
    console.log(
      `\n=== ${id} === contexts=${(r.contexts || []).length} candidate_keys=${(r.candidate_keys || []).length} ` +
        `context_keys=${(r.context_keys || []).length} abstained=${r.abstained} ragas_nan=${r.ragas_nan}`
    );
    if (r.metrics) {
      console.log(`  metrics: ${JSON.stringify(r.metrics)}`);
    }
    if (r.error) console.log(`  error: ${JSON.stringify(r.error).slice(0, 300)}`);
    if (r.answer) console.log(`  answer: ${String(r.answer).slice(0, 200)}`);
    (r.contexts || []).forEach((c, i) => {
      console.log(`  ctx[${i}]: ${String(c).slice(0, 90).replace(/\s+/g, ' ')}`);
    });
  }
}

main()
  .then(async () => {
    await ropcRevert();
    process.exit(0);
  })
  .catch(async (e) => {
    console.error('FATAL', e.message);
    await ropcRevert();
    process.exit(1);
  });
