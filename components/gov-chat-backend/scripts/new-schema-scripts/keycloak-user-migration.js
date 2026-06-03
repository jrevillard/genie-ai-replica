/*
  Keycloak User Migration Script

  Creates/updates the 'users' collection schema for JIT user provisioning.
  Idempotent — safe to run multiple times.

  What this script does:
  - Ensures 'users' collection exists
  - Creates unique persistent index on 'iss_sub' (composite identity key)
  - Creates persistent (non-unique) index on 'email'
  - Handles legacy unique email index by dropping it if present

  Environment variables:
  - ARANGO_URL (default: 'http://127.0.0.1:8529')
  - ARANGO_DATABASE (default: 'node-services')
  - ARANGO_USER (default: 'root')
  - ARANGO_PASSWORD (default: 'test')
*/

require('dotenv').config();
const { Database } = require('arangojs');

let db;

const config = {
  url: process.env.ARANGO_URL || 'http://127.0.0.1:8529',
  database: process.env.ARANGO_DATABASE || 'node-services',
  auth: {
    username: process.env.ARANGO_USER || 'root',
    password: process.env.ARANGO_PASSWORD || 'test'
  }
};

async function initializeDatabase() {
  try {
    console.log(`Connecting to ArangoDB at ${config.url}, database "${config.database}"...`);

    db = new Database({
      url: config.url,
      databaseName: config.database,
      auth: config.auth
    });

    const info = await db.get();
    console.log(`Connected to database: ${info.name} (version: ${info.version})`);
  } catch (error) {
    console.error(`Failed to connect to database at ${config.url}.`);
    console.error('Error:', error.message);
    throw error;
  }
}

async function migrateUsersCollection() {
  try {
    const collection = db.collection('users');
    const exists = await collection.exists();

    if (exists) {
      console.log('"users" collection already exists. Skipping creation.');
    } else {
      console.log('Creating "users" collection...');
      await db.createCollection('users');
      console.log('"users" collection created successfully.');
    }

    // --- Handle legacy unique email index ---
    // Keycloak does not guarantee email uniqueness across realms — the same
    // email address can exist in multiple realms with different sub claims.
    // Must not enforce email uniqueness at the DB level for multi-realm support.
    try {
      const indexes = await collection.getIndexes();
      const legacyEmailIndex = indexes.find(
        (idx) => idx.fields.length === 1 && idx.fields[0] === 'email' && idx.unique === true
      );

      if (legacyEmailIndex) {
        console.log(`Dropping legacy unique email index "${legacyEmailIndex.name}"...`);
        await collection.dropIndex(legacyEmailIndex.id);
        console.log('Legacy unique email index dropped.');
      }
    } catch (err) {
      console.log(`Could not check/drop legacy email index: ${err.message}`);
      // Non-fatal — continue with migration
    }

    // --- Create iss_sub unique index (sparse: skip legacy users without iss_sub) ---
    console.log('Ensuring "iss_sub" unique index exists...');
    await collection.ensureIndex({
      type: 'persistent',
      fields: ['iss_sub'],
      unique: true,
      sparse: true,
      name: 'idx_users_iss_sub_unique'
    });
    console.log('"iss_sub" unique index is in place.');

    // --- Create email persistent index (non-unique) ---
    console.log('Ensuring "email" persistent index exists...');
    await collection.ensureIndex({
      type: 'persistent',
      fields: ['email'],
      unique: false,
      sparse: true,
      name: 'idx_users_email'
    });
    console.log('"email" persistent index is in place.');
  } catch (error) {
    console.error('Error during users collection migration:', error);
    throw error;
  }
}

async function main() {
  try {
    await initializeDatabase();
    await migrateUsersCollection();
    console.log('\nMigration complete. The "users" collection is ready for JIT provisioning.');
  } catch {
    console.error('\nMigration failed.');
    process.exit(1);
  }
}

if (require.main === module) {
  main()
    .then(() => {
      process.exit(0);
    })
    .catch(() => {
      process.exit(1);
    });
}

module.exports = { initializeDatabase, migrateUsersCollection };
