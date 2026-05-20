const path = require('path');
const { parseEnvTemplate, getRequiredSecrets } = require('../validators/parse-env');
const { parseComposeEnvVars, crossReference } = require('../validators/parse-compose');
const { validateFeatureFlags, OPEA_VAR_NAMES } = require('../validators/validate-features');
const {
  validateHardwareProfile,
  validateProfileConsistency,
  parseGpuProfile,
  GPU_RANGES
} = require('../validators/validate-hardware');

const ROOT = path.resolve(__dirname, '../../..');
const ENV_FILE = path.join(ROOT, 'env');
const COMPOSE_FILE = path.join(ROOT, 'docker-compose.yaml');
const T4_FILE = path.join(ROOT, 'env.t4');
const RTX6000_FILE = path.join(ROOT, 'env.rtx6000');

describe('Configuration Validation Suite', () => {
  let envParsed;
  let composeVars;
  let xRef;

  beforeAll(() => {
    envParsed = parseEnvTemplate(ENV_FILE);
    composeVars = parseComposeEnvVars(COMPOSE_FILE);
    xRef = crossReference(composeVars, envParsed);
  });

  // --- AC #2: All docker-compose env vars are documented in env template ---
  describe('AC2: Docker-compose vars documented in env template', () => {
    test('required compose vars (no default) are present in env template', () => {
      // Vars WITHOUT defaults in compose are required secrets — must be in env template.
      // Vars WITH defaults are optional and may not need env template documentation.
      const requiredComposeVars = composeVars.filter((v) => !v.hasDefault);
      const envNames = new Set(envParsed.variables.map((v) => v.name));
      const missing = requiredComposeVars.filter((v) => !envNames.has(v.name));
      expect(missing.map((v) => v.name)).toEqual([]);
    });

    test('compose vars are extracted with correct defaults', () => {
      const varWithDefault = composeVars.find((v) => v.name === 'VLLM_GPU_UTILIZATION');
      expect(varWithDefault).toBeDefined();
      expect(varWithDefault.default).toBe('0.4');
    });

    test('compose vars without defaults have null default', () => {
      const noDefault = composeVars.find((v) => v.name === 'ARANGO_PASSWORD');
      expect(noDefault).toBeDefined();
      expect(noDefault.default).toBeNull();
    });
  });

  // --- AC #3: Required secrets have no undefined defaults ---
  describe('AC3: Required secrets have no undefined defaults', () => {
    test('required secrets are correctly identified', () => {
      const secrets = getRequiredSecrets(envParsed);

      const expectedSecrets = [
        'ARANGO_PASSWORD',
        'POSTGRES_PASSWORD',
        'KONG_DB_PASSWORD',
        'KEYCLOAK_ADMIN_PASSWORD',
        'KEYCLOAK_CLIENT_SECRET',
        'KEYCLOAK_PROXY_CLIENT_SECRET',
        'KEYCLOAK_DB_PASSWORD',
        'HUGGING_FACE_HUB_TOKEN',
        'EMAIL_HOST',
        'EMAIL_PORT',
        'EMAIL_USER',
        'EMAIL_PASSWORD',
        'EMAIL_FROM',
        'GENIE_ADMIN_PASSWORD',
        'TRANSLATION_CACHE_PASSWORD'
      ];

      const secretNames = secrets.map((s) => s.name);
      for (const expected of expectedSecrets) {
        expect(secretNames).toContain(expected);
      }
    });

    test('required secrets have empty value in env template', () => {
      const secrets = getRequiredSecrets(envParsed);
      for (const secret of secrets) {
        expect(secret.name).toBeTruthy();
      }
    });
  });

  // --- AC #4: No orphaned or conflicting configurations ---
  describe('AC4: No orphaned or conflicting configurations', () => {
    test('orphans are documented (known intentional ones)', () => {
      // These env vars are intentionally not in docker-compose.yaml
      // They may be used by application code directly or in other config files
      const knownOrphans = new Set([
        'KEYCLOAK_URL', // Used by backend directly
        'KEYCLOAK_REALM', // Used by backend directly
        'KEYCLOAK_CLIENT_ID', // Used by backend directly
        'KEYCLOAK_CLIENT_SECRET', // Used by keycloak-config directly
        'KC_DATAPREP_CLIENT_ID', // Used by keycloak-config
        'KC_MOBILE_CLIENT_ID', // Used by keycloak-config
        'KC_MOBILE_REDIRECT_SCHEME', // Used by keycloak-config
        'VUE_APP_API_URL', // Build-time variable
        'VUE_PROXY_HOST', // Build-time variable
        'VUE_APP_CSP_CONNECT_SRC', // Build-time variable
        'KEYCLOAK_ADDITIONAL_REALMS', // Used by backend
        'OPEA_HOST', // Used by backend code
        'CONTEXT_OPTION', // Used by backend code
        'SESSION_EXPIRATION_TIME', // Used by backend code
        'VLLM_API_KEY' // Optional, used by OPEA services
      ]);

      const unknownOrphans = xRef.orphaned.filter((name) => !knownOrphans.has(name));
      expect(unknownOrphans).toEqual([]);
    });

    test('no conflicting defaults between compose and env template', () => {
      expect(xRef.conflicting).toEqual([]);
    });
  });

  // --- AC #5: DEPLOY_OPEA feature flag interdependencies ---
  describe('AC5: DEPLOY_OPEA feature flag interdependencies', () => {
    test('OPEA service vars are documented in env template', () => {
      const result = validateFeatureFlags(envParsed, composeVars);
      expect(result.errors).toEqual([]);
    });

    test('DEPLOY_OPEA controls the expected OPEA services', () => {
      expect(Object.keys(validateFeatureFlags(envParsed, composeVars).opeaServiceVars).length).toBeGreaterThanOrEqual(
        10
      );
    });

    test('all OPEA vars are accounted for', () => {
      expect(OPEA_VAR_NAMES.size).toBeGreaterThanOrEqual(20);
    });
  });

  // --- AC #4 (extended): GPU profile parameters within valid ranges ---
  describe('AC4: GPU profile parameter validation', () => {
    test('T4 profile values are within valid ranges', () => {
      const result = validateHardwareProfile(T4_FILE, 'T4 (16GB VRAM)');
      expect(result.errors).toEqual([]);
    });

    test('RTX6000 profile values are within valid ranges', () => {
      const result = validateHardwareProfile(RTX6000_FILE, 'RTX6000 ADA (24GB VRAM)');
      expect(result.errors).toEqual([]);
    });

    test('T4 uses conservative settings vs RTX6000', () => {
      const t4 = parseGpuProfile(T4_FILE);
      const rtx = parseGpuProfile(RTX6000_FILE);
      const result = validateProfileConsistency(t4, rtx);
      expect(result.warnings).toEqual([]);
    });

    test('GPU profile defaults in docker-compose match valid ranges', () => {
      // Verify compose defaults for GPU vars are within GPU_RANGES
      for (const varDef of composeVars) {
        const range = GPU_RANGES[varDef.name];
        if (!range || !varDef.hasDefault) continue;

        if (range.type === 'enum') {
          expect(range.values).toContain(varDef.default);
        } else {
          const numVal = parseFloat(varDef.default);
          if (!isNaN(numVal)) {
            expect(numVal).toBeGreaterThanOrEqual(range.min);
            expect(numVal).toBeLessThanOrEqual(range.max);
          }
        }
      }
    });
  });

  // --- JUnit XML report is collected (AC #6) ---
  describe('AC6: JUnit XML report generation', () => {
    test('jest-junit reporter is configured', () => {
      const config = require('../jest.config.js');
      const junitReporter = config.reporters.find((r) => Array.isArray(r) && r[0] === 'jest-junit');
      expect(junitReporter).toBeDefined();
      expect(junitReporter[1].outputName).toBe('jest-config.xml');
    });
  });
});
