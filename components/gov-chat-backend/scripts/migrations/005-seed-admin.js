'use strict';

/**
 * 005-seed-admin.js
 *
 * Upserts the bootstrap admin from ADMIN_BOOTSTRAP_EMAIL. The JIT linker in
 * keycloak-auth-middleware.js (ensureUserProfile) matches Keycloak logins by
 * email, so the realm user with this email becomes role Admin on first login.
 * Idempotent; skips when ADMIN_BOOTSTRAP_EMAIL is unset.
 */

module.exports = {
  async up(db) {
    const email = (process.env.ADMIN_BOOTSTRAP_EMAIL || '').toLowerCase().trim();
    if (!email) {
      console.log('[005] ADMIN_BOOTSTRAP_EMAIL not set — skipping admin seed');
      return;
    }

    const users = db.collection('users');

    const cursor = await db.query(
      'FOR u IN users FILTER u.email == @email LIMIT 1 RETURN u',
      { email }
    );
    const byEmail = await cursor.next();
    if (byEmail) {
      await users.update(byEmail._key, { role: 'Admin', roles: ['admin'], status: 'Active', disabled: false });
      console.log(`[005] promoted existing user ${byEmail._key} (<${email}>) to Admin`);
      return;
    }

    try {
      await users.save({
        _key: 'bootstrap-admin',
        loginName: 'admin',
        email,
        emailVerified: true,
        role: 'Admin',
        roles: ['admin'],
        status: 'Active',
        disabled: false
      });
      console.log(`[005] seeded bootstrap admin for <${email}>`);
    } catch (conflict) {
      // _key taken by a different email (re-run after rotation) — fix in place
      await users.update('bootstrap-admin', { email, role: 'Admin', roles: ['admin'], status: 'Active', disabled: false });
      console.log(`[005] re-pointed bootstrap-admin to <${email}>`);
    }
  }
};
