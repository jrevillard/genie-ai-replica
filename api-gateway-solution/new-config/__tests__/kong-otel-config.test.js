const fs = require('fs');
const path = require('path');

const KONG_CONFIG_PATH = path.resolve(__dirname, '..', 'kong_config.json');
const RESTORE_SCRIPT_PATH = path.resolve(__dirname, '..', 'restore-kong-config.sh');

describe('Kong OTel Configuration', () => {
  let kongConfig;
  let restoreScript;

  beforeAll(() => {
    kongConfig = JSON.parse(fs.readFileSync(KONG_CONFIG_PATH, 'utf8'));
    restoreScript = fs.readFileSync(RESTORE_SCRIPT_PATH, 'utf8');
  });

  describe('AC1 — OTel Plugin Activation (Task 4.1)', () => {
    let otelPlugin;

    beforeAll(() => {
      otelPlugin = kongConfig.plugins.find((p) => p.name === 'opentelemetry');
    });

    test('opentelemetry plugin exists in plugins array', () => {
      expect(otelPlugin).toBeDefined();
    });

    test('opentelemetry plugin is a global plugin (no service field)', () => {
      expect(otelPlugin.service).toBeUndefined();
    });

    test('opentelemetry plugin is disabled by default (safe default)', () => {
      expect(otelPlugin.enabled).toBe(false);
    });

    test('opentelemetry config has endpoint pointing to OTel Collector', () => {
      expect(otelPlugin.config.endpoint).toBe(
        'http://otel-collector:4318/v1/traces'
      );
    });

    test('opentelemetry config has resource_attributes with service.name = kong-gateway', () => {
      expect(otelPlugin.config.resource_attributes).toEqual({
        'service.name': 'kong-gateway',
      });
    });

    test('opentelemetry config has header_type = w3c', () => {
      expect(otelPlugin.config.header_type).toBe('w3c');
    });

    test('opentelemetry config has sampling_rate = 1.0', () => {
      expect(otelPlugin.config.sampling_rate).toBe(1.0);
    });
  });

  describe('AC5 — Plugin Compatibility — existing plugins preserved (Task 4.2)', () => {
    const expectedGlobalPlugins = ['prometheus'];
    const expectedServicePlugins = [
      'request-transformer',
      'rate-limiting',
      'cors',
      'file-log',
      'response-transformer',
      'request-termination',
    ];

    test('total plugin count is 8 (2 global + 6 service-scoped)', () => {
      // 1 prometheus + 1 opentelemetry (global) + 6 service-scoped = 8
      expect(kongConfig.plugins).toHaveLength(8);
    });

    test('existing global plugin prometheus is present and enabled', () => {
      const prom = kongConfig.plugins.find((p) => p.name === 'prometheus');
      expect(prom).toBeDefined();
      expect(prom.enabled).toBe(true);
      expect(prom.service).toBeUndefined(); // global
    });

    test.each(expectedServicePlugins)(
      'service plugin %s is present and scoped to express-api',
      (pluginName) => {
        const plugin = kongConfig.plugins.find((p) => p.name === pluginName);
        expect(plugin).toBeDefined();
        expect(plugin.service).toEqual({ name: 'express-api' });
      },
    );

    test('opentelemetry plugin does not disrupt existing plugin order', () => {
      const pluginNames = kongConfig.plugins.map((p) => p.name);
      expect(pluginNames).toEqual([
        'prometheus',
        'opentelemetry',
        'request-transformer',
        'rate-limiting',
        'cors',
        'file-log',
        'response-transformer',
        'request-termination',
      ]);
    });
  });

  describe('AC7 — Conditional Activation — restore script logic (Task 4.3)', () => {
    test('restore-kong-config.sh contains ENABLE_OBSERVABILITY conditional block', () => {
      expect(restoreScript).toMatch(/ENABLE_OBSERVABILITY/);
      expect(restoreScript).toMatch(/ENABLE_OBSERVABILITY.*=.*"1"/);
    });

    test('script enables opentelemetry plugin when observability is on', () => {
      expect(restoreScript).toMatch(/opentelemetry/);
      expect(restoreScript).toMatch(/enabled=true/);
      expect(restoreScript).toMatch(/PATCH.*plugins/);
    });

    test('script warns when opentelemetry plugin not found', () => {
      expect(restoreScript).toMatch(
        /opentelemetry plugin not found/,
      );
    });

    test('script uses curl to query plugin ID via Admin API', () => {
      expect(restoreScript).toMatch(
        /curl.*KONG_ADMIN_URL.*plugins.*jq.*opentelemetry/,
      );
    });
  });
});
