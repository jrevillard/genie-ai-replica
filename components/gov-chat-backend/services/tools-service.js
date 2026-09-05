const { aql } = require('arangojs');
const Redis = require('ioredis');
const { logger, dbService } = require('../shared-lib');

class ToolsService {
  constructor() {
    this.db = null;
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;
    try {
      this.db = await dbService.getConnection('default');
      // Ensure feeds collection exists
      const exists = await this.db.collection('feeds').exists();
      if (!exists) {
        await this.db.createCollection('feeds');
        const feedsCol = this.db.collection('feeds');
        await feedsCol.ensureIndex({
          type: 'persistent',
          fields: ['url'],
          unique: true,
          name: 'idx_feeds_url'
        });
      }
      // Story 4-4: singleton tools config (domain whitelist + tool toggles) —
      // the runtime-editable store; env stays the operator breaker
      const configExists = await this.db.collection('tools_config').exists();
      if (!configExists) {
        await this.db.createCollection('tools_config');
      }
      this.initialized = true;
      logger.info('ToolsService initialized');
    } catch (error) {
      logger.error(`Error initializing ToolsService: ${error.message}`);
      throw error;
    }
  }

  async getFeeds() {
    try {
      const cursor = await this.db.query(aql`
        FOR f IN feeds
        RETURN f
      `);
      return await cursor.all();
    } catch (error) {
      logger.error(`Error getting feeds: ${error.message}`);
      throw error;
    }
  }

  async getConfig() {
    try {
      const doc = await this.db
        .collection('tools_config')
        .document('config')
        .catch((err) => {
          if (err.errorNum === 1202 || err.code === 404) return null;
          throw err;
        });
      if (!doc) {
        return { whitelist: [], web_search_enabled: true };
      }
      return {
        whitelist: Array.isArray(doc.whitelist) ? doc.whitelist : [],
        web_search_enabled: doc.web_search_enabled !== false
      };
    } catch (error) {
      logger.error(`Error getting tools config: ${error.message}`);
      throw error;
    }
  }

  async updateConfig({ whitelist, web_search_enabled }) {
    try {
      const config = {
        whitelist: Array.isArray(whitelist) ? whitelist : [],
        web_search_enabled: web_search_enabled !== false,
        updatedAt: Date.now()
      };
      await this.db.collection('tools_config').save({ _key: 'config', ...config }, { overwriteMode: 'replace' });
      return config;
    } catch (error) {
      logger.error(`Error updating tools config: ${error.message}`);
      throw error;
    }
  }

  async getFeedById(id) {
    try {
      const feed = await this.db.collection('feeds').document(id);
      return feed;
    } catch (error) {
      if (error.errorNum === 1202) return null; // Document not found
      logger.error(`Error getting feed ${id}: ${error.message}`);
      throw error;
    }
  }

  async createFeed(feedData) {
    try {
      const feed = {
        ...feedData,
        enabled: feedData.enabled !== undefined ? feedData.enabled : true,
        last_polled: 0,
        last_entry_date: 0,
        failures: 0,
        createdAt: Date.now()
      };

      const result = await this.db.collection('feeds').save(feed, { returnNew: true });
      return result.new;
    } catch (error) {
      logger.error(`Error creating feed: ${error.message}`);
      throw error;
    }
  }

  async updateFeed(id, updateData) {
    try {
      // Don't allow overwriting internal fields directly
      delete updateData._key;
      delete updateData._id;
      delete updateData._rev;

      const result = await this.db.collection('feeds').update(id, updateData, { returnNew: true });
      return result.new;
    } catch (error) {
      logger.error(`Error updating feed ${id}: ${error.message}`);
      throw error;
    }
  }

  async deleteFeed(id) {
    try {
      await this.db.collection('feeds').remove(id);
      return { success: true };
    } catch (error) {
      if (error.errorNum === 1202) return { success: false, message: 'Feed not found' };
      logger.error(`Error deleting feed ${id}: ${error.message}`);
      throw error;
    }
  }

  // ------------------------------------------------------------------
  // Audit stream reader (story 4-6) — FOI access via tools-reader.
  // PEEK ONLY: XREVRANGE, never XREADGROUP/XACK — consuming would steal
  // entries from the future analytics consumer and break the audit trail.
  // ------------------------------------------------------------------
  async _auditRedis() {
    if (!this._auditClient) {
      const host = (process.env.REDIS_HOST || 'redis-cache').replace(/^redis:\/\//, '');
      const port = parseInt(process.env.REDIS_PORT || '6379', 10);
      const password = process.env.REDIS_PASSWORD || undefined;
      this._auditClient = new Redis({
        host,
        port,
        password,
        lazyConnect: false,
        maxRetriesPerRequest: 1,
        // Fail fast when Redis is unreachable — a queued-forever xrevrange
        // would hang the /audit request with no timeout (review: offline queue)
        enableOfflineQueue: false
      });
      // Unhandled 'error' events crash the process — always attach a listener
      this._auditClient.on('error', (err) => logger.error(`Audit Redis error: ${err.message}`));
    }
    return this._auditClient;
  }

  _decodeAuditEntry(id, flatFields) {
    // ioredis returns [field, value, field, value, ...] — decode to an object.
    // PUBLIC FIELDS ONLY: parameters_redacted and metadata carry invocation
    // payloads and are deliberately excluded from the listing shape.
    const raw = {};
    for (let i = 0; i < flatFields.length; i += 2) {
      raw[flatFields[i]] = flatFields[i + 1];
    }
    return {
      id,
      tool_id: raw.tool_id || '',
      user_id: raw.user_id || '',
      timestamp: parseFloat(raw.timestamp) || 0,
      action: raw.action || 'invoke',
      governance_decision: raw.governance_decision || '',
      duration_ms: raw.duration_ms !== undefined ? parseFloat(raw.duration_ms) : null,
      pii_entities_found: parseInt(raw.pii_entities_found || '0', 10) || 0,
      // Cap at export/listing time — the writer truncates too, but a
      // hand-written stream entry could carry an unbounded summary
      result_summary: raw.result_summary ? raw.result_summary.slice(0, 200) : null
    };
  }

  _csvCell(str) {
    // Neutralize spreadsheet formula injection (=cmd()+-@) and always quote
    // anything containing quotes/newlines/CR (review: CSV injection)
    const dangerous = /^[=+\-@]/.test(str);
    const needsQuoting = /[",\r\n]/.test(str) || dangerous;
    const escaped = dangerous ? `'${str}` : str;
    return needsQuoting ? `"${escaped.replace(/"/g, '""')}"` : escaped;
  }

  async getAuditEntries({ tool_id, action, user_id, from, to, limit = 50, cursor, _maxCap = 500 } = {}) {
    const capped = Math.min(Math.max(parseInt(limit, 10) || 50, 1), _maxCap);
    try {
      const client = await this._auditRedis();
      const stream = process.env.AUDIT_STREAM_NAME || 'tool-invocation-audit';
      // '(' = EXCLUSIVE start (Redis 6.2+): re-entering at the cursor must not
      // re-emit the boundary entry (review: inclusive cursor duplicated rows)
      const start = cursor && /^\d+-\d+$/.test(cursor) ? `(${cursor}` : '+';
      // Over-fetch to compensate for in-code filtering, then slice
      const fetchCount = Math.min(capped * 4, _maxCap);
      const raw = await client.xrevrange(stream, start, '-', 'COUNT', fetchCount);
      const entries = [];
      let lastSeenId = null;
      for (const [id, fields] of raw) {
        lastSeenId = id;
        const entry = this._decodeAuditEntry(id, fields);
        if (tool_id && entry.tool_id !== tool_id) continue;
        if (action && entry.action !== action) continue;
        if (user_id && entry.user_id !== user_id) continue;
        // from/to are epoch SECONDS (the entry unit)
        if (from !== undefined && !Number.isNaN(from) && entry.timestamp < from) continue;
        if (to !== undefined && !Number.isNaN(to) && entry.timestamp > to) continue;
        entries.push(entry);
        if (entries.length >= capped) break;
      }
      // Cursor whenever the FETCH window was exhausted — even with zero filter
      // matches, deeper entries may hold matches (review: sparse filters used
      // to dead-end the pagination)
      const nextCursor = raw.length >= fetchCount ? lastSeenId : null;
      return { entries, next_cursor: entries.length >= capped ? nextCursor : null };
    } catch (error) {
      logger.error(`Error reading audit stream: ${error.message}`);
      throw error;
    }
  }

  async exportAudit(filters) {
    // _maxCap lifts the listing cap for one-shot exports (review: the export
    // used to be silently truncated to the 500-row listing cap)
    const { entries } = await this.getAuditEntries({ ...filters, limit: 10000, _maxCap: 10000 });
    if (filters.format === 'csv') {
      const header =
        'id,timestamp,tool_id,action,governance_decision,duration_ms,pii_entities_found,user_id,result_summary';
      const rows = entries.map((e) =>
        [
          e.id,
          new Date(e.timestamp * 1000).toISOString(),
          e.tool_id,
          e.action,
          e.governance_decision,
          e.duration_ms !== null ? e.duration_ms : '',
          e.pii_entities_found,
          e.user_id,
          e.result_summary || ''
        ]
          .map((v) => this._csvCell(String(v)))
          .join(',')
      );
      return {
        body: [header, ...rows].join('\r\n'),
        contentType: 'text/csv',
        filename: `tool-audit-${Date.now()}.csv`
      };
    }
    return {
      body: JSON.stringify(entries, null, 2),
      contentType: 'application/json',
      filename: `tool-audit-${Date.now()}.json`
    };
  }
}

const instance = new ToolsService();
module.exports = instance;
