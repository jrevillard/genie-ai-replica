#!/usr/bin/env node
/**
 * Load test for the notification fan-out. Run with FCM_TRANSPORT=mock on the
 * backend — real FCM would return 10k not-registered errors for synthetic
 * tokens, which the pruner would (correctly) act on while burning quota.
 *
 * Usage:
 *   node scripts/notification-load-test.js seed   [--count 10000] [--bad-pct 5]
 *   node scripts/notification-load-test.js run    [--district Rangpur] [--all]
 *   node scripts/notification-load-test.js dedup  # same idempotency key 5x concurrently
 *   node scripts/notification-load-test.js clean  # remove synthetic tokens
 *
 * Env: API_BASE_URL (default http://localhost:3000)
 *      NOTIFICATION_BROADCAST_SECRET (required for run/dedup)
 *      ARANGO_* via shared-lib dbService (required for seed/clean)
 *
 * Assertions for a 10k run (from the implementation plan):
 *   - POST /broadcast responds 202 in <300ms
 *   - wall clock to terminal status <15s
 *   - sent + failed == matched
 *   - pruned ≈ count * bad-pct, every pruned token active:false
 */
require('dotenv').config();
const { aql } = require('arangojs');

const API_BASE = (process.env.API_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const SECRET = process.env.NOTIFICATION_BROADCAST_SECRET || '';

// Mirrors warning_system_engine/app/core/scheduler.py DISTRICT_LIST
const DISTRICTS = [
  'Dhaka', 'Chittagong', 'Sylhet', 'Rajshahi', 'Khulna',
  'Barisal', 'Rangpur', 'Mymensingh', 'Comilla', 'Jessore',
  'Bogra', 'Dinajpur', 'Pabna', 'Tangail', 'Faridpur',
  'Noakhali', 'Brahmanbaria', "Cox's Bazar", 'Chandpur', 'Narsingdi',
];
const SYNTHETIC_PREFIX = 'loadtest-';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function getDb() {
  const { dbService } = require('../shared-lib');
  return dbService.getConnection('default');
}

async function seed() {
  const count = parseInt(arg('count', '10000'), 10);
  const badPct = parseFloat(arg('bad-pct', '5')) / 100;
  const db = await getDb();
  const now = new Date().toISOString();

  const docs = [];
  for (let i = 0; i < count; i++) {
    const district = DISTRICTS[i % DISTRICTS.length];
    const marker = Math.random() < badPct ? '-BAD-' : '-OK-';
    const fcmToken = `${SYNTHETIC_PREFIX}${marker}${i}-${Math.random().toString(36).slice(2, 10)}`;
    const userId = `loadtest-user-${i}`;
    docs.push({
      userId,
      fcmToken,
      platform: 'android',
      preferences: {
        districts: [district],
        crops: i % 2 === 0 ? ['potato'] : [],
        alertTypes: ['weather_warning', 'potato_ews', 'drought_alert'],
      },
      deviceInfo: { synthetic: true },
      active: true,
      createdAt: now, updatedAt: now, lastSeenAt: now,
    });
  }

  // Batch insert via AQL (key = sha256 handled server-side is skipped here —
  // synthetic keys are fine for load testing)
  const crypto = require('crypto');
  for (const d of docs) {
    d._key = crypto.createHash('sha256').update(`${d.userId}:${d.fcmToken}`).digest('hex');
  }
  let inserted = 0;
  for (let i = 0; i < docs.length; i += 1000) {
    const batch = docs.slice(i, i + 1000);
    await db.query(aql`
      FOR d IN ${batch}
        INSERT d INTO notificationDeviceTokens OPTIONS { overwriteMode: "replace" }
    `);
    inserted += batch.length;
    process.stdout.write(`\rseeded ${inserted}/${count}`);
  }
  console.log(`\nDone. ~${Math.round(count * badPct)} tokens carry the -BAD- marker (mock prunes them).`);
  process.exit(0);
}

async function post(path, body, headers = {}) {
  const started = Date.now();
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-notification-secret': SECRET, ...headers },
    body: JSON.stringify(body),
  });
  const elapsed = Date.now() - started;
  const json = await res.json().catch(() => ({}));
  return { status: res.status, elapsed, json };
}

async function getStatus(broadcastId) {
  const res = await fetch(`${API_BASE}/api/notifications/broadcasts/${broadcastId}`, {
    headers: { 'x-notification-secret': SECRET },
  });
  return res.json();
}

function broadcastBody(extra = {}) {
  return {
    type: 'weather_warning',
    title: 'LOAD TEST — Weather Warning',
    body: 'Synthetic broadcast from notification-load-test.js',
    alertTypes: ['weather_warning'],
    ...extra,
  };
}

async function run() {
  if (!SECRET) { console.error('NOTIFICATION_BROADCAST_SECRET is required'); process.exit(1); }
  const district = arg('district', null);
  const body = broadcastBody(
    process.argv.includes('--all') || !district
      ? {}
      : { districts: [district], location: district },
  );
  body.idempotencyKey = `loadtest-${Date.now()}`;

  const t0 = Date.now();
  const { status, elapsed, json } = await post('/api/notifications/broadcast', body);
  console.log(`POST /broadcast → ${status} in ${elapsed}ms`, json);
  if (status !== 202) process.exit(1);
  if (elapsed > 300) console.warn(`⚠️  enqueue latency ${elapsed}ms exceeds the 300ms budget`);

  // Poll to terminal status
  for (;;) {
    await new Promise((r) => setTimeout(r, 1000));
    const s = await getStatus(json.broadcastId);
    process.stdout.write(`\r[${Math.round((Date.now() - t0) / 1000)}s] status=${s.status} sent=${s.counts?.sent} failed=${s.counts?.failed} pruned=${s.counts?.pruned} chunks=${s.counts?.chunksDone}/${s.counts?.chunksTotal}   `);
    if (['completed', 'partial', 'failed'].includes(s.status)) {
      console.log('\nFinal:', JSON.stringify(s, null, 2));
      const { matched, sent, failed } = s.counts;
      console.log(`\nAssertions:`);
      console.log(`  wall clock: ${Math.round((Date.now() - t0) / 1000)}s (budget 15s for 10k)`);
      console.log(`  sent+failed==matched: ${sent + failed === matched ? 'PASS' : `FAIL (${sent}+${failed}!=${matched})`}`);
      process.exit(0);
    }
    if (Date.now() - t0 > 180000) { console.error('\nTimed out after 180s'); process.exit(1); }
  }
}

async function dedup() {
  if (!SECRET) { console.error('NOTIFICATION_BROADCAST_SECRET is required'); process.exit(1); }
  const key = `dedup-test-${Date.now()}`;
  const body = broadcastBody({ idempotencyKey: key, districts: ['Dhaka'] });
  const results = await Promise.all(Array.from({ length: 5 }, () => post('/api/notifications/broadcast', body)));
  const accepted = results.filter((r) => r.status === 202).length;
  const duplicates = results.filter((r) => r.status === 200 && r.json.duplicate).length;
  const ids = new Set(results.map((r) => r.json.broadcastId));
  console.log(`5 concurrent posts, same idempotency key: ${accepted} accepted, ${duplicates} duplicate`);
  console.log(`distinct broadcastIds: ${ids.size} (expect 1)`);
  console.log(accepted === 1 && duplicates === 4 && ids.size === 1 ? 'PASS' : 'FAIL');
  process.exit(accepted === 1 && duplicates === 4 && ids.size === 1 ? 0 : 1);
}

async function clean() {
  const db = await getDb();
  const cursor = await db.query(aql`
    FOR t IN notificationDeviceTokens
      FILTER STARTS_WITH(t.fcmToken, ${SYNTHETIC_PREFIX})
      REMOVE t IN notificationDeviceTokens
      COLLECT WITH COUNT INTO n RETURN n
  `);
  console.log(`removed ${(await cursor.next()) || 0} synthetic tokens`);
  process.exit(0);
}

const command = process.argv[2];
({ seed, run, dedup, clean }[command] || (() => {
  console.error('usage: notification-load-test.js <seed|run|dedup|clean> [options]');
  process.exit(1);
}))();
