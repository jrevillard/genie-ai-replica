// One-off remediation (2026-10-09): restore NCD's forbidden tags to the
// curator's original 5 (the 1-8c teaching-loop cycle added 10 poisoned tags
// — 6 of which forbid the repo's own subject matter), rebuild the head,
// re-run the poisoned suite, and print the recovered baseline. Same auth
// spine as smoke-1-8c.js. Dev-only harness.
const https = require('https');
const fs = require('fs');
const crypto = require('crypto');

const REPO_ID = 'f043215b-cead-4af2-ad37-e675a8eec4b7';
const SUITE_KEY = process.argv[2] || 's1791540006723-1aeba6';
const RESTORE = ['mental-health', 'nutrition', 'exercise', 'genetics', 'epidemiology'];
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

  // 2. restore: the UI's 6-field shape (the doc's _approved carries legacy
  // entries that cannot pass the validator — every UI save drops them; here
  // we do the same, swapping forbidden back to the curator's 5).
  const repo = j(await req('GET', `${API_BASE}/api/okf/repos/${REPO_ID}`, { token: USER_TOKEN }));
  const src = repo.frontmatter || {};
  const arr = (v) => (Array.isArray(v) ? v : []);
  const fm = {
    topic: arr(src.topic),
    entity: arr(src.entity),
    scope: typeof src.scope === 'string' ? src.scope : '',
    forbidden: RESTORE,
    summary: typeof src.summary === 'string' ? src.summary : '',
    keyword: arr(src.keyword)
  };
  const patch = await req('PATCH', `${API_BASE}/api/okf/repos/${REPO_ID}`, { token: USER_TOKEN, json: { frontmatter: fm } });
  if (patch.status !== 200) throw new Error('restore PATCH ' + patch.status + ': ' + patch.body.slice(0, 200));
  console.log('[2] forbidden restored to ' + RESTORE.length + ' curator tags');

  // 3. rebuild head
  const reb = await req('POST', `${API_BASE}/api/okf/repos/${REPO_ID}/head/rebuild`, { token: USER_TOKEN });
  console.log('[3] head rebuild: HTTP ' + reb.status);

  // 4. re-run the poisoned suite
  const run = j(await req('POST', `${API_BASE}/api/okf/repos/${REPO_ID}/routing-testsuite/${SUITE_KEY}/run`, { token: USER_TOKEN }));
  const s = run.payload && run.payload.summary;
  if (!s) throw new Error('run failed: ' + JSON.stringify(run).slice(0, 200));
  console.log(`[4] suite re-run: positives ${s.positive_passed}/${s.positive_total}, negatives ${s.negative_passed}/${s.negative_total}`);
  const posFails = (run.payload.results || []).filter((q) => q.kind === 'positive' && !q.head_claimed);
  posFails.forEach((q) => console.log(`   still-killed: veto=${q.tag_veto || '-'} ${q.query.slice(0, 60)}`));
  console.log(posFails.length === 0 ? '== BASELINE RECOVERED ==' : '== POSITIVE FAILS REMAIN — review above ==');
})()
  .catch((e) => { console.error('REMEDIATION ERROR:', e.message); process.exitCode = 1; })
  .finally(cleanup);
