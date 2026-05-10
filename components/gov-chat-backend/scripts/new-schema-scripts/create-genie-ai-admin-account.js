'use strict';

/**
 * Creates or restores a legacy local-login admin row in Arango `users`.
 *
 * Why this exists: migration 004 removes `loginName` / `encPassword` for Keycloak
 * users. If you still use the Vue login form (`POST /api/auth/login`), those fields
 * must exist and `encPassword` must be bcrypt( sha256_hex( plain_password ) ) — same
 * as registration (see authService.hashPassword + AuthService.hashPassword).
 *
 * Run from backend package root so `bcrypt` / `arangojs` resolve:
 *   cd components/gov-chat-backend
 *   ARANGO_URL=http://127.0.0.1:8529 ARANGO_DB=genie-ai ARANGO_PASSWORD=... \
 *     ADMIN_PLAIN_PASSWORD='YourNewPassword1' node scripts/new-schema-scripts/create-genie-ai-admin-account.js
 *
 * Or omit ADMIN_PLAIN_PASSWORD to be prompted (input is visible — use env in production).
 */

const path = require('path');
const crypto = require('crypto');
const readline = require('readline');

const backendRoot = path.join(__dirname, '..', '..');
const bcrypt = require(require.resolve('bcrypt', { paths: [backendRoot] }));
const { Database } = require(require.resolve('arangojs', { paths: [backendRoot] }));

const DEFAULT_LOGIN = process.env.ADMIN_LOGIN_NAME || 'Admin';
const DEFAULT_EMAIL = process.env.ADMIN_EMAIL || 'admin@admin.com';

function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise(resolve =>
    rl.question(query, ans => {
      rl.close();
      resolve(ans);
    })
  );
}

function encPasswordForApp(plain) {
  const shaHex = crypto.createHash('sha256').update(plain, 'utf8').digest('hex');
  return bcrypt.hash(shaHex, 10);
}

async function createAdminUser() {
  const dbConfig = {
    url: process.env.ARANGO_URL || 'http://127.0.0.1:8529',
    databaseName: process.env.ARANGO_DB || process.env.ARANGO_DATABASE || 'genie-ai',
    auth: {
      username: process.env.ARANGO_USER || 'root',
      password: process.env.ARANGO_PASSWORD
    }
  };

  if (!dbConfig.auth.password) {
    console.error('ERROR: ARANGO_PASSWORD is required.');
    process.exit(1);
  }

  console.log('--- Legacy admin login restore / create ---');
  console.log('Sets loginName + encPassword (Vue-compatible) + emailVerified on one user.');
  console.log('\nDatabase configuration:');
  console.log(`  URL:      ${dbConfig.url}`);
  console.log(`  Database: ${dbConfig.databaseName}`);
  console.log(`  User:     ${dbConfig.auth.username}`);
  console.log(`  Match:    loginName="${DEFAULT_LOGIN}" OR email="${DEFAULT_EMAIL}"`);

  const answer = await askQuestion('\nProceed? (Y/n) ');
  if (answer.toLowerCase() !== 'y') {
    console.log('Cancelled.');
    process.exit(0);
  }

  let plain = process.env.ADMIN_PLAIN_PASSWORD;
  if (!plain || !plain.length) {
    plain = await askQuestion('Enter new admin password (plain text, min 8 chars, mixed rules as your UI): ');
  }
  if (!plain || plain.length < 8) {
    console.error('Password too short or empty.');
    process.exit(1);
  }

  const hashed = await encPasswordForApp(plain);
  const db = new Database(dbConfig);
  const exists = await db.exists();
  if (!exists) {
    console.error(`Database "${dbConfig.databaseName}" does not exist.`);
    process.exit(1);
  }

  const users = db.collection('users');
  const cursor = await db.query(
    `FOR u IN users
       FILTER u.loginName == @login OR u.email == @email
       LIMIT 1
       RETURN u`,
    { login: DEFAULT_LOGIN, email: DEFAULT_EMAIL }
  );
  const existing = await cursor.next();
  const now = new Date().toISOString();

  if (existing) {
    await users.update(existing._key, {
      loginName: DEFAULT_LOGIN,
      email: DEFAULT_EMAIL,
      encPassword: hashed,
      emailVerified: true,
      updatedAt: now,
      role: 'Admin',
      roles: ['admin', 'user']
    });
    console.log(`Updated user _key=${existing._key} with legacy login fields (password reset).`);
  } else {
    const doc = {
      loginName: DEFAULT_LOGIN,
      email: DEFAULT_EMAIL,
      encPassword: hashed,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
      role: 'Admin',
      roles: ['admin', 'user'],
      personalIdentification: {
        fullName: DEFAULT_LOGIN,
        dob: '',
        gender: '',
        nationality: '',
        maritalStatus: ''
      }
    };
    const meta = await users.save(doc, { returnNew: true });
    console.log('Created new admin user:', meta.new._key);
  }

  console.log('\nDone. Log in via /login with login name:', DEFAULT_LOGIN, 'and the password you set.');
}

if (require.main === module) {
  createAdminUser().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
