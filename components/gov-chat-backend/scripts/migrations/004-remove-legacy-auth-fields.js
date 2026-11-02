'use strict';

/**
 * Migration 004 (pre-OIDC auth field strip)
 *
 * Removes obsolete auth fields from all user documents.
 * These fields were used by the pre-Keycloak authentication system:
 * - accessToken, refreshToken, encPassword: replaced by Keycloak token management
 * - keycloakId: replaced by the iss_sub composite identity (A5)
 *
 * Idempotent — safe to run multiple times.
 */

// A7: loginName and role REMOVED from the strip list — both are live fields
// (A6 provisioning writes loginName; approve writes the role label; /api/me
// and the admin queue read both). Only token/password-era remnants die here.
const LEGACY_FIELDS = ['accessToken', 'refreshToken', 'encPassword', 'keycloakId'];

module.exports = {
  async up(db) {
    for (const field of LEGACY_FIELDS) {
      const cursor = await db.query(`FOR u IN users FILTER HAS(u, @field) RETURN u._id`, { field });
      const ids = await cursor.all();

      if (ids.length === 0) {
        console.log(`  Field "${field}": no users have it, skipping`);
        continue;
      }

      await db.query(
        `FOR u IN users FILTER HAS(u, @field) UPDATE u WITH { [@field]: null } IN users OPTIONS { keepNull: false } RETURN NEW._key`,
        { field }
      );
      console.log(`  Removed "${field}" from ${ids.length} user(s)`);
    }

    console.log('  Legacy auth field cleanup complete');
  }
};
