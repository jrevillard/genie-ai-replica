'use strict';

/**
 * 003-drop-legacy-unique-indexes.js
 *
 * Drops legacy unique indexes that conflict with multi-realm Keycloak support.
 * Keycloak does not guarantee email uniqueness across realms, and loginName is
 * an obsolete field from the pre-Keycloak auth system.
 *
 * Idempotent — only drops indexes that actually exist.
 */

module.exports = {
  async up(db) {
    const usersCollection = db.collection('users');
    const indexes = await usersCollection.indexes();

    for (const idx of indexes) {
      const field = idx.fields.length === 1 ? idx.fields[0] : null;

      // Drop any unique index on email (hash, persistent, or skiplist)
      if (field === 'email' && idx.unique === true) {
        console.log(`  Dropping legacy unique email index "${idx.name}" (type: ${idx.type})`);
        await usersCollection.dropIndex(idx.id);
      }

      // Drop any unique index on loginName
      if (field === 'loginName' && idx.unique === true) {
        console.log(`  Dropping legacy unique loginName index "${idx.name}" (type: ${idx.type})`);
        await usersCollection.dropIndex(idx.id);
      }
    }

    console.log('  Legacy unique index cleanup complete');
  }
};
