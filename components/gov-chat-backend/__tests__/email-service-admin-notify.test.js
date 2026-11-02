// Pins the A6 admin-notify lookup AQL: admins are found by the JWT-claims
// array ('admin' IN u.roles — the pre-A6 scalar role=='Admin' matched nothing)
// and soft-deleted admins are excluded (markUserAsDeleted preserves email+roles).
// Runs the REAL sendNewUserNotificationToAdmins against the shared-lib db mock;
// EMAIL_HOST is pointed at localhost so the constructor's SMTP verify fails
// fast instead of dialing an external server from the test.
process.env.EMAIL_HOST = 'localhost';
process.env.EMAIL_PORT = '2525';
process.env.DEBUG_EMAIL = 'false';

function freshService(queryResults) {
  jest.resetModules();
  const specs = [];
  // re-required AFTER resetModules so the mock we configure is the instance
  // the freshly-required email-service sees (repo freshService pattern)
  const sharedLib = require('../mocks/shared-lib.js');
  sharedLib.dbService.getConnection.mockReset().mockResolvedValue({
    query: async (spec) => {
      specs.push(spec);
      return { all: async () => queryResults.shift() || [] };
    }
  });
  return { service: require('../services/email-service'), specs };
}

describe('EmailService.sendNewUserNotificationToAdmins (A6 lookup fix)', () => {
  it("queries admins by 'admin' IN u.roles and excludes disabled AND soft-deleted admins", async () => {
    const admin = { email: 'admin@example.com', fullName: 'Ada Admin' };
    const { service, specs } = freshService([[admin]]);

    const result = await service.sendNewUserNotificationToAdmins({
      fullName: 'New Bee',
      loginName: 'newbie',
      email: 'new@example.com'
    });

    // The pin is the QUERY: one admin matched, the SMTP dial itself fails fast
    // against localhost (no real server) → sent 0 / failed 1
    expect(result).toEqual({ success: true, sent: 0, failed: 1 });
    const q = specs[0].query;
    expect(q).toContain("'admin' IN u.roles");
    expect(q).toContain('u.disabled != true');
    expect(q).toContain('u.deleted != true'); // soft-deleted admins keep email+roles — must not be emailed
    // the legacy scalar lookup is gone
    expect(q).not.toContain("u.role == 'Admin'");
  });

  it('no admins found → success:false, no send attempted', async () => {
    const { service } = freshService([[]]);
    const result = await service.sendNewUserNotificationToAdmins({ fullName: 'X', email: 'x@y.z' });
    expect(result).toEqual(expect.objectContaining({ success: false }));
  });
});
