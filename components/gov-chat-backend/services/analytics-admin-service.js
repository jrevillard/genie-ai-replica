'use strict';

const { aql } = require('arangojs');
const { logger, dbService } = require('../shared-lib');

/**
 * Parse a YYYY-MM-DD string to a UTC start-of-day ISO timestamp.
 * Falls back to a sensible default when the value is missing/invalid.
 */
function toIsoStart(dateStr, fallbackDaysAgo = 30) {
  if (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return new Date(`${dateStr}T00:00:00.000Z`).toISOString();
  }
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - fallbackDaysAgo);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

function toIsoEnd(dateStr) {
  if (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return new Date(`${dateStr}T23:59:59.999Z`).toISOString();
  }
  return new Date().toISOString();
}

class AnalyticsAdminService {
  constructor() {
    this.db = null;
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;
    try {
      this.db = await dbService.getConnection('default');
      this.initialized = true;
      logger.info('AnalyticsAdminService initialized');
    } catch (error) {
      logger.error(`AnalyticsAdminService.init failed: ${error.message}`, { stack: error.stack });
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Return the _keys of all patients belonging to this admin and all twins
   * owned by this admin. These two arrays are used to scope every query.
   */
  async _scope(adminKey) {
    const [patientCursor, twinCursor] = await Promise.all([
      this.db.query(aql`
        FOR u IN users
          FILTER u.adminId == ${adminKey}
          RETURN u._key
      `),
      this.db.query(aql`
        FOR t IN aiTwins
          FILTER t.ownerId == ${adminKey}
          RETURN t._key
      `),
    ]);
    const [patientKeys, twinKeys] = await Promise.all([
      patientCursor.all(),
      twinCursor.all(),
    ]);
    return { patientKeys, twinKeys };
  }

  // ---------------------------------------------------------------------------
  // Summary — all chart data in one call
  // ---------------------------------------------------------------------------

  /**
   * @param {string} adminKey
   * @param {string} from  YYYY-MM-DD
   * @param {string} to    YYYY-MM-DD
   */
  async getSummary(adminKey, from, to) {
    const fromIso = toIsoStart(from);
    const toIso = toIsoEnd(to);

    const { patientKeys, twinKeys } = await this._scope(adminKey);

    // Run all independent queries in parallel for speed
    const [
      kpis,
      activityByDay,
      channelSplit,
      twinBreakdown,
      sessionLengthDistribution,
      callDurationDistribution,
      topCategories,
      callLanguages,
      hourlyDistribution,
    ] = await Promise.all([
      this._kpis(patientKeys, twinKeys, fromIso, toIso, adminKey),
      this._activityByDay(patientKeys, twinKeys, fromIso, toIso),
      this._channelSplit(patientKeys, twinKeys, fromIso, toIso),
      this._twinBreakdown(patientKeys, twinKeys, fromIso, toIso),
      this._sessionLengthDistribution(patientKeys, twinKeys, fromIso, toIso),
      this._callDurationDistribution(patientKeys, twinKeys, fromIso, toIso),
      this._topCategories(patientKeys, twinKeys, fromIso, toIso),
      this._callLanguages(patientKeys, twinKeys, fromIso, toIso),
      this._hourlyDistribution(patientKeys, twinKeys, fromIso, toIso),
    ]);

    return {
      period: { from: fromIso, to: toIso },
      kpis,
      activityByDay,
      channelSplit,
      twinBreakdown,
      sessionLengthDistribution,
      callDurationDistribution,
      topCategories,
      callLanguages,
      hourlyDistribution,
    };
  }

  // ---------------------------------------------------------------------------
  // KPIs
  // ---------------------------------------------------------------------------

  async _kpis(patientKeys, twinKeys, fromIso, toIso, adminKey) {
    const [
      chatCountCursor,
      callCountCursor,
      activePatientsViaChatCursor,
      activePatientsViaCallCursor,
      totalMessagesCursor,
      avgResponseTimeCursor,
      avgCallDurationCursor,
      newPatientsCursor,
    ] = await Promise.all([
      // Total chat+WhatsApp sessions
      this.db.query(aql`
        RETURN COUNT(
          FOR s IN chatSessions
            FILTER (s.userId IN ${patientKeys} OR s.twinId IN ${twinKeys})
              AND s.createdAt >= ${fromIso} AND s.createdAt <= ${toIso}
            RETURN 1
        )
      `),
      // Total calls
      this.db.query(aql`
        RETURN COUNT(
          FOR s IN call_sessions
            FILTER (s.userId IN ${patientKeys} OR s.twinId IN ${twinKeys})
              AND s.startAt >= ${fromIso} AND s.startAt <= ${toIso}
            RETURN 1
        )
      `),
      // Distinct active patients via chat
      this.db.query(aql`
        RETURN COUNT_UNIQUE(
          FOR s IN chatSessions
            FILTER (s.userId IN ${patientKeys} OR s.twinId IN ${twinKeys})
              AND s.createdAt >= ${fromIso} AND s.createdAt <= ${toIso}
              AND s.userId IN ${patientKeys}
            RETURN s.userId
        )
      `),
      // Distinct active patients via call
      this.db.query(aql`
        RETURN COUNT_UNIQUE(
          FOR s IN call_sessions
            FILTER (s.userId IN ${patientKeys} OR s.twinId IN ${twinKeys})
              AND s.startAt >= ${fromIso} AND s.startAt <= ${toIso}
              AND s.userId IN ${patientKeys}
            RETURN s.userId
        )
      `),
      // Total user messages (chat)
      this.db.query(aql`
        LET sessionIds = (
          FOR s IN chatSessions
            FILTER (s.userId IN ${patientKeys} OR s.twinId IN ${twinKeys})
              AND s.createdAt >= ${fromIso} AND s.createdAt <= ${toIso}
            RETURN s._key
        )
        RETURN COUNT(
          FOR m IN chatSessionMessages
            FILTER m.sessionId IN sessionIds AND m.role == 'user'
            RETURN 1
        )
      `),
      // Avg chat AI response time
      this.db.query(aql`
        LET sessionIds = (
          FOR s IN chatSessions
            FILTER (s.userId IN ${patientKeys} OR s.twinId IN ${twinKeys})
              AND s.createdAt >= ${fromIso} AND s.createdAt <= ${toIso}
            RETURN s._key
        )
        RETURN AVG(
          FOR m IN chatSessionMessages
            FILTER m.sessionId IN sessionIds AND m.role == 'assistant'
              AND m.responseTime != null
            RETURN m.responseTime
        )
      `),
      // Avg call duration (seconds), only ended calls
      this.db.query(aql`
        RETURN AVG(
          FOR s IN call_sessions
            FILTER (s.userId IN ${patientKeys} OR s.twinId IN ${twinKeys})
              AND s.startAt >= ${fromIso} AND s.startAt <= ${toIso}
              AND s.durationSeconds != null
            RETURN s.durationSeconds
        )
      `),
      // New patients created in range
      this.db.query(aql`
        RETURN COUNT(
          FOR u IN users
            FILTER u.adminId == ${adminKey}
              AND u.createdAt >= ${fromIso} AND u.createdAt <= ${toIso}
            RETURN 1
        )
      `),
    ]);

    const [
      totalChatSessions,
      totalCalls,
      activePatientsChat,
      activePatientsCall,
      totalMessages,
      avgResponseTimeMs,
      avgCallDurationSecs,
      newPatients,
    ] = await Promise.all([
      chatCountCursor.next(),
      callCountCursor.next(),
      activePatientsViaChatCursor.next(),
      activePatientsViaCallCursor.next(),
      totalMessagesCursor.next(),
      avgResponseTimeCursor.next(),
      avgCallDurationCursor.next(),
      newPatientsCursor.next(),
    ]);

    // Active patients = union of chat and call users (max possible, de-duplicated by DB)
    const activePatients = Math.max(activePatientsChat ?? 0, activePatientsCall ?? 0);

    return {
      totalChatSessions: totalChatSessions ?? 0,
      totalCalls: totalCalls ?? 0,
      activePatients,
      newPatients: newPatients ?? 0,
      totalMessages: totalMessages ?? 0,
      avgResponseTimeMs: avgResponseTimeMs != null ? Math.round(avgResponseTimeMs) : null,
      avgCallDurationSecs: avgCallDurationSecs != null ? Math.round(avgCallDurationSecs) : null,
    };
  }

  // ---------------------------------------------------------------------------
  // Activity over time (dual series: chat + calls per day)
  // ---------------------------------------------------------------------------

  async _activityByDay(patientKeys, twinKeys, fromIso, toIso) {
    const [chatCursor, callCursor] = await Promise.all([
      this.db.query(aql`
        FOR s IN chatSessions
          FILTER (s.userId IN ${patientKeys} OR s.twinId IN ${twinKeys})
            AND s.createdAt >= ${fromIso} AND s.createdAt <= ${toIso}
          COLLECT day = DATE_FORMAT(s.createdAt, '%yyyy-%mm-%dd')
          AGGREGATE cnt = COUNT(1)
          SORT day ASC
          RETURN { day, chatSessions: cnt }
      `),
      this.db.query(aql`
        FOR s IN call_sessions
          FILTER (s.userId IN ${patientKeys} OR s.twinId IN ${twinKeys})
            AND s.startAt >= ${fromIso} AND s.startAt <= ${toIso}
          COLLECT day = DATE_FORMAT(s.startAt, '%yyyy-%mm-%dd')
          AGGREGATE cnt = COUNT(1)
          SORT day ASC
          RETURN { day, calls: cnt }
      `),
    ]);

    const [chatRows, callRows] = await Promise.all([chatCursor.all(), callCursor.all()]);

    // Merge by day
    const byDay = new Map();
    for (const r of chatRows) byDay.set(r.day, { day: r.day, chatSessions: r.chatSessions, calls: 0 });
    for (const r of callRows) {
      const existing = byDay.get(r.day);
      if (existing) {
        existing.calls = r.calls;
      } else {
        byDay.set(r.day, { day: r.day, chatSessions: 0, calls: r.calls });
      }
    }

    return Array.from(byDay.values()).sort((a, b) => a.day.localeCompare(b.day));
  }

  // ---------------------------------------------------------------------------
  // Channel split (chat / whatsapp / call)
  // ---------------------------------------------------------------------------

  async _channelSplit(patientKeys, twinKeys, fromIso, toIso) {
    const [chatCursor, callCountCursor] = await Promise.all([
      // Chat sessions already store type: 'chat' | 'whatsapp'
      this.db.query(aql`
        FOR s IN chatSessions
          FILTER (s.userId IN ${patientKeys} OR s.twinId IN ${twinKeys})
            AND s.createdAt >= ${fromIso} AND s.createdAt <= ${toIso}
          COLLECT channel = s.type != null ? s.type : 'chat'
          AGGREGATE cnt = COUNT(1)
          RETURN { channel, count: cnt }
      `),
      this.db.query(aql`
        RETURN COUNT(
          FOR s IN call_sessions
            FILTER (s.userId IN ${patientKeys} OR s.twinId IN ${twinKeys})
              AND s.startAt >= ${fromIso} AND s.startAt <= ${toIso}
            RETURN 1
        )
      `),
    ]);

    const [chatRows, callTotal] = await Promise.all([chatCursor.all(), callCountCursor.next()]);

    const result = [...chatRows];
    if ((callTotal ?? 0) > 0) {
      result.push({ channel: 'call', count: callTotal });
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // Twin breakdown (chat + calls)
  // ---------------------------------------------------------------------------

  async _twinBreakdown(patientKeys, twinKeys, fromIso, toIso) {
    const [chatCursor, callCursor] = await Promise.all([
      // Compute per-session stats BEFORE COLLECT so we never reference
      // the 'chatSessions' collection name after it has been shadowed by
      // the AGGREGATE variable of the same name.
      this.db.query(aql`
        FOR s IN chatSessions
          FILTER (s.userId IN ${patientKeys} OR s.twinId IN ${twinKeys})
            AND s.createdAt >= ${fromIso} AND s.createdAt <= ${toIso}
            AND s.twinId != null
          LET sessionRt = AVG(
            FOR m IN chatSessionMessages
              FILTER m.sessionId == s._key AND m.role == 'assistant' AND m.responseTime != null
              RETURN m.responseTime
          )
          LET sessionMsgCount = LENGTH(
            FOR m IN chatSessionMessages
              FILTER m.sessionId == s._key
              RETURN 1
          )
          COLLECT twinId = s.twinId
          AGGREGATE
            sessionCount   = COUNT(1),
            rtSum          = SUM(sessionRt != null ? sessionRt : 0),
            rtCount        = SUM(sessionRt != null ? 1 : 0),
            totalMsgCount  = SUM(sessionMsgCount)
          LET twinName = FIRST(FOR t IN aiTwins FILTER t._key == twinId RETURN t.name)
          RETURN {
            twinId,
            name: twinName,
            chatSessions: sessionCount,
            avgResponseTimeMs: rtCount > 0 ? ROUND(rtSum / rtCount) : null,
            avgMsgsPerSession: sessionCount > 0 ? ROUND((totalMsgCount / sessionCount) * 10) / 10 : null
          }
      `),
      this.db.query(aql`
        FOR s IN call_sessions
          FILTER (s.userId IN ${patientKeys} OR s.twinId IN ${twinKeys})
            AND s.startAt >= ${fromIso} AND s.startAt <= ${toIso}
            AND s.twinId != null
          COLLECT twinId = s.twinId
          AGGREGATE calls = COUNT(1),
                    avgDur = AVG(s.durationSeconds != null ? s.durationSeconds : null)
          LET twinName = FIRST(FOR t IN aiTwins FILTER t._key == twinId RETURN t.name)
          RETURN { twinId, name: twinName, calls, avgCallDurationSecs: avgDur != null ? ROUND(avgDur) : null }
      `),
    ]);

    const [chatRows, callRows] = await Promise.all([chatCursor.all(), callCursor.all()]);

    // Merge by twinId
    const byTwin = new Map();
    for (const r of chatRows) {
      byTwin.set(r.twinId, {
        twinId: r.twinId,
        name: r.name,
        chatSessions: r.chatSessions,
        calls: 0,
        avgResponseTimeMs: r.avgResponseTimeMs,
        avgMsgsPerSession: r.avgMsgsPerSession,
        avgCallDurationSecs: null,
      });
    }
    for (const r of callRows) {
      const existing = byTwin.get(r.twinId);
      if (existing) {
        existing.calls = r.calls;
        existing.avgCallDurationSecs = r.avgCallDurationSecs;
      } else {
        byTwin.set(r.twinId, {
          twinId: r.twinId,
          name: r.name,
          chatSessions: 0,
          calls: r.calls,
          avgResponseTimeMs: null,
          avgMsgsPerSession: null,
          avgCallDurationSecs: r.avgCallDurationSecs,
        });
      }
    }

    return Array.from(byTwin.values()).sort((a, b) => (b.chatSessions + b.calls) - (a.chatSessions + a.calls));
  }

  // ---------------------------------------------------------------------------
  // Session length distribution (chat only)
  // ---------------------------------------------------------------------------

  async _sessionLengthDistribution(patientKeys, twinKeys, fromIso, toIso) {
    const cursor = await this.db.query(aql`
      LET sessionIds = (
        FOR s IN chatSessions
          FILTER (s.userId IN ${patientKeys} OR s.twinId IN ${twinKeys})
            AND s.createdAt >= ${fromIso} AND s.createdAt <= ${toIso}
          RETURN s._key
      )
      FOR sid IN sessionIds
        LET msgCount = LENGTH(FOR m IN chatSessionMessages FILTER m.sessionId == sid RETURN 1)
        LET bucket = msgCount <= 5 ? '1-5' :
                     msgCount <= 10 ? '6-10' :
                     msgCount <= 20 ? '11-20' : '21+'
        COLLECT b = bucket AGGREGATE cnt = COUNT(1)
        RETURN { bucket: b, count: cnt }
    `);
    const rows = await cursor.all();
    // Ensure all buckets present in correct order
    const order = ['1-5', '6-10', '11-20', '21+'];
    const map = new Map(rows.map((r) => [r.bucket, r.count]));
    return order.map((bucket) => ({ bucket, count: map.get(bucket) ?? 0 }));
  }

  // ---------------------------------------------------------------------------
  // Call duration distribution
  // ---------------------------------------------------------------------------

  async _callDurationDistribution(patientKeys, twinKeys, fromIso, toIso) {
    const cursor = await this.db.query(aql`
      FOR s IN call_sessions
        FILTER (s.userId IN ${patientKeys} OR s.twinId IN ${twinKeys})
          AND s.startAt >= ${fromIso} AND s.startAt <= ${toIso}
          AND s.durationSeconds != null
        LET bucket = s.durationSeconds < 60 ? '<1min' :
                     s.durationSeconds < 300 ? '1-5min' :
                     s.durationSeconds < 900 ? '5-15min' : '15+min'
        COLLECT b = bucket AGGREGATE cnt = COUNT(1)
        RETURN { bucket: b, count: cnt }
    `);
    const rows = await cursor.all();
    const order = ['<1min', '1-5min', '5-15min', '15+min'];
    const map = new Map(rows.map((r) => [r.bucket, r.count]));
    return order.map((bucket) => ({ bucket, count: map.get(bucket) ?? 0 }));
  }

  // ---------------------------------------------------------------------------
  // Top conversation categories (from auto-router stored on queries)
  // ---------------------------------------------------------------------------

  async _topCategories(patientKeys, twinKeys, fromIso, toIso) {
    const cursor = await this.db.query(aql`
      LET chatSessionIds = (
        FOR s IN chatSessions
          FILTER (s.userId IN ${patientKeys} OR s.twinId IN ${twinKeys})
            AND s.createdAt >= ${fromIso} AND s.createdAt <= ${toIso}
          RETURN s._key
      )
      FOR q IN queries
        FILTER q.chatSessionId IN chatSessionIds
          AND q.context != null AND q.context.categoryLabel != null
        COLLECT category = q.context.categoryLabel AGGREGATE cnt = COUNT(1)
        SORT cnt DESC
        LIMIT 10
        RETURN { category, count: cnt }
    `);
    return cursor.all();
  }

  // ---------------------------------------------------------------------------
  // Call language breakdown
  // ---------------------------------------------------------------------------

  async _callLanguages(patientKeys, twinKeys, fromIso, toIso) {
    const cursor = await this.db.query(aql`
      FOR s IN call_sessions
        FILTER (s.userId IN ${patientKeys} OR s.twinId IN ${twinKeys})
          AND s.startAt >= ${fromIso} AND s.startAt <= ${toIso}
        COLLECT language = s.language != null ? s.language : 'unknown'
        AGGREGATE cnt = COUNT(1)
        SORT cnt DESC
        RETURN { language, count: cnt }
    `);
    return cursor.all();
  }

  // ---------------------------------------------------------------------------
  // Hourly distribution (user chat messages by hour of day)
  // ---------------------------------------------------------------------------

  async _hourlyDistribution(patientKeys, twinKeys, fromIso, toIso) {
    const cursor = await this.db.query(aql`
      LET sessionIds = (
        FOR s IN chatSessions
          FILTER (s.userId IN ${patientKeys} OR s.twinId IN ${twinKeys})
            AND s.createdAt >= ${fromIso} AND s.createdAt <= ${toIso}
          RETURN s._key
      )
      FOR m IN chatSessionMessages
        FILTER m.sessionId IN sessionIds AND m.role == 'user'
        COLLECT hour = DATE_HOUR(m.createdAt) AGGREGATE cnt = COUNT(1)
        SORT hour ASC
        RETURN { hour, count: cnt }
    `);
    const rows = await cursor.all();
    // Fill missing hours with 0 for a complete 0-23 series
    const map = new Map(rows.map((r) => [r.hour, r.count]));
    return Array.from({ length: 24 }, (_, h) => ({ hour: h, count: map.get(h) ?? 0 }));
  }

  // ---------------------------------------------------------------------------
  // Per-patient breakdown (paginated)
  // ---------------------------------------------------------------------------

  /**
   * @param {string} adminKey
   * @param {string} from  YYYY-MM-DD
   * @param {string} to    YYYY-MM-DD
   * @param {number} offset
   * @param {number} limit
   */
  async getPatients(adminKey, from, to, offset = 0, limit = 50) {
    const fromIso = toIsoStart(from);
    const toIso = toIsoEnd(to);
    const { patientKeys, twinKeys } = await this._scope(adminKey);

    if (patientKeys.length === 0) {
      return { patients: [], total: 0, offset, limit };
    }

    // Fetch base patient list (paginated)
    const patientCursor = await this.db.query(aql`
      FOR u IN users
        FILTER u.adminId == ${adminKey}
        SORT u.createdAt DESC
        LIMIT ${offset}, ${limit}
        RETURN { _key: u._key, name: u.personalIdentification.fullName, email: u.email, createdAt: u.createdAt }
    `);
    const patientRows = await patientCursor.all();

    const countCursor = await this.db.query(aql`
      RETURN COUNT(FOR u IN users FILTER u.adminId == ${adminKey} RETURN 1)
    `);
    const total = (await countCursor.next()) ?? 0;

    // For each patient, aggregate chat and call stats in parallel
    const patients = await Promise.all(
      patientRows.map(async (p) => {
        const uid = p._key;
        const [chatStatsCursor, callStatsCursor] = await Promise.all([
          this.db.query(aql`
            LET sessions = (
              FOR s IN chatSessions
                FILTER s.userId == ${uid}
                  AND s.createdAt >= ${fromIso} AND s.createdAt <= ${toIso}
                RETURN s
            )
            LET sessionIds = sessions[*]._key
            LET msgCounts = (
              FOR sid IN sessionIds
                RETURN COUNT(FOR m IN chatSessionMessages FILTER m.sessionId == sid RETURN 1)
            )
            LET lastActive = MAX(sessions[*].updatedAt)
            LET totalMsgs = SUM(
              FOR sid IN sessionIds
                RETURN COUNT(FOR m IN chatSessionMessages FILTER m.sessionId == sid AND m.role == 'user' RETURN 1)
            )
            LET avgRt = AVG(
              FOR sid IN sessionIds
                FOR m IN chatSessionMessages
                  FILTER m.sessionId == sid AND m.role == 'assistant' AND m.responseTime != null
                  RETURN m.responseTime
            )
            RETURN {
              chatSessions: LENGTH(sessions),
              totalMessages: totalMsgs,
              avgSessionLength: LENGTH(msgCounts) > 0 ? ROUND(AVERAGE(msgCounts) * 10) / 10 : null,
              lastChatActive: lastActive,
              avgResponseTimeMs: avgRt != null ? ROUND(avgRt) : null
            }
          `),
          this.db.query(aql`
            LET sessions = (
              FOR s IN call_sessions
                FILTER s.userId == ${uid}
                  AND s.startAt >= ${fromIso} AND s.startAt <= ${toIso}
                RETURN s
            )
            LET lastActive = MAX(sessions[*].startAt)
            RETURN {
              calls: LENGTH(sessions),
              totalCallSecs: SUM(sessions[*].durationSeconds),
              lastCallActive: lastActive
            }
          `),
        ]);

        const [chatStats, callStats] = await Promise.all([
          chatStatsCursor.next(),
          callStatsCursor.next(),
        ]);

        const lastActive = [chatStats?.lastChatActive, callStats?.lastCallActive]
          .filter(Boolean)
          .sort()
          .pop() ?? null;

        return {
          patientId: uid,
          name: p.name ?? null,
          email: p.email,
          createdAt: p.createdAt,
          chatSessions: chatStats?.chatSessions ?? 0,
          calls: callStats?.calls ?? 0,
          totalMessages: chatStats?.totalMessages ?? 0,
          avgSessionLength: chatStats?.avgSessionLength ?? null,
          totalCallSecs: callStats?.totalCallSecs ?? null,
          avgResponseTimeMs: chatStats?.avgResponseTimeMs ?? null,
          lastActive,
        };
      })
    );

    return { patients, total, offset, limit };
  }
}

module.exports = new AnalyticsAdminService();
