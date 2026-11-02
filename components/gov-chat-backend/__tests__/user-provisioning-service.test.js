// user-provisioning-service unit suite: dbService.getConnection is mocked via
// the shared-lib manual mock (repo pattern). Pins the A5 contract: UPSERT
// search key/params carry iss_sub, legacy-email migration runs before the
// UPSERT, soft-deleted users get reactivation fields, and the 60s cache
// prevents repeat DB round-trips. A6 additions: status knob (Pending/Active),
// profile stubs, admin-notify on first Pending insert, evictUser, and the
// concurrency guarantee (N parallel provisions → exactly one row).
const mockNotifyAdmins = jest.fn().mockResolvedValue({ success: true });
jest.mock('../services/email-service', () => ({
  sendNewUserNotificationToAdmins: (...args) => mockNotifyAdmins(...args)
}));

const TOKEN = {
  iss: 'http://localhost:8080/realms/genie',
  sub: 'user-123',
  iss_sub: 'http://localhost:8080/realms/genie#user-123',
  email: 'test@example.com',
  name: 'Test User',
  email_verified: true,
  preferred_username: 'tuser',
  realm_access: { roles: ['user'] }
};

// Builds a fake db whose query() records every aql spec; cursor results are
// consumed lazily (.next() shifts the queue) so ignored UPDATE cursors don't eat values.
function makeDb(cursorResults) {
  const specs = [];
  const queue = [...cursorResults];
  const db = {
    query: async (spec) => {
      specs.push(spec);
      return { next: async () => (queue.length ? queue.shift() : null) };
    }
  };
  return { db, specs };
}

function freshService(db) {
  jest.resetModules();
  const sharedLib = require('../mocks/shared-lib.js'); // same module the jest mapper serves
  sharedLib.dbService.getConnection.mockResolvedValue(db);
  return require('../services/user-provisioning-service');
}

function isUpsert(spec) {
  return typeof spec.query === 'string' && spec.query.includes('UPSERT');
}

describe('userProvisioningService', () => {
  beforeEach(() => {
    mockNotifyAdmins.mockClear().mockResolvedValue({ success: true });
    delete process.env.USER_APPROVAL_REQUIRED;
  });

  it('UPSERTs on iss_sub: search key + insert doc carry the composite identity', async () => {
    const { db, specs } = makeDb([null, null, { new: { iss_sub: TOKEN.iss_sub }, old: null }]);
    const svc = freshService(db);

    const user = await svc.provisionUser(TOKEN);

    expect(user.iss_sub).toBe(TOKEN.iss_sub);
    const upsert = specs.find(isUpsert);
    expect(upsert).toBeDefined();
    // aql binds values as value0… — the first bind var is the UPSERT search key
    expect(upsert.bindVars.value0).toBe(TOKEN.iss_sub);
    expect(Object.values(upsert.bindVars)).toEqual(
      expect.arrayContaining([expect.objectContaining({ iss_sub: TOKEN.iss_sub, sub: TOKEN.sub, deleted: false })])
    );
  });

  it('migrates a legacy email-matched user (no iss_sub) before the UPSERT', async () => {
    const legacy = { _key: 'legacy-1', email: TOKEN.email, name: 'Old Name' };
    const { db, specs } = makeDb([legacy, null, { new: { iss_sub: TOKEN.iss_sub }, old: legacy }]);
    const svc = freshService(db);

    await svc.provisionUser(TOKEN);

    // legacy lookup, legacy UPDATE, deleted-check, UPSERT — in that order
    expect(specs.length).toBe(4);
    expect(specs[1].query).toContain('UPDATE');
    expect(specs[1].bindVars.value0).toBe('legacy-1');
    expect(isUpsert(specs[3])).toBe(true);
  });

  it('reactivation: soft-deleted user gets deleted:false / deletedAt:null / active:true in the update doc', async () => {
    const deletedUser = { _key: 'u1', iss_sub: TOKEN.iss_sub, deleted: true };
    const { db, specs } = makeDb([null, deletedUser, { new: { iss_sub: TOKEN.iss_sub, deleted: false }, old: deletedUser }]);
    const svc = freshService(db);

    await svc.provisionUser(TOKEN);

    const upsert = specs.find(isUpsert);
    // value1 = INSERT doc, value2 = UPDATE doc (aql bind order)
    expect(upsert.bindVars.value2).toEqual(
      expect.objectContaining({ deleted: false, deletedAt: null, active: true })
    );
  });

  it('cache: second provision within TTL reuses the first result without new queries', async () => {
    const { db, specs } = makeDb([null, null, { new: { iss_sub: TOKEN.iss_sub }, old: null }]);
    const svc = freshService(db);

    const first = await svc.provisionUser(TOKEN);
    const queryCount = specs.length;
    const second = await svc.provisionUser(TOKEN);

    expect(second).toBe(first);
    expect(specs.length).toBe(queryCount);
  });

  it('markUserAsDeleted updates by iss_sub and invalidates the cache', async () => {
    const { db, specs } = makeDb([
      null, // legacy lookup
      null, // deleted check
      { new: { iss_sub: TOKEN.iss_sub }, old: null }, // UPSERT (prime)
      { _key: 'u1' }, // markUserAsDeleted UPDATE cursor
      null, // legacy lookup (re-provision after invalidation)
      null, // deleted check
      { new: { iss_sub: TOKEN.iss_sub }, old: null } // UPSERT (re-provision)
    ]);
    const svc = freshService(db);

    await svc.provisionUser(TOKEN); // prime cache
    await svc.markUserAsDeleted(TOKEN.iss_sub);

    const last = specs[specs.length - 1];
    expect(last.query).toContain('UPDATE');
    expect(Object.values(last.bindVars)).toContain(TOKEN.iss_sub);

    // re-provision hits the DB again (cache was invalidated)
    const before = specs.length;
    await svc.provisionUser(TOKEN);
    expect(specs.length).toBeGreaterThan(before);
  });

  describe('A6 approval lifecycle', () => {
    it('USER_APPROVAL_REQUIRED=true: INSERT carries status Pending + profile stubs, admin-notify attempted', async () => {
      process.env.USER_APPROVAL_REQUIRED = 'true';
      const { db, specs } = makeDb([null, null, { new: { iss_sub: TOKEN.iss_sub, status: 'Pending' }, old: null }]);
      const svc = freshService(db);

      const user = await svc.provisionUser(TOKEN);

      const upsert = specs.find(isUpsert);
      // value1 = INSERT doc (aql bind order)
      expect(upsert.bindVars.value1).toEqual(
        expect.objectContaining({
          status: 'Pending',
          loginName: 'tuser',
          personalIdentification: { fullName: 'Test User', firstName: null, lastName: null }
        })
      );
      // UPDATE doc never writes status — admin decisions stick
      expect(upsert.bindVars.value2).not.toHaveProperty('status');
      expect(mockNotifyAdmins).toHaveBeenCalledTimes(1);
      expect(mockNotifyAdmins).toHaveBeenCalledWith({
        fullName: 'Test User',
        loginName: 'tuser',
        email: 'test@example.com'
      });
      expect(user.status).toBe('Pending');
    });

    it('USER_APPROVAL_REQUIRED=false: INSERT status Active, no admin-notify', async () => {
      process.env.USER_APPROVAL_REQUIRED = 'false';
      const { db, specs } = makeDb([null, null, { new: { iss_sub: TOKEN.iss_sub, status: 'Active' }, old: null }]);
      const svc = freshService(db);

      await svc.provisionUser(TOKEN);

      const upsert = specs.find(isUpsert);
      expect(upsert.bindVars.value1).toEqual(expect.objectContaining({ status: 'Active' }));
      expect(mockNotifyAdmins).not.toHaveBeenCalled();
    });

    it('knob tolerates YAML-bool rendering: "True" (ansible env.j2) still means approval ON', async () => {
      process.env.USER_APPROVAL_REQUIRED = 'True';
      const { db, specs } = makeDb([null, null, { new: { iss_sub: TOKEN.iss_sub, status: 'Pending' }, old: null }]);
      const svc = freshService(db);

      await svc.provisionUser(TOKEN);

      const upsert = specs.find(isUpsert);
      expect(upsert.bindVars.value1).toEqual(expect.objectContaining({ status: 'Pending' }));
    });

    it('notify failure is non-blocking: warn logged, provisioning still returns the user', async () => {
      process.env.USER_APPROVAL_REQUIRED = 'true';
      mockNotifyAdmins.mockRejectedValue(new Error('SMTP down'));
      const { db } = makeDb([null, null, { new: { iss_sub: TOKEN.iss_sub, status: 'Pending' }, old: null }]);
      const svc = freshService(db);

      const user = await svc.provisionUser(TOKEN);
      expect(user.iss_sub).toBe(TOKEN.iss_sub);
    });

    it('existing user re-provision: status is NOT rewritten and no duplicate notify', async () => {
      process.env.USER_APPROVAL_REQUIRED = 'true';
      const existing = { _key: 'u1', iss_sub: TOKEN.iss_sub, status: 'Active' };
      const { db, specs } = makeDb([null, null, { new: { ...existing }, old: existing }]);
      const svc = freshService(db);

      await svc.provisionUser(TOKEN);

      const upsert = specs.find(isUpsert);
      expect(upsert.bindVars.value2).not.toHaveProperty('status');
      expect(mockNotifyAdmins).not.toHaveBeenCalled();
    });

    it('evictUser: next provision re-queries instead of serving the cached doc', async () => {
      const { db, specs } = makeDb([
        null, // legacy lookup (prime)
        null, // deleted check (prime)
        { new: { iss_sub: TOKEN.iss_sub }, old: null }, // UPSERT (prime)
        null, // legacy lookup (re-provision)
        null, // deleted check (re-provision)
        { new: { iss_sub: TOKEN.iss_sub }, old: null } // UPSERT (re-provision)
      ]);
      const svc = freshService(db);

      await svc.provisionUser(TOKEN); // prime cache
      svc.evictUser(TOKEN.iss_sub);

      const before = specs.length;
      await svc.provisionUser(TOKEN);
      expect(specs.length).toBeGreaterThan(before);
    });

    it('concurrency: N parallel first provisions produce exactly one UPSERT row', async () => {
      process.env.USER_APPROVAL_REQUIRED = 'true';
      // Async db with real awaiting — interleaves like a live Arango under load
      const specs = [];
      const upsertResult = { new: { iss_sub: TOKEN.iss_sub, status: 'Pending' }, old: null };
      const results = [null, null, upsertResult]; // legacy lookup, deleted check, UPSERT
      const db = {
        query: async (spec) => {
          specs.push(spec);
          await new Promise((r) => setTimeout(r, 5));
          return { next: async () => (results.length ? results.shift() : null) };
        }
      };
      const svc = freshService(db);

      const users = await Promise.all([
        svc.provisionUser(TOKEN),
        svc.provisionUser(TOKEN),
        svc.provisionUser(TOKEN),
        svc.provisionUser(TOKEN),
        svc.provisionUser(TOKEN)
      ]);

      // Every caller shares the SAME provisioned row object
      expect(new Set(users.map((u) => u)).size).toBe(1);
      expect(specs.filter(isUpsert)).toHaveLength(1);
      expect(mockNotifyAdmins).toHaveBeenCalledTimes(1);
    });
  });
});
