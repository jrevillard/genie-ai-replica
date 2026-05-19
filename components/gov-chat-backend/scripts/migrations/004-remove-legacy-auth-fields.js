'use strict';

/**
 * 004-remove-legacy-auth-fields.js  — DISABLED
 *
 * This migration was originally written to clean up legacy auth fields
 * (encPassword / loginName / role / accessToken / refreshToken) under the
 * assumption that all users had been migrated to Keycloak SSO.
 *
 * ON 2026-05-19 IT WAS DISCOVERED THAT THIS DEPLOYMENT STILL RELIES ON THE
 * LEGACY BCRYPT-IN-ARANGO AUTH PATH. Running this migration wiped the
 * encPassword field from all 21 real user accounts, locking everyone out.
 * The original password hashes are unrecoverable.
 *
 * THIS FILE IS INTENTIONALLY DISABLED:
 *   1. The `up` function below throws immediately, so even if the migration
 *      somehow gets re-scheduled it cannot delete data.
 *   2. The migration marker `004-remove-legacy-auth-fields` is pre-inserted
 *      into the `schema_migrations` collection so run-migrations.js will
 *      skip this file under normal conditions.
 *   3. The `genieai_db-migrations` service is scaled to 0 replicas in
 *      Swarm so the migration runner does not auto-run on stack deploy.
 *
 * DO NOT re-enable this migration until ALL of the following are true:
 *   - Every user document has `iss_sub` set (confirmed migrated to Keycloak).
 *   - An `arangodump` of the `users` collection has been taken immediately
 *     before the migration runs, and the dump is retained.
 *   - The migration body has been rewritten to ABORT (not silently null) if
 *     any user still has `encPassword` or is missing `iss_sub`. That is the
 *     missing sanity check that caused the 2026-05-19 incident.
 *
 * See `docs/incidents/2026-05-19-encpassword-wipe.md` (or the commit history
 * for this file) for the full story.
 */

module.exports = {
  async up() {
    throw new Error(
      'Migration 004-remove-legacy-auth-fields is DISABLED. ' +
      'See the file header for the 2026-05-19 incident that caused this. ' +
      'Do not re-enable without a backup and a pre-flight sanity check ' +
      'for users still on legacy auth.'
    );
  },
};
