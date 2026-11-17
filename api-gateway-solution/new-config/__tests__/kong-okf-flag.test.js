const fs = require('fs');
const path = require('path');

const KONG_CONFIG_PATH = path.resolve(__dirname, '..', 'kong_config.json');
const RESTORE_SCRIPT_PATH = path.resolve(__dirname, '..', 'restore-kong-config.sh');

// OKF feature flag (2026-10-21, merge prep): the okf-server service and
// /api/okf route are declared declaratively (they previously lived only as
// manually-created Admin-API entities — unreproducible on a fresh deploy)
// and the restore script strips/deletes them when OKF_ENABLED != 1.
describe('Kong OKF feature flag', () => {
  let kongConfig;
  let restoreScript;

  beforeAll(() => {
    kongConfig = JSON.parse(fs.readFileSync(KONG_CONFIG_PATH, 'utf8'));
    restoreScript = fs.readFileSync(RESTORE_SCRIPT_PATH, 'utf8');
  });

  test('okf-server service is declared declaratively', () => {
    const svc = kongConfig.services.find((s) => s.name === 'okf-server');
    expect(svc).toBeDefined();
    expect(svc).toMatchObject({ host: 'okf-server', port: 3002, protocol: 'http' });
  });

  test('okf-route is declared with the okf tag and /api/okf path', () => {
    const route = kongConfig.routes.find((r) => r.name === 'okf-route');
    expect(route).toBeDefined();
    expect(route.paths).toEqual(['/api/okf']);
    expect(route.tags).toContain('okf');
    expect(route.service.name).toBe('okf-server');
  });

  test('restore script strips the okf entities when OKF_ENABLED != 1', () => {
    // The gate reads OKF_ENABLED (compose passes it; default 0), deletes any
    // existing okf-tagged routes + the okf-server service (idempotent
    // disable), and filters both out of the declarative apply.
    expect(restoreScript).toMatch(/\$\{OKF_ENABLED:-0\}" != "1"/);
    // #1944 extended the filter to the okf-import service alongside
    // okf-server (the dedicated test below pins the full conjunctive form).
    expect(restoreScript).toMatch(/del\(\.services\[\] \| select\(\.name == "okf-server" or \.name == "okf-import"\)\)/);
    expect(restoreScript).toMatch(/del\(\.routes\[\] \| select\(\(\.tags \/\/ \[\]\) \| index\("okf"\)\)\)/);
  });

  // #1944: zip imports of 5-6k concepts run 55-75s (parse + PII + enqueue;
  // longer when imports queue on the sidecar) — Kong's 60s read_timeout on
  // the okf-server service cut the RESPONSE while okf-server continued, so
  // operators saw a red "import failed" for operations that succeeded. The
  // okf-import service carries express-api's 1h shape for the import POSTs;
  // everything else okf keeps the 60s backstop.
  test('okf-import service is declared with the long-timeout import shape', () => {
    const svc = kongConfig.services.find((s) => s.name === 'okf-import');
    expect(svc).toBeDefined();
    // Same upstream as okf-server — this is a timeout persona, not a
    // different backend.
    expect(svc).toMatchObject({
      host: 'okf-server',
      port: 3002,
      protocol: 'http',
      read_timeout: 3600000,
      write_timeout: 3600000,
      // Kong must never replay an import POST.
      retries: 0
    });
  });

  test('okf-import-route targets the import writes and keeps the okf tag', () => {
    const route = kongConfig.routes.find((r) => r.name === 'okf-import-route');
    expect(route).toBeDefined();
    expect(route.service.name).toBe('okf-import');
    expect(route.paths).toEqual(['/api/okf/repos/']);
    expect(route.methods).toEqual(['POST']);
    // The longer prefix outranks okf-route's /api/okf for matching requests;
    // POST /api/okf/repos (create) still routes at 60s — the prefix requires
    // the trailing segment.
    expect(route.strip_path).toBe(false);
    // The OKF_ENABLED parking deletes okf-tagged routes — the flag covers
    // the new pair too.
    expect(route.tags).toContain('okf');
  });

  test('restore script parks the okf-import service with the okf entities', () => {
    // The explicit Admin-API delete (idempotent disable) AND the declarative
    // jq filter must both name okf-import — a dangling 1h-timeout service
    // after a disable would be an unflagged OKF surface.
    expect(restoreScript).toMatch(/services\/okf-import"/);
    expect(restoreScript).toMatch(
      /del\(\.services\[\] \| select\(\.name == "okf-server" or \.name == "okf-import"\)\)/
    );
  });
});
