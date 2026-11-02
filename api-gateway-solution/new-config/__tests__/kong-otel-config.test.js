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

    test('opentelemetry config has traces_endpoint pointing to OTel Collector', () => {
      expect(otelPlugin.config.traces_endpoint).toBe(
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

    test('script errors when opentelemetry plugin not found and obs is enabled', () => {
      expect(restoreScript).toMatch(
        /ERROR.*opentelemetry plugin not found.*cannot enable tracing/,
      );
    });

    test('script increments errors counter on plugin-not-found failure', () => {
      // Verify errors=$((errors + 1)) follows the plugin-not-found ERROR
      expect(restoreScript).toMatch(
        /ERROR.*opentelemetry plugin not found[\s\S]*?errors=\$\(\(errors \+ 1\)\)/,
      );
    });

    test('script increments errors counter on PATCH failure', () => {
      // Verify errors=$((errors + 1)) follows the PATCH failure ERROR
      expect(restoreScript).toMatch(
        /ERROR.*Failed to enable opentelemetry plugin[\s\S]*?errors=\$\(\(errors \+ 1\)\)/,
      );
    });

    test('script does not error when plugin not found and obs is disabled', () => {
      expect(restoreScript).toMatch(
        /opentelemetry plugin not found.*skipping toggle.*observability disabled/,
      );
    });

    test('script exits with error code when errors > 0', () => {
      expect(restoreScript).toMatch(/exit\s+\$\{_restore_rc/);
    });

    test('script uses curl to query plugin ID via Admin API', () => {
      expect(restoreScript).toMatch(
        /curl.*KONG_ADMIN_URL.*plugins.*jq.*opentelemetry/,
      );
    });
  });

  describe('A3 — Keycloak root-context flip (keycloak-route + compose pins)', () => {
    let kongConfig;
    let kongConfigSingleNode;
    let composeContent;

    beforeAll(() => {
      kongConfig = JSON.parse(fs.readFileSync(KONG_CONFIG_PATH, 'utf8'));
      kongConfigSingleNode = JSON.parse(
        fs.readFileSync(
          path.resolve(__dirname, '..', 'kong_config.json-single-node'),
          'utf8',
        ),
      );
      composeContent = fs.readFileSync(
        path.resolve(__dirname, '..', '..', '..', 'docker-compose.yaml'),
        'utf8',
      );
    });

    test('keycloak-route exists with strip_path true (prefix stripped before proxying root-context KC)', () => {
      const route = kongConfig.routes.find((r) => r.name === 'keycloak-route');
      expect(route).toBeDefined();
      expect(route.strip_path).toBe(true);
    });

    test('keycloak-route keeps the X-Forwarded-Prefix request-transformer (public URLs keep /auth)', () => {
      const route = kongConfig.routes.find((r) => r.name === 'keycloak-route');
      const transformer = route.plugins.find((p) => p.name === 'request-transformer');
      expect(transformer).toBeDefined();
      expect(transformer.config.add.headers).toContain('X-Forwarded-Prefix:/auth');
    });

    test('kong_config.json contains no legacy auth-login-route/auth-refresh-route', () => {
      const names = kongConfig.routes.map((r) => r.name);
      expect(names).not.toContain('auth-login-route');
      expect(names).not.toContain('auth-refresh-route');
    });

    test('kong_config.json-single-node contains no legacy auth-login-route/auth-refresh-route', () => {
      const names = kongConfigSingleNode.routes.map((r) => r.name);
      expect(names).not.toContain('auth-login-route');
      expect(names).not.toContain('auth-refresh-route');
    });

    test('chatqna/dataprep KEYCLOAK_INTERNAL_URL dial root-context keycloak (no /auth)', () => {
      // Backend's line retired in A5 (verifier uses the public KEYCLOAK_URL door);
      // chatqna + dataprep keep the internal root-context URL (map-style).
      expect(composeContent).toMatch(/KEYCLOAK_INTERNAL_URL: http:\/\/keycloak:8080\n/);
    });

    test('A3 stopgap envs retired (A5): KEYCLOAK_JWKS_URI + KEYCLOAK_TOKEN_URL gone from compose', () => {
      // The legacy middleware/routes that consumed them died with A5's convergence.
      expect(composeContent).not.toContain('KEYCLOAK_JWKS_URI=');
      expect(composeContent).not.toContain('KEYCLOAK_TOKEN_URL=');
    });

    test('grafana OAuth token/userinfo URLs dial root-context keycloak', () => {
      expect(composeContent).toContain(
        'GF_AUTH_GENERIC_OAUTH_TOKEN_URL=http://keycloak:8080/realms/${KEYCLOAK_REALM:-agrivisory}/protocol/openid-connect/token',
      );
      expect(composeContent).toContain(
        'GF_AUTH_GENERIC_OAUTH_API_URL=http://keycloak:8080/realms/${KEYCLOAK_REALM:-agrivisory}/protocol/openid-connect/userinfo',
      );
    });

    test('docker-compose.yaml contains zero legacy 8080/auth references', () => {
      expect((composeContent.match(/8080\/auth/g) || []).length).toBe(0);
    });
  });

  describe('Docker Compose — Kong tracing defaults', () => {
    let composeContent;

    beforeAll(() => {
      const composePath = path.resolve(__dirname, '..', '..', '..', 'docker-compose.yaml');
      composeContent = fs.readFileSync(composePath, 'utf8');
    });

    test('KONG_TRACING_INSTRUMENTATIONS defaults to request', () => {
      expect(composeContent).toMatch(
        /KONG_TRACING_INSTRUMENTATIONS=\$\{KONG_TRACING_INSTRUMENTATIONS:-request\}/,
      );
    });

    test('KONG_TRACING_SAMPLING_RATE defaults to 1.0', () => {
      expect(composeContent).toMatch(
        /KONG_TRACING_SAMPLING_RATE=\$\{KONG_TRACING_SAMPLING_RATE:-1\.0\}/,
      );
    });
  });
});
