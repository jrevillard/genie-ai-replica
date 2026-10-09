// One-off remediation (2026-10-09): dedup NCD's stored forbidden tags — the
// granite suggester emitted "mental-health" 5x inside one array and the
// duplicates reached the stored frontmatter (dd41684 fixes the suggester +
// adds the write-boundary dedup; this repairs the ALREADY-poisoned doc).
// Reads the live frontmatter, dedups case-insensitively (first occurrence
// wins), PATCHes back through the API (two-write path stays consistent),
// rebuilds the head. Same auth spine as restore-ncd-tags.js. Dev-only.
const https = require('https');
const fs = require('fs');
const crypto = require('crypto');

const REPO_ID = process.argv[2] || 'f043215b-cead-4af2-ad37-e675a8eec4b7';
const SMOKE_USER = 'okf-fix-' + crypto.randomBytes(3).toString('hex');
const SMOKE_PW = crypto.randomBytes(18).toString('base64url') + '#aA1!';

const env = {};
for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^"|"$/g, '');
}
const AUTH_BASE = 'https://localhost/auth';
const API_BASE = 'https://localhost';
const REALM = env.KEYCLOAK_REALM || 'genie';
const CLIENT_ID = env.KEYCLOAK_CLIENT_ID || 'genie-app';

function req(method, url, { token, form, json } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const body = json ? JSON.stringify(json) : form ? new URLSearchParams(form).toString() : null;
    const r = https.request(
      { method, hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, rejectUnauthorized: false,
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': json ? 'application/json' : 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } : {}) } },
      (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve({ status: res.statusCode, body: d })); }
    );
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}
const j = (r) => { try { return JSON.parse(r.body); } catch { return { raw: r.body.slice(0, 200) }; } };

let ADMIN_TOKEN = '', USER_TOKEN = '', CLIENT_UUID = '', USER_ID = '', ROPC_WAS = null;
async function cleanup() {
  try {
    if (ADMIN_TOKEN && CLIENT_UUID && ROPC_WAS === false)
      await req('PUT', `${AUTH_BASE}/admin/realms/${REALM}/clients/${CLIENT_UUID}`, { token: ADMIN_TOKEN, json: { directAccessGrantsEnabled: false } });
  } catch (e) { console.error('cleanup ROPC:', e.message); }
  try {
    if (ADMIN_TOKEN && USER_ID) await req('DELETE', `${AUTH_BASE}/admin/realms/${REALM}/users/${USER_ID}`, { token: ADMIN_TOKEN });
  } catch (e) { console.error('cleanup user:', e.message); }
  console.log('[cleanup] done');
}

(async () => {
  const mt = j(await req('POST', `${AUTH_BASE}/realms/master/protocol/openid-connect/token`, { form: { client_id: 'admin-cli', username: 'admin', password: env.KEYCLOAK_ADMIN_PASSWORD, grant_type: 'password' } }));
  if (!mt.access_token) throw new Error('master token failed');
  ADMIN_TOKEN = mt.access_token;
  const mk = await req('POST', `${AUTH_BASE}/admin/realms/${REALM}/users`, { token: ADMIN_TOKEN, json: { username: SMOKE_USER, email: SMOKE_USER + '@example.invalid', emailVerified: true, firstName: 'Fix', lastName: 'Harness', enabled: true, credentials: [{ type: 'password', value: SMOKE_PW, temporary: false }] } });
  if (mk.status !== 201) throw new Error('user create ' + mk.status);
  USER_ID = j(await req('GET', `${AUTH_BASE}/admin/realms/${REALM}/users?username=${SMOKE_USER}&exact=true`, { token: ADMIN_TOKEN }))[0].id;
  const role = j(await req('GET', `${AUTH_BASE}/admin/realms/${REALM}/roles/tools-admin`, { token: ADMIN_TOKEN }));
  await req('POST', `${AUTH_BASE}/admin/realms/${REALM}/users/${USER_ID}/role-mappings/realm`, { token: ADMIN_TOKEN, json: [role] });
  const clients = j(await req('GET', `${AUTH_BASE}/admin/realms/${REALM}/clients?clientId=${CLIENT_ID}`, { token: ADMIN_TOKEN }));
  CLIENT_UUID = clients[0].id;
  ROPC_WAS = !!clients[0].directAccessGrantsEnabled;
  if (!ROPC_WAS) await req('PUT', `${AUTH_BASE}/admin/realms/${REALM}/clients/${CLIENT_UUID}`, { token: ADMIN_TOKEN, json: { directAccessGrantsEnabled: true } });
  USER_TOKEN = j(await req('POST', `${AUTH_BASE}/realms/${REALM}/protocol/openid-connect/token`, { form: { grant_type: 'password', client_id: CLIENT_ID, username: SMOKE_USER, password: SMOKE_PW } })).access_token;
  if (!ROPC_WAS) { await req('PUT', `${AUTH_BASE}/admin/realms/${REALM}/clients/${CLIENT_UUID}`, { token: ADMIN_TOKEN, json: { directAccessGrantsEnabled: false } }); ROPC_WAS = false; }
  if (!USER_TOKEN) throw new Error('user token failed');
  console.log('[1] auth spine ok');

  // 2. read live, dedup, write back through the API.
  const repo = j(await req('GET', `${API_BASE}/api/okf/repos/${REPO_ID}`, { token: USER_TOKEN }));
  const src = repo.frontmatter || {};
  const arr = (v) => (Array.isArray(v) ? v : []);
  const dedup = (list) => {
    const seen = new Set();
    return list.filter((v) => {
      const k = String(v).toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };
  const before = arr(src.forbidden);
  const fm = {
    topic: dedup(arr(src.topic)),
    entity: dedup(arr(src.entity)),
    scope: typeof src.scope === 'string' ? src.scope : '',
    forbidden: dedup(before),
    summary: typeof src.summary === 'string' ? src.summary : '',
    keyword: dedup(arr(src.keyword))
  };
  console.log('[2] forbidden before: ' + JSON.stringify(before));
  const patch = await req('PATCH', `${API_BASE}/api/okf/repos/${REPO_ID}`, { token: USER_TOKEN, json: { frontmatter: fm } });
  if (patch.status !== 200) throw new Error('repair PATCH ' + patch.status + ': ' + patch.body.slice(0, 200));
  console.log('[2] forbidden after:  ' + JSON.stringify(fm.forbidden));

  // 3. verify the stored doc is clean.
  const verify = j(await req('GET', `${API_BASE}/api/okf/repos/${REPO_ID}`, { token: USER_TOKEN }));
  const now = (verify.frontmatter && verify.frontmatter.forbidden) || [];
  const dupFree = new Set(now.map((v) => String(v).toLowerCase())).size === now.length;
  console.log('[3] stored: ' + JSON.stringify(now) + ' dupFree=' + dupFree);
  if (!dupFree) throw new Error('duplicates persist after repair');

  // 4. rebuild the head so the per-tag veto vectors match the clean set.
  const reb = await req('POST', `${API_BASE}/api/okf/repos/${REPO_ID}/head/rebuild`, { token: USER_TOKEN });
  console.log('[4] head rebuild: HTTP ' + reb.status);
  console.log('== REPAIR DONE ==');
})()
  .catch((e) => { console.error('REMEDIATION ERROR:', e.message); process.exitCode = 1; })
  .finally(cleanup);
