'use strict';

const bcrypt = require('bcryptjs');
const { aql } = require('arangojs');
const { logger, dbService } = require('../shared-lib');

const BCRYPT_ROUNDS = 12;

class PatientService {
  constructor() {
    this.db = null;
    this.users = null;
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;
    try {
      this.db = await dbService.getConnection('default');
      this.users = this.db.collection('users');
      this.initialized = true;
      logger.info('PatientService initialized');
    } catch (error) {
      logger.error(`PatientService.init failed: ${error.message}`, { stack: error.stack });
      throw error;
    }
  }

  /**
   * Create a patient user linked to the given admin.
   * The patient is immediately active (no email verification flow).
   */
  async createPatient(adminKey, { firstName, lastName, email, password, phone = '', dateOfBirth = '', notes = '' }) {
    logger.info('PatientService.createPatient', { adminKey, email });

    // Collision check
    const cursor = await this.db.query(aql`
      FOR u IN users
        FILTER u.email == ${email}
        LIMIT 1
        RETURN u._key
    `);
    const existing = await cursor.next();
    if (existing) {
      const err = new Error('A user with this email already exists');
      err.status = 409;
      throw err;
    }

    const loginName = email.toLowerCase().trim();
    const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const now = new Date().toISOString();

    const doc = {
      loginName,
      email: email.toLowerCase().trim(),
      encPassword: hashedPassword,
      emailVerified: true,
      role: 'User',
      adminId: adminKey,
      createdAt: now,
      updatedAt: now,
      personalIdentification: {
        fullName: `${firstName} ${lastName}`.trim(),
        firstName,
        lastName,
        dob: dateOfBirth,
        phone,
      },
      notes,
    };

    const saved = await this.users.save(doc, { returnNew: true });
    const patient = saved.new ?? saved;
    logger.info('PatientService.createPatient.saved', { adminKey, patientKey: patient._key });

    // Strip sensitive fields before returning
    const { encPassword: _, ...safe } = patient;
    return safe;
  }

  /**
   * List all patients belonging to the given admin.
   */
  async listPatients(adminKey, { offset = 0, limit = 50 } = {}) {
    logger.info('PatientService.listPatients', { adminKey, offset, limit });

    // One aggregated query — per-patient subqueries pull session counts and
    // last-activity timestamps from chatSessions / call_sessions so a single
    // round-trip gives the admin everything they need to render a usage table.
    // collection-or-view-not-found errors degrade to zero/null per row.
    const cursor = await this.db.query(aql`
      FOR u IN users
        FILTER u.adminId == ${adminKey}
        LET userKey = u._key

        LET numChats = LENGTH(
          FOR s IN chatSessions
            FILTER s.userId == userKey AND s.type == 'chat'
            RETURN 1
        )
        LET numWhatsappChats = LENGTH(
          FOR s IN chatSessions
            FILTER s.userId == userKey AND s.type == 'whatsapp'
            RETURN 1
        )
        LET numCalls = LENGTH(
          FOR c IN call_sessions
            FILTER c.userId == userKey
            RETURN 1
        )

        LET lastChatAt = FIRST(
          FOR s IN chatSessions
            FILTER s.userId == userKey
            SORT s.updatedAt DESC
            LIMIT 1
            RETURN s.updatedAt
        )
        LET lastCallAt = FIRST(
          FOR c IN call_sessions
            FILTER c.userId == userKey
            SORT (c.endAt OR c.startAt) DESC
            LIMIT 1
            RETURN (c.endAt OR c.startAt)
        )

        LET twinsAllowedCount = u.allowedTwinIds == null
          ? null
          : LENGTH(u.allowedTwinIds)

        SORT u.createdAt DESC
        LIMIT ${offset}, ${limit}
        RETURN MERGE(
          UNSET(u, 'encPassword', 'accessToken'),
          {
            numChats: numChats,
            numWhatsappChats: numWhatsappChats,
            numCalls: numCalls,
            totalSessions: numChats + numWhatsappChats + numCalls,
            lastChatAt: lastChatAt,
            lastCallAt: lastCallAt,
            lastActivityAt: lastChatAt > lastCallAt ? lastChatAt : lastCallAt,
            twinsAllowedCount: twinsAllowedCount
          }
        )
    `);

    const patients = await cursor.all();

    const countCursor = await this.db.query(aql`
      RETURN COUNT(
        FOR u IN users
          FILTER u.adminId == ${adminKey}
          RETURN 1
      )
    `);
    const total = (await countCursor.next()) ?? 0;

    return { patients, total, offset, limit };
  }

  /**
   * Fetch a single patient that belongs to the given admin.
   * Same enriched shape as listPatients — counts and last-activity timestamps
   * are joined in via subqueries so the detail page doesn't need a second call.
   */
  async getPatient(adminKey, patientKey) {
    logger.info('PatientService.getPatient', { adminKey, patientKey });

    const cursor = await this.db.query(aql`
      FOR u IN users
        FILTER u._key == ${patientKey} AND u.adminId == ${adminKey}
        LIMIT 1
        LET userKey = u._key
        LET numChats = LENGTH(
          FOR s IN chatSessions
            FILTER s.userId == userKey AND s.type == 'chat'
            RETURN 1
        )
        LET numWhatsappChats = LENGTH(
          FOR s IN chatSessions
            FILTER s.userId == userKey AND s.type == 'whatsapp'
            RETURN 1
        )
        LET numCalls = LENGTH(
          FOR c IN call_sessions
            FILTER c.userId == userKey
            RETURN 1
        )
        LET lastChatAt = FIRST(
          FOR s IN chatSessions
            FILTER s.userId == userKey
            SORT s.updatedAt DESC
            LIMIT 1
            RETURN s.updatedAt
        )
        LET lastCallAt = FIRST(
          FOR c IN call_sessions
            FILTER c.userId == userKey
            SORT (c.endAt OR c.startAt) DESC
            LIMIT 1
            RETURN (c.endAt OR c.startAt)
        )
        LET twinsAllowedCount = u.allowedTwinIds == null
          ? null
          : LENGTH(u.allowedTwinIds)
        RETURN MERGE(
          UNSET(u, 'encPassword', 'accessToken'),
          {
            numChats: numChats,
            numWhatsappChats: numWhatsappChats,
            numCalls: numCalls,
            totalSessions: numChats + numWhatsappChats + numCalls,
            lastChatAt: lastChatAt,
            lastCallAt: lastCallAt,
            lastActivityAt: lastChatAt > lastCallAt ? lastChatAt : lastCallAt,
            twinsAllowedCount: twinsAllowedCount
          }
        )
    `);

    const patient = await cursor.next();
    if (!patient) {
      const err = new Error('Patient not found');
      err.status = 404;
      throw err;
    }
    return patient;
  }

  /**
   * Update allowed patient fields. Password change is optional.
   */
  async updatePatient(adminKey, patientKey, updates) {
    logger.info('PatientService.updatePatient', { adminKey, patientKey });

    // Verify ownership
    await this.getPatient(adminKey, patientKey);

    const { password, firstName, lastName, phone, dateOfBirth, notes, email } = updates;

    const patch = {
      updatedAt: new Date().toISOString(),
    };

    if (email) {
      // Check email collision (excluding current user)
      const emailCursor = await this.db.query(aql`
        FOR u IN users
          FILTER u.email == ${email.toLowerCase().trim()} AND u._key != ${patientKey}
          LIMIT 1
          RETURN u._key
      `);
      const emailConflict = await emailCursor.next();
      if (emailConflict) {
        const err = new Error('A user with this email already exists');
        err.status = 409;
        throw err;
      }
      patch.email = email.toLowerCase().trim();
      patch.loginName = email.toLowerCase().trim();
    }

    if (password) {
      patch.encPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);
    }

    // Build personalIdentification patch
    if (firstName !== undefined || lastName !== undefined || phone !== undefined || dateOfBirth !== undefined) {
      // Fetch current values so we can merge
      const current = await this.users.document(patientKey, { graceful: true });
      const pid = current?.personalIdentification ?? {};

      patch.personalIdentification = {
        ...pid,
        firstName: firstName ?? pid.firstName ?? '',
        lastName: lastName ?? pid.lastName ?? '',
        fullName: `${firstName ?? pid.firstName ?? ''} ${lastName ?? pid.lastName ?? ''}`.trim(),
        phone: phone ?? pid.phone ?? '',
        dob: dateOfBirth ?? pid.dob ?? '',
      };
    }

    if (notes !== undefined) patch.notes = notes;

    await this.users.update(patientKey, patch);

    const updated = await this.users.document(patientKey, { graceful: true });
    const { encPassword: _, accessToken: __, ...safe } = updated;
    return safe;
  }

  // ---------------------------------------------------------------------------
  // Twin-access management
  // ---------------------------------------------------------------------------

  /**
   * Return the list of allowed twin _keys for a patient.
   * If `allowedTwinIds` is not set on the user document, returns null, meaning
   * "no restriction" (all twins visible).
   */
  async getPatientTwinAccess(adminKey, patientKey) {
    logger.info('PatientService.getPatientTwinAccess', { adminKey, patientKey });
    const patient = await this.getPatient(adminKey, patientKey);
    return {
      patientKey,
      allowedTwinIds: patient.allowedTwinIds ?? null,
    };
  }

  /**
   * Replace the full list of allowed twin _keys for a patient.
   * Pass an empty array to block all twins; pass null to remove the restriction.
   */
  async setPatientTwinAccess(adminKey, patientKey, twinIds) {
    logger.info('PatientService.setPatientTwinAccess', { adminKey, patientKey, count: twinIds?.length });
    await this.getPatient(adminKey, patientKey); // ownership check

    const patch = {
      updatedAt: new Date().toISOString(),
      allowedTwinIds: twinIds === null ? null : [...new Set(twinIds)],
    };
    await this.users.update(patientKey, patch);
    return { patientKey, allowedTwinIds: patch.allowedTwinIds };
  }

  /**
   * Enable access to a single twin (idempotent).
   */
  async addPatientTwinAccess(adminKey, patientKey, twinId) {
    logger.info('PatientService.addPatientTwinAccess', { adminKey, patientKey, twinId });
    const patient = await this.getPatient(adminKey, patientKey);
    const current = patient.allowedTwinIds ?? [];
    if (current.includes(twinId)) {
      return { patientKey, allowedTwinIds: current };
    }
    const updated = [...current, twinId];
    await this.users.update(patientKey, { allowedTwinIds: updated, updatedAt: new Date().toISOString() });
    return { patientKey, allowedTwinIds: updated };
  }

  /**
   * Revoke access to a single twin (idempotent).
   */
  async removePatientTwinAccess(adminKey, patientKey, twinId) {
    logger.info('PatientService.removePatientTwinAccess', { adminKey, patientKey, twinId });
    const patient = await this.getPatient(adminKey, patientKey);
    const current = patient.allowedTwinIds ?? [];
    const updated = current.filter((id) => id !== twinId);
    await this.users.update(patientKey, { allowedTwinIds: updated, updatedAt: new Date().toISOString() });
    return { patientKey, allowedTwinIds: updated };
  }

  /**
   * Resolve the patient's twin-access scope from their user row.
   *
   * Returns `{ adminId, allowedTwinIds }` when the user is a patient (has
   * adminId), or `null` when they're not. Callers MUST treat `null` as
   * "deny — show no twins" (NOT "no restriction → show everything"; that
   * historical interpretation leaked twins across tenants).
   *
   * `allowedTwinIds` field semantics:
   *   null    — no explicit allow-list. Patient sees ALL of their admin's
   *             twins. Use adminId for tenant scoping.
   *   []      — explicit deny-all. Patient sees nothing.
   *   [...]   — explicit allow-list. Patient sees the intersection of this
   *             list and their admin's twins.
   */
  async getSelfTwinAccess(patientKey) {
    logger.info('PatientService.getSelfTwinAccess', { patientKey });
    const cursor = await this.db.query(aql`
      FOR u IN users
        FILTER u._key == ${patientKey} AND u.adminId != null
        LIMIT 1
        RETURN { allowedTwinIds: u.allowedTwinIds, adminId: u.adminId }
    `);
    const row = await cursor.next();
    if (!row) {
      return null;
    }
    return {
      adminId: row.adminId,
      allowedTwinIds: row.allowedTwinIds ?? null,
    };
  }

  /**
   * Delete a patient (hard delete from ArangoDB).
   * Only the owning admin can delete.
   */
  async deletePatient(adminKey, patientKey) {
    logger.info('PatientService.deletePatient', { adminKey, patientKey });

    // Verify ownership first
    await this.getPatient(adminKey, patientKey);

    await this.users.remove(patientKey);
    logger.info('PatientService.deletePatient.done', { adminKey, patientKey });
    return { success: true };
  }
}

module.exports = new PatientService();
