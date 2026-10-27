const path = require('path');
const fs = require('fs');
const os = require('os');
const { parseEnvTemplate, getRequiredSecrets } = require('../validators/parse-env');
const {
  parseComposeEnvVars,
  crossReference,
  parseComposeImages,
  parseAnsibleImages,
  parseGitlabCiImages,
  parseComposeServiceContracts
} = require('../validators/parse-compose');
const { parseEnvTemplateImageVars } = require('../validators/parse-env-template');
const { validateRetrieverEnvCoverage } = require('../validators/validate-retriever-env');
const { validateFeatureFlags, OPEA_VAR_NAMES } = require('../validators/validate-features');
const {
  validateHardwareProfile,
  validateProfileConsistency,
  parseGpuProfile,
  GPU_RANGES
} = require('../validators/validate-hardware');
const {
  validateGpuNode,
  crossReferenceGpu,
  parseGpuCompose,
  GPU_SERVICE_PORTS,
  GPU_REQUIRED_SERVICES,
  GPU_SHARED_COMPOSE_VARS
} = require('../validators/validate-gpu-node');
const { readLoginThemeNames } = require('../validators/validate-keycloak-theme');
const { collectThemeIssues, inspectThemes } = require('../validators/validate-keycloak-themes');

const ROOT = path.resolve(__dirname, '../../..');
const ENV_FILE = path.join(ROOT, 'env');
const COMPOSE_FILE = path.join(ROOT, 'docker-compose.yaml');
const GPU_COMPOSE_FILE = path.join(ROOT, 'docker-compose.gpu.yaml');
const T4_FILE = path.join(ROOT, 'env.t4');
const RTX6000_FILE = path.join(ROOT, 'env.rtx6000');
const ANSIBLE_GROUPVARS_FILE = path.join(ROOT, 'deploy/ansible/group_vars/all.yml');
const ENV_TEMPLATE_FILE = path.join(ROOT, 'deploy/ansible/templates/env.j2');
const SHARED_FACTS_FILE = path.join(ROOT, 'deploy/ansible/tasks/deploy-shared-facts.yml');

describe('Configuration Validation Suite', () => {
  let envParsed;
  let composeVars;
  let xRef;

  beforeAll(() => {
    envParsed = parseEnvTemplate(ENV_FILE);
    composeVars = parseComposeEnvVars(COMPOSE_FILE);
    xRef = crossReference(composeVars, envParsed);
  });

  // Env vars intentionally not referenced in any docker-compose file.
  // Used by application code, build scripts, or other config files.
  const KNOWN_ORPHANS = new Set([
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
    'VLLM_API_KEY', // Optional, used by OPEA services
    'GPU_PUBLIC_DOMAIN', // Used by GPU node certbot (not in main compose)
    // Section 14: Remote GPU Node — used by app node to point to GPU node
    'GPU_NODE_HOST',
    'VLLM_ENDPOINT',
    'VLLM_TRANSLATION_ENDPOINT',
    'EMBEDDING_SERVICE_URL',
    'RERANKER_SERVICE_URL',
    'DOCLING_ENDPOINT',
    'DOCLING_ENDPOINT_TIMEOUT',
    // Per-service image vars — infrastructure (not app config), used by compose only
    'GENIE_AI_REGISTRY',
    'GENIE_AI_GLOBAL_TAG'
  ]);

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
      expect(varWithDefault.default).toBe('0.55');
    });

    test('compose vars without defaults have null default', () => {
      const noDefault = composeVars.find((v) => v.name === 'ARANGO_PASSWORD');
      expect(noDefault).toBeDefined();
      expect(noDefault.default).toBeNull();
    });

    test('locale whitelist vars are extracted from compose with correct defaults', () => {
      const vueVar = composeVars.find((v) => v.name === 'VUE_APP_AVAILABLE_LOCALES');
      expect(vueVar).toBeDefined();
      expect(vueVar.hasDefault).toBe(true);
      expect(vueVar.default).toBe(''); // unset = all locales active

      const kcVar = composeVars.find((v) => v.name === 'KEYCLOAK_SUPPORTED_LOCALES');
      expect(kcVar).toBeDefined();
      expect(kcVar.hasDefault).toBe(true);
      // Default curated set as a JSON array string (envsubst into the realm YAML).
      expect(kcVar.default).toBe('["ar","de","en","es","fr","pt","ru","th","zh-Hans"]');
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
        'GENIE_ADMIN_EMAIL',
        'TRANSLATION_CACHE_PASSWORD'
      ];

      const secretNames = secrets.map((s) => s.name);
      for (const expected of expectedSecrets) {
        expect(secretNames).toContain(expected);
      }
    });
  });

  // --- AC #4: No orphaned or conflicting configurations ---
  describe('AC4: No orphaned or conflicting configurations', () => {
    test('orphans are documented (known intentional ones)', () => {
      const unknownOrphans = xRef.orphaned.filter((name) => !KNOWN_ORPHANS.has(name));
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

  // --- GPU node compose validation (issue #758) ---
  describe('GPU node compose validation', () => {
    let gpuExists = false;
    let gpuComposeVars;
    let gpuXRef;
    let gpuValidation;

    beforeAll(() => {
      gpuExists = fs.existsSync(GPU_COMPOSE_FILE);
      if (gpuExists) {
        gpuComposeVars = parseComposeEnvVars(GPU_COMPOSE_FILE);
        const gpuSharedVars = new Set([
          ...composeVars.map((v) => v.name),
          ...GPU_SHARED_COMPOSE_VARS,
          ...KNOWN_ORPHANS
        ]);
        gpuXRef = crossReferenceGpu(gpuComposeVars, envParsed, gpuSharedVars);
        gpuValidation = validateGpuNode(GPU_COMPOSE_FILE, COMPOSE_FILE);
      }
    });

    test('docker-compose.gpu.yaml exists', () => {
      expect(gpuExists).toBe(true);
    });

    test('all 5 AI services present with nginx on port 443', () => {
      if (!gpuExists) return;
      const gpu = parseGpuCompose(GPU_COMPOSE_FILE);
      for (const serviceName of Object.keys(GPU_SERVICE_PORTS)) {
        const svc = gpu.services.find((s) => s.name === serviceName);
        expect(svc).toBeDefined();
      }
      // nginx-gpu exposes port 443 (path-based routing)
      const nginx = gpu.services.find((s) => s.name === 'nginx-gpu');
      expect(nginx).toBeDefined();
      expect(nginx.ports).toContain(443);
    });

    test('nginx-gpu service exists', () => {
      if (!gpuExists) return;
      const gpu = parseGpuCompose(GPU_COMPOSE_FILE);
      const nginx = gpu.services.find((s) => s.name === 'nginx-gpu');
      expect(nginx).toBeDefined();
    });

    test('gpu_network is defined', () => {
      if (!gpuExists) return;
      const gpu = parseGpuCompose(GPU_COMPOSE_FILE);
      expect(gpu.networks).toContain('gpu_network');
    });

    test('all GPU image tags are pinned (no :latest)', () => {
      if (!gpuExists) return;
      const gpu = parseGpuCompose(GPU_COMPOSE_FILE);
      for (const serviceName of GPU_REQUIRED_SERVICES) {
        const actualImage = gpu.images.get(serviceName);
        expect(actualImage).toBeDefined();
        expect(actualImage).not.toMatch(/:latest$/);
        expect(actualImage).toContain(':');
      }
    });

    test('no GPU compose validation errors', () => {
      if (!gpuExists) return;
      expect(gpuValidation.errors).toEqual([]);
    });

    test('GPU compose vars cross-reference: no undocumented vars', () => {
      if (!gpuExists) return;
      expect(gpuXRef.undocumented).toEqual([]);
    });

    test('GPU compose vars cross-reference: no conflicting defaults', () => {
      if (!gpuExists) return;
      expect(gpuXRef.conflicting).toEqual([]);
    });

    test('GPU compose vars cross-reference: no unexpected orphans', () => {
      if (!gpuExists) return;
      // Only known orphans allowed (Section 14 vars used by app node, not GPU compose)
      expect(gpuXRef.orphaned).toEqual([]);
    });
  });

  // --- Image tag pinning (no :latest in deployment configs) ---
  describe('Image tag pinning (no :latest)', () => {
    test('all main compose image tags are pinned (no :latest)', () => {
      const images = parseComposeImages(COMPOSE_FILE);
      expect(images.length).toBeGreaterThan(0);

      // Variable references (${GENIE_AI_*_IMAGE:-...}) are the documented local-dev
      // escape hatch: their `${VAR:-latest}` fallback only resolves to :latest when
      // no env value is set, which is acceptable for local dev. Skip those — only
      // check literal image references, which must always be pinned.
      const literalImages = images.filter((img) => !img.isVariableRef);
      expect(literalImages.length).toBeGreaterThan(0);

      const violations = literalImages.filter((img) => img.image.endsWith(':latest'));
      expect(violations.map((v) => `${v.service}: ${v.image}`)).toEqual([]);

      // Every literal image must also have an explicit tag (not bare image:foo)
      const untagged = literalImages.filter((img) => !img.image.includes(':'));
      expect(untagged.map((v) => `${v.service}: ${v.image}`)).toEqual([]);
    });

    test('Ansible image tags are pinned (no :latest)', () => {
      if (!fs.existsSync(ANSIBLE_GROUPVARS_FILE)) return;
      const images = parseAnsibleImages(ANSIBLE_GROUPVARS_FILE);
      expect(images.length).toBeGreaterThan(0);

      const violations = images.filter((img) => img.image.endsWith(':latest'));
      expect(violations.map((v) => `${v.name}: ${v.image}`)).toEqual([]);
    });

    test('GitLab CI image tags are pinned (no :latest)', () => {
      const ciFile = path.join(ROOT, '.gitlab-ci.yml');
      if (!fs.existsSync(ciFile)) return;
      const images = parseGitlabCiImages(ciFile);
      expect(images.length).toBeGreaterThan(0);

      const violations = images.filter((img) => img.image.endsWith(':latest'));
      expect(violations.map((v) => `${v.job || 'global'}: ${v.image}`)).toEqual([]);
    });
  });

  // --- Admin-logs substrate always-on contract: VL + OTel Collector + otel-collector-init must start by default; VL pinned to 1 replica. ---
  describe('admin-logs always-on substrate', () => {
    let contracts;

    beforeAll(() => {
      contracts = parseComposeServiceContracts(COMPOSE_FILE);
    });

    const findService = (name) => contracts.find((c) => c.service === name);

    test('victorialogs has no observability profile (always-on)', () => {
      const svc = findService('victorialogs');
      expect(svc).toBeDefined();
      expect(svc.profiles).not.toContain('observability');
    });

    test('otel-collector has no observability profile (always-on)', () => {
      const svc = findService('otel-collector');
      expect(svc).toBeDefined();
      expect(svc.profiles).not.toContain('observability');
    });

    test('otel-collector-init has no observability profile (always-on)', () => {
      const svc = findService('otel-collector-init');
      expect(svc).toBeDefined();
      expect(svc.profiles).not.toContain('observability');
    });

    test('victorialogs deploy.replicas is pinned to literal 1 (not env-gated)', () => {
      const svc = findService('victorialogs');
      expect(svc).toBeDefined();
      expect(svc.replicas).toBe('1');
    });

    test('opt-in services still gated behind [observability] profile', () => {
      for (const name of ['victoriametrics', 'victoriatraces', 'grafana', 'tempo-proxy']) {
        const svc = findService(name);
        expect({ svc: name, found: !!svc, profiles: svc ? svc.profiles : null }).toEqual({
          svc: name,
          found: true,
          profiles: expect.arrayContaining(['observability'])
        });
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

  // --- env.j2 per-service image vars vs docker-compose references ---
  // env.j2 (rendered by Ansible) is the only producer of the per-service
  // GENIE_AI_<NAME>_IMAGE / _IMAGE_TAG values; docker-compose.yaml is their
  // only consumer. A name mismatch on either side makes compose silently
  // fall back to GENIE_AI_GLOBAL_TAG — no deploy error, wrong image deployed
  // (the doubled-prefix bug: per-service overrides were a silent no-op).
  describe('env template per-service image vars', () => {
    const derivedVars = parseEnvTemplateImageVars(ENV_TEMPLATE_FILE, SHARED_FACTS_FILE);

    test('every var env.j2 renders is referenced by docker-compose', () => {
      const composeNames = new Set(composeVars.map((v) => v.name));
      const unreferenced = derivedVars.flatMap((d) => [d.imageVar, d.tagVar]).filter((name) => !composeNames.has(name));
      expect(unreferenced).toEqual([]);
    });

    test('every per-service GENIE_AI_* var compose references is rendered by env.j2', () => {
      const rendered = new Set(derivedVars.flatMap((d) => [d.imageVar, d.tagVar]));
      const unrendered = composeVars
        .map((v) => v.name)
        .filter(
          (name) =>
            name.startsWith('GENIE_AI_') &&
            name !== 'GENIE_AI_REGISTRY' &&
            name !== 'GENIE_AI_GLOBAL_TAG' &&
            !rendered.has(name)
        );
      expect(unrendered).toEqual([]);
    });
  });
  // --- Keycloak login theme marker ---
  // The base login theme marks its own pages so a child theme
  // (genie-el-salvador, parent=genie) keeps its own ground and wave. The
  // marker follows the theme directory name: the template tests the
  // resource path, the CSS scopes the ground and the band to the class
  // the template emits. A rename that breaks the chain drops the ground
  // and the wave with no error anywhere.
  describe('Keycloak login theme marker', () => {
    let names;

    beforeAll(() => {
      // Read in a hook, not while the suite is collected: a theme that
      // lost a file has to fail one check, not the whole file.
      names = readLoginThemeNames(ROOT, 'genie');
    });

    // A theme of its own, on a tree of its own: the checks read the
    // tree, so the tree is what has to be right.
    const writeLoginTemplate = (root, template) => {
      const dir = path.join(root, 'configs', 'keycloak', 'themes', 'demo', 'login');
      fs.mkdirSync(path.join(dir, 'resources'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'theme.properties'), 'styles=css/genie.css\n');
      fs.writeFileSync(path.join(dir, 'template.ftl'), template);
    };

    // The stylesheets that paint only one of the ground and the wave.
    // Each side is asserted on its own: a stylesheet that drops the
    // wave but keeps the ground leaves the page half-decorated in one
    // colour scheme only; one that drops both leaves the other
    // scheme's ground and blend in place.
    const halfPainted = (paintedByStyle) =>
      paintedByStyle
        .filter((entry) => !entry.pseudoElements.includes('before') || !entry.pseudoElements.includes('after'))
        .map((entry) => entry.style);

    // The stylesheets on disk, read from the filesystem and not from
    // the helper: the assertion has to be able to fail.
    const stylesheetsOnDisk = (dir, prefix = '') => {
      const found = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const name = `${prefix}${entry.name}`;
        if (entry.isDirectory()) {
          found.push(...stylesheetsOnDisk(path.join(dir, entry.name), `${name}/`));
        } else if (entry.name.endsWith('.css')) {
          found.push(name);
        }
      }
      return found.sort();
    };

    test('the login template tests the resource path of its own theme', () => {
      expect(names.testedPath).toBe(names.themeName);
    });

    test('the template emits the marker class of its own theme', () => {
      expect(names.emittedClass).toBe(`kc-theme-${names.themeName}`);
    });

    test('the marker is emitted only for the base theme', () => {
      expect(names.emittedConditionally).toBe(true);
    });

    test('the body keeps the id the stylesheets select on', () => {
      expect(names.bodyId).toBe('keycloak-bg');
    });

    test('the ground and the wave are scoped to the marker class', () => {
      // The marker has to sit in the compound that selects the body, as
      // a class token: `.kc-theme-genie-2` is not `.kc-theme-genie`, and
      // `body.kc-theme-genie #keycloak-bg` selects another element. The
      // guard owns the rule: it reports the selectors that are not
      // scoped, and there are none.
      expect(names.unscopedSelectors).toEqual([]);
    });

    test('the theme paints the ground and the wave', () => {
      const painted = names.paintedSelectors.join(' ');
      expect(painted).toMatch(/#keycloak-bg::before/);
      expect(painted).toMatch(/#keycloak-bg::after/);
    });

    test('every stylesheet the theme declares is on disk', () => {
      // The theme holds two stylesheets — the light one and the dark
      // one — and declares two. A drop of either leaves a colour
      // scheme undecorated. The declared set is checked against the
      // files on disk: the helper's own reading of the property would
      // hold whatever the theme declares. What the stylesheets paint is
      // the claim of the two tests that follow.
      const declared = [...names.styles].sort();
      const onDisk = stylesheetsOnDisk(path.join(ROOT, 'configs', 'keycloak', 'themes', 'genie', 'login', 'resources'));
      expect(declared).toEqual(onDisk);
    });

    test('every stylesheet the theme declares is read', () => {
      // A stylesheet the helper does not read is one nothing checks:
      // the ground and the wave of the other colour scheme would go
      // unnoticed.
      const onDisk = stylesheetsOnDisk(path.join(ROOT, 'configs', 'keycloak', 'themes', 'genie', 'login', 'resources'));
      expect(names.paintedByStyle.map((entry) => entry.style).sort()).toEqual(onDisk);
    });

    test('every stylesheet paints the ground and the wave', () => {
      expect(halfPainted(names.paintedByStyle)).toEqual([]);
    });

    describe('the base theme assignment', () => {
      let root;

      beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'kc-theme-'));
      });

      afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
      });

      test('the assignment that decides the base theme is the test of the resource path', () => {
        // The marker follows the theme directory name. An assignment
        // that also matches another theme hands the marker to the child
        // themes, which then lose their own ground and wave.
        writeLoginTemplate(
          root,
          "<#assign isBaseTheme = url.resourcesPath?ends_with('/login/demo') || " +
            "url.resourcesPath?ends_with('/login/child')>" +
            '<body id="keycloak-bg" class="<#if isBaseTheme>kc-theme-demo </#if>"></body>'
        );
        expect(readLoginThemeNames(root, 'demo').testedPath).toBeNull();
      });

      test('an assignment in an HTML comment is not an assignment', () => {
        // An HTML comment is not output: the assignment it holds is not
        // the one the page carries.
        writeLoginTemplate(
          root,
          "<!-- <#assign isBaseTheme = url.resourcesPath?ends_with('/login/demo')> -->" +
            '<#assign isBaseTheme = true>' +
            '<body id="keycloak-bg" class="<#if isBaseTheme>kc-theme-demo </#if>"></body>'
        );
        expect(readLoginThemeNames(root, 'demo').testedPath).toBeNull();
      });
    });

    describe('the stylesheets of a theme of its own', () => {
      let root;

      beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'kc-theme-'));
      });

      afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
      });

      const writeStylesheet = (content) => {
        const dir = path.join(root, 'configs', 'keycloak', 'themes', 'demo', 'login', 'resources', 'css');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'genie.css'), content);
      };

      test('a stylesheet that paints neither the ground nor the wave is reported', () => {
        // The stylesheet the theme declares says nothing about the
        // ground and the wave: the page comes up undecorated, and
        // nothing says so.
        writeLoginTemplate(root, '<body id="keycloak-bg"></body>');
        writeStylesheet('.a { color: red; }');
        expect(halfPainted(readLoginThemeNames(root, 'demo').paintedByStyle)).toEqual(['css/genie.css']);
      });

      test('a stylesheet that paints only the ground is reported', () => {
        writeLoginTemplate(root, '<body id="keycloak-bg"></body>');
        writeStylesheet('body.kc-theme-demo#keycloak-bg::before { content: ""; }');
        expect(halfPainted(readLoginThemeNames(root, 'demo').paintedByStyle)).toEqual(['css/genie.css']);
      });

      test('a stylesheet that paints the ground outside the marker is reported', () => {
        // The marker has to sit in the compound that carries
        // `#keycloak-bg`: `body.kc-theme-demo #keycloak-bg` selects
        // another element, so the ground would be painted for the child
        // themes as well.
        writeLoginTemplate(root, '<body id="keycloak-bg" class="<#if isBaseTheme>kc-theme-demo </#if>"></body>');
        writeStylesheet('body.kc-theme-demo #keycloak-bg::before { content: ""; }');
        expect(readLoginThemeNames(root, 'demo').unscopedSelectors).toEqual([
          'body.kc-theme-demo #keycloak-bg::before'
        ]);
      });
    });

    describe('the body id', () => {
      let root;

      beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'kc-theme-'));
      });

      afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
      });

      test('an id on an inner element is not the body id', () => {
        // The id the stylesheets select on belongs to the body: an id
        // that moved inside it is not the body's id.
        writeLoginTemplate(root, '<body class="x"><div id="keycloak-bg"></div></body>');
        expect(readLoginThemeNames(root, 'demo').bodyId).toBe('');
      });

      test('a page id is the body id when the body has no id', () => {
        writeLoginTemplate(root, '<body data-page-id="login-page" class="x"></body>');
        expect(readLoginThemeNames(root, 'demo').bodyId).toBe('login-page');
      });

      test('the id wins over the page id', () => {
        writeLoginTemplate(root, '<body id="keycloak-bg" data-page-id="login-page"></body>');
        expect(readLoginThemeNames(root, 'demo').bodyId).toBe('keycloak-bg');
      });
    });
  });
  describe('Keycloak theme assets', () => {
    let root;

    beforeEach(() => {
      root = fs.mkdtempSync(path.join(os.tmpdir(), 'kc-theme-'));
    });

    afterEach(() => {
      fs.rmSync(root, { recursive: true, force: true });
    });

    // A minimal theme: the checks read the tree, so the tree is what
    // has to be right, not a copy of the repository's themes.
    // `resources` are the theme's assets; `templates` are the files
    // Keycloak renders (an email template lives outside `resources`).
    const writeTheme = (type, properties, { resources = {}, templates = {}, theme = 'demo' } = {}) => {
      const dir = path.join(root, 'configs', 'keycloak', 'themes', theme, type);
      fs.mkdirSync(path.join(dir, 'resources'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'theme.properties'), properties);
      const write = (base, files) => {
        for (const [name, content] of Object.entries(files)) {
          const file = path.join(base, name);
          fs.mkdirSync(path.dirname(file), { recursive: true });
          fs.writeFileSync(file, content);
        }
      };
      write(path.join(dir, 'resources'), resources);
      write(dir, templates);
    };

    test('every file the themes point at exists', () => {
      // A theme that names a stylesheet, a logo or an image that is not
      // there loads anyway: the page comes up, the masthead shows a
      // broken image, the band under the form never appears.
      expect(collectThemeIssues(ROOT)).toEqual([]);
    });

    test('the guard walks the themes of the repository', () => {
      // An empty list of issues means "clean" only if the guard looked
      // at the theme that ships: the guard reports the themes and the
      // types it walked, and the theme of the repository is one of
      // them.
      expect(inspectThemes(ROOT).inspected).toContainEqual({ theme: 'genie', type: 'login' });
    });

    describe('a broken reference is reported', () => {
      test('an image a stylesheet names', () => {
        writeTheme('admin', 'styles=css/genie.css\n', {
          resources: { 'css/genie.css': '.a { background: url(../img/wave.svg); }' }
        });
        expect(collectThemeIssues(root)).toEqual([
          { theme: 'demo', type: 'admin', kind: 'asset', reference: '../img/wave.svg' }
        ]);
      });

      test('a logo the theme does not have', () => {
        writeTheme('admin', 'logo=/img/logo.png\n');
        expect(collectThemeIssues(root)).toEqual([
          { theme: 'demo', type: 'admin', kind: 'logo', reference: '/img/logo.png' }
        ]);
      });

      test('a `cid:` image in an email template', () => {
        // Keycloak attaches nothing to an email: a `cid:` reference is
        // a broken image in every mail client.
        writeTheme('email', 'parent=keycloak\n', {
          templates: { 'html/template.ftl': '<img src="cid:logo.png" alt="GENIE.AI">' }
        });
        expect(collectThemeIssues(root)).toEqual([
          { theme: 'demo', type: 'email', kind: 'cid', reference: 'logo.png' }
        ]);
      });

      test('an image an email template names by URL', () => {
        // The theme provides the img directory, so the image the
        // template names has to be there.
        writeTheme('email', 'parent=keycloak\n', {
          resources: { 'img/keep.png': 'binary' },
          templates: { 'html/template.ftl': '<img src="${url.resourcesUrl}/img/logo.png" alt="GENIE.AI">' }
        });
        expect(collectThemeIssues(root)).toEqual([
          { theme: 'demo', type: 'email', kind: 'asset', reference: 'img/logo.png' }
        ]);
      });

      test('a `cid:` in a comment is not a `cid:` in the mail', () => {
        // The comment carries a `cid:` the scanner would match if the
        // comment were not stripped: a FreeMarker comment is not output.
        writeTheme('email', 'parent=keycloak\n', {
          templates: { 'html/template.ftl': '<#-- a cid:logo.png reference would break --><p>hello</p>' }
        });
        expect(collectThemeIssues(root)).toEqual([]);
      });

      test('a `CID:` in another case is still a `cid:`', () => {
        writeTheme('email', 'parent=keycloak\n', {
          templates: { 'html/template.ftl': '<img src="CID:logo.png" alt="GENIE.AI">' }
        });
        expect(collectThemeIssues(root)).toEqual([
          { theme: 'demo', type: 'email', kind: 'cid', reference: 'logo.png' }
        ]);
      });

      test('a `cid:` in an HTML comment is not a `cid:` in the mail', () => {
        writeTheme('email', 'parent=keycloak\n', {
          templates: { 'html/template.ftl': '<!-- <img src="cid:logo.png"> --><p>hello</p>' }
        });
        expect(collectThemeIssues(root)).toEqual([]);
      });

      test('a stylesheet the theme imports and does not have', () => {
        writeTheme('admin', 'styles=css/genie.css\n', {
          resources: { 'css/genie.css': '@import "missing.css";\n.a { color: red; }' }
        });
        expect(collectThemeIssues(root)).toEqual([
          { theme: 'demo', type: 'admin', kind: 'import', reference: 'missing.css' }
        ]);
      });

      test('an image an imported stylesheet names', () => {
        writeTheme('admin', 'styles=css/genie.css\n', {
          resources: {
            'css/genie.css': '@import "base.css";',
            'css/base.css': '.a { background: url(../img/wave.svg); }'
          }
        });
        expect(collectThemeIssues(root)).toEqual([
          { theme: 'demo', type: 'admin', kind: 'asset', reference: '../img/wave.svg' }
        ]);
      });

      test('a stylesheet a child theme borrows from its parent', () => {
        // A child theme serves the parent's stylesheets: the file lives
        // in the parent's resources and the child is served it, so it
        // is not a broken reference.
        writeTheme('login', 'parent=base\nstyles=css/base.css\n', { theme: 'child' });
        writeTheme('login', 'styles=css/base.css\n', {
          theme: 'base',
          resources: { 'css/base.css': '.a { color: red; }' }
        });
        expect(collectThemeIssues(root)).toEqual([]);
      });

      test('a property the theme separates with a colon', () => {
        // Keycloak reads theme.properties as a Java properties file: a
        // colon separates as well as an equals sign.
        writeTheme('admin', 'styles:css/genie.css\n');
        expect(collectThemeIssues(root)).toEqual([
          { theme: 'demo', type: 'admin', kind: 'styles', reference: 'css/genie.css' }
        ]);
      });

      test('a favicon the theme does not have', () => {
        writeTheme('admin', 'favIcon=/img/favicon.ico\n');
        expect(collectThemeIssues(root)).toEqual([
          { theme: 'demo', type: 'admin', kind: 'favIcon', reference: '/img/favicon.ico' }
        ]);
      });

      test('a script the theme does not have', () => {
        writeTheme('admin', 'scripts=js/app.js\n');
        expect(collectThemeIssues(root)).toEqual([
          { theme: 'demo', type: 'admin', kind: 'scripts', reference: 'js/app.js' }
        ]);
      });

      test('a stylesheet the theme names outside its own resources is reported', () => {
        // The value spells a path that leaves the theme: the browser
        // asks for that path and gets nothing, whatever the file on
        // disk says.
        writeTheme('login', 'parent=base\nstyles=../../../base/login/resources/css/genie.css\n', { theme: 'child' });
        writeTheme('login', 'styles=css/genie.css\n', {
          theme: 'base',
          resources: { 'css/genie.css': '.a { color: red; }' }
        });
        expect(collectThemeIssues(root)).toEqual([
          {
            theme: 'child',
            type: 'login',
            kind: 'styles',
            reference: '../../../base/login/resources/css/genie.css'
          }
        ]);
      });

      test('a logo that is a directory and not a file', () => {
        writeTheme('admin', 'logo=/img/logo.png\n');
        fs.mkdirSync(
          path.join(root, 'configs', 'keycloak', 'themes', 'demo', 'admin', 'resources', 'img', 'logo.png'),
          { recursive: true }
        );
        expect(collectThemeIssues(root)).toEqual([
          { theme: 'demo', type: 'admin', kind: 'logo', reference: '/img/logo.png' }
        ]);
      });
    });

    // --- the properties file is read the way java.util.Properties reads
    // it. The oracle is java.util.Properties.load on OpenJDK 8, 17 and
    // 25: every expectation below is what the JVM answers.
    describe('a theme.properties is read as java.util.Properties reads it', () => {
      test('the whitespace before the separator is skipped', () => {
        // `parent = x` is the key `parent` and the value `x`.
        writeTheme('login', 'parent = nonexistent\n');
        expect(collectThemeIssues(root)).toEqual([
          { theme: 'demo', type: 'login', kind: 'parent', reference: 'nonexistent' }
        ]);
      });

      test('the trailing whitespace of a value is kept', () => {
        // The value is `base `, with its space: no theme carries that
        // name.
        writeTheme('login', 'parent=base \n');
        expect(collectThemeIssues(root)).toEqual([
          { theme: 'demo', type: 'login', kind: 'parent', reference: 'base ' }
        ]);
      });

      test('a non-breaking space after the separator is part of the value', () => {
        // java.util.Properties skips a space, a tab and a form feed
        // after the separator; a non-breaking space is an ordinary
        // character there. The parent is `keycloak.v2` with that space
        // in front of it, and no theme carries that name.
        writeTheme('login', 'parent=\u00a0keycloak.v2\n');
        expect(collectThemeIssues(root)).toEqual([
          { theme: 'demo', type: 'login', kind: 'parent', reference: '\u00a0keycloak.v2' }
        ]);
      });

      test('the trailing non-breaking space of a value is kept', () => {
        // The value is `keycloak.v2` with a non-breaking space at the
        // end of it: Keycloak reads the value with the space, and no
        // theme carries that name.
        writeTheme('login', 'parent=keycloak.v2\u00a0\n');
        expect(collectThemeIssues(root)).toEqual([
          { theme: 'demo', type: 'login', kind: 'parent', reference: 'keycloak.v2\u00a0' }
        ]);
      });

      test('a comment does not swallow the line that follows it', () => {
        // A `#` at the start of a line is a comment to the end of that
        // line, even when the line ends with a backslash.
        writeTheme('login', '# comment \\\nstyles=css/missing.css\n');
        expect(collectThemeIssues(root)).toEqual([
          { theme: 'demo', type: 'login', kind: 'styles', reference: 'css/missing.css' }
        ]);
      });

      test('a `#` inside a value is text', () => {
        writeTheme('login', 'styles=css/genie.css#v2\n');
        expect(collectThemeIssues(root)).toEqual([
          { theme: 'demo', type: 'login', kind: 'styles', reference: 'css/genie.css#v2' }
        ]);
      });

      test('a malformed unicode escape breaks the file', () => {
        // java.util.Properties throws on a `\u` that is not four hex
        // digits; the file is invalid, not a literal.
        writeTheme('login', 'styles=css/genie.css\\u12\n');
        expect(collectThemeIssues(root)).toEqual([
          {
            theme: 'demo',
            type: 'login',
            kind: 'properties',
            reference: 'theme.properties',
            detail: 'Malformed \\uxxxx encoding.'
          }
        ]);
      });

      test('a property the theme continues on the next line', () => {
        // The backslash escapes the newline: the value is `base`, the
        // theme that is on disk.
        writeTheme('login', 'parent=bas\\\ne\nstyles=css/missing.css\n', { theme: 'child' });
        writeTheme('login', 'styles=css/base.css\n', {
          theme: 'base',
          resources: { 'css/base.css': '.a { color: red; }' }
        });
        expect(collectThemeIssues(root)).toEqual([
          { theme: 'child', type: 'login', kind: 'styles', reference: 'css/missing.css' }
        ]);
      });

      test('a property the theme does not continue on the next line', () => {
        // Two backslashes: the last one escapes the other, so the line
        // ends there and the next line is a line of its own.
        writeTheme('login', 'parent=base\\\\\nstyles=css/missing.css\n');
        expect(collectThemeIssues(root)).toEqual([
          { theme: 'demo', type: 'login', kind: 'parent', reference: 'base\\' },
          { theme: 'demo', type: 'login', kind: 'styles', reference: 'css/missing.css' }
        ]);
      });

      test('a property with several separators keeps the rest of the line', () => {
        // The key ends at the first separator: the value is
        // `css/a.css=css/b.css`.
        writeTheme('login', 'styles=css/a.css=css/b.css\n');
        expect(collectThemeIssues(root)).toEqual([
          { theme: 'demo', type: 'login', kind: 'styles', reference: 'css/a.css=css/b.css' }
        ]);
      });

      test('a property separated by whitespace keeps the rest of the line', () => {
        // The whitespace ends the key: the value is `css/a.css=css/b.css`.
        writeTheme('login', 'styles css/a.css=css/b.css\n');
        expect(collectThemeIssues(root)).toEqual([
          { theme: 'demo', type: 'login', kind: 'styles', reference: 'css/a.css=css/b.css' }
        ]);
      });
    });

    // --- the theme chain ------------------------------------------------
    describe('the theme chain is followed', () => {
      test('a parent the theme does not have is reported', () => {
        // Keycloak refuses to load a theme whose parent is missing.
        writeTheme('login', 'parent=nonexistent\n');
        expect(collectThemeIssues(root)).toEqual([
          { theme: 'demo', type: 'login', kind: 'parent', reference: 'nonexistent' }
        ]);
      });

      test('a built-in parent is not reported', () => {
        // The built-in themes live in the image, not on disk.
        writeTheme('login', 'parent=keycloak.v2\n');
        expect(collectThemeIssues(root)).toEqual([]);
      });

      test('a stylesheet the grandparent theme has is not reported', () => {
        writeTheme('login', 'parent=middle\nstyles=css/base.css\n', { theme: 'child' });
        writeTheme('login', 'parent=base\n', { theme: 'middle' });
        writeTheme('login', 'styles=css/base.css\n', {
          theme: 'base',
          resources: { 'css/base.css': '.a { color: red; }' }
        });
        expect(collectThemeIssues(root)).toEqual([]);
      });

      test('an import the theme does not have is reported', () => {
        writeTheme('login', 'import=common/nonexistent\n');
        expect(collectThemeIssues(root)).toEqual([
          {
            theme: 'demo',
            type: 'login',
            kind: 'themeImport',
            reference: 'common/nonexistent',
            detail: 'the imported theme does not exist'
          }
        ]);
      });

      test('an import of a built-in theme is not reported', () => {
        writeTheme('login', 'import=common/keycloak\n');
        expect(collectThemeIssues(root)).toEqual([]);
      });

      test('an import of a theme type Keycloak does not serve is reported', () => {
        writeTheme('login', 'import=bogus/keycloak\n');
        expect(collectThemeIssues(root)).toEqual([
          {
            theme: 'demo',
            type: 'login',
            kind: 'themeImport',
            reference: 'bogus/keycloak',
            detail: 'the theme type bogus is not one Keycloak serves'
          }
        ]);
      });

      test('an import that names no theme type is reported', () => {
        writeTheme('login', 'import=keycloak\n');
        expect(collectThemeIssues(root)).toEqual([
          {
            theme: 'demo',
            type: 'login',
            kind: 'themeImport',
            reference: 'keycloak',
            detail: 'the import names no theme type'
          }
        ]);
      });

      test('a file the imported theme has is not reported', () => {
        // The imported theme's resources are served too.
        writeTheme('login', 'import=common/shared\nstyles=css/genie.css\n');
        writeTheme('common', '', {
          theme: 'shared',
          resources: { 'css/genie.css': '.a { color: red; }' }
        });
        expect(collectThemeIssues(root)).toEqual([]);
      });
    });

    // --- the theme types ------------------------------------------------
    describe('every theme type is scanned', () => {
      for (const type of ['login', 'admin', 'account', 'email', 'welcome', 'common']) {
        test(`a broken reference in the ${type} type is reported`, () => {
          writeTheme(type, 'styles=css/missing.css\n');
          expect(collectThemeIssues(root)).toEqual([
            { theme: 'demo', type, kind: 'styles', reference: 'css/missing.css' }
          ]);
        });
      }

      test('a theme type without a theme.properties is not a theme', () => {
        // Keycloak ignores the directory, and the other types of the
        // theme are still checked.
        const dir = path.join(root, 'configs', 'keycloak', 'themes', 'demo', 'login');
        fs.mkdirSync(path.join(dir, 'resources'), { recursive: true });
        fs.writeFileSync(path.join(dir, 'template.ftl'), '<img src="cid:logo.png">');
        writeTheme('admin', 'styles=css/missing.css\n');
        expect(collectThemeIssues(root)).toEqual([
          { theme: 'demo', type: 'admin', kind: 'styles', reference: 'css/missing.css' }
        ]);
      });
    });

    // --- the references a stylesheet holds -------------------------------
    describe('a stylesheet is read', () => {
      test('the prelude of an at-rule names no file of the theme', () => {
        // `@import url(...)` is an import, not an asset, and the
        // prelude of an at-rule names no file.
        writeTheme('admin', 'styles=css/genie.css\n', {
          resources: {
            'css/genie.css':
              '@import url("vendor/patternfly.min.css");\n@media screen and (min-width: 100px) { .a { color: red; } }'
          }
        });
        expect(collectThemeIssues(root)).toEqual([
          { theme: 'demo', type: 'admin', kind: 'import', reference: 'vendor/patternfly.min.css' }
        ]);
      });

      test('a file an at-rule holds is still checked', () => {
        writeTheme('admin', 'styles=css/genie.css\n', {
          resources: {
            'css/genie.css': '@media screen { .a { background: url(../img/wave.svg); } }'
          }
        });
        expect(collectThemeIssues(root)).toEqual([
          { theme: 'demo', type: 'admin', kind: 'asset', reference: '../img/wave.svg' }
        ]);
      });

      test('a reference outside the theme is not reported', () => {
        // The stylesheet names a file outside the theme's resources: it
        // is not a file of the theme.
        writeTheme('admin', 'styles=css/genie.css\n', {
          resources: {
            'css/genie.css': '.a { background: url(../../../../../outside/img/wave.svg); }'
          }
        });
        expect(collectThemeIssues(root)).toEqual([]);
      });

      test('a template that names a file outside the theme is not reported', () => {
        writeTheme('login', 'parent=keycloak\n', {
          templates: {
            'template.ftl': '<img src="${url.resourcesPath}/img/../../../outside/logo.png" alt="GENIE.AI">'
          }
        });
        expect(collectThemeIssues(root)).toEqual([]);
      });
    });

    // --- the images a template names -------------------------------------
    describe('the images a template names', () => {
      const PICTURE =
        '<picture><source srcset="${url.resourcesPath}/img/logo.webp" type="image/webp">' +
        '<img src="${url.resourcesPath}/img/logo.png" alt="GENIE.AI"></picture>';

      test('a webp image the theme has is not reported', () => {
        // The brand artwork is served as a `picture`: the webp source
        // and the png fallback are both files of the theme.
        writeTheme('login', 'parent=keycloak\n', {
          resources: { 'img/logo.webp': 'binary', 'img/logo.png': 'binary' },
          templates: { 'template.ftl': PICTURE }
        });
        expect(collectThemeIssues(root)).toEqual([]);
      });

      test('a webp image the theme does not have is reported', () => {
        // The webp is a file of the theme like any other: a format the
        // guard does not know is not a reason to skip it.
        writeTheme('login', 'parent=keycloak\n', {
          resources: { 'img/logo.png': 'binary' },
          templates: { 'template.ftl': PICTURE }
        });
        expect(collectThemeIssues(root)).toEqual([
          { theme: 'demo', type: 'login', kind: 'asset', reference: 'img/logo.webp' }
        ]);
      });
    });

    // --- the files a template names --------------------------------------
    describe('the files a template names', () => {
      test('a stylesheet a template names that the theme does not have is reported', () => {
        // The theme provides the css directory, so the stylesheet it
        // names has to be there.
        writeTheme('login', 'parent=keycloak\nstyles=css/genie.css\n', {
          resources: { 'css/genie.css': '.a { color: red; }' },
          templates: { 'template.ftl': '<link href="${url.resourcesPath}/css/missing.css" rel="stylesheet">' }
        });
        expect(collectThemeIssues(root)).toEqual([
          { theme: 'demo', type: 'login', kind: 'asset', reference: 'css/missing.css' }
        ]);
      });

      test('a file a template names in a directory the theme does not provide is not reported', () => {
        // The theme provides no js directory: the script comes from the
        // built-in parent, which is not on disk, so the guard cannot
        // see it.
        writeTheme('login', 'parent=keycloak\n', {
          templates: { 'template.ftl': '<script src="${url.resourcesPath}/js/passwordVisibility.js"></script>' }
        });
        expect(collectThemeIssues(root)).toEqual([]);
      });

      test('a file a template names in a directory the parent provides is not reported', () => {
        // The child theme serves the resources of its parent: the file
        // the child's template names lives in the parent's resources,
        // so the page shows it.
        writeTheme('login', 'parent=base\n', {
          theme: 'child',
          templates: { 'template.ftl': '<img src="${url.resourcesPath}/img/logo.png" alt="GENIE.AI">' }
        });
        writeTheme('login', 'parent=keycloak\n', {
          theme: 'base',
          resources: { 'img/logo.png': 'binary' }
        });
        expect(collectThemeIssues(root)).toEqual([]);
      });

      test('a file a template names in a directory the parent provides is reported when the parent does not have it', () => {
        // The parent provides the directory, so the file the child's
        // template names has to be there: a child theme inherits the
        // resources of its parent, not the files it does not hold.
        writeTheme('login', 'parent=base\n', {
          theme: 'child',
          templates: { 'template.ftl': '<img src="${url.resourcesPath}/img/logo.png" alt="GENIE.AI">' }
        });
        writeTheme('login', 'parent=keycloak\n', {
          theme: 'base',
          resources: { 'img/keep.png': 'binary' }
        });
        expect(collectThemeIssues(root)).toEqual([
          { theme: 'child', type: 'login', kind: 'asset', reference: 'img/logo.png' }
        ]);
      });
    });

    // --- the stylesheets a theme ships -----------------------------------
    describe('the stylesheets a theme ships', () => {
      test('a stylesheet the theme ships but does not declare is reported', () => {
        // A stylesheet nobody loads does nothing: the page never asks
        // for it.
        writeTheme('admin', 'styles=css/genie.css\n', {
          resources: { 'css/genie.css': '.a { color: red; }', 'css/extra.css': '.b { color: blue; }' }
        });
        expect(collectThemeIssues(root)).toEqual([
          { theme: 'demo', type: 'admin', kind: 'stylesheet', reference: 'css/extra.css' }
        ]);
      });

      test('a stylesheet the theme imports is not reported', () => {
        // The partial is loaded by the stylesheet that imports it.
        writeTheme('admin', 'styles=css/genie.css\n', {
          resources: {
            'css/genie.css': '@import "base.css";',
            'css/base.css': '.a { color: red; }'
          }
        });
        expect(collectThemeIssues(root)).toEqual([]);
      });
    });

    // --- the styles a theme inherits -------------------------------------
    describe('the styles a theme inherits', () => {
      test('a stylesheet the inherited declaration covers is not reported', () => {
        // The theme declares no styles of its own: it serves the
        // nearest ancestor's, the way Keycloak inherits them. The
        // stylesheet it ships is the one that declaration names.
        writeTheme('login', 'parent=middle\n', {
          theme: 'child',
          resources: { 'css/base.css': '.a { color: red; }' }
        });
        writeTheme('login', 'parent=keycloak\nstyles=css/base.css\n', {
          theme: 'middle',
          resources: { 'css/base.css': '.a { color: red; }' }
        });
        expect(collectThemeIssues(root)).toEqual([]);
      });

      test('a stylesheet the inherited declaration does not cover is reported', () => {
        // The inherited declaration names one stylesheet; the other one
        // the theme ships is a file nobody loads.
        writeTheme('login', 'parent=middle\n', {
          theme: 'child',
          resources: { 'css/extra.css': '.b { color: blue; }' }
        });
        writeTheme('login', 'parent=keycloak\nstyles=css/base.css\n', {
          theme: 'middle',
          resources: { 'css/base.css': '.a { color: red; }' }
        });
        expect(collectThemeIssues(root)).toEqual([
          { theme: 'child', type: 'login', kind: 'stylesheet', reference: 'css/extra.css' }
        ]);
      });

      test('the declaration of the grandparent does not cover the styles of the theme', () => {
        // The nearest ancestor wins: the parent's declaration is the
        // one the theme serves, and the grandparent's does not add to
        // it.
        writeTheme('login', 'parent=middle\n', {
          theme: 'child',
          resources: { 'css/grandparent.css': '.c { color: green; }' }
        });
        writeTheme('login', 'parent=base\nstyles=css/parent.css\n', {
          theme: 'middle',
          resources: { 'css/parent.css': '.b { color: blue; }' }
        });
        writeTheme('login', 'parent=keycloak\nstyles=css/grandparent.css\n', {
          theme: 'base',
          resources: { 'css/grandparent.css': '.c { color: green; }' }
        });
        expect(collectThemeIssues(root)).toEqual([
          { theme: 'child', type: 'login', kind: 'stylesheet', reference: 'css/grandparent.css' }
        ]);
      });
    });

    // --- the common theme -----------------------------------------------
    describe('the common stylesheets are resolved in the common theme', () => {
      test('a common stylesheet the common theme has is not reported', () => {
        // `stylesCommon` names the files of the common theme, not the
        // theme's own.
        writeTheme('login', 'common=common/shared\nstylesCommon=css/common.css\n');
        writeTheme('common', '', {
          theme: 'shared',
          resources: { 'css/common.css': '.a { color: red; }' }
        });
        expect(collectThemeIssues(root)).toEqual([]);
      });

      test('a common stylesheet the common theme does not have is reported', () => {
        writeTheme('login', 'common=common/shared\nstylesCommon=css/common.css\n');
        writeTheme('common', '', { theme: 'shared' });
        expect(collectThemeIssues(root)).toEqual([
          { theme: 'demo', type: 'login', kind: 'stylesCommon', reference: 'css/common.css' }
        ]);
      });

      test('a common theme that does not exist is reported', () => {
        // The common stylesheets are served from the common theme. A
        // common theme that is not there leaves the browser asking for
        // a path that does not exist.
        writeTheme('login', 'common=common/ghost\nstylesCommon=css/common.css\n');
        expect(collectThemeIssues(root)).toEqual([
          {
            theme: 'demo',
            type: 'login',
            kind: 'common',
            reference: 'common/ghost',
            detail: 'the common theme does not exist'
          },
          { theme: 'demo', type: 'login', kind: 'stylesCommon', reference: 'css/common.css' }
        ]);
      });

      test('a common stylesheet is not resolved in the resources of the theme itself', () => {
        // The file is in the theme's own resources, but the browser
        // asks the common theme for it: the common theme is not there,
        // so the stylesheet is not served.
        writeTheme('login', 'common=common/ghost\nstylesCommon=css/common.css\n', {
          resources: { 'css/common.css': '.a { color: red; }' }
        });
        const issues = collectThemeIssues(root);
        expect(issues.filter((issue) => issue.kind === 'stylesCommon')).toEqual([
          { theme: 'demo', type: 'login', kind: 'stylesCommon', reference: 'css/common.css' }
        ]);
      });
    });
  });

  describe('AC7: Retriever env var names agree with the code that reads them', () => {
    let retrieverEnv;

    beforeAll(() => {
      retrieverEnv = validateRetrieverEnvCoverage({
        composeFile: COMPOSE_FILE,
        ansibleEnvFile: ENV_TEMPLATE_FILE,
        envTemplateFile: ENV_FILE,
        overlayDir: path.join(ROOT, 'genie-ai-overlay')
      });
    });

    test('every knob the deployment sets is read by the overlay', () => {
      expect(retrieverEnv.errors).toEqual([]);
    });

    test('the label filter strategy knob is read under the name the deployment sets', () => {
      expect(retrieverEnv.deploymentNames.has('RETRIEVER_ARANGO_FILTER_STRATEGY')).toBe(true);
      expect(retrieverEnv.codeNames.has('RETRIEVER_ARANGO_FILTER_STRATEGY')).toBe(true);
    });

    // --- the check on a fixture -------------------------------------------
    // The check has to fail when the two sides drift apart, otherwise it
    // passes on every repository state.
    describe('the check on a fixture', () => {
      let root;

      beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'retriever-env-'));
      });

      afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
      });

      function writeFixture(relativePath, content) {
        const target = path.join(root, relativePath);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, content);
        return target;
      }

      function checkFixture() {
        return validateRetrieverEnvCoverage({
          composeFile: path.join(root, 'docker-compose.yaml'),
          ansibleEnvFile: path.join(root, 'env.j2'),
          envTemplateFile: path.join(root, 'env'),
          overlayDir: path.join(root, 'overlay')
        });
      }

      test('a knob the deployment sets and the code reads is not reported', () => {
        writeFixture('docker-compose.yaml', 'RETRIEVER_ARANGO_K: ${RETRIEVER_ARANGO_K:-4}\n');
        writeFixture('env.j2', 'RETRIEVER_ARANGO_K={{ retriever_arango_k }}\n');
        writeFixture('env', 'RETRIEVER_ARANGO_K=4\n');
        writeFixture('overlay/retriever/config.py', 'K = os.getenv("RETRIEVER_ARANGO_K", "4")\n');
        expect(checkFixture().errors).toEqual([]);
      });

      test('a knob the deployment sets and no code reads is reported', () => {
        writeFixture(
          'docker-compose.yaml',
          'RETRIEVER_ARANGO_K: ${RETRIEVER_ARANGO_K:-4}\nRETRIEVER_ARANGO_FILTER_STRATEGY: ${RETRIEVER_ARANGO_FILTER_STRATEGY:-OR}\n'
        );
        writeFixture('env.j2', 'RETRIEVER_ARANGO_K={{ retriever_arango_k }}\n');
        writeFixture('env', 'RETRIEVER_ARANGO_K=4\n');
        writeFixture('overlay/retriever/config.py', 'K = os.getenv("RETRIEVER_ARANGO_K", "4")\n');
        expect(checkFixture().errors).toEqual([expect.stringContaining('RETRIEVER_ARANGO_FILTER_STRATEGY')]);
      });

      test('a knob the code reads and no deployment file sets is reported', () => {
        writeFixture('docker-compose.yaml', 'RETRIEVER_ARANGO_K: ${RETRIEVER_ARANGO_K:-4}\n');
        writeFixture('env.j2', 'RETRIEVER_ARANGO_K={{ retriever_arango_k }}\n');
        writeFixture('env', 'RETRIEVER_ARANGO_K=4\n');
        writeFixture(
          'overlay/retriever/config.py',
          'K = os.getenv("RETRIEVER_ARANGO_K", "4")\nSTRATEGY = os.getenv("RETRIEVER_ARANGO_GHOST", "OR")\n'
        );
        expect(checkFixture().errors).toEqual([expect.stringContaining('RETRIEVER_ARANGO_GHOST')]);
      });

      test('the code of a test does not count as code that reads a knob', () => {
        writeFixture('docker-compose.yaml', 'RETRIEVER_ARANGO_K: ${RETRIEVER_ARANGO_K:-4}\n');
        writeFixture('env.j2', 'RETRIEVER_ARANGO_K={{ retriever_arango_k }}\n');
        writeFixture('env', 'RETRIEVER_ARANGO_K=4\n');
        writeFixture('overlay/tests/test_config.py', 'K = os.getenv("RETRIEVER_ARANGO_K", "4")\n');
        expect(checkFixture().errors).toEqual([expect.stringContaining('RETRIEVER_ARANGO_K')]);
      });
    });
  });
});
