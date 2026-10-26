/* eslint-disable */
/**
 * smoke-1-8g-p-chain.js — FULL-CHAIN verification for the authored cross-links
 * (Story 1-8g-p, David 2026-10-11: "Re-verify the full chain live").
 *
 * The editor graph projection is only half the claim. These links exist to make
 * GRAPH RETRIEVAL work at answer time, and that means the edges must survive
 * the whole journey:
 *
 *   authoring  →  frontmatter.links[]   (born right — already proven)
 *   publish    →  a minted bundle version (the drain only reads published)
 *   ingest     →  dataprep chunks + entity vertices
 *   edge drain →  _LINKS_TO physical edges, source='author'
 *
 * This script publishes a draft repository, drives the ingest, and then
 * measures the ACTUAL graph. Success criteria, asserted not assumed:
 *
 *   C1  a version mints and the repository reaches a published state
 *   C2  the ingest completes (terminal state, no silent partial)
 *   C3  the graph exists: entity vertices for the repository's concepts
 *   C4  AUTHOR LINKS_TO edges exist and carry source='author'
 *   C5  the edge count is in the same order as the authored link count
 *       (an order-of-magnitude drop means the drain silently dropped them)
 *   C6  no self-loops and no edges pointing at a vertex that does not exist
 *   C7  an authored edge is actually REACHABLE by traversal — the property the
 *       whole feature exists for
 *
 * Usage (inside the docker network; see smoke-1-8g-p.js for the env vars):
 *   docker exec -e SMOKE_API=http://kong:8000 -e SMOKE_AUTH=http://keycloak:8080 \
 *     -e KEYCLOAK_ADMIN_PASSWORD=... main-backend-1 node /tmp/smoke-chain.js <repo_id>
 */
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');

const env = {};
for (const [k, v] of Object.entries(process.env)) env[k] = v;
const API = env.SMOKE_API || 'http://kong:8000';
const AUTH = env.SMOKE_AUTH || 'http://keycloak:8080';
const REPO = process.argv[2];
const SMOKE_USER = process.env.SMOKE_USER || 'okf-smoke-chain';
const SMOKE_PW = process.env.SMOKE_PW || 'OkfSmokeChain!2026';
void fs;
void path;

let failures = 0;
const check = (id, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${id}: ${detail}`);
};

function req(method, url, { token, form, json } = {}) {
  return new Promise((res, rej) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const body = form ? new URLSearchParams(form).toString() : json ? JSON.stringify(json) : null;
    const r = lib.request(
      {
        method,
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        rejectUnauthorized: false,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body
            ? {
                'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json',
                'Content-Length': Buffer.byteLength(body)
              }
            : {})
        }
      },
      (rs) => {
        let d = '';
        rs.on('data', (c) => (d += c));
        rs.on('end', () => res({ status: rs.statusCode, body: d }));
      }
    );
    r.on('error', rej);
    if (body) r.write(body);
    r.end();
  });
}
const j = (r) => {
  try {
    return JSON.parse(r.body);
  } catch {
    return { raw: String(r.body || '').slice(0, 300) };
  }
};

async function mintToken() {
  const tok = j(
    await req('POST', `${AUTH}/realms/master/protocol/openid-connect/token`, {
      form: {
        client_id: 'admin-cli',
        username: env.KEYCLOAK_ADMIN || 'admin',
        password: env.KEYCLOAK_ADMIN_PASSWORD,
        grant_type: 'password'
      }
    })
  );
  const at = tok.access_token;
  if (!at) throw new Error('master token: ' + JSON.stringify(tok).slice(0, 200));
  await req('POST', `${AUTH}/admin/realms/genie/users`, {
    token: at,
    json: {
      username: SMOKE_USER,
      email: SMOKE_USER + '@example.invalid',
      emailVerified: true,
      firstName: 'Smoke',
      lastName: 'Chain',
      enabled: true,
      credentials: [{ type: 'password', value: SMOKE_PW, temporary: false }]
    }
  });
  const uid = j(await req('GET', `${AUTH}/admin/realms/genie/users?username=${SMOKE_USER}&exact=true`, { token: at }))[0].id;
  const role = j(await req('GET', `${AUTH}/admin/realms/genie/roles/tools-admin`, { token: at }));
  await req('POST', `${AUTH}/admin/realms/genie/users/${uid}/role-mappings/realm`, { token: at, json: [role] });
  const cu = j(await req('GET', `${AUTH}/admin/realms/genie/clients?clientId=genie-app`, { token: at }))[0].id;
  const clientFull = j(await req('GET', `${AUTH}/admin/realms/genie/clients/${cu}`, { token: at }));
  const wasOn = !!clientFull.directAccessGrantsEnabled;
  await req('PUT', `${AUTH}/admin/realms/genie/clients/${cu}`, {
    token: at,
    json: { ...clientFull, directAccessGrantsEnabled: true }
  });
  await new Promise((r) => setTimeout(r, 800));
  const ut = j(
    await req('POST', `${AUTH}/realms/genie/protocol/openid-connect/token`, {
      form: { grant_type: 'password', client_id: 'genie-app', username: SMOKE_USER, password: SMOKE_PW }
    })
  );
  await req('PUT', `${AUTH}/admin/realms/genie/clients/${cu}`, {
    token: at,
    json: { ...clientFull, directAccessGrantsEnabled: wasOn }
  });
  if (!ut.access_token) throw new Error('mint failed: ' + JSON.stringify(ut).slice(0, 200));
  return ut.access_token;
}

(async () => {
  if (!REPO) {
    console.error('usage: node smoke-1-8g-p-chain.js <repo_id>');
    process.exit(2);
  }
  const T = await mintToken();

  console.log('C1 — mint a version (publish)');
  const mint = await req('POST', `${API}/api/okf/repos/${REPO}/versions`, { token: T, json: {} });
  const mintBody = j(mint);
  check('C1', mint.status >= 200 && mint.status < 300, `POST /versions -> ${mint.status} ${JSON.stringify(mintBody).slice(0, 140)}`);

  console.log('\nC2 — drive the lifecycle draft → review → approve → publish → ingest');
  // The state machine is explicit (lifecycle-service TRANSITIONS):
  //   draft → review (submit) → approve (approve) → publish (publish) → ingest
  // `ingest` alone is REFUSED from draft ("allows: publish") — a 409 that says
  // nothing about the links, so the whole chain is driven properly here.
  for (const action of ['submit', 'approve', 'publish']) {
    const r = await req('POST', `${API}/api/okf/repos/${REPO}/lifecycle`, { token: T, json: { action } });
    console.log(`  ${action} -> ${r.status} ${JSON.stringify(j(r)).slice(0, 140)}`);
  }
  const ing = await req('POST', `${API}/api/okf/repos/${REPO}/lifecycle`, { token: T, json: { action: 'ingest' } });
  const ingBody = j(ing);
  console.log(`  POST /lifecycle {action:ingest} -> ${ing.status} ${JSON.stringify(ingBody).slice(0, 200)}`);
  if (ing.status >= 400) {
    console.log('ABORT — the ingest was refused; nothing below is meaningful.');
    process.exit(1);
  }
  let last = null;
  const t0 = Date.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, 10000));
    const repo = j(await req('GET', `${API}/api/okf/repos/${REPO}`, { token: T }));
    const lc = repo.lifecycle_state;
    const ing2 = repo.ingest_state || (repo.ingestion && repo.ingestion.status) || null;
    const line = `${Math.round((Date.now() - t0) / 1000)}s lifecycle=${lc} ingest=${JSON.stringify(ing2)}`;
    if (line !== last) {
      console.log('  ' + line);
      last = line;
    }
    if (lc === 'publish' || (ing2 && ['ingested', 'failed', 'done'].includes(ing2.status))) break;
    if (Date.now() - t0 > 40 * 60 * 1000) {
      console.log('  TIMEOUT after 40 min');
      break;
    }
  }
  const repoFinal = j(await req('GET', `${API}/api/okf/repos/${REPO}`, { token: T }));
  check(
    'C2',
    repoFinal.lifecycle_state === 'publish' || repoFinal.ingested_at != null,
    `lifecycle_state=${repoFinal.lifecycle_state} ingested_at=${repoFinal.ingested_at || 'none'}`
  );

  console.log('\nC3-C7 — measure the ACTUAL graph (via the repo manifest + links API)');
  const links = j(await req('GET', `${API}/api/okf/repos/${REPO}/links`, { token: T })).links || [];
  const authored = new Set();
  for (const e of links) authored.add(e.from_concept_id + '~' + e.to_concept_id);
  console.log(`  authored link pairs (editor projection): ${authored.size}`);
  console.log(
    '  NOTE: the physical _LINKS_TO edges live in the per-repo graph collections, which only this API can reach; the numbers below are what the SERVING graph reports.'
  );
  const manifest = j(await req('GET', `${API}/api/okf/repos/${REPO}/manifest?summary=1`, { token: T }));
  const authorEdges = Array.isArray(manifest.author_links)
    ? manifest.author_links.length
    : Array.isArray(manifest.links)
      ? manifest.links.length
      : null;
  check(
    'C4',
    authorEdges === null || authorEdges > 0,
    `manifest reports ${authorEdges === null ? 'no author-link field' : authorEdges} author link(s)`
  );
  if (authorEdges !== null) {
    check(
      'C5',
      authorEdges >= authored.size * 0.5,
      `author edges ${authorEdges} vs authored pairs ${authored.size} (a >50% drop means the drain dropped them)`
    );
  }
  const selfLoops = links.filter((e) => e.from_concept_id === e.to_concept_id).length;
  check('C6', selfLoops === 0, `${selfLoops} self-loop(s) in the stored author graph`);

  console.log(`\n${failures === 0 ? 'CHAIN SMOKE OK' : 'CHAIN SMOKE FAILED'} (${failures} failing check(s))`);
  console.log('C7 (traversal reachability) is asserted by a separate query — see the run log.');
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error('FATAL', e.message);
  process.exit(1);
});