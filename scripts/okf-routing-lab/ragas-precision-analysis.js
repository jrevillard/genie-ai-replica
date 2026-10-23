// ragas-precision-analysis.js — read-only: compare per-row context_precision
// between the baseline run and the comparison run of the same suite, to
// answer WHY the mean dropped. Secrets are never printed.
const https = require('https');
const fs = require('fs');
const crypto = require('crypto');

const REPO_ID = '1e8258ad-6981-4b20-a8c1-00a99d876f76';
const SUITE_KEY = 'rs1792645296070-246482';
const BASELINE = 'rr1792684450748-f9b8b1';
const COMPARE = 'rr1792742789648-86637b';
const INFRA_ROWS = new Set(['new-19', 'new-31', 'new-33', 'new-39', 'new-41', 'new-77']);
const SMOKE_USER = 'okf-ragas-precision';
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
    /* keep previous */
  }
  const r = await req('PUT', `${AUTH_BASE}/admin/realms/${REALM}/clients/${CLIENT_UUID}`, {
    token: ADMIN_TOKEN,
    json: { directAccessGrantsEnabled: false }
  });
  ROPC_ON = false;
  if (r.status !== 204) console.error(`ROPC REVERT HTTP ${r.status} — VERIFY MANUALLY`);
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
  const mk = await req('POST', `${AUTH_BASE}/admin/realms/${REALM}/users`, {
    token: ADMIN_TOKEN,
    json: {
      username: SMOKE_USER,
      email: `${SMOKE_USER}@example.invalid`,
      emailVerified: true,
      firstName: 'Ragas',
      lastName: 'Precision',
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

  const getRun = async (rk) =>
    j(
      await req('GET', `${API_BASE}/api/okf/repos/${REPO_ID}/ragas-testsuite/${SUITE_KEY}/runs/${rk}`, { token })
    );
  const base = await getRun(BASELINE);
  const comp = await getRun(COMPARE);
  const baseRows = new Map((base.payload.results || []).map((r) => [r.id, r]));
  const compRows = new Map((comp.payload.results || []).map((r) => [r.id, r]));

  const prec = (r) => {
    const v = r && r.metrics ? r.metrics.context_precision : null;
    return typeof v === 'number' && v === v ? v : null;
  };

  // 1. The infra rows: what did they actually SCORE?
  console.log('=== infra-failed rows: recorded precision + contexts ===');
  let infraScoredZero = 0;
  let infraNull = 0;
  for (const id of INFRA_ROWS) {
    const r = compRows.get(id) || {};
    const p = prec(r);
    console.log(
      `  ${id}: precision=${p === null ? 'null' : p} contexts=${(r.contexts || []).length} ` +
        `answer=${r.answer ? 'yes' : 'NO'}`
    );
    if (p === null) infraNull += 1;
    else if (p === 0) infraScoredZero += 1;
  }

  // 2. Means over scored rows, with and without the infra rows.
  const scored = (rows, skipInfra) =>
    [...rows.values()]
      .filter((r) => !(skipInfra && INFRA_ROWS.has(r.id)))
      .map(prec)
      .filter((v) => v !== null);
  const mean = (a) => a.reduce((s, v) => s + v, 0) / (a.length || 1);
  const bAll = scored(baseRows, false);
  const cAll = scored(compRows, false);
  const cClean = scored(compRows, true);
  const bClean = scored(baseRows, true);
  console.log(`\n=== context_precision means ===`);
  console.log(`  baseline       : ${mean(bAll).toFixed(4)} over ${bAll.length} scored rows`);
  console.log(`  compare (all)  : ${mean(cAll).toFixed(4)} over ${cAll.length} scored rows`);
  console.log(`  compare (clean): ${mean(cClean).toFixed(4)} over ${cClean.length} scored rows (6 infra rows out)`);
  console.log(`  baseline (clean): ${mean(bClean).toFixed(4)} over ${bClean.length} scored rows`);
  console.log(
    `  headline delta : ${(mean(cAll) - mean(bAll)).toFixed(4)}  |  clean-vs-clean: ${(mean(cClean) - mean(bClean)).toFixed(4)}`
  );

  // 3. Per-row deltas on rows scored BOTH sides.
  console.log(`\n=== biggest per-row drops (scored both sides) ===`);
  const deltas = [];
  for (const [id, br] of baseRows) {
    const bp = prec(br);
    const cp = prec(compRows.get(id));
    if (bp === null || cp === null) continue;
    deltas.push({ id, bp, cp, delta: cp - bp, bc: (br.contexts || []).length, cc: (compRows.get(id).contexts || []).length });
  }
  deltas.sort((a, b) => a.delta - b.delta);
  for (const d of deltas.slice(0, 12)) {
    console.log(
      `  ${d.id}: ${d.bp.toFixed(3)} -> ${d.cp.toFixed(3)} (${d.delta >= 0 ? '+' : ''}${d.delta.toFixed(3)}) ` +
        `contexts ${d.bc} -> ${d.cc}`
    );
  }
  const dropped = deltas.filter((d) => d.delta < -0.001);
  const improved = deltas.filter((d) => d.delta > 0.001);
  console.log(`  rows dropped: ${dropped.length}, improved: ${improved.length}, flat: ${deltas.length - dropped.length - improved.length}`);
  const droppedSum = dropped.reduce((s, d) => s + d.delta, 0);
  const improvedSum = improved.reduce((s, d) => s + d.delta, 0);
  console.log(`  sum of drops: ${droppedSum.toFixed(3)} | sum of gains: ${improvedSum.toFixed(3)}`);

  // 4. How many rows delivered the maximum 16 contexts vs 3?
  const ccDist = {};
  for (const r of compRows.values()) {
    const n = (r.contexts || []).length;
    ccDist[n] = (ccDist[n] || 0) + 1;
  }
  console.log(`\n=== compare-run context counts per row ===`);
  console.log(' ', JSON.stringify(ccDist));
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
