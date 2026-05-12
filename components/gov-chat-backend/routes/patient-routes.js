'use strict';

const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth-middleware');
const { logger } = require('../shared-lib');

/**
 * @swagger
 * tags:
 *   - name: Patients
 *     description: Admin-managed patient user accounts
 *
 * components:
 *   schemas:
 *     Patient:
 *       type: object
 *       properties:
 *         _key:
 *           type: string
 *         email:
 *           type: string
 *           format: email
 *         loginName:
 *           type: string
 *         adminId:
 *           type: string
 *           description: _key of the admin who created this patient
 *         role:
 *           type: string
 *           example: User
 *         personalIdentification:
 *           type: object
 *           properties:
 *             fullName:
 *               type: string
 *             firstName:
 *               type: string
 *             lastName:
 *               type: string
 *             phone:
 *               type: string
 *             dob:
 *               type: string
 *         notes:
 *           type: string
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 */

module.exports = (patientService) => {
  if (!patientService || typeof patientService.createPatient !== 'function') {
    logger.error('patient-routes: invalid patientService');
    throw new Error('patientService is required');
  }

  /**
   * @swagger
   * /patients:
   *   post:
   *     summary: Create a new patient
   *     description: Admin creates a new patient user linked to their account.
   *     tags: [Patients]
   *     security:
   *       - BearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [firstName, lastName, email, password]
   *             properties:
   *               firstName:
   *                 type: string
   *               lastName:
   *                 type: string
   *               email:
   *                 type: string
   *                 format: email
   *               password:
   *                 type: string
   *               phone:
   *                 type: string
   *               dateOfBirth:
   *                 type: string
   *               notes:
   *                 type: string
   *     responses:
   *       201:
   *         description: Patient created
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Patient'
   *       400:
   *         description: Missing required fields
   *       403:
   *         description: Admin access required
   *       409:
   *         description: Email already in use
   */
  router.post(
    '/',
    authMiddleware.authenticate,
    authMiddleware.isAdmin,
    async (req, res) => {
      try {
        const adminKey = req.user._key;
        const { firstName, lastName, email, password, phone, dateOfBirth, notes } = req.body;

        if (!firstName || !lastName || !email || !password) {
          return res.status(400).json({ message: 'firstName, lastName, email, and password are required' });
        }

        const patient = await patientService.createPatient(adminKey, {
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: email.trim(),
          password,
          phone: phone?.trim() ?? '',
          dateOfBirth: dateOfBirth ?? '',
          notes: notes ?? '',
        });

        logger.info(`[PATIENTS] Admin ${adminKey} created patient ${patient._key}`);
        res.status(201).json(patient);
      } catch (error) {
        const status = error.status ?? 500;
        logger.error(`[PATIENTS] POST / error: ${error.message}`, { stack: error.stack });
        res.status(status).json({ message: error.message });
      }
    }
  );

  /**
   * @swagger
   * /patients:
   *   get:
   *     summary: List patients
   *     description: >-
   *       Returns all patients created by the authenticated admin. Each row is
   *       enriched with live usage counts (chat / WhatsApp / call session totals),
   *       last-activity timestamps, and how many AI twins the patient has been
   *       granted access to. All these enriched fields are computed at read time
   *       from chatSessions and call_sessions — they are never stored on the user
   *       document and cannot be edited.
   *     tags: [Patients]
   *     security:
   *       - BearerAuth: []
   *     parameters:
   *       - in: query
   *         name: offset
   *         schema:
   *           type: integer
   *           default: 0
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *           default: 50
   *     responses:
   *       200:
   *         description: Paginated list of patients
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 patients:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       _key:        { type: string }
   *                       loginName:   { type: string }
   *                       email:       { type: string, format: email }
   *                       role:        { type: string, example: User }
   *                       adminId:     { type: string, description: _key of the admin who owns this patient }
   *                       personalIdentification:
   *                         type: object
   *                         properties:
   *                           fullName:  { type: string }
   *                           firstName: { type: string }
   *                           lastName:  { type: string }
   *                           dob:       { type: string }
   *                           phone:     { type: string }
   *                       notes:        { type: string }
   *                       allowedTwinIds:
   *                         type: array
   *                         nullable: true
   *                         items: { type: string }
   *                         description: Explicit allow-list of twin _keys, or null when unrestricted
   *                       emailVerified: { type: boolean }
   *                       disabled:      { type: boolean, nullable: true }
   *                       createdAt:     { type: string, format: date-time }
   *                       updatedAt:     { type: string, format: date-time }
   *                       numChats:         { type: integer, description: Web chat sessions (computed) }
   *                       numWhatsappChats: { type: integer, description: WhatsApp chat sessions (computed) }
   *                       numCalls:         { type: integer, description: Voice call sessions (computed) }
   *                       totalSessions:    { type: integer, description: Sum of the three counts above }
   *                       lastChatAt:       { type: string, format: date-time, nullable: true }
   *                       lastCallAt:       { type: string, format: date-time, nullable: true }
   *                       lastActivityAt:   { type: string, format: date-time, nullable: true, description: Most recent of lastChatAt / lastCallAt }
   *                       twinsAllowedCount: { type: integer, nullable: true, description: Number of twins granted access; null means unrestricted }
   *                 total:  { type: integer }
   *                 offset: { type: integer }
   *                 limit:  { type: integer }
   *       403:
   *         description: Admin access required
   */
  router.get(
    '/',
    authMiddleware.authenticate,
    authMiddleware.isAdmin,
    async (req, res) => {
      try {
        const adminKey = req.user._key;
        const offset = Math.max(0, parseInt(req.query.offset) || 0);
        const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));

        const result = await patientService.listPatients(adminKey, { offset, limit });
        res.json(result);
      } catch (error) {
        logger.error(`[PATIENTS] GET / error: ${error.message}`, { stack: error.stack });
        res.status(500).json({ message: error.message });
      }
    }
  );

  /**
   * @swagger
   * /patients/{patientId}:
   *   get:
   *     summary: Get a patient
   *     description: >-
   *       Returns a single patient owned by the authenticated admin. The
   *       response shape mirrors the list endpoint — enriched with live usage
   *       counts (chat / WhatsApp / call session totals), last-activity
   *       timestamps, and how many AI twins the patient has been granted
   *       access to. All these enriched fields are computed at read time from
   *       chatSessions and call_sessions; they are never stored on the user
   *       document and cannot be edited.
   *     tags: [Patients]
   *     security:
   *       - BearerAuth: []
   *     parameters:
   *       - in: path
   *         name: patientId
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Patient object with usage counts
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 _key:        { type: string }
   *                 loginName:   { type: string }
   *                 email:       { type: string, format: email }
   *                 role:        { type: string, example: User }
   *                 adminId:     { type: string, description: _key of the admin who owns this patient }
   *                 personalIdentification:
   *                   type: object
   *                   properties:
   *                     fullName:  { type: string }
   *                     firstName: { type: string }
   *                     lastName:  { type: string }
   *                     dob:       { type: string }
   *                     phone:     { type: string }
   *                 notes:        { type: string }
   *                 allowedTwinIds:
   *                   type: array
   *                   nullable: true
   *                   items: { type: string }
   *                   description: Explicit allow-list of twin _keys, or null when unrestricted
   *                 emailVerified: { type: boolean }
   *                 disabled:      { type: boolean, nullable: true }
   *                 createdAt:     { type: string, format: date-time }
   *                 updatedAt:     { type: string, format: date-time }
   *                 numChats:         { type: integer, description: Web chat sessions (computed) }
   *                 numWhatsappChats: { type: integer, description: WhatsApp chat sessions (computed) }
   *                 numCalls:         { type: integer, description: Voice call sessions (computed) }
   *                 totalSessions:    { type: integer, description: Sum of the three counts above }
   *                 lastChatAt:       { type: string, format: date-time, nullable: true }
   *                 lastCallAt:       { type: string, format: date-time, nullable: true }
   *                 lastActivityAt:   { type: string, format: date-time, nullable: true, description: Most recent of lastChatAt / lastCallAt }
   *                 twinsAllowedCount: { type: integer, nullable: true, description: Number of twins granted access; null means unrestricted }
   *       403:
   *         description: Admin access required
   *       404:
   *         description: Patient not found
   */
  router.get(
    '/:patientId',
    authMiddleware.authenticate,
    authMiddleware.isAdmin,
    async (req, res) => {
      try {
        const adminKey = req.user._key;
        const patient = await patientService.getPatient(adminKey, req.params.patientId);
        res.json(patient);
      } catch (error) {
        const status = error.status ?? 500;
        logger.error(`[PATIENTS] GET /:id error: ${error.message}`, { stack: error.stack });
        res.status(status).json({ message: error.message });
      }
    }
  );

  /**
   * @swagger
   * /patients/{patientId}:
   *   put:
   *     summary: Update a patient
   *     description: Admin updates details for one of their patients.
   *     tags: [Patients]
   *     security:
   *       - BearerAuth: []
   *     parameters:
   *       - in: path
   *         name: patientId
   *         required: true
   *         schema:
   *           type: string
   *     requestBody:
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               firstName:
   *                 type: string
   *               lastName:
   *                 type: string
   *               email:
   *                 type: string
   *               password:
   *                 type: string
   *               phone:
   *                 type: string
   *               dateOfBirth:
   *                 type: string
   *               notes:
   *                 type: string
   *     responses:
   *       200:
   *         description: Updated patient
   *       403:
   *         description: Admin access required
   *       404:
   *         description: Patient not found
   */
  router.put(
    '/:patientId',
    authMiddleware.authenticate,
    authMiddleware.isAdmin,
    async (req, res) => {
      try {
        const adminKey = req.user._key;
        const patient = await patientService.updatePatient(adminKey, req.params.patientId, req.body);
        logger.info(`[PATIENTS] Admin ${adminKey} updated patient ${req.params.patientId}`);
        res.json(patient);
      } catch (error) {
        const status = error.status ?? 500;
        logger.error(`[PATIENTS] PUT /:id error: ${error.message}`, { stack: error.stack });
        res.status(status).json({ message: error.message });
      }
    }
  );

  /**
   * @swagger
   * /patients/{patientId}:
   *   delete:
   *     summary: Delete a patient
   *     description: Admin permanently removes one of their patients.
   *     tags: [Patients]
   *     security:
   *       - BearerAuth: []
   *     parameters:
   *       - in: path
   *         name: patientId
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Patient deleted
   *       403:
   *         description: Admin access required
   *       404:
   *         description: Patient not found
   */
  router.delete(
    '/:patientId',
    authMiddleware.authenticate,
    authMiddleware.isAdmin,
    async (req, res) => {
      try {
        const adminKey = req.user._key;
        const result = await patientService.deletePatient(adminKey, req.params.patientId);
        logger.info(`[PATIENTS] Admin ${adminKey} deleted patient ${req.params.patientId}`);
        res.json(result);
      } catch (error) {
        const status = error.status ?? 500;
        logger.error(`[PATIENTS] DELETE /:id error: ${error.message}`, { stack: error.stack });
        res.status(status).json({ message: error.message });
      }
    }
  );

  // ---------------------------------------------------------------------------
  // Twin-access management
  // ---------------------------------------------------------------------------

  /**
   * @swagger
   * /patients/{patientId}/twin-access:
   *   get:
   *     summary: Get allowed twin IDs for a patient
   *     description: >
   *       Returns the list of AI twin _keys this patient is allowed to access.
   *       A `null` value means no restriction (all twins visible).
   *       An empty array means the patient cannot see any twin.
   *     tags: [Patients]
   *     security:
   *       - BearerAuth: []
   *     parameters:
   *       - in: path
   *         name: patientId
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Twin access info
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 patientKey:
   *                   type: string
   *                 allowedTwinIds:
   *                   nullable: true
   *                   type: array
   *                   items:
   *                     type: string
   *       403:
   *         description: Admin access required
   *       404:
   *         description: Patient not found
   */
  router.get(
    '/:patientId/twin-access',
    authMiddleware.authenticate,
    authMiddleware.isAdmin,
    async (req, res) => {
      try {
        const result = await patientService.getPatientTwinAccess(req.user._key, req.params.patientId);
        res.json(result);
      } catch (error) {
        const status = error.status ?? 500;
        logger.error(`[PATIENTS] GET /:id/twin-access: ${error.message}`, { stack: error.stack });
        res.status(status).json({ message: error.message });
      }
    }
  );

  /**
   * @swagger
   * /patients/{patientId}/twin-access:
   *   put:
   *     summary: Replace the allowed twin list for a patient
   *     description: >
   *       Pass an array of twin _keys to restrict access to exactly those twins.
   *       Pass `null` to remove all restrictions (patient sees all twins).
   *       Pass an empty array to block the patient from all twins.
   *     tags: [Patients]
   *     security:
   *       - BearerAuth: []
   *     parameters:
   *       - in: path
   *         name: patientId
   *         required: true
   *         schema:
   *           type: string
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               allowedTwinIds:
   *                 nullable: true
   *                 type: array
   *                 items:
   *                   type: string
   *     responses:
   *       200:
   *         description: Updated twin access
   *       403:
   *         description: Admin access required
   *       404:
   *         description: Patient not found
   */
  router.put(
    '/:patientId/twin-access',
    authMiddleware.authenticate,
    authMiddleware.isAdmin,
    async (req, res) => {
      try {
        const { allowedTwinIds } = req.body;
        if (allowedTwinIds !== null && !Array.isArray(allowedTwinIds)) {
          return res.status(400).json({ message: 'allowedTwinIds must be an array or null' });
        }
        const result = await patientService.setPatientTwinAccess(
          req.user._key,
          req.params.patientId,
          allowedTwinIds
        );
        res.json(result);
      } catch (error) {
        const status = error.status ?? 500;
        logger.error(`[PATIENTS] PUT /:id/twin-access: ${error.message}`, { stack: error.stack });
        res.status(status).json({ message: error.message });
      }
    }
  );

  /**
   * @swagger
   * /patients/{patientId}/twin-access/{twinId}:
   *   post:
   *     summary: Enable a specific twin for a patient
   *     tags: [Patients]
   *     security:
   *       - BearerAuth: []
   *     parameters:
   *       - in: path
   *         name: patientId
   *         required: true
   *         schema:
   *           type: string
   *       - in: path
   *         name: twinId
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Twin added to patient's allowed list
   *       403:
   *         description: Admin access required
   *       404:
   *         description: Patient not found
   */
  router.post(
    '/:patientId/twin-access/:twinId',
    authMiddleware.authenticate,
    authMiddleware.isAdmin,
    async (req, res) => {
      try {
        const result = await patientService.addPatientTwinAccess(
          req.user._key,
          req.params.patientId,
          req.params.twinId
        );
        logger.info(`[PATIENTS] Admin ${req.user._key} enabled twin ${req.params.twinId} for patient ${req.params.patientId}`);
        res.json(result);
      } catch (error) {
        const status = error.status ?? 500;
        logger.error(`[PATIENTS] POST /:id/twin-access/:twinId: ${error.message}`, { stack: error.stack });
        res.status(status).json({ message: error.message });
      }
    }
  );

  /**
   * @swagger
   * /patients/{patientId}/twin-access/{twinId}:
   *   delete:
   *     summary: Disable a specific twin for a patient
   *     tags: [Patients]
   *     security:
   *       - BearerAuth: []
   *     parameters:
   *       - in: path
   *         name: patientId
   *         required: true
   *         schema:
   *           type: string
   *       - in: path
   *         name: twinId
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Twin removed from patient's allowed list
   *       403:
   *         description: Admin access required
   *       404:
   *         description: Patient not found
   */
  router.delete(
    '/:patientId/twin-access/:twinId',
    authMiddleware.authenticate,
    authMiddleware.isAdmin,
    async (req, res) => {
      try {
        const result = await patientService.removePatientTwinAccess(
          req.user._key,
          req.params.patientId,
          req.params.twinId
        );
        logger.info(`[PATIENTS] Admin ${req.user._key} disabled twin ${req.params.twinId} for patient ${req.params.patientId}`);
        res.json(result);
      } catch (error) {
        const status = error.status ?? 500;
        logger.error(`[PATIENTS] DELETE /:id/twin-access/:twinId: ${error.message}`, { stack: error.stack });
        res.status(status).json({ message: error.message });
      }
    }
  );

  return router;
};
