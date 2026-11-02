// 005-seed-admin migration suite: B3 made ADMIN_BOOTSTRAP_EMAIL derive from
// genie_admin_email (one vault var), which makes the migration's two upgrade
// branches load-bearing — a regression here means admin lockout with every
// deploy gate green. Pins: (a) re-point — a pre-existing bootstrap-admin doc
// carrying the OLD email gets email+role+status fixed in place when the _key
// save conflicts; (b) promote — an existing user doc already carrying the NEW
// email is flipped to Admin/Active. Mock-db pattern per the __tests__ idiom
// (user-provisioning-service.test.js); run with the vm-modules flag like the
// rest of the suite.
const NEW_EMAIL = 'admin@agriconnect.site';
const OLD_EMAIL = 'old-admin@agrivisory.local';

// Fake db: query() feeds the byEmail cursor; collection('users') records
// save()/update() calls. saveConflict simulates the _key unique-constraint
// error the re-point branch catches (pre-existing 'bootstrap-admin' doc).
function makeDb({ byEmail = null, saveConflict = false } = {}) {
  const calls = { query: [], saved: [], updates: [] };
  const users = {
    save: async (doc) => {
      if (saveConflict) {
        const err = new Error('conflict: unique constraint violated');
        err.errorNum = 1210;
        throw err;
      }
      calls.saved.push(doc);
      return doc;
    },
    update: async (key, data) => {
      calls.updates.push({ key, data });
      return { key, data };
    }
  };
  const db = {
    query: async (spec, binds) => {
      calls.query.push({ spec, binds });
      return { next: async () => byEmail };
    },
    collection: (name) => (name === 'users' ? users : undefined)
  };
  return { db, calls };
}

function freshMigration() {
  jest.resetModules();
  return require('../scripts/migrations/005-seed-admin');
}

describe('migration 005-seed-admin', () => {
  beforeEach(() => {
    process.env.ADMIN_BOOTSTRAP_EMAIL = NEW_EMAIL;
  });

  afterEach(() => {
    delete process.env.ADMIN_BOOTSTRAP_EMAIL;
  });

  it('re-point branch: bootstrap-admin doc with the OLD email is updated in place (email+role+status)', async () => {
    // No user carries the new email (byEmail null) and the 'bootstrap-admin'
    // _key is taken by the old-email doc → save conflicts → fix-in-place path.
    const { db, calls } = makeDb({ byEmail: null, saveConflict: true });
    const migration = freshMigration();

    await migration.up(db);

    expect(calls.saved).toHaveLength(0); // never inserts on conflict
    expect(calls.updates).toHaveLength(1);
    expect(calls.updates[0]).toEqual({
      key: 'bootstrap-admin',
      data: { email: NEW_EMAIL, role: 'Admin', roles: ['admin'], status: 'Active', disabled: false }
    });
  });

  it('promote branch: existing user doc carrying the NEW email is flipped to Admin/Active', async () => {
    // A realm-provisioned user already holds the new email → promote, no seed.
    const { db, calls } = makeDb({
      byEmail: { _key: 'user-7', email: NEW_EMAIL, role: 'User', status: 'Pending' }
    });
    const migration = freshMigration();

    await migration.up(db);

    expect(calls.saved).toHaveLength(0); // promote, not a second seed
    expect(calls.updates).toHaveLength(1);
    expect(calls.updates[0]).toEqual({
      key: 'user-7',
      data: { role: 'Admin', roles: ['admin'], status: 'Active', disabled: false }
    });
  });

  it('search key is the normalized (lowercased, trimmed) ADMIN_BOOTSTRAP_EMAIL', async () => {
    process.env.ADMIN_BOOTSTRAP_EMAIL = `  ${NEW_EMAIL.toUpperCase()}  `;
    const { db, calls } = makeDb({ byEmail: null, saveConflict: true });
    const migration = freshMigration();

    await migration.up(db);

    expect(calls.query[0].binds).toEqual({ email: NEW_EMAIL });
  });
});
