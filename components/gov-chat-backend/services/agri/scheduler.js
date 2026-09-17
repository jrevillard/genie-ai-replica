/**
 * Prefetch scheduler (remediation-plan.md §5 — single-flight discipline).
 *
 * The ONLY component that ever contacts upstream APIs. Per adapter:
 * distributed lock (Redis SET NX PX) so swarm replicas cannot double-fetch
 * (duplicate GDELT calls would trip its sticky limiter); in-process mutex
 * guards single-replica overlap. Every run is logged to `agri_fetch_log`
 * with schema-level success (a parse that yields 0 docs is a FAILURE —
 * health must not stay green on garbage, per BMAD verification).
 */
const { logger } = require('../../shared-lib');
const { adapterConfig, cadenceMs } = require('./config');

// Verbose pipeline tracing — set AGRI_VERBOSE=1 in the deployment env.
// All detail is stringified INTO the message: this app's winston format
// silently drops meta objects, which cost an hour of blind debugging on
// 2026-09-17 (crash logs showed empty "Service initialization failed:").
const VERBOSE = process.env.AGRI_VERBOSE === '1';
const vlog = (msg) => {
  if (VERBOSE) logger.info(`[agri-v] ${msg}`);
};

class AgriScheduler {
  /**
   * @param {Object} deps
   * @param {Object[]} deps.adapters - enabled adapter modules
   * @param {Object} deps.db - arangojs database
   * @param {Object|null} deps.redis
   * @param {Function} deps.onAdaptersRun - async (adapterIds) => rebuild endpoints
   */
  constructor({ adapters, db, redis, onAdaptersRun }) {
    this.adapters = adapters;
    this.db = db;
    this.redis = redis;
    this.onAdaptersRun = onAdaptersRun;
    this.inFlight = new Set();
    this.timer = null;
  }

  /** Record a fetch attempt/result. Never throws. */
  async log(entry) {
    try {
      await this.db.collection('agri_fetch_log').save({
        adapterId: entry.adapterId,
        ok: entry.ok,
        docCount: entry.docCount || 0,
        latencyMs: entry.latencyMs || 0,
        latestDataDate: entry.latestDataDate || null,
        error: entry.error || null,
        ranAt: new Date().toISOString()
      });
    } catch (error) {
      logger.warn(`agri scheduler: fetch_log write failed: ${error.message}`);
    }
  }

  /** Last successful run time for an adapter (epoch ms), 0 if none. */
  async lastSuccess(adapterId) {
    try {
      const cursor = await this.db.query(
        'FOR l IN agri_fetch_log FILTER l.adapterId == @id AND l.ok == true ' +
          'SORT l.ranAt DESC LIMIT 1 RETURN l.ranAt',
        { id: adapterId }
      );
      const [ranAt] = await cursor.all();
      return ranAt ? Date.parse(ranAt) : 0;
    } catch {
      return 0;
    }
  }

  async acquireLock(adapterId, ttlMs) {
    if (this.redis) {
      try {
        const ok = await this.redis.set(`agri:lock:${adapterId}`, '1', 'PX', ttlMs, 'NX');
        return ok === 'OK';
      } catch {
        /* fall through to in-process guard */
      }
    }
    return !this.inFlight.has(adapterId);
  }

  releaseLock(adapterId) {
    this.inFlight.delete(adapterId);
    if (this.redis) {
      this.redis.del(`agri:lock:${adapterId}`).catch(() => {});
    }
  }

  /** Run one adapter end-to-end: resolve → fetch → parse → normalize → upsert. */
  async runAdapter(adapter) {
    const cfg = adapterConfig(adapter);
    const started = Date.now();
    try {
      const resolved = await adapter.resolve(cfg);
      vlog(`${adapter.id} resolved: ${JSON.stringify(resolved)}`);
      const raw = await adapter.fetch(resolved, cfg);
      const bytes = raw && raw.length !== undefined ? raw.length : (raw && raw.byteLength) || '?';
      vlog(`${adapter.id} fetched: ${bytes} bytes in ${Date.now() - started}ms`);
      // parse may be sync OR async (zip/xlsx extractors) — always await
      const parsed = await adapter.parse(raw);
      vlog(`${adapter.id} parsed: ${Array.isArray(parsed) ? `${parsed.length} rows` : typeof parsed}`);
      const { collection, docs } = adapter.normalize(parsed);
      vlog(`${adapter.id} normalized: ${docs ? docs.length : 0} docs -> ${collection}`);

      if (!docs || docs.length === 0) {
        throw new Error('normalize produced 0 documents (schema change?)');
      }

      const coll = this.db.collection(collection);
      let written = 0;
      for (let i = 0; i < docs.length; i += 500) {
        // arangojs import() takes an ARRAY OF OBJECTS (type 'array') or an
        // NDJSON string (type 'list'). Passing an array of JSON strings is
        // accepted by the server but imports 0 documents — which is how a
        // full pass of wfp/hdx data silently vanished on the deployed box
        // (2026-09-17: fetch log said ok, collections stayed empty).
        const chunk = docs.slice(i, i + 500).map((d) => ({ ...d }));
        const res = await coll.import(chunk, { type: 'array', onDuplicate: 'update' });
        vlog(`${adapter.id} import chunk ${i / 500 + 1}/${Math.ceil(docs.length / 500)} -> ${JSON.stringify(res)}`);
        // Arango import API returns {created, updated, ignored, errors} —
        // re-importing existing docs lands in 'updated'/'ignored', so all
        // three count as persisted.
        written += (res && (res.created || 0) + (res.updated || 0) + (res.ignored || 0)) || 0;
      }
      if (docs.length > 0 && written === 0) {
        // A 0-doc write with a non-empty parse is as much a failure as a
        // 0-doc parse — surface it instead of logging a green fetch.
        throw new Error(`import wrote 0 of ${docs.length} documents (type mismatch?)`);
      }

      const latestDataDate = docs.reduce((max, d) => {
        const date = d.date || d.year || d.observedOn || d.publishedAt;
        return date && date > (max || '') ? date : max;
      }, null);

      await this.log({
        adapterId: adapter.id,
        ok: true,
        docCount: docs.length,
        latencyMs: Date.now() - started,
        latestDataDate
      });
      return { ok: true, docs: docs.length, latestDataDate };
    } catch (error) {
      logger.error(
        `agri adapter ${adapter.id} failed after ${Date.now() - started}ms: ${error.message} | ${error.stack}`
      );
      await this.log({
        adapterId: adapter.id,
        ok: false,
        latencyMs: Date.now() - started,
        error: error.message
      });
      return { ok: false, error: error.message };
    }
  }

  /** One pass over all enabled adapters that are due. */
  async runOnce() {
    const touched = [];
    let skipped = 0;
    for (const adapter of this.adapters) {
      const lastOk = await this.lastSuccess(adapter.id);
      const dueAt = lastOk + cadenceMs(adapter);
      if (dueAt > Date.now()) {
        skipped += 1;
        vlog(
          `skip ${adapter.id}: last ok ${lastOk ? new Date(lastOk).toISOString() : 'never'}, next due ${new Date(dueAt).toISOString()}`
        );
        continue;
      }

      const lockTtl = cadenceMs(adapter) + 10 * 60 * 1000;
      if (!(await this.acquireLock(adapter.id, lockTtl))) continue;
      this.inFlight.add(adapter.id);

      try {
        const result = await this.runAdapter(adapter);
        if (result.ok) touched.push(adapter.id);
        logger.info(
          `agri scheduler: ${adapter.id} ${result.ok ? 'ok' : 'FAILED'} ` +
            `(${result.docs ?? ''} docs${result.error ? ` — ${result.error}` : ''})`
        );
      } finally {
        this.releaseLock(adapter.id);
      }
    }

    if (touched.length > 0 && this.onAdaptersRun) {
      try {
        await this.onAdaptersRun(touched);
      } catch (error) {
        logger.error(`agri scheduler: endpoint rebuild failed: ${error.message} | ${error.stack}`);
      }
    }
    logger.info(
      `agri pass complete: ${touched.length} ok, ${this.adapters.length - touched.length - skipped} failed, ${skipped} not-due`
    );
    return touched;
  }

  /** Start periodic runs (interval = shortest adapter cadence). */
  start(intervalMs) {
    const tick = Math.min(...this.adapters.map((a) => cadenceMs(a)), intervalMs || 60 * 60 * 1000);
    // Clamp to at least 15 min so we never hammer upstreams
    const interval = Math.max(tick, 15 * 60 * 1000);
    this.timer = setInterval(() => {
      this.runOnce().catch((e) => logger.error(`agri scheduler pass failed: ${e.message}`));
    }, interval);
    this.timer.unref();
    logger.info(`agri scheduler started (interval ${Math.round(interval / 60000)} min)`);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }
}

module.exports = { AgriScheduler };
