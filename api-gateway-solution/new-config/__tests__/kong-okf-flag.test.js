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
    expect(restoreScript).toMatch(/del\(\.services\[\] \| select\(\.name == "okf-server"\)\)/);
    expect(restoreScript).toMatch(/del\(\.routes\[\] \| select\(\(\.tags \/\/ \[\]\) \| index\("okf"\)\)\)/);
  });
});
