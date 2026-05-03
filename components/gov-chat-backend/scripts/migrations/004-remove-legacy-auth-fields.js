'use strict';

/**
 * 004-remove-legacy-auth-fields.js
 *
 * Removes obsolete auth fields from all user documents.
 * These fields were used by the pre-Keycloak authentication system:
 * - loginName: replaced by `name` from Keycloak claims
 * - role: replaced by Keycloak realm roles
 * - accessToken, refreshToken, encPassword: replaced by Keycloak token management
 *
 * Idempotent — safe to run multiple times.
 */

const LEGACY_FIELDS = ['loginName', 'role', 'accessToken', 'refreshToken', 'encPassword'];

module.exports = {
  async up(db) {
    for (const field of LEGACY_FIELDS) {
      const cursor = await db.query(
        `FOR u IN users FILTER HAS(u, @field) RETURN u._id`,
        { field }
      );
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
