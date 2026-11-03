const path = require('path');
const fs = require('fs');
const os = require('os');
const { parseEnvTemplate, getRequiredSecrets } = require('../validators/parse-env');
const { findUnwiredDocumented, findDuplicatedDocumented } = require('../validators/unwired-documented');
const { parseAnsibleEnvVars } = require('../validators/parse-ansible');
const {
  parseComposeEnvVars,
  crossReference,
  parseComposeImages,
  parseAnsibleImages,
  parseGitlabCiImages,
  parseGitlabCiJobChanges,
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

  // !1073 — documented OKF_* knobs that are deliberately NOT wired to a
  // container. Every entry needs a justification that survives review, because
  // the default answer to "this var is in the allowlist" must be "it shouldn't
  // be". These two are documented in `env` but read by NOTHING in the
  // codebase — spec 1-6 assigns OKF_SEARCH_STYLE to the retriever, and the
  // OPEA overlay never reads it; grep-verified across components/ and
  // genie-ai-overlay/.
  //
  // Wiring them would put a live-looking variable in the container that changes
  // nothing, which is worse than the honest absence: an operator would believe
  // the knob works. Un-wired until a reader exists.
  const UNIMPLEMENTED_OKF_KNOBS = new Set([
    'OKF_SEARCH_STYLE', // no reader: retriever/config.py does not read it (spec 1-6 unimplemented)
    'OKF_FRONTMATTER_TAG_BATCH_SIZE' // no reader: suggestTags concurrency is not configurable yet (spec 1-6)
  ]);

  test('AC9 (!1073): every documented OKF_* knob reaches a container', () => {
    // The env→compose direction, which nothing asserted. There is no env_file:
    // in docker-compose.yaml, so a variable absent from a service's
    // environment: block is unreachable by definition — setting it in .env did
    // nothing, silently. 28 knobs were in that state.
    //
    // Reads the COMMENTED `# NAME=value` channel: `env` documents these knobs
    // as comments (86 OKF_* lines are commented against 1 active), and the
    // parser used to skip them entirely, so they could not reach the orphan
    // gate even in principle.
    const { unwired, allowlisted } = findUnwiredDocumented(envParsed.documented, composeVars, {
      allowlist: UNIMPLEMENTED_OKF_KNOBS
    });

    expect(unwired.map((u) => `${u.name} (env section: ${u.section})`)).toEqual([]);

    // The allowlist is not a place to hide things: it is asserted to be EXACTLY
    // the two documented-unimplemented knobs, so adding a third name fails here
    // rather than quietly widening the exemption.
    expect(allowlisted.sort()).toEqual(['OKF_FRONTMATTER_TAG_BATCH_SIZE', 'OKF_SEARCH_STYLE']);
  });

  test('AC9 parser: documented commented knobs are collected, active ones are not', () => {
    // The gate above would pass VACUOUSLY if the parser returned nothing here
    // — that is exactly how 28 knobs accumulated. Pin both ends.
    expect(Array.isArray(envParsed.documented)).toBe(true);
    expect(envParsed.documented.length).toBeGreaterThan(200);
    expect(envParsed.documented.every((d) => d.commentedOut === true)).toBe(true);
    expect(envParsed.variables.every((v) => v.commentedOut === false)).toBe(true);
    expect(envParsed.documented.some((d) => d.name === 'OKF_INGEST_MAX_CONCEPTS')).toBe(true);
  });

  test('AC10 (!1073): a knob documented twice in `env` must document the SAME value', () => {
    // 22 OKF_* knobs are stated in two sections of `env` (operator-facing block +
    // deeper reference). They agree today and nothing enforced it — the same
    // "same fact in two places" shape as BUG-11 (type enum), BUG-12 (hardcoded
    // counters) and BUG-15 (tag ceilings), all of which drifted.
    //
    // Two of the 22 legitimately differ: OKF_INTERNAL_SECRET and
    // OKF_CONVERSION_DEBUG are documented once as an instruction and once with
    // a concrete example value. Those are pinned by name rather than waved
    // through with a blanket allowance.
    const EXAMPLE_FORMS = new Set(['OKF_INTERNAL_SECRET', 'OKF_CONVERSION_DEBUG']);
    const conflicting = findDuplicatedDocumented(envParsed.documented, { prefix: /^OKF_/ })
      .filter((d) => d.values.length > 1 && !EXAMPLE_FORMS.has(d.name))
      .map((d) => `${d.name}: ${d.values.join(' vs ')}`);

    expect(conflicting).toEqual([]);
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

  // --- Story 1-8 (David 2026-10-08): Ansible stays in step with local ---
  // 'the ansible deployment must be kept in step with the local deployment
  // with the right env vars AND defaults' — env.j2 enumerates every var
  // explicitly (no passthrough), so an omission silently falls back to the
  // compose default on swarm deploys. These tests pin the OKF surface.
  describe('AC7: OKF env parity between docker-compose and ansible env.j2', () => {
    const ansibleVars = parseAnsibleEnvVars(
      fs.readFileSync(path.resolve(__dirname, '../../../deploy/ansible/templates/env.j2'), 'utf8')
    );
    // The compose okf-server service block: the local-deployment truth.
    const composeText = fs.readFileSync(COMPOSE_FILE, 'utf8');
    const okfBlock = composeText.slice(composeText.indexOf('  okf-server:'), composeText.indexOf('  pii-service:'));
    const okfComposeVars = {};
    for (const m of okfBlock.matchAll(new RegExp('- ([A-Z][A-Z0-9_]+)=\\$\\{[A-Z0-9_]+(?::-([^}]*))?\\}', 'g'))) {
      okfComposeVars[m[1]] = m[2] === undefined ? '' : m[2];
    }
    // Parity scope: OKF feature vars + the okf-server model endpoints
    // (topology vars like ARANGO_URL/KEYCLOAK_* are deployment-specific
    // and intentionally compose-defaulted).
    const PARITY_VARS = Object.keys(okfComposeVars).filter((v) =>
      /^(OKF_|TEI_EMBED_HOST|EMBEDDING_MODEL_ID|VLLM_ENDPOINT|VLLM_MODEL_ID|VLLM_API_KEY|DATAPREP_URL)/.test(v)
    );

    test('every OKF compose var is emitted by env.j2', () => {
      expect(PARITY_VARS.length).toBeGreaterThanOrEqual(15); // guard: block actually parsed
      // VLLM_MODEL_ID passes through RAW in the okf-server block (envPin()
      // in the service owns the precedence) — env.j2 emits it guarded
      // (vllm_model_id), so the parity holds on both paths.
      const missing = PARITY_VARS.filter((v) => !ansibleVars[v]);
      expect(missing).toEqual([]);
    });

    test('literal defaults match between compose and env.j2', () => {
      const mismatches = [];
      for (const v of PARITY_VARS) {
        const a = ansibleVars[v];
        if (!a || a.defaultIsJinja || a.default === null) continue; // guarded/no-literal: presence-only
        const composeDefault = okfComposeVars[v];
        if (composeDefault !== '' && a.default !== composeDefault)
          mismatches.push(v + ': compose=' + composeDefault + ' ansible=' + a.default);
      }
      expect(mismatches).toEqual([]);
    });

    test('env.j2 emits each OKF var exactly once (no last-wins shadowing)', () => {
      const dupes = Object.entries(ansibleVars)
        .filter(([k, a]) => /^OKF_/.test(k) && a.count > 1)
        .map(([k]) => k);
      expect(dupes).toEqual([]);
    });

    test('TEI_EMBED_HOST defaults follow the same-host rule (Jinja-derived, presence-checked)', () => {
      expect(ansibleVars.TEI_EMBED_HOST).toBeDefined();
      expect(ansibleVars.TEI_EMBED_HOST.defaultIsJinja).toBe(true); // derived from gpu_node_host
    });

    // --- PII parity (David 2026-10-13) ---------------------------------------
    //
    // The Ansible .env carried NO PII_* vars at all, so a cloud deployment ran
    // the sidecar at the image default while the local .env overrode it, and
    // okf-server had no way to tune the rescan retry pace. PII_CONCEPT_RETRY_
    // PAUSE_MS in particular must be overridable: its default has to outlast a
    // sidecar worker respawn, and recording a PERMANENT 'error' for a respawn
    // is what blocked a repository indefinitely on 2026-10-12.
    //
    // These are CODE defaults (PII_SERVICE_URL/PII_TIMEOUT_MS/PII_RETRIES are
    // not in the compose okf-server block), so parity here means "ansible
    // emits them with the code's own default", not "compose agrees". The code
    // side is PARSED FROM SOURCE — the Dockerfile CMD, the sidecar's app.py
    // getenv and okf-server's config/pii-service reads — not mirrored by hand
    // (a hand mirror stays green while env.j2 silently diverges from real
    // behaviour, exactly half the drift this check exists to catch).
    const piiCodeDefaults = () => {
      const repo = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
      const dockerfile = repo('components/pii-service/Dockerfile');
      const appPy = repo('components/pii-service/app.py');
      const okfConfig = repo('components/okf-server/config.js');
      const okfPii = repo('components/okf-server/services/pii-service.js');
      const out = {};

      // ${PII_WEB_CONCURRENCY:-4} in the Dockerfile CMD (uvicorn --workers)
      const workers = dockerfile.match(/\$\{PII_WEB_CONCURRENCY:-(\d+)\}/);
      if (!workers) throw new Error('PII_WEB_CONCURRENCY default not found in pii-service Dockerfile CMD');
      out.PII_WEB_CONCURRENCY = workers[1];

      // os.getenv("PII_REGION_MAX_CHARS", "50000") in the sidecar
      const region = appPy.match(/os\.getenv\(["']PII_REGION_MAX_CHARS["'],\s*["'](\d+)["']\)/);
      if (!region) throw new Error('PII_REGION_MAX_CHARS default not found in pii-service app.py');
      out.PII_REGION_MAX_CHARS = region[1];

      // process.env.PII_CONCEPT_RETRY_PAUSE_MS) || 8000 in okf-server
      const pause = okfPii.match(/PII_CONCEPT_RETRY_PAUSE_MS\)\s*\|\|\s*(\d+)/);
      if (!pause) throw new Error('PII_CONCEPT_RETRY_PAUSE_MS default not found in okf-server pii-service.js');
      out.PII_CONCEPT_RETRY_PAUSE_MS = pause[1];

      // okf-server/config.js: url || '...', parseInt(env || '...', 10)
      const url = okfConfig.match(/PII_SERVICE_URL\s*\|\|\s*'([^']+)'/);
      const timeout = okfConfig.match(/PII_TIMEOUT_MS\s*\|\|\s*'(\d+)'/);
      const retries = okfConfig.match(/PII_RETRIES\s*\|\|\s*'(\d+)'/);
      if (!url || !timeout || !retries)
        throw new Error('PII_SERVICE_URL/PII_TIMEOUT_MS/PII_RETRIES defaults not found in okf-server config.js');
      out.PII_SERVICE_URL = url[1];
      out.PII_TIMEOUT_MS = timeout[1];
      out.PII_RETRIES = retries[1];
      return out;
    };

    test('ansible env.j2 emits every PII var the cloud deployment needs', () => {
      const missing = Object.keys(piiCodeDefaults()).filter((v) => !ansibleVars[v]);
      expect(missing).toEqual([]);
    });

    test('ansible PII defaults match the values the code itself defaults to (parsed from source)', () => {
      const mismatches = Object.entries(piiCodeDefaults())
        .filter(([v, expected]) => ansibleVars[v] && ansibleVars[v].default !== expected)
        .map(([v, expected]) => v + ': ansible=' + ansibleVars[v].default + ' code=' + expected);
      expect(mismatches).toEqual([]);
    });

    test('PII_WEB_CONCURRENCY is tunable per environment (not pinned)', () => {
      // It is a memory knob: each worker holds its own ~390MB spaCy copy. A
      // deployment on a smaller host needs to be able to LOWER it.
      expect(ansibleVars.PII_WEB_CONCURRENCY).toBeDefined();
      expect(ansibleVars.PII_WEB_CONCURRENCY.defaultIsJinja).toBe(false);
    });

    test('PII_REGION_MAX_CHARS is tunable per environment (not pinned)', () => {
      // This is the knob that stops uvicorn's supervisor SIGKILLing a worker
      // mid-scan (measured 2026-10-13: 850 KB page killed the worker 8/8).
      // A slower cloud host MUST be able to lower it, so it cannot be pinned.
      expect(ansibleVars.PII_REGION_MAX_CHARS).toBeDefined();
      expect(ansibleVars.PII_REGION_MAX_CHARS.defaultIsJinja).toBe(false);
    });

    test('PII_REGION_MAX_CHARS is piped into the compose pii-service service', () => {
      // Without the compose pipe the ansible .env value would be inert in
      // compose mode: app.py reads it, but the container never receives it.
      const v = composeVars.find((x) => x.name === 'PII_REGION_MAX_CHARS');
      expect(v).toBeDefined();
      expect(v.default).toBe('50000');
    });
  });

  // --- Story 1-8b: retriever routing-head knobs (graph affinity + the
  // forbidden/noise gate). The routing decision must be an affirmative claim
  // with positive evidence, and its thresholds are calibration-sensitive —
  // plumbing drift between the surfaces (compose pipe / env template
  // doc / ansible env.j2) would silently retune production routing. Defaults
  // live in genie-ai-overlay/retriever/config.py; the literals below were
  // copied from it at authoring time (the code file itself is NOT read here,
  // so code-side drift is invisible to this suite), and these pins keep
  // compose and the template docs honest against those literals.
  describe('Story 1-8b: retriever routing-head knob plumbing', () => {
    const ROUTE_HEAD_KNOBS = {
      RETRIEVER_ROUTE_HEAD_WEIGHT: '1.0',
      RETRIEVER_ROUTE_HEAD_MARGIN: '0.01',
      RETRIEVER_ROUTE_HEAD_FLOOR: '0.55',
      RETRIEVER_ROUTE_FORBIDDEN_TAG_MAX: '0.55',
      RETRIEVER_ROUTE_HEADS_SUPERSEDE: 'true'
    };

    test('every routing-head knob is piped in compose with the code default', () => {
      for (const [name, def] of Object.entries(ROUTE_HEAD_KNOBS)) {
        const v = composeVars.find((x) => x.name === name);
        expect({ name, found: !!v, default: v ? v.default : null }).toEqual({
          name,
          found: true,
          default: def
        });
      }
    });

    test('every routing-head knob is documented in the env template with the same default', () => {
      const envText = fs.readFileSync(ENV_FILE, 'utf8');
      for (const [name, def] of Object.entries(ROUTE_HEAD_KNOBS)) {
        expect(envText).toMatch(new RegExp(`^#\\s*${name}=${def.replace(/\./g, '\\.')}\\s*(#.*)?$`, 'm'));
      }
    });

    test('every routing-head knob is emitted by ansible env.j2', () => {
      const headVars = parseAnsibleEnvVars(
        fs.readFileSync(path.resolve(__dirname, '../../../deploy/ansible/templates/env.j2'), 'utf8')
      );
      const missing = Object.keys(ROUTE_HEAD_KNOBS).filter((v) => !headVars[v]);
      expect(missing).toEqual([]);
    });
  });

  // --- Story 1-8d: teaching-loop suggestion-guardrail knobs. The 2026-10-09
  // poisoning (a suggested forbidden tag matching the repo's OWN subject —
  // 'lung-cancer', its own entity tag — positives 7/8 -> 2/8) is exactly the
  // failure these thresholds prevent, and their calibration is load-bearing:
  // plumbing drift between the three surfaces would silently retune the
  // guardrail. Defaults live in components/okf-server/services/
  // head-test-service.js; the compose pipes are intentionally EMPTY (code
  // default applies when unset), so these pins check the code default where
  // each surface documents it: the env template comment and the env.j2
  // emission.
  describe('Story 1-8d: OKF suggestion-guardrail knob plumbing', () => {
    const GUARD_KNOBS = {
      OKF_GUARD_SELF_SUBJECT: '0.55',
      OKF_GUARD_DUPLICATE_FORBIDDEN: '0.9'
    };

    test('both guard knobs are piped in the okf-server compose block with an empty default (code default applies)', () => {
      const composeText = fs.readFileSync(COMPOSE_FILE, 'utf8');
      const full = fs.readFileSync(COMPOSE_FILE, 'utf8');
      const okfBlock = full.slice(full.indexOf('  okf-server:'), full.indexOf('  pii-service:'));
      for (const name of Object.keys(GUARD_KNOBS)) {
        expect(okfBlock).toMatch(new RegExp(`- ${name}=\\$\\{${name}:-\\}`));
      }
    });

    test('both guard knobs are documented in the env template with the code default', () => {
      const envText = fs.readFileSync(ENV_FILE, 'utf8');
      for (const [name, def] of Object.entries(GUARD_KNOBS)) {
        expect(envText).toMatch(new RegExp(`^#\\s*${name}=${def.replace(/\./g, '\\.')}\\s*(#.*)?$`, 'm'));
      }
    });

    test('both guard knobs are emitted by ansible env.j2 with the code default', () => {
      const guardVars = parseAnsibleEnvVars(
        fs.readFileSync(path.resolve(__dirname, '../../../deploy/ansible/templates/env.j2'), 'utf8')
      );
      for (const [name, def] of Object.entries(GUARD_KNOBS)) {
        expect({ name, found: !!guardVars[name], default: guardVars[name] ? guardVars[name].default : null }).toEqual({
          name,
          found: true,
          default: def
        });
      }
    });
  });

  // --- DEFAULT-OPEN OKF read authorization (product decision 2026-10-16).
  // The mode flag is load-bearing in the OPPOSITE direction of the guard
  // knobs: its default ('open') is what makes serving repos reachable by
  // regular users, so a plumbing drift that silently made it 'closed' would
  // shut every regular user out of OKF fan-out with no error anywhere —
  // the exact silent-wrong class this file exists to catch. The scope
  // authority reads it per call in scope-authz-service.js.
  describe('DEFAULT-OPEN: OKF_SCOPE_MODE plumbing', () => {
    test('OKF_SCOPE_MODE is piped in the okf-server compose block with the open default', () => {
      const full = fs.readFileSync(COMPOSE_FILE, 'utf8');
      const start = full.indexOf('  okf-server:');
      const end = full.indexOf('  pii-service:');
      // Guard both anchors: if a service is renamed/moved, indexOf returns -1
      // and slice(start, -1) would silently span every later service block —
      // turning "piped in the okf-server block" into "present anywhere after
      // it", defeating the plumbing-drift catch this test exists for.
      expect(start).toBeGreaterThanOrEqual(0);
      expect(end).toBeGreaterThan(start);
      const okfBlock = full.slice(start, end);
      // Unset-only default (`${VAR-open}`, NOT `${VAR:-open}`): an explicitly
      // empty .env value must reach the container as explicit garbage and
      // degrade to closed — not be silently coerced to open at interpolation.
      expect(okfBlock).toMatch(/- OKF_SCOPE_MODE=\$\{OKF_SCOPE_MODE-open\}/);
    });

    test('OKF_SCOPE_MODE is documented in the env template with the open default', () => {
      const envText = fs.readFileSync(ENV_FILE, 'utf8');
      expect(envText).toMatch(/^#\s*OKF_SCOPE_MODE=open\s*(#.*)?$/m);
    });

    test('OKF_SCOPE_MODE is emitted by ansible env.j2 with the open default', () => {
      const scopeVars = parseAnsibleEnvVars(
        fs.readFileSync(path.resolve(__dirname, '../../../deploy/ansible/templates/env.j2'), 'utf8')
      );
      expect({
        name: 'OKF_SCOPE_MODE',
        found: !!scopeVars.OKF_SCOPE_MODE,
        default: scopeVars.OKF_SCOPE_MODE ? scopeVars.OKF_SCOPE_MODE.default : null
      }).toEqual({
        name: 'OKF_SCOPE_MODE',
        found: true,
        default: 'open'
      });
    });
  });

  // Story 1-8g: the Lab click-test reranks a query against the repo corpus
  // through the pipeline's TEI /rerank. Empty default = the probe answers
  // verdict=unknown with an honest note (never a fake score).
  describe('Story 1-8g: OKF corpus-probe rerank endpoint plumbing', () => {
    test('OKF_RERANK_ENDPOINT is piped in the okf-server compose block with an empty default', () => {
      const composeText = fs.readFileSync(COMPOSE_FILE, 'utf8');
      const full = fs.readFileSync(COMPOSE_FILE, 'utf8');
      const okfBlock = full.slice(full.indexOf('  okf-server:'), full.indexOf('  pii-service:'));
      expect(okfBlock).toMatch(/- OKF_RERANK_ENDPOINT=\$\{OKF_RERANK_ENDPOINT:-\}/);
    });

    test('OKF_RERANK_ENDPOINT is documented in the env template', () => {
      const envText = fs.readFileSync(ENV_FILE, 'utf8');
      expect(envText).toMatch(/^#\s*OKF_RERANK_ENDPOINT=\S.*$/m);
    });

    test('OKF_RERANK_TOKEN is piped in the okf-server compose block with an empty default', () => {
      const composeText = fs.readFileSync(COMPOSE_FILE, 'utf8');
      const full = fs.readFileSync(COMPOSE_FILE, 'utf8');
      const okfBlock = full.slice(full.indexOf('  okf-server:'), full.indexOf('  pii-service:'));
      expect(okfBlock).toMatch(/- OKF_RERANK_TOKEN=\$\{OKF_RERANK_TOKEN:-\}/);
    });

    test('OKF_RERANK_ENDPOINT is emitted by ansible env.j2 (empty default)', () => {
      const vars = parseAnsibleEnvVars(
        fs.readFileSync(path.resolve(__dirname, '../../../deploy/ansible/templates/env.j2'), 'utf8')
      );
      expect({
        found: !!vars.OKF_RERANK_ENDPOINT,
        default: vars.OKF_RERANK_ENDPOINT ? vars.OKF_RERANK_ENDPOINT.default : null
      }).toEqual({
        found: true,
        default: ''
      });
    });
  });

  // Story 8-6 (ADR-okf-043): the RAGAS benchmark sidecar + the okf-server
  // knobs. Four-site parity: compose block, env template, ansible env.j2.
  describe('Story 8-6: RAGAS benchmarking plumbing', () => {
    test('OKF_RAGAS_URL is piped in the okf-server compose block with the sidecar default', () => {
      const full = fs.readFileSync(COMPOSE_FILE, 'utf8');
      const okfBlock = full.slice(full.indexOf('  okf-server:'), full.indexOf('  pii-service:'));
      expect(okfBlock).toMatch(/- OKF_RAGAS_URL=\$\{OKF_RAGAS_URL:-http:\/\/ragas-service:8090\}/);
    });

    test('the ragas-service compose block carries judge/embedder env with inherited defaults', () => {
      const full = fs.readFileSync(COMPOSE_FILE, 'utf8');
      const block = full.slice(full.indexOf('  ragas-service:'), full.indexOf('  document-repository:'));
      expect(block).toMatch(/- RAGAS_JUDGE_BASE_URL=\$\{RAGAS_JUDGE_BASE_URL:-http:\/\/vllm:8000\/v1\}/);
      expect(block).toMatch(/- RAGAS_JUDGE_MODEL=\$\{RAGAS_JUDGE_MODEL:-\$\{VLLM_LLM_MODEL_ID:-\}\}/);
      expect(block).toMatch(/- RAGAS_INTERNAL_SECRET=\$\{RAGAS_INTERNAL_SECRET:-\$\{OKF_INTERNAL_SECRET:-\}\}/);
      // Embedder: EMBEDDING_MODEL_ID is the deployment's actual var (the stack
      // has no EMBED_MODEL_ID); the TEI dialect default hits {base}/embed.
      expect(block).toMatch(/- RAGAS_EMBED_BASE_URL=\$\{RAGAS_EMBED_BASE_URL:-http:\/\/tei-embedding-server:80\}/);
      expect(block).toMatch(/- RAGAS_EMBED_MODEL=\$\{RAGAS_EMBED_MODEL:-\$\{EMBEDDING_MODEL_ID:-\}\}/);
      expect(block).toMatch(/- RAGAS_EMBED_API=\$\{RAGAS_EMBED_API:-tei\}/);
    });

    test('OKF_RAGAS_TESTSET_SIZE_DEFAULT is documented in the env template with the 20 default', () => {
      const envText = fs.readFileSync(ENV_FILE, 'utf8');
      expect(envText).toMatch(/^#\s*OKF_RAGAS_TESTSET_SIZE_DEFAULT=20.*$/m);
    });

    test('the answer leg token budget lands in all four sites (2026-10-22)', () => {
      // The answer leg's initial budget was hardcoded to 800 tokens. A
      // reasoning-capable model burns 400-700 tokens BEFORE writing a word,
      // so every answer hit the length cap, was thrown away, and was
      // re-called at 3200 by the adaptive ladder — two calls per question
      // with the first one entirely wasted.
      const full = fs.readFileSync(COMPOSE_FILE, 'utf8');
      const okfBlock = full.slice(full.indexOf('  okf-server:'), full.indexOf('  pii-service:'));
      expect(okfBlock).toMatch(/- OKF_RAGAS_ANSWER_MAX_TOKENS=\$\{OKF_RAGAS_ANSWER_MAX_TOKENS:-5000\}/);
      const envText = fs.readFileSync(ENV_FILE, 'utf8');
      expect(envText).toMatch(/^#\s*OKF_RAGAS_ANSWER_MAX_TOKENS=5000.*$/m);
      const vars = parseAnsibleEnvVars(
        fs.readFileSync(path.resolve(__dirname, '../../../deploy/ansible/templates/env.j2'), 'utf8')
      );
      expect(vars.OKF_RAGAS_ANSWER_MAX_TOKENS && vars.OKF_RAGAS_ANSWER_MAX_TOKENS.default).toBe('5000');
    });

    test('the benchmark rerank batch concurrency lands in all four sites (2026-10-23)', () => {
      // Batch rerank calls are independent and scores are identical at any
      // concurrency — the knob is transport only. 1 = the old sequential
      // behaviour; 3 overlaps a 192-chunk pool into ~2 waves. The global
      // in-flight ceiling is OKF_RAGAS_RUN_CONCURRENCY x this value.
      const full = fs.readFileSync(COMPOSE_FILE, 'utf8');
      const okfBlock = full.slice(full.indexOf('  okf-server:'), full.indexOf('  pii-service:'));
      expect(okfBlock).toMatch(/- OKF_RAGAS_RERANK_CONCURRENCY=\$\{OKF_RAGAS_RERANK_CONCURRENCY:-3\}/);
      const envText = fs.readFileSync(ENV_FILE, 'utf8');
      expect(envText).toMatch(/^#\s*OKF_RAGAS_RERANK_CONCURRENCY=3.*$/m);
      const vars = parseAnsibleEnvVars(
        fs.readFileSync(path.resolve(__dirname, '../../../deploy/ansible/templates/env.j2'), 'utf8')
      );
      expect(vars.OKF_RAGAS_RERANK_CONCURRENCY && vars.OKF_RAGAS_RERANK_CONCURRENCY.default).toBe('3');
    });

    test('the SERVE-mode benchmark URL lands in all four sites (2026-10-23)', () => {
      // SERVE is the benchmark default: the question goes through the SAME
      // chatqna pipeline citizens use. whatif runs (knob experiments) ignore it.
      const full = fs.readFileSync(COMPOSE_FILE, 'utf8');
      const okfBlock = full.slice(full.indexOf('  okf-server:'), full.indexOf('  pii-service:'));
      expect(okfBlock).toMatch(
        /- OKF_RAGAS_SERVE_URL=\$\{OKF_RAGAS_SERVE_URL:-http:\/\/chatqna-xeon-backend-server:8888\/v1\/chatqna\}/
      );
      const envText = fs.readFileSync(ENV_FILE, 'utf8');
      expect(envText).toMatch(/^#\s*OKF_RAGAS_SERVE_URL=http:\/\/chatqna-xeon-backend-server:8888\/v1\/chatqna.*$/m);
      const vars = parseAnsibleEnvVars(
        fs.readFileSync(path.resolve(__dirname, '../../../deploy/ansible/templates/env.j2'), 'utf8')
      );
      expect(vars.OKF_RAGAS_SERVE_URL && vars.OKF_RAGAS_SERVE_URL.default).toBe(
        'http://chatqna-xeon-backend-server:8888/v1/chatqna'
      );
    });

    test('the judge cache + liveness-horizon vars land in all four sites (2026-10-18 batch)', () => {
      // compose: sidecar carries the cache; okf-server carries the horizon
      const full = fs.readFileSync(COMPOSE_FILE, 'utf8');
      const ragasBlock = full.slice(full.indexOf('  ragas-service:'), full.indexOf('  document-repository:'));
      expect(ragasBlock).toMatch(/- RAGAS_LLM_CACHE=\$\{RAGAS_LLM_CACHE:-1\}/);
      expect(ragasBlock).toMatch(/- RAGAS_LLM_CACHE_DIR=\$\{RAGAS_LLM_CACHE_DIR:-\/tmp\/ragas-llm-cache\}/);
      const okfBlock = full.slice(full.indexOf('  okf-server:'), full.indexOf('  pii-service:'));
      expect(okfBlock).toMatch(/- OKF_RAGAS_LONG_TIMEOUT_MS=\$\{OKF_RAGAS_LONG_TIMEOUT_MS:-3600000\}/);
      expect(okfBlock).toMatch(/- OKF_RAGAS_JOB_POLL_MS=\$\{OKF_RAGAS_JOB_POLL_MS:-3000\}/);
      // env template documents all of them
      const envText = fs.readFileSync(ENV_FILE, 'utf8');
      expect(envText).toMatch(/^#\s*RAGAS_LLM_CACHE=1.*$/m);
      expect(envText).toMatch(/^#\s*RAGAS_LLM_CACHE_DIR=\/tmp\/ragas-llm-cache.*$/m);
      expect(envText).toMatch(/^#\s*OKF_RAGAS_LONG_TIMEOUT_MS=3600000.*$/m);
      expect(envText).toMatch(/LIVENESS HORIZON, not a job deadline/);
      // ansible env.j2 emits them
      const vars = parseAnsibleEnvVars(
        fs.readFileSync(path.resolve(__dirname, '../../../deploy/ansible/templates/env.j2'), 'utf8')
      );
      expect({
        c: vars.RAGAS_LLM_CACHE && vars.RAGAS_LLM_CACHE.default,
        d: vars.RAGAS_LLM_CACHE_DIR && vars.RAGAS_LLM_CACHE_DIR.default
      }).toEqual({
        c: '1',
        d: '/tmp/ragas-llm-cache'
      });
      expect(vars.OKF_RAGAS_LONG_TIMEOUT_MS && vars.OKF_RAGAS_LONG_TIMEOUT_MS.default).toBe('3600000');
    });

    test('the cache-migration switch lands in all four sites (2026-10-21)', () => {
      // RAGAS_LLM_CACHE_LEGACY: the judge identity in the cache key now
      // carries the endpoint, so the entries the previous key wrote are
      // unreachable. 1 lets an operator whose judge has NOT been repointed
      // replay them (and migrate each to the new key on read); 0 is strict.
      const full = fs.readFileSync(COMPOSE_FILE, 'utf8');
      const ragasBlock = full.slice(full.indexOf('  ragas-service:'), full.indexOf('  document-repository:'));
      expect(ragasBlock).toMatch(/- RAGAS_LLM_CACHE_LEGACY=\$\{RAGAS_LLM_CACHE_LEGACY:-0\}/);
      const envText = fs.readFileSync(ENV_FILE, 'utf8');
      expect(envText).toMatch(/^#\s*RAGAS_LLM_CACHE_LEGACY=0.*$/m);
      const vars = parseAnsibleEnvVars(
        fs.readFileSync(path.resolve(__dirname, '../../../deploy/ansible/templates/env.j2'), 'utf8')
      );
      expect(vars.RAGAS_LLM_CACHE_LEGACY && vars.RAGAS_LLM_CACHE_LEGACY.default).toBe('0');
    });

    test('the judge call-discipline vars land in all four sites (2026-10-21)', () => {
      // RAGAS_LLM_MAX_CONCURRENCY / RAGAS_LLM_MAX_RETRIES: the upstream
      // answered 82 of ~500 synthesis calls with 429 and 35 questions were
      // dropped. The client now caps its own concurrency and retries a 429
      // with jitter.
      const full = fs.readFileSync(COMPOSE_FILE, 'utf8');
      const ragasBlock = full.slice(full.indexOf('  ragas-service:'), full.indexOf('  document-repository:'));
      expect(ragasBlock).toMatch(/- RAGAS_LLM_MAX_CONCURRENCY=\$\{RAGAS_LLM_MAX_CONCURRENCY:-8\}/);
      expect(ragasBlock).toMatch(/- RAGAS_LLM_MAX_RETRIES=\$\{RAGAS_LLM_MAX_RETRIES:-5\}/);
      const envText = fs.readFileSync(ENV_FILE, 'utf8');
      expect(envText).toMatch(/^#\s*RAGAS_LLM_MAX_CONCURRENCY=8.*$/m);
      expect(envText).toMatch(/^#\s*RAGAS_LLM_MAX_RETRIES=5.*$/m);
      const vars = parseAnsibleEnvVars(
        fs.readFileSync(path.resolve(__dirname, '../../../deploy/ansible/templates/env.j2'), 'utf8')
      );
      expect(vars.RAGAS_LLM_MAX_CONCURRENCY && vars.RAGAS_LLM_MAX_CONCURRENCY.default).toBe('8');
      expect(vars.RAGAS_LLM_MAX_RETRIES && vars.RAGAS_LLM_MAX_RETRIES.default).toBe('5');
    });

    test('ragas usage telemetry is OFF in all four sites (2026-10-26)', () => {
      // RAGAS_DO_NOT_TRACK: ragas 0.4.3 POSTs every prompt's usage event to
      // https://t.explodinggradients.com from INSIDE the async prompt path
      // (1 s timeout), so it blocks the event loop and the configured
      // concurrency never overlaps. Measured in the sidecar: a warm CACHE HIT
      // — no model call at all — cost 0.79 s, and 0.008 s with this off. The
      // tax was ~50 min of Solar System's ~3,800-prompt graph build. It is
      // also a sovereignty leak: per-call usage telemetry must not leave a
      // public-sector deployment.
      const full = fs.readFileSync(COMPOSE_FILE, 'utf8');
      const ragasBlock = full.slice(full.indexOf('  ragas-service:'), full.indexOf('  document-repository:'));
      expect(ragasBlock).toMatch(/- RAGAS_DO_NOT_TRACK=\$\{RAGAS_DO_NOT_TRACK:-true\}/);
      const envText = fs.readFileSync(ENV_FILE, 'utf8');
      expect(envText).toMatch(/^#\s*RAGAS_DO_NOT_TRACK=true.*$/m);
      const vars = parseAnsibleEnvVars(
        fs.readFileSync(path.resolve(__dirname, '../../../deploy/ansible/templates/env.j2'), 'utf8')
      );
      expect(vars.RAGAS_DO_NOT_TRACK && vars.RAGAS_DO_NOT_TRACK.default).toBe('true');
    });

    test('the scoring-leg throughput vars land in all four sites (2026-10-22)', () => {
      // The scoring leg's worker pool was hardcoded to 8, the same number as
      // the judge-concurrency cap, so the two ceilings could not be moved
      // apart: 100 rows x ~13 judge calls at 8-way concurrency measured
      // ~5.4 min per row (~8 h projected). The pool and the row batch have
      // to be configurable together, and the per-call timeout has to be
      // reachable from the deployment — a call that exceeds it scores NULL
      // for its row without erroring the run.
      const full = fs.readFileSync(COMPOSE_FILE, 'utf8');
      const ragasBlock = full.slice(full.indexOf('  ragas-service:'), full.indexOf('  document-repository:'));
      expect(ragasBlock).toMatch(/- RAGAS_EVAL_MAX_WORKERS=\$\{RAGAS_EVAL_MAX_WORKERS:-8\}/);
      expect(ragasBlock).toMatch(/- RAGAS_EVAL_BATCH_ROWS=\$\{RAGAS_EVAL_BATCH_ROWS:-1\}/);
      expect(ragasBlock).toMatch(/- RAGAS_EVAL_TIMEOUT_SECONDS=\$\{RAGAS_EVAL_TIMEOUT_SECONDS:-600\}/);
      const envText = fs.readFileSync(ENV_FILE, 'utf8');
      expect(envText).toMatch(/^#\s*RAGAS_EVAL_MAX_WORKERS=8.*$/m);
      expect(envText).toMatch(/^#\s*RAGAS_EVAL_BATCH_ROWS=1.*$/m);
      expect(envText).toMatch(/^#\s*RAGAS_EVAL_TIMEOUT_SECONDS=600.*$/m);
      const vars = parseAnsibleEnvVars(
        fs.readFileSync(path.resolve(__dirname, '../../../deploy/ansible/templates/env.j2'), 'utf8')
      );
      expect(vars.RAGAS_EVAL_MAX_WORKERS && vars.RAGAS_EVAL_MAX_WORKERS.default).toBe('8');
      expect(vars.RAGAS_EVAL_BATCH_ROWS && vars.RAGAS_EVAL_BATCH_ROWS.default).toBe('1');
      expect(vars.RAGAS_EVAL_TIMEOUT_SECONDS && vars.RAGAS_EVAL_TIMEOUT_SECONDS.default).toBe('600');
    });

    test('the ragas vars are emitted by ansible env.j2 (inherited defaults)', () => {
      const vars = parseAnsibleEnvVars(
        fs.readFileSync(path.resolve(__dirname, '../../../deploy/ansible/templates/env.j2'), 'utf8')
      );
      expect({ found: !!vars.OKF_RAGAS_URL, url: vars.OKF_RAGAS_URL ? vars.OKF_RAGAS_URL.default : null }).toEqual({
        found: true,
        url: 'http://ragas-service:8090'
      });
      expect({
        found: !!vars.RAGAS_JUDGE_BASE_URL,
        url: vars.RAGAS_JUDGE_BASE_URL ? vars.RAGAS_JUDGE_BASE_URL.default : null
      }).toEqual({
        found: true,
        url: 'http://vllm:8000/v1'
      });
      expect({
        found: !!vars.RAGAS_EMBED_BASE_URL,
        url: vars.RAGAS_EMBED_BASE_URL ? vars.RAGAS_EMBED_BASE_URL.default : null
      }).toEqual({
        found: true,
        url: 'http://tei-embedding-server:80'
      });
      expect({ found: !!vars.RAGAS_EMBED_API, v: vars.RAGAS_EMBED_API ? vars.RAGAS_EMBED_API.default : null }).toEqual({
        found: true,
        v: 'tei'
      });
      expect({
        found: !!vars.OKF_RAGAS_TESTSET_SIZE_DEFAULT,
        v: vars.OKF_RAGAS_TESTSET_SIZE_DEFAULT ? vars.OKF_RAGAS_TESTSET_SIZE_DEFAULT.default : null
      }).toEqual({
        found: true,
        v: '20'
      });
    });

    test('the ragas-service image is in the ansible image list', () => {
      const facts = fs.readFileSync(
        path.resolve(__dirname, '../../../deploy/ansible/tasks/deploy-shared-facts.yml'),
        'utf8'
      );
      expect(facts).toMatch(/name: "genie-ai-ragas-service"/);
    });
  });

  // --- AC8: Contextual Retrieval knobs agree across compose and ansible -----
  //
  // The doc-context budget shipped as a hardcoded 6000 in docker-compose while
  // the Python default was 100000 and three docs said 100000 — four surfaces,
  // three answers, and 1,291 of 2,258 concept documents silently truncated
  // because nobody could tell which one was live. AC7 could not catch it: its
  // parity scope regex only matched DATAPREP_URL, so the whole contextual
  // family sat outside the gate, and env.j2's `{% if %}` guards meant the vars
  // carried no literal default for the comparison to read.
  //
  // The budget is now derived from the serving model's discovered window,
  // which makes agreement between these surfaces load-bearing rather than
  // cosmetic.
  describe('AC8: Contextual Retrieval defaults agree across compose and ansible', () => {
    const composeLines = fs.readFileSync(COMPOSE_FILE, 'utf8').split(/\r?\n/);
    const blockStart = composeLines.findIndex((l) => /^  dataprep-arango-service:/.test(l));
    let blockEnd = blockStart + 1;
    while (blockEnd < composeLines.length && !/^  [a-z0-9-]+:/.test(composeLines[blockEnd])) blockEnd += 1;
    const dataprepBlock = composeLines.slice(blockStart, blockEnd).join('\n');

    const composeDefaults = {};
    for (const m of dataprepBlock.matchAll(/\b([A-Z][A-Z0-9_]+):\s*\$\{\1(?::-([^}]*))?\}/g)) {
      composeDefaults[m[1]] = m[2] === undefined ? '' : m[2];
    }

    const ansibleVars = parseAnsibleEnvVars(
      fs.readFileSync(path.resolve(__dirname, '../../../deploy/ansible/templates/env.j2'), 'utf8')
    );

    const FAMILY = [
      'DATAPREP_CONTEXTUAL_DOC_BUDGET',
      'DATAPREP_CONTEXTUAL_DOC_BUDGET_DOC_LEVEL',
      'DATAPREP_MAX_MODEL_LEN',
      'DATAPREP_CONTEXTUAL_MAX_TOKENS',
      'CONTEXTUAL_STRATEGY',
      'CONTEXTUAL_RETRIEVAL_ENABLED',
      'CONTEXTUAL_LABEL_RAW'
    ];

    test('the dataprep compose block parsed (guard — a silent re-scope must not pass)', () => {
      expect(blockStart).toBeGreaterThan(-1);
      expect(blockEnd).toBeGreaterThan(blockStart);
      for (const v of FAMILY) expect(composeDefaults[v]).toBeDefined();
    });

    test('compose and env.j2 agree on every contextual default', () => {
      const problems = [];
      for (const v of FAMILY) {
        const a = ansibleVars[v];
        if (!a) {
          problems.push(`${v}: not emitted by env.j2`);
          continue;
        }
        if (a.count !== 1) problems.push(`${v}: emitted ${a.count}x by env.j2 (last-wins shadowing)`);
        if (a.default === null) {
          problems.push(`${v}: env.j2 carries no literal default, so compose silently wins`);
          continue;
        }
        if (a.default !== composeDefaults[v]) problems.push(`${v}: compose=${composeDefaults[v]} ansible=${a.default}`);
      }
      expect(problems).toEqual([]);
    });

    test('the doc-context budget is derived, not a fixed literal', () => {
      // 0 = derive from the serving model's discovered window. A non-zero
      // compose default would silently reinstate the one-number-for-every-
      // hardware bug, because compose ALWAYS injects the variable — so
      // "unset" never reaches Python.
      expect(composeDefaults.DATAPREP_CONTEXTUAL_DOC_BUDGET).toBe('0');
    });

    test('CONTEXTUAL_STRATEGY defaults to per_chunk on both surfaces', () => {
      // Two docs claimed a doc_level compose default; compose is per_chunk.
      expect(composeDefaults.CONTEXTUAL_STRATEGY).toBe('per_chunk');
      expect(ansibleVars.CONTEXTUAL_STRATEGY.default).toBe('per_chunk');
    });

    test('Contextual Retrieval and decoupled labelling are ON by default', () => {
      // group_vars/all.yml documented both as false; code and compose say true.
      expect(composeDefaults.CONTEXTUAL_RETRIEVAL_ENABLED).toBe('true');
      expect(composeDefaults.CONTEXTUAL_LABEL_RAW).toBe('true');
    });

    test('the concept-document ceiling agrees across compose and env.j2', () => {
      // okf-server splits a concept document above this; dataprep truncates the
      // document context above the budget it derives from the window the
      // endpoint serves at runtime. The two are NOT derived from one source —
      // this one is a literal — so the invariant "they stay in step" is the
      // operator's to keep by hand. What this test CAN assert is that both
      // deployment surfaces state the same literal.
      const full = fs.readFileSync(COMPOSE_FILE, 'utf8');
      const okfBlock = full.slice(full.indexOf('  okf-server:'), full.indexOf('  pii-service:'));
      const m = okfBlock.match(/- OKF_MAX_CONCEPT_DOC_CHARS=\$\{OKF_MAX_CONCEPT_DOC_CHARS:-(\d+)\}/);
      expect(m).not.toBeNull();
      expect(ansibleVars.OKF_MAX_CONCEPT_DOC_CHARS).toBeDefined();
      expect(ansibleVars.OKF_MAX_CONCEPT_DOC_CHARS.default).toBe(m[1]);
    });

    test('the ceiling is sized for the default window, not the historical 6000', () => {
      const full = fs.readFileSync(COMPOSE_FILE, 'utf8');
      const okfBlock = full.slice(full.indexOf('  okf-server:'), full.indexOf('  pii-service:'));
      const m = okfBlock.match(/- OKF_MAX_CONCEPT_DOC_CHARS=\$\{OKF_MAX_CONCEPT_DOC_CHARS:-(\d+)\}/);
      // 6000 was the T4-sized literal that truncated 57% of a real corpus.
      expect(Number(m[1])).toBeGreaterThan(200000);
    });
  });

  // --- Review #1350 closeout: the retriever fan-out/route knobs are now
  // emitted UNCONDITIONALLY by env.j2 (they used to be `is defined`-guarded,
  // so an ansible host without those group_vars rendered an .env without
  // them — invisible to the operator and to parity checks, while compose
  // always pinned the same defaults). This family check pins compose ↔ env.j2;
  // the retriever CODE defaults (genie-ai-overlay/retriever/config.py:280-355)
  // were verified to match by hand at the time of writing but are NOT
  // asserted here — they are comment-covered, not assertion-covered (follow-up
  // tracked on #1350).
  describe('AC8b: retriever fan-out/route defaults agree across compose and ansible', () => {
    const RETRIEVER_FAMILY = [
      'RETRIEVER_FANOUT_ENABLED',
      'RETRIEVER_FANOUT_MAX_GRAPHS',
      'RETRIEVER_FANOUT_PER_GRAPH_TIMEOUT_MS',
      'RETRIEVER_FANOUT_CANDIDATE_CAP_PER_GRAPH',
      'RETRIEVER_FANOUT_CANDIDATE_CAP_GLOBAL',
      'RETRIEVER_FANOUT_SPINE_MAX_HOPS',
      'RETRIEVER_FANOUT_EXTRACTED_HOP_CAP',
      'RETRIEVER_ROUTE_ENABLED',
      'RETRIEVER_ROUTE_TOP_K',
      'RETRIEVER_ROUTE_MIN_CHUNKS',
      'RETRIEVER_ROUTE_PROBE_TIMEOUT_MS',
      'RETRIEVER_ROUTE_RETRY',
      'RETRIEVER_ROUTE_HEAD_WEIGHT',
      'RETRIEVER_ROUTE_HEAD_MARGIN',
      'RETRIEVER_ROUTE_HEAD_FLOOR',
      'RETRIEVER_ROUTE_FORBIDDEN_TAG_MAX',
      'RETRIEVER_ROUTE_HEADS_SUPERSEDE'
    ];

    test('the family parsed from compose (guard — a silent re-scope must not pass)', () => {
      for (const v of RETRIEVER_FAMILY) {
        const c = composeVars.find((x) => x.name === v);
        expect({ name: v, found: !!c }).toEqual({ name: v, found: true });
      }
    });

    test('compose and env.j2 agree on every fan-out/route default', () => {
      const ansible = parseAnsibleEnvVars(
        fs.readFileSync(path.resolve(__dirname, '../../../deploy/ansible/templates/env.j2'), 'utf8')
      );
      const problems = [];
      for (const v of RETRIEVER_FAMILY) {
        const a = ansible[v];
        const c = composeVars.find((x) => x.name === v);
        if (!a) {
          problems.push(`${v}: not emitted by env.j2`);
          continue;
        }
        if (a.count !== 1) problems.push(`${v}: emitted ${a.count}x by env.j2 (last-wins shadowing)`);
        if (a.default === null) {
          problems.push(`${v}: env.j2 carries no literal default, so compose silently wins`);
          continue;
        }
        if (c && a.default !== c.default) problems.push(`${v}: compose=${c.default} ansible=${a.default}`);
      }
      expect(problems).toEqual([]);
    });
  });

  // OKF feature flag (2026-10-21, merge prep): one variable parks the whole
  // OKF stack — containers (replicas), Kong route (restore script), UI
  // (entrypoint APP_CONFIG), BFF posture (short-circuit). Parity here guards
  // that all four surfaces keep reading the SAME variable with the SAME
  // default, and that the shipped default is parked (0) — main must behave
  // pre-OKF until a deployment opts in.
  describe('AC9: OKF feature flag consistency', () => {
    const composeText = fs.readFileSync(COMPOSE_FILE, 'utf8');
    const ansibleVars = parseAnsibleEnvVars(
      fs.readFileSync(path.resolve(__dirname, '../../../deploy/ansible/templates/env.j2'), 'utf8')
    );
    const allVarsYml = fs.readFileSync(path.resolve(__dirname, '../../../deploy/ansible/group_vars/all.yml'), 'utf8');

    test('every OKF container scales on OKF_ENABLED with default 0', () => {
      for (const svc of ['okf-server:', 'pii-service:', 'ragas-service:']) {
        const start = composeText.indexOf('  ' + svc);
        expect(start).toBeGreaterThan(-1);
        // Block ends at the next line indented exactly 2 spaces (the next
        // top-level key) — body lines are 4+ so /\n  \S/ skips them.
        const rest = composeText.slice(start + 10);
        const next = rest.match(/\n  \S/);
        const block = composeText.slice(start, next ? start + 10 + next.index : undefined);
        expect(block).toMatch(/profiles: \["okf"\]/);
        expect(block).toMatch(/replicas: \$\{OKF_ENABLED:-0\}/);
      }
    });

    test('frontend, kong-config and backend all receive the flag', () => {
      expect(composeText).toMatch(/VUE_APP_OKF_ENABLED=\$\{OKF_ENABLED:-0\}/);
      // Backend + kong-config (the backend has no .env passthrough — without
      // this entry a parked deployment leaves it timing out against the
      // zero-replica okf-server).
      expect((composeText.match(/- OKF_ENABLED=\$\{OKF_ENABLED:-0\}/g) || []).length).toBeGreaterThanOrEqual(2);
    });

    test('env.j2 renders OKF_ENABLED (default 0) and all.yml pins okf_enabled 0', () => {
      expect(ansibleVars.OKF_ENABLED).toBeDefined();
      // `{{ okf_enabled | default('0') }}` is classified as literal default
      // '0' (not a jinja expression) — same shape as ENABLE_OBSERVABILITY.
      expect(ansibleVars.OKF_ENABLED.default).toBe('0');
      expect(ansibleVars.OKF_ENABLED.defaultIsJinja).toBe(false);
      expect(allVarsYml).toMatch(/^okf_enabled: "0"$/m);
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

    test('every knob of the retrieval path is delivered and read', () => {
      expect(retrieverEnv.errors).toEqual([]);
    });

    test('the label filter strategy knob is delivered to the retriever and read by the overlay', () => {
      expect(retrieverEnv.deliveredToRetriever.has('RETRIEVER_ARANGO_FILTER_STRATEGY')).toBe(true);
      expect(retrieverEnv.codeNames.has('RETRIEVER_ARANGO_FILTER_STRATEGY')).toBe(true);
    });

    // --- the check on a fixture -------------------------------------------
    // The check has to fail when the two sides drift apart, otherwise it
    // passes on every repository state. Each case builds the same small
    // deployment with one difference and states what the check must report.
    describe('the check on a fixture', () => {
      let root;

      const COMPOSE = [
        'services:',
        '  retriever-arango-service:',
        '    environment:',
        '      RETRIEVER_ARANGO_K: ${RETRIEVER_ARANGO_K:-4}',
        ''
      ].join('\n');
      const WITH_FILTER_STRATEGY =
        COMPOSE + '      RETRIEVER_ARANGO_FILTER_STRATEGY: ${RETRIEVER_ARANGO_FILTER_STRATEGY:-OR}\n';
      const READ_K = 'K = os.getenv("RETRIEVER_ARANGO_K", "4")\n';
      const READ_FILTER_STRATEGY = 'STRATEGY = os.getenv("RETRIEVER_ARANGO_FILTER_STRATEGY", "OR")\n';

      const CASES = [
        {
          name: 'a knob the retriever receives and the code reads is not reported',
          files: { 'docker-compose.yaml': COMPOSE, 'overlay/retriever/config.py': READ_K },
          reported: []
        },
        {
          name: 'a knob the retriever receives and no service reads is reported',
          files: {
            'docker-compose.yaml': WITH_FILTER_STRATEGY,
            'overlay/retriever/config.py': READ_K
          },
          reported: ['RETRIEVER_ARANGO_FILTER_STRATEGY']
        },
        {
          name: 'a knob the deployment configures and the retriever does not receive is reported',
          files: {
            'docker-compose.yaml': COMPOSE,
            'env.j2': 'RETRIEVER_ARANGO_FILTER_STRATEGY={{ retriever_arango_filter_strategy }}\n',
            'overlay/retriever/config.py': READ_K + READ_FILTER_STRATEGY
          },
          reported: ['RETRIEVER_ARANGO_FILTER_STRATEGY']
        },
        {
          name: 'a knob the code reads and no deployment file sets is reported',
          files: {
            'docker-compose.yaml': COMPOSE,
            'overlay/retriever/config.py': READ_K + 'GHOST = os.getenv("RETRIEVER_ARANGO_GHOST", "OR")\n'
          },
          reported: ['RETRIEVER_ARANGO_GHOST']
        },
        {
          name: 'a commented-out read does not count as a read',
          files: {
            'docker-compose.yaml': WITH_FILTER_STRATEGY,
            'overlay/retriever/config.py': READ_K + '# ' + READ_FILTER_STRATEGY
          },
          reported: ['RETRIEVER_ARANGO_FILTER_STRATEGY']
        },
        {
          name: 'a read by a service outside the retrieval path does not count as a read',
          files: {
            'docker-compose.yaml': WITH_FILTER_STRATEGY,
            'overlay/retriever/config.py': READ_K,
            'overlay/dataprep/genieai_dataprep_arangodb.py': READ_FILTER_STRATEGY
          },
          reported: ['RETRIEVER_ARANGO_FILTER_STRATEGY']
        }
      ];

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

      test.each(CASES)('$name', ({ files, reported }) => {
        writeFixture('env.j2', '');
        writeFixture('env', '');
        for (const [relativePath, content] of Object.entries(files)) {
          writeFixture(relativePath, content);
        }
        const errors = checkFixture().errors;
        expect(errors).toHaveLength(reported.length);
        for (const name of reported) {
          expect(errors.join('\n')).toContain(name);
        }
      });
    });
  });
});

// Section of the CI file from a top-level key to the next one. The boundary
// matches a top-level KEY line only — a column-0 comment inside the job body
// is valid YAML there and must not truncate the section. Comment lines are
// stripped entirely: they are layout, not configuration, and must not leak
// literals (a path, a condition) into the assertions built on it.
const stripComments = (lines) =>
  lines.filter((line) => !line.trimStart().startsWith('#')).map((line) => line.replace(/\s+#.*$/, ''));

const gitlabSection = (content, job) => {
  const start = content.indexOf(`\n${job}:`);
  expect(start).toBeGreaterThan(-1);
  const rest = content.slice(start + 1);
  const end = rest.search(/\n[\w:.-]+:(\s|$)/);
  const section = end === -1 ? rest : rest.slice(0, end + 1);
  return stripComments(section.split('\n')).join('\n');
};

// --- e2e merge-train changes filters (#1264) ---
// e2e:playwright hard-needs e2e:integration on merge trains: a train whose
// paths instantiate e2e:playwright must also instantiate its needs-partner,
// or GitLab fails pipeline creation and the whole train goes red. The CI file
// makes that hold structurally — both jobs alias one hidden anchor
// (.e2e_merge_train_changes) — so this guard pins the alias wiring and the
// anchor contents instead of re-deriving a subset relation. Every path the
// jobs execute or consume must be in the anchor, or e2e silently skips on
// the train.
describe('e2e merge-train changes filters (#1264)', () => {
  const ciFile = path.join(ROOT, '.gitlab-ci.yml');
  const ANCHOR = '.e2e_merge_train_changes';
  const E2E_JOBS = ['e2e:integration', 'e2e:playwright'];
  let content;
  let filters;
  let EXECUTED_GLOBS;
  let EXECUTED_SPECS;
  let DERIVED_CONSUMED;
  let CONSUMED_FILES;

  beforeAll(() => {
    content = fs.readFileSync(ciFile, 'utf-8');
    filters = parseGitlabCiJobChanges(ciFile, [ANCHOR, ...E2E_JOBS]);
    // One snapshot: every assertion below reads the same parse/walk/spec
    // reads, so executed and consumed paths can never come from different
    // invocations of the pipeline.
    EXECUTED_GLOBS = executedPaths();
    EXECUTED_SPECS = specFilesUnderExecuted(EXECUTED_GLOBS);
    ({ globs: DERIVED_CONSUMED, files: CONSUMED_FILES } = deriveConsumed(
      EXECUTED_SPECS.map((file) => ({
        file,
        source: fs.readFileSync(path.join(ROOT, file), 'utf-8')
      }))
    ));
  });

  // Comments are stripped entirely — whole-line ones and inline ` #...`
  // tails: they are layout, not configuration, and must not leak literals
  // (a path, a condition, a tool name) into the assertions below. The
  // inline rule is safe for the sections this suite reads today; it is NOT
  // file-wide — a line like `echo "Add a ## [v1] section"` (config:changelog
  // carries one) would truncate, so a future section pin on such a job
  // needs a quote-aware strip first.
  // Section of the file from a top-level key to the next one. The boundary
  // matches a top-level KEY line only — a column-0 comment inside the job
  // body is valid YAML there and must not truncate the section. Comment
  // lines are stripped entirely: they are layout, not configuration, and
  // must not leak literals (a path, a condition) into the assertions below.
  const sectionOf = (job) => gitlabSection(content, job);

  // Executed paths are derived from the `npx playwright test` invocation
  // line(s) in .e2e_web_base rather than copied into a second hand-maintained
  // list — a hardcoded list would inherit the same drift this guard exists to
  // catch. The derivation is anchored to that base's section so an invocation
  // added elsewhere in the file cannot silently redirect it, and it consumes
  // EVERY invocation the base carries (a second script line's targets reach
  // the anchor check instead of silently escaping it). The npx spelling is
  // the contract: a first invocation in another spelling fails loudly below,
  // and script text that merely MENTIONS the invocation (an echo, say) is
  // captured too — loud, conservative over-capture.
  const executedPaths = () => {
    const invocations = sectionOf('.e2e_web_base').match(/npx playwright test ([^\n]+)/g) || [];
    expect(invocations.length).toBeGreaterThan(0);
    let targets = invocations.flatMap((line) =>
      line
        .replace(/^npx playwright test /, '')
        .split(/\s+/)
        .filter((arg) => arg.startsWith('tests/e2e'))
        .map((arg) => (arg.endsWith('/') ? `${arg}**/*` : arg))
    );
    // Set equality, order- and repetition-free: reordering the invocation's
    // arguments, or repeating one, is semantically identical for Playwright
    // and must not red the guard, while an added or removed target still
    // fails here. The canonical (deduplicated, sorted) form is what the pin
    // validates AND what every consumer downstream receives.
    targets = [...new Set(targets)].sort();
    expect(targets).toEqual([
      'tests/e2e/admin/**/*',
      'tests/e2e/chatbot/**/*',
      'tests/e2e/documents/**/*',
      'tests/e2e/helpers/**/*',
      'tests/e2e/theme-runtime-config.spec.js'
    ]);
    return targets;
  };

  // Consumed at runtime by the executed specs but not visible on the
  // invocation line: helpers are imported, fixtures are uploaded/read by the
  // documents specs. Like executedPaths above, the consumed list is derived
  // from the specs themselves — a hand-written copy would inherit the same
  // drift this guard exists to catch (a new shared directory imported by an
  // executed spec would escape the anchor until someone edits a list).
  // Two consumption shapes exist in the tree: relative require/import
  // specifiers (the helpers) and path.join(__dirname, ...) segment chains
  // (the fixtures dir). Anything else a spec consumes is not derived —
  // including joins anchored on __filename or import.meta.url and a join
  // resolving to the tests/e2e root itself; none exist in the tree.
  const TESTS_E2E_ROOT = 'tests/e2e';

  // Containment + existence + file reads in one seam. Both derivation shapes
  // drop anything that leaves tests/e2e (a traversal, a cross-tree import) or
  // does not exist on disk — the regexes over-capture and the filesystem
  // arbitrates. The transitive walk needs to read helper sources, so the
  // whole IO surface is one injectable object: the derivation units pin the
  // walk on synthetic two-directory chains that cannot exist on the real
  // tree. stat returns the stat or null, read throws outside tests/e2e —
  // containment is part of BOTH halves' contract; read returns the file
  // text.
  const REAL_IO = {
    stat: (candidate) => {
      if (!candidate.startsWith(`${TESTS_E2E_ROOT}/`)) return null;
      try {
        return fs.statSync(path.join(ROOT, candidate));
      } catch {
        return null;
      }
    },
    read: (file) => {
      if (!file.startsWith(`${TESTS_E2E_ROOT}/`)) {
        throw new Error(`read outside ${TESTS_E2E_ROOT}: ${file}`);
      }
      return fs.readFileSync(path.join(ROOT, file), 'utf-8');
    }
  };

  // Resolve a specifier the way Node does for these CJS specs: as-is, with
  // .js appended, or as a directory index (require('./lib') loading
  // lib/index.js — a literal argument the #1325 detector must NOT excuse,
  // so the resolver has to keep up). First existing file wins. (An
  // extensionless .json/.node require gets its rule added when one appears
  // — a resolver branch nothing pins stays out; the directory-index branch
  // IS pinned, on a synthetic tree below.)
  const resolveSpecifier = (fromDir, specifier, io) => {
    const base = path.posix.normalize(path.posix.join(fromDir, specifier));
    for (const candidate of [base, `${base}.js`, `${base}/index.js`]) {
      if (io.stat(candidate)?.isFile()) return candidate;
    }
    return null;
  };

  // Anchor-style entry covering a resolved path: a file directly under
  // tests/e2e is listed exactly (the anchor lists such files verbatim),
  // anything deeper becomes its directory glob. Both callers pre-filter to
  // strict descendants of tests/e2e, so the root itself never reaches here.
  const toAnchorPath = (resolvedPath, isDir) => {
    if (isDir) return `${resolvedPath}/**/*`;
    const dir = path.posix.dirname(resolvedPath);
    return dir === TESTS_E2E_ROOT ? resolvedPath : `${dir}/**/*`;
  };

  // Anchor coverage is prefix-based, not verbatim: `X/**/*` covers any
  // deeper glob or file — the anchor lists a directory once, while the
  // derivation may resolve a path nested inside it. Exact entries cover
  // themselves only.
  const isCovered = (anchorPaths, entry) =>
    anchorPaths.some((p) => p === entry || (p.endsWith('/**/*') && entry.startsWith(`${p.slice(0, -5)}/`)));

  // ONE string-literal policy for the whole guard: a quoted literal whose
  // content may carry the OTHER quote styles and backslash escapes, never
  // an unescaped copy of its own delimiter. The derivation regexes and the
  // #1325 detector below all consume this fragment — the derivation and
  // the detector must agree on the literal shape set, or a call shape one
  // accepts and the other misses re-opens a silent coverage hole. Backtick
  // interpolation (${...}) is NOT part of a literal here; it matches the
  // shape and is rejected by the detector, while a derived garbage path
  // fails the existence stat — either way the call is gated loud, never
  // silently consumed.
  const LIT_ARM = (q, dot) => `${q}${dot ? '\\.' : ''}(?:[^${q}\\\\]|\\\\.)*${q}`;
  const LIT_SRC = ["'", '"', '`'].map((q) => LIT_ARM(q)).join('|');
  // The leading `.` sits inside the quotes (it is the first character of
  // the specifier string value), so it is inserted after each arm's
  // opening delimiter — derived, never a second hand-maintained copy.
  const DOT_LIT_SRC = ["'", '"', '`'].map((q) => LIT_ARM(q, true)).join('|');
  // The whitespace between a call's tokens may legally carry a block
  // comment; every call-shape regex below uses this fragment in those
  // gaps, so a commented call is matched (or flagged) like a plain one.
  const GAP_SRC = '(?:\\s|\\/\\*[\\s\\S]*?\\*\\/)*';
  // Node resolves the STRING VALUE, not the source text: escapes written in
  // the literal ('./it\'s.js') are already resolved before require runs.
  const UNESCAPE = (literal) => literal.slice(1, -1).replace(/\\(.)/g, '$1');

  // Extract the consumed paths from the executed specs AND the files they
  // transitively require (#1326, #1344): consumption introduced inside a
  // helper — a refactor moving shared logic into a new directory required
  // only from another helper — must reach the anchor demand too, or a train
  // touching it skips e2e silently. The walk BFS-es from the executed specs
  // through their resolved relative specifiers; the visited set doubles as
  // the cycle guard. Two consumption shapes per file: relative require/
  // import specifiers and path.join(__dirname, ...) / path.resolve(
  // __dirname, ...) string-literal segment chains (both built on LIT_SRC
  // above). Candidates are dropped unless they resolve inside tests/e2e to
  // something that exists on disk — the regexes over-capture (comments
  // naming real files, dead references) and the filesystem arbitrates.
  // Over-capture is the conservative direction for a trigger guard: more
  // anchor coverage, never a silent loss of coverage, and it fails the
  // exact pin loudly. Computed (non-literal) arguments match nothing here
  // (or resolve to nothing) — the shape detector below fails loudly when
  // one appears, so this walk never sees the family ungated.
  const deriveConsumed = (specFiles, io = REAL_IO) => {
    // Specifier shapes consumed — require( takes spaced and .resolve
    // spellings, import( the spaced one, and `from`, dynamic import() and
    // bare side-effect imports land in the same alternation; the literal
    // itself is the shared LIT_SRC policy (must start with `.` = relative).
    const specifierRe = new RegExp(
      '(?:(?:require(?:\\.resolve)?)' +
        GAP_SRC +
        '\\(|\\bimport' +
        GAP_SRC +
        '\\(?|\\bfrom' +
        GAP_SRC +
        ')(' +
        DOT_LIT_SRC +
        ')',
      'g'
    );
    // Same literal policy for __dirname chains: any spacing, two or more
    // `, 'segment'` pairs. A join carrying a non-literal argument is not
    // matched at all (the detector below gates it); an inline comment
    // inside the call likewise. Chains anchored on __filename or
    // import.meta.url are not derived — no spec uses them; they belong to
    // the same documented-limits family.
    const joinRe = new RegExp(
      'path\\.(?:join|resolve)' +
        GAP_SRC +
        '\\(' +
        GAP_SRC +
        '__dirname((?:' +
        GAP_SRC +
        ',' +
        GAP_SRC +
        '(?:' +
        LIT_SRC +
        '))+)\\s*\\)',
      'g'
    );
    const segmentRe = new RegExp(LIT_SRC, 'g');
    const globs = new Set();
    const sources = new Map();
    const queue = [];
    // One enqueue path for both consumption shapes: the visited set (the
    // sources map) doubles as the cycle guard, and the read happens once.
    // Non-JS consumed files (a JSON fixture a require or join lands on)
    // still count as consumption — the caller adds their glob — but carry
    // no JS to walk, and running the #1325 detector over data-file prose
    // would only fabricate findings. The JS spellings mirror the testMatch
    // shape set: Playwright transpiles jsx/tsx helpers like js ones.
    const visitFile = (resolved) => {
      if (sources.has(resolved)) return;
      if (!WALKABLE_FILE_RE.test(resolved)) return;
      sources.set(resolved, io.read(resolved));
      queue.push(resolved);
    };
    for (const { file, source } of specFiles) {
      sources.set(file, source);
      queue.push(file);
    }
    while (queue.length > 0) {
      const file = queue.shift();
      const source = sources.get(file);
      const dir = path.posix.dirname(file);
      for (const match of source.matchAll(specifierRe)) {
        const resolved = resolveSpecifier(dir, UNESCAPE(match[1]), io);
        if (!resolved) continue;
        globs.add(toAnchorPath(resolved, false));
        visitFile(resolved);
      }
      for (const match of source.matchAll(joinRe)) {
        const segments = [...match[1].matchAll(segmentRe)].map((m) => UNESCAPE(m[0]));
        const resolved = path.posix.normalize(path.posix.join(dir, ...segments));
        const st = io.stat(resolved);
        if (!st) continue;
        globs.add(toAnchorPath(resolved, st.isDirectory()));
        // A join that lands on a FILE is consumption like a require — its
        // own requires must be walked and it must face the #1325 detector
        // like any other consumed file. (The fixtures joins resolve to the
        // directory and stop here.)
        if (st.isFile()) visitFile(resolved);
      }
    }
    return {
      globs: [...globs].sort(),
      files: [...sources].map(([file, source]) => ({ file, source }))
    };
  };

  // Shape detector for the non-literal-argument family (#1325): every
  // derivation regex only matches literal arguments, so a require/import
  // carrying a computed specifier or a __dirname join carrying an
  // interpolated segment matches nothing and its consumption escapes the
  // anchor silently. Policy (the conscious gate this issue asks to decide):
  // executed specs and the helpers they transitively consume must not
  // contain such calls AT ALL — the detector fails loudly when one appears,
  // converting the introduction into a deliberate test change instead of a
  // silent coverage hole. require( / require.resolve( / import( must carry
  // exactly one string literal (template literals with interpolation
  // included in the forbidden family); path.join(__dirname, ...)/resolve
  // must carry only string-literal segments — both built on the shared
  // LIT_SRC policy above, so the quote/escape rules cannot drift between
  // the derivation and this detector. The detector runs on raw text (no
  // comment stripping — stripping could truncate a string containing `//`
  // and FABRICATE a finding, worse than over-capture) and over-captures on
  // purpose: prose mentioning a call shape reads as consumption — loud is
  // the safe direction. Matching is delimiter-aware instead of
  // first-paren-delimited: a literal carrying `)` (a file named `doc(v2)`)
  // is not misread as the call's end, and a literal carrying ANOTHER quote
  // style (`require("./user's-data.js")`) is not misread as terminated
  // early. The literal must be the WHOLE argument: the closing paren
  // anchors the end, so `require('../x' + y)` cannot pass as a literal
  // prefix match.
  const LITERAL_ARG = new RegExp('^\\s*(' + LIT_SRC + ')\\s*\\)');
  const findNonLiteralConsumption = (source) => {
    const findings = [];
    const interpolated = (literal) => literal.startsWith('`') && literal.includes('${');
    // Escapes UNESCAPE cannot resolve exactly (\uXXXX, \xNN, octal): the
    // runtime path would differ from the derived one, so the call is
    // flagged instead of silently resolved to a wrong path.
    const ESCAPE_UNRESOLVED = /\\(?:u\{?[0-9a-fA-F]{1,6}|x[0-9a-fA-F]{2}|[0-7]{1,3})/;
    // Same word-boundary discipline as the specifier regex: a method named
    // require/import (x.import(...) / foo.require(...)) is not consumption.
    const callStartRe = new RegExp('(?<![\\w.$])(?:require(?:\\.resolve)?|import)' + GAP_SRC + '\\(', 'g');
    for (const match of source.matchAll(callStartRe)) {
      const m = LITERAL_ARG.exec(source.slice(match.index + match[0].length));
      if (!m || interpolated(m[1]) || ESCAPE_UNRESOLVED.test(m[1])) {
        findings.push('non-literal specifier in a require/import call');
      }
    }
    const dirnameStartRe = new RegExp('path\\.(?:join|resolve)' + GAP_SRC + '\\(' + GAP_SRC + '__dirname', 'g');
    const SEGMENT = new RegExp('^\\s*,\\s*(' + LIT_SRC + ')');
    for (const match of source.matchAll(dirnameStartRe)) {
      let rest = source.slice(match.index + match[0].length);
      let segment;
      while ((segment = SEGMENT.exec(rest))) {
        if (interpolated(segment[1]) || ESCAPE_UNRESOLVED.test(segment[1])) break;
        rest = rest.slice(segment[0].length);
      }
      if (!/^\s*\)/.test(rest)) findings.push('non-literal segment in a path.join(__dirname, ...) call');
    }
    return findings;
  };

  // The spec files the invocation executes: real files under the executed
  // globs (a `X/**/*` glob narrows to the `X/` subtree — with a real
  // directory boundary, a sibling `X-v2/` is not covered — an exact entry
  // stays exact). Playwright's default testMatch glob
  // `*.(spec|test).?(c|m)[jt]s?(x)`: optional c|m module prefix, then j or
  // t, then a REQUIRED s (the trailing ? quantifies only the x), then
  // optional x — the selection regex below mirrors that shape set exactly
  // (the config test pins that the default is still in force), so every
  // spelling Playwright would run counts as executed and none it would
  // not.
  const specFilesUnderExecuted = (executedGlobs) =>
    scanTargets(
      fs
        .readdirSync(path.join(ROOT, TESTS_E2E_ROOT), { recursive: true })
        .map((f) => `${TESTS_E2E_ROOT}/${f.split(path.sep).join('/')}`),
      executedGlobs
    );

  // The extension shape set Playwright's default testMatch accepts — one
  // fragment shared by the executed-spec selection and the walk's JS-file
  // gate so the two cannot drift.
  const JS_EXT_SRC = '[cm]?[jt]sx?';

  // Pure selection of the executed files from a directory listing — the
  // units below pin the boundary and the testMatch shapes on synthetic
  // listings, the real-tree pin above anchors them to the actual invocation.
  const EXECUTED_SPEC_RE = new RegExp('\\.(?:spec|test)\\.' + JS_EXT_SRC + '$');
  const WALKABLE_FILE_RE = new RegExp('\\.(?:' + JS_EXT_SRC + ')$');
  const scanTargets = (files, executedGlobs) =>
    files.filter((f) => EXECUTED_SPEC_RE.test(f)).filter((f) => isCovered(executedGlobs, f));

  test('executed and consumed paths are covered by the shared anchor', () => {
    const anchorPaths = filters.get(ANCHOR);
    const uncovered = [...EXECUTED_GLOBS, ...DERIVED_CONSUMED].filter((p) => !isCovered(anchorPaths, p));
    // The diff names every uncovered path, not just the first.
    expect(uncovered).toEqual([]);
  });

  test('derivation scans exactly the spec files the invocation executes', () => {
    expect([...EXECUTED_SPECS].sort()).toEqual([
      'tests/e2e/admin/authz.spec.js',
      'tests/e2e/admin/data-wiring.spec.js',
      'tests/e2e/admin/failure-states.spec.js',
      'tests/e2e/admin/logs-view.spec.js',
      'tests/e2e/chatbot/conversation-history.spec.js',
      'tests/e2e/chatbot/error-handling.spec.js',
      'tests/e2e/chatbot/quick-help-scope.spec.js',
      'tests/e2e/chatbot/send-message-and-stream.spec.js',
      'tests/e2e/documents/search.spec.js',
      'tests/e2e/documents/upload.spec.js',
      'tests/e2e/helpers/auth.spec.js',
      'tests/e2e/theme-runtime-config.spec.js'
    ]);
  });

  // Exact pin — the mutation gate for the derivation itself: a scanner branch
  // that stops matching (a require shape, the fixtures path.join) fails here
  // before it can silently shrink what the anchor check above covers.
  test('consumed paths derived from the executed specs are the expected set', () => {
    expect(DERIVED_CONSUMED).toEqual(['tests/e2e/fixtures/**/*', 'tests/e2e/helpers/**/*']);
  });

  // The non-literal-argument family (#1325) is absent from the real tree
  // today — this gate keeps it that way: the first interpolated require or
  // __dirname join with a variable segment in an executed spec (or a helper
  // it consumes) fails here loudly instead of escaping the derivation
  // silently.
  test('no non-literal consumption calls in executed specs or consumed helpers', () => {
    const findings = CONSUMED_FILES.flatMap(({ file, source }) =>
      findNonLiteralConsumption(source).map((kind) => `${file}: ${kind}`)
    );
    expect(findings).toEqual([]);
  });

  // The derivation assumes Playwright's default testMatch (which shapes
  // execute) and relies on testDir pointing at the tree the invocation
  // targets. If the config ever pins its own testMatch or moves testDir,
  // the scan set silently diverges from what actually executes — the same
  // hand-copied drift this guard exists to catch, in its own input. Pin
  // both (on comment-free code text — no comment form naming the keys may
  // fail the pin) so an override fails here first, loudly.
  test('playwright.config.js keeps the defaults the derivation assumes', () => {
    const config = stripJsComments(fs.readFileSync(path.join(ROOT, 'playwright.config.js'), 'utf-8').split('\n')).join(
      '\n'
    );
    // testMatch and testIgnore must not appear at all (both would change
    // which files execute), and testDir must appear exactly once — a
    // second, project-level testDir would execute a different file set
    // than the invocation's targets name.
    expect(config).not.toMatch(/testMatch/);
    expect(config).not.toMatch(/testIgnore/);
    expect((config.match(/testDir/g) || []).length).toBe(1);
    expect(config).toMatch(/testDir:\s*'\.\/tests\/e2e'/);
  });

  describe('scan-target selection', () => {
    const GLOBS = ['tests/e2e/chatbot/**/*', 'tests/e2e/theme-runtime-config.spec.js'];

    test('a .test.js file executes under the default testMatch too', () => {
      expect(scanTargets(['tests/e2e/chatbot/x.test.js', 'tests/e2e/chatbot/x.js'], GLOBS)).toEqual([
        'tests/e2e/chatbot/x.test.js'
      ]);
    });

    test('every extension of the default testMatch executes', () => {
      const listing = [
        'tests/e2e/chatbot/x.spec.ts',
        'tests/e2e/chatbot/x.test.mjs',
        'tests/e2e/chatbot/x.spec.cjs',
        'tests/e2e/chatbot/x.spec.tsx',
        'tests/e2e/chatbot/x.test.jsx'
      ];
      expect(scanTargets(listing, GLOBS)).toEqual(listing);
    });

    // The selection regex must accept exactly the shape set of Playwright's
    // default testMatch glob `*.(spec|test).?(c|m)[jt]s?(x)`: optional c|m
    // module prefix, then j or t, then the literal s (required — the `?`
    // quantifies only the trailing x), then optional x. A spelling
    // Playwright runs but the selection drops would execute in the real
    // invocation while staying invisible to the derivation; a spelling the
    // selection accepts but Playwright does not run would derive an anchor
    // demand for files that never execute.
    test.each(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.mts', '.cts'])(
      'spelling x.spec%s matches the default testMatch shape set',
      (ext) => {
        expect(scanTargets([`tests/e2e/chatbot/x.spec${ext}`], GLOBS)).toEqual([`tests/e2e/chatbot/x.spec${ext}`]);
      }
    );

    test.each(['', '.j', '.jx', '.t', '.tx', '.mj', '.mtx', '.cjx', '.ctx', '.mt', '.m', '.mx', '.cx', '.jm'])(
      'spelling x.spec%s falls outside the default testMatch shape set',
      (ext) => {
        expect(scanTargets([`tests/e2e/chatbot/x.spec${ext}`], GLOBS)).toEqual([]);
      }
    );

    test('a sibling directory beyond the glob boundary is not executed', () => {
      expect(scanTargets(['tests/e2e/chatbot-v2/x.spec.js', 'tests/e2e/chatbotless.spec.js'], GLOBS)).toEqual([]);
    });
  });

  describe('comment stripping', () => {
    test('whole-line comments and inline tails are stripped, code text survives', () => {
      expect(
        stripComments([
          '  # whole-line comment stays out',
          '  script: npx playwright test tests/e2e/ # historical: npx playwright test tests/e2e/okf/',
          '  VERSION="${CI_COMMIT_TAG#v}"'
        ])
      ).toEqual(['  script: npx playwright test tests/e2e/', '  VERSION="${CI_COMMIT_TAG#v}"']);
    });

    test('stripJsComments erases whole-line, inline and block comments', () => {
      expect(
        stripJsComments([
          '// whole-line comment',
          "testDir: './tests/e2e', // inline tail",
          '/* single-line block: testMatch */',
          'const x = 1; /* multi',
          'line block */ const y = 2;'
        ])
      ).toEqual(["testDir: './tests/e2e',", '', 'const x = 1; ', ' const y = 2;']);
    });

    // A closing */ on a line that starts with // must clear the block
    // state — otherwise every later line collapses to '' and the config
    // pins above read stripped text that hides the drift they check for.
    test('a block closed by a // line still clears the block state', () => {
      expect(
        stripJsComments(['const a = 1; /* drifted:', '// end */', "testDir: './tests/e2e'", '// testMatch'])
      ).toEqual(['const a = 1; ', '', "testDir: './tests/e2e'"]);
    });
  });

  describe('anchor coverage', () => {
    const ANCHOR_ROWS = ['tests/e2e/fixtures/**/*', 'tests/e2e/theme-runtime-config.spec.js'];

    test('an exact anchor entry covers verbatim and deeper paths alike', () => {
      expect(isCovered(ANCHOR_ROWS, 'tests/e2e/fixtures/**/*')).toBe(true);
      expect(isCovered(ANCHOR_ROWS, 'tests/e2e/fixtures/http/**/*')).toBe(true);
      expect(isCovered(ANCHOR_ROWS, 'tests/e2e/fixtures/http/seed.json')).toBe(true);
      expect(isCovered(ANCHOR_ROWS, 'tests/e2e/theme-runtime-config.spec.js')).toBe(true);
    });

    test('a sibling or unrelated path is not covered', () => {
      expect(isCovered(ANCHOR_ROWS, 'tests/e2e/helpers/**/*')).toBe(false);
      expect(isCovered(ANCHOR_ROWS, 'tests/e2e/fixtures-backup/**/*')).toBe(false);
      expect(isCovered(ANCHOR_ROWS, 'tests/e2e/theme-runtime-config.spec.js.bak')).toBe(false);
    });
  });

  // JS-flavored comment stripping for playwright.config.js: whole-line //
  // comments, inline // tails, and /* */ block spans. The in-block handler
  // runs BEFORE the whole-line filter: a closing */ on a line that starts
  // with // (e.g. `// end */`) must clear the block state, or every later
  // line collapses to '' and the config pins above false-pass on drifted
  // text. The // erase is naive (a URL in a string is truncated too) — the
  // config pin only searches for config keys, so truncation cannot
  // fabricate a match.
  const stripJsComments = (lines) => {
    let inBlock = false;
    return lines
      .map((line) => {
        if (inBlock) {
          const end = line.indexOf('*/');
          if (end === -1) return '';
          line = line.slice(end + 2);
          inBlock = false;
        }
        // A whole-line comment is REMOVED (null → filtered), not blanked;
        // a line emptied by a block close stays '' (harmless to the config
        // pins, which search text).
        if (line.trimStart().startsWith('//')) return null;
        const open = line.indexOf('/*');
        if (open !== -1) {
          const close = line.indexOf('*/', open);
          line = close === -1 ? line.slice(0, open) : line.slice(0, open) + line.slice(close + 2);
          if (close === -1) inBlock = true;
        }
        return line.replace(/\s+\/\/.*$/, '');
      })
      .filter((line) => line !== null);
  };

  describe('consumed-path derivation units', () => {
    // tree (optional) swaps in the synthetic IO seam: tests pinning only the
    // derived globs collapse to a one-liner; tests also pinning the walked
    // FILE list keep the explicit deriveConsumed call — the {globs, files}
    // return shape is part of what they pin.
    const deriveFrom = (file, source, tree) => deriveConsumed([{ file, source }], tree && memIo(tree)).globs;

    // Synthetic IO seam: the walk's transitivity (#1326), the directory-
    // index resolution and the join-onto-a-file walk are shapes the real
    // tree never exercises (every cross-require stays inside helpers/), so
    // the gates live on synthetic trees instead of waiting for a real
    // refactor to make them reachable.
    const memIo = (tree) => ({
      stat: (candidate) => (tree[candidate] ? { isFile: () => true, isDirectory: () => false } : null),
      read: (file) => {
        if (!tree[file]) throw new Error(`read outside the synthetic tree: ${file}`);
        return tree[file];
      }
    });

    // One row per specifier spelling the scanner accepts; the next accepted
    // spelling is a row here, not a new test.
    test.each([
      ['plain require', "const h = require('../helpers/auth');"],
      ['double-quoted require', 'const h = require("../helpers/auth");'],
      ['backtick require', 'const h = require(`../helpers/auth`);'],
      ['spaced require', "const h = require ('../helpers/auth');"],
      ['require.resolve', "const b = require.resolve('../helpers/auth');"],
      ['ESM from-import', "import x from '../helpers/auth';"],
      ['dynamic import', "const y = import('../helpers/auth');"],
      ['spaced dynamic import', "const y = await import ('../helpers/auth');"],
      ['side-effect import', "import '../helpers/auth';"],
      ['no-space side-effect import', "import'../helpers/auth';"],
      ['no-space re-export from', "export { x } from'../helpers/auth';"]
    ])('consumes the %s shape', (_name, source) => {
      expect(deriveFrom('tests/e2e/chatbot/x.spec.js', source)).toEqual(['tests/e2e/helpers/**/*']);
    });

    test('a block comment inside the call does not hide the consumption', () => {
      expect(deriveFrom('tests/e2e/chatbot/x.spec.js', "const h = require /* note */ ('../helpers/auth');")).toEqual([
        'tests/e2e/helpers/**/*'
      ]);
    });

    test('an extensionless same-dir require resolves through the .js rule', () => {
      expect(deriveFrom('tests/e2e/helpers/auth.spec.js', "const a = require('./auth');")).toEqual([
        'tests/e2e/helpers/**/*'
      ]);
    });

    test('a path.join(__dirname, ...) chain maps to the referenced directory', () => {
      expect(
        deriveFrom('tests/e2e/documents/upload.spec.js', "const d = path.join(__dirname, '..', 'fixtures');")
      ).toEqual(['tests/e2e/fixtures/**/*']);
    });

    test('path.resolve is treated like path.join', () => {
      expect(
        deriveFrom('tests/e2e/documents/x.spec.js', "const d = path.resolve(__dirname, '..', 'fixtures');")
      ).toEqual(['tests/e2e/fixtures/**/*']);
    });

    test('a join with space after the paren, double quotes or backticks still matches', () => {
      expect(
        deriveFrom('tests/e2e/documents/x.spec.js', 'const d = path.join( __dirname, "..", `fixtures` );')
      ).toEqual(['tests/e2e/fixtures/**/*']);
    });

    test('a file directly under tests/e2e maps to its exact path', () => {
      // Synthetic tree: the pin is the exact mapping for a root-level file,
      // not the real tree's file set.
      const tree = {
        'tests/e2e/documents/x.spec.js': "const t = require('../theme-runtime-config.spec.js');",
        'tests/e2e/theme-runtime-config.spec.js': 'test();'
      };
      expect(deriveFrom('tests/e2e/documents/x.spec.js', tree['tests/e2e/documents/x.spec.js'], tree)).toEqual([
        'tests/e2e/theme-runtime-config.spec.js'
      ]);
    });

    test('a literal carrying another quote style or an escape is still consumed', () => {
      const tree = {
        'tests/e2e/documents/x.spec.js': 'const a = require("../lib/user\'s-data.js");',
        "tests/e2e/lib/user's-data.js": 'module.exports = {};',
        'tests/e2e/documents/y.spec.js': "const b = require('../lib/it\\'s.js');",
        "tests/e2e/lib/it's.js": 'module.exports = {};'
      };
      const derived = deriveConsumed(
        [
          { file: 'tests/e2e/documents/x.spec.js', source: tree['tests/e2e/documents/x.spec.js'] },
          { file: 'tests/e2e/documents/y.spec.js', source: tree['tests/e2e/documents/y.spec.js'] }
        ],
        memIo(tree)
      );
      expect(derived.globs).toEqual(['tests/e2e/lib/**/*']);
      // The walked file must carry the RESOLVED escape (it's.js, not
      // it\'s.js) — the value Node itself would load at runtime.
      expect(derived.files.map((f) => f.file)).toContain("tests/e2e/lib/it's.js");
    });

    test('a non-relative specifier is not derived even when a same-named file exists', () => {
      const tree = {
        'tests/e2e/documents/x.spec.js': "const p = require('helpers');",
        'tests/e2e/documents/helpers.js': 'module.exports = {};'
      };
      const derived = deriveConsumed(
        [{ file: 'tests/e2e/documents/x.spec.js', source: tree['tests/e2e/documents/x.spec.js'] }],
        memIo(tree)
      );
      expect(derived.globs).toEqual([]);
      expect(derived.files).toHaveLength(1);
    });

    test('a join landing on a non-JS file adds the glob but is not walked or scanned', () => {
      const tree = {
        'tests/e2e/documents/x.spec.js': "const e = path.join(__dirname, 'expected.json');",
        'tests/e2e/documents/expected.json': '{ "note": "mention require(x) here" }'
      };
      const derived = deriveConsumed(
        [{ file: 'tests/e2e/documents/x.spec.js', source: tree['tests/e2e/documents/x.spec.js'] }],
        memIo(tree)
      );
      expect(derived.globs).toEqual(['tests/e2e/documents/**/*']);
      expect(derived.files).toHaveLength(1);
    });

    test('a directory-index require resolves through the index.js rule', () => {
      const tree = {
        'tests/e2e/documents/x.spec.js': "const l = require('../lib');",
        'tests/e2e/lib/index.js': 'module.exports = {};'
      };
      expect(deriveFrom('tests/e2e/documents/x.spec.js', tree['tests/e2e/documents/x.spec.js'], tree)).toEqual([
        'tests/e2e/lib/**/*'
      ]);
    });

    test('a join that lands on a file walks the file too', () => {
      const tree = {
        'tests/e2e/documents/x.spec.js': "const p = path.join(__dirname, 'extra.js');",
        'tests/e2e/documents/extra.js': "const x = require('../lib/loaded');",
        'tests/e2e/lib/loaded.js': 'module.exports = {};'
      };
      const derived = deriveConsumed(
        [{ file: 'tests/e2e/documents/x.spec.js', source: tree['tests/e2e/documents/x.spec.js'] }],
        memIo(tree)
      );
      expect(derived.globs).toEqual(['tests/e2e/documents/**/*', 'tests/e2e/lib/**/*']);
      expect(derived.files.map((f) => f.file)).toEqual([
        'tests/e2e/documents/x.spec.js',
        'tests/e2e/documents/extra.js',
        'tests/e2e/lib/loaded.js'
      ]);
    });

    test('specifiers that leave tests/e2e or do not exist are dropped', () => {
      const source = [
        "const p = require('../../../tests/config-validator/package.json');", // exists, outside tests/e2e
        "const g = require('../../../etc/passwd');", // traversal
        "const m = require('path');", // builtin
        "const n = require('../helpers/no-such-helper');", // nonexistent
        "const j = path.join(__dirname, '..', '..', 'config-validator');", // join, outside tests/e2e
        "// const c = require('../helpers/also-missing');" // dead reference
      ].join('\n');
      expect(deriveFrom('tests/e2e/documents/x.spec.js', source)).toEqual([]);
    });

    test('a helper required by a helper is walked transitively', () => {
      const tree = {
        'tests/e2e/documents/x.spec.js': "const a = require('../helpers/auth');",
        'tests/e2e/helpers/auth.js': "const p = require('../lib/paths');",
        'tests/e2e/lib/paths.js': 'module.exports = {};'
      };
      const derived = deriveConsumed(
        [{ file: 'tests/e2e/documents/x.spec.js', source: tree['tests/e2e/documents/x.spec.js'] }],
        memIo(tree)
      );
      expect(derived.globs).toEqual(['tests/e2e/helpers/**/*', 'tests/e2e/lib/**/*']);
      expect(derived.files.map((f) => f.file)).toEqual([
        'tests/e2e/documents/x.spec.js',
        'tests/e2e/helpers/auth.js',
        'tests/e2e/lib/paths.js'
      ]);
    });

    test('the walk does not loop on a require cycle', () => {
      const tree = {
        'tests/e2e/documents/x.spec.js': "const a = require('../helpers/auth');",
        'tests/e2e/helpers/auth.js': "const c = require('../helpers/chatbot');",
        'tests/e2e/helpers/chatbot.js': "const a = require('./auth');"
      };
      const derived = deriveConsumed(
        [{ file: 'tests/e2e/documents/x.spec.js', source: tree['tests/e2e/documents/x.spec.js'] }],
        memIo(tree)
      );
      expect(derived.globs).toEqual(['tests/e2e/helpers/**/*']);
      expect(derived.files).toHaveLength(3);
    });

    // Shape detector for the non-literal-argument family (#1325) — the
    // derivation regexes match nothing for these shapes, so without the
    // detector the consumption would drop silently.
    test.each([
      ['interpolated require', 'const h = require(`../helpers/${name}`);'],
      ['variable require', 'const h = require(helperName);'],
      ['concatenated require', "const h = require('../helpers/' + name);"],
      ['variable dynamic import', 'const y = import(dynamicName);'],
      ['interpolated join segment', "const d = path.join(__dirname, '..', locale);"],
      ['spaced join with a variable segment', 'const d = path.join (__dirname, locale);'],
      ['unicode escape in a require', "const h = require('./caf\\u00e9.js');"],
      ['unicode escape in a join segment', "const d = path.join(__dirname, 'caf\\u00e9');"],
      ['block comment inside a require call', 'const h = require /* note */ (dynamicName);'],
      ['interpolated backtick join segment', 'const d = path.join(__dirname, `../${locale}`);'],
      ['call argument after a literal join segment', "const d = path.join(__dirname, '..', dirName());"],
      // Over-capture is deliberate: a string merely mentioning a call shape
      // reads as consumption — loud is the safe direction for a trigger guard.
      ['string mentioning a require call', "const s = 'call require(x) later';"]
    ])('flags the %s shape', (_name, source) => {
      // One finding per shape — the wording itself is not the contract.
      expect(findNonLiteralConsumption(source)).toHaveLength(1);
    });

    test.each([
      ['plain require', "const h = require('../helpers/auth');"],
      ['package require', "const p = require('@playwright/test');"],
      ['backtick require without interpolation', 'const h = require(`../helpers/auth`);'],
      ['literal join', "const d = path.join(__dirname, '..', 'fixtures');"],
      ['join on a variable anchor', 'const f = path.join(FIXTURES_DIR, fileName);'],
      ['require with a paren inside the literal', "const h = require('./a(1)b.js');"],
      ['join with a paren inside a literal segment', "const d = path.join(__dirname, 'doc(v2)');"],
      ['apostrophe inside a double-quoted require', 'const h = require("./user\'s-data.js");'],
      ['escaped quote inside a require', "const h = require('./it\\'s.js');"],
      ['apostrophe inside a join segment', 'const d = path.join(__dirname, "user\'s docs");'],
      ['block comment inside a literal require call', "const h = require /* note */ ('../helpers/auth');"],
      ['string mentioning require without call args', "const s = 'see require docs';"]
    ])('does not flag the %s shape', (_name, source) => {
      expect(findNonLiteralConsumption(source)).toEqual([]);
    });
  });

  // Entries the jobs deploy or consume from this checkout — the component
  // trees the stack runs, the compose file, the env template, the Keycloak
  // tree (see the anchor bullet in .gitlab-ci.yml for the baked/bind-mount
  // split), the collector config, and the provisioning script the e2e job
  // runs with node before Playwright starts. Not derivable from the Playwright
  // invocation; a cleanup pruning one of them re-silences the train trigger
  // silently. This list is pinned EXHAUSTIVE by the reverse-containment
  // test below: an entry that loses its justification must be removed here
  // AND from the anchor in the same change.
  const STACK_INPUT_PATHS = [
    'components/gov-chat-frontend/**/*',
    'components/gov-chat-backend/**/*',
    'components/document-repository/**/*',
    '.gitlab-ci.yml',
    'playwright.config.js',
    'package.json',
    'package-lock.json',
    'docker-compose.yaml',
    'env',
    'tests/e2e/provision-admin-fixtures.js',
    'configs/keycloak/**/*',
    'configs/otel/otel-collector-config.yaml'
  ];

  test('stack-input entries are listed in the shared anchor', () => {
    const anchorPaths = filters.get(ANCHOR);
    for (const required of STACK_INPUT_PATHS) {
      expect(anchorPaths).toContain(required);
    }
  });

  // Reverse containment (#1327): the forward check alone lets an anchor
  // entry nothing justifies stay green — a purged or renamed spec tree with
  // a surviving anchor bullet instantiates e2e:integration + e2e:playwright
  // on every train touching the path, which then run nothing relevant.
  // The anchor must be EXACTLY the union of the three justification classes
  // (executed globs, derived consumed globs, stack inputs) — no extra
  // entry. Combined with the forward check, that closes both drift
  // directions; the exact equality also pins STACK_INPUT_PATHS as the
  // exhaustive hand-list, so a deliberate anchor addition outside the
  // derived classes must land in that list (and justify itself) here.
  test('the anchor is exactly the justified union — no stale entries', () => {
    const anchorPaths = [...filters.get(ANCHOR)].sort();
    const justified = [...new Set([...EXECUTED_GLOBS, ...DERIVED_CONSUMED, ...STACK_INPUT_PATHS])].sort();
    expect(anchorPaths).toEqual(justified);
  });

  // The e2e stack pulls the keycloak-config candidate image whose build job
  // bakes the realm (and the import entrypoint); if a tree change stops
  // instantiating the build, the train's candidate tag does not exist: the
  // compose pull swallows the missing manifest (|| true) and `up --no-build`
  // then fails hard — a red train whose cause (a missing tag, not a broken
  // realm) is hard to attribute. The inline `paths: [...]` form is
  // opaque to the line parser, so pin the merge_request_event rule — the
  // branch that instantiates the job on merge trains — by adjacency: its
  // paths list sits immediately above the compare_to line. scan:keycloak-config
  // carries the identical rules and gates the promote chain, so it is pinned
  // the same way.
  test.each(['build:keycloak-config', 'scan:keycloak-config', 'promote:keycloak-config'])(
    '%s merge_request_event rule still triggers on the keycloak tree',
    (job) => {
      const lines = sectionOf(job).split('\n');
      const compareTo = lines.findIndex((l) => l.includes('compare_to: $CI_MERGE_REQUEST_TARGET_BRANCH_NAME'));
      expect(compareTo).toBeGreaterThan(0);
      const adjacent = lines.slice(Math.max(0, compareTo - 2), compareTo + 1).join('\n');
      expect(adjacent).toContain('"configs/keycloak/**/*"');
    }
  );

  // The default-branch and release rules carry the same paths list (for
  // pending-<sha> images and release builds); adjacency above pins the
  // merge_request_event branch, the exact count here covers the other two
  // in the current layout: it fails uncompensated losses and forces a
  // conscious test update when the branch structure changes. It cannot see
  // a compensating duplicate inside a single rule's list — closing that
  // needs parse-level linting of the inline paths form.
  test.each(['build:keycloak-config', 'scan:keycloak-config', 'promote:keycloak-config'])(
    '%s carries the keycloak glob in all three rule branches',
    (job) => {
      const count = (sectionOf(job).match(/"configs\/keycloak\/\*\*\/\*"/g) || []).length;
      expect(count).toBe(3);
    }
  );

  // The widened keycloak trigger exists to feed the ROPC-refusal probe in
  // .e2e_web_base; if the probe block is ever deleted the trigger loses its
  // justification — pin the probe's presence so the pair cannot drift apart
  // silently. Both consuming jobs must still extend that base, or the probe
  // survives as dead text while nothing runs it.
  test('the ROPC-refusal probe is present in .e2e_web_base', () => {
    expect(sectionOf('.e2e_web_base')).toContain('ROPC refusal verified');
  });

  test.each(['e2e:playwright', 'scheduled:e2e-web'])('%s still extends the base that carries the probe', (job) => {
    const section = sectionOf(job);
    // Scalar extends, exactly — an extends CHAIN ([.e2e_web_base, .other])
    // could pull a script: from another hidden job, executing targets the
    // derivation (anchored to .e2e_web_base) never sees.
    expect(section).toMatch(/^\s*extends: \.e2e_web_base\s*$/m);
    expect(section).not.toMatch(/^\s*extends:\s*\[/m);
    // The derivation reads the invocation from .e2e_web_base only — a
    // consuming job running its own playwright invocation (in any of the
    // three script phases) would execute targets nothing derived. Pin all
    // three keys' absence: artifact paths or prose naming playwright stay
    // legal, a second invocation cannot exist.
    expect(section).not.toMatch(/^\s*(?:script|before_script|after_script):/m);
  });
  test('both jobs trigger off the shared anchor — no inline filter may fork it', () => {
    // The invariant exists because of this hard needs — pin it too.
    expect(sectionOf('e2e:playwright')).toContain('needs: [e2e:integration]');
    for (const job of E2E_JOBS) {
      expect(sectionOf(job)).toContain('paths: *e2e_merge_train_changes');
    }
    // The line parser cannot see through the alias; an empty parse proves
    // e2e:playwright carries no block-form changes: entries beside it. Any
    // rewrite that drops the alias text fails the toContain above, so flow
    // or list-item rewrites are caught either way.
    expect(filters.get('e2e:playwright')).toEqual([]);
  });

  test('every rule carries the merge-train condition', () => {
    // Broadening e2e:playwright's rule to all merge_request_event pipelines
    // would dangle its hard needs on every ordinary MR pipeline and fail
    // pipeline creation repo-wide; e2e:integration's two rules must stay
    // scoped the same way. The FULL condition is pinned — dropping either
    // half re-scopes the rule — and the RULE COUNTS are pinned, so an extra
    // broadened rule cannot be appended beside the alias (every rule starts
    // with a `- if:` list item).
    const trainCondition =
      '$CI_PIPELINE_SOURCE == "merge_request_event" && $CI_MERGE_REQUEST_EVENT_TYPE == "merge_train"';
    const ruleCount = (section) => section.split('\n').filter((line) => line.trimStart().startsWith('- if:')).length;
    expect(ruleCount(sectionOf('e2e:playwright'))).toBe(1);
    expect(ruleCount(sectionOf('e2e:integration'))).toBe(2);
    expect(sectionOf('e2e:playwright').split(trainCondition).length - 1).toBe(1);
    expect(sectionOf('e2e:integration').split(trainCondition).length - 1).toBe(2);
  });

  test('mobile stays integration-only', () => {
    expect(filters.get('e2e:integration')).toEqual(['mobile/genie_ai_mobile/**/*']);
    expect(sectionOf('e2e:playwright')).not.toContain('mobile/');
    // Neither half of the split may reach the shared anchor: an alias entry
    // is invisible to the section checks above.
    expect(filters.get(ANCHOR)).not.toContain('mobile/genie_ai_mobile/**/*');
  });

  // The anchor comment in .gitlab-ci.yml says the okf exclusion is enforced
  // here: the okf specs are not executed by the train invocation, so the
  // anchor must not cover them — neither as an explicit okf glob nor via a
  // widening rewrite like tests/e2e/**/* that would silently re-include
  // every excluded directory.
  test('the anchor does not cover the excluded okf specs', () => {
    expect(isCovered(filters.get(ANCHOR), 'tests/e2e/okf/**/*')).toBe(false);
  });
});

// The venue-fixture provisioning in .e2e_web_base (issue #1324): all three
// venue users (testuser, testadmin, testplain) are provisioned through the
// one shared script (tests/e2e/provision-e2e-fixtures.js → ensureUser in
// tests/e2e/helpers/keycloak-admin.js), never through inline bash. Pin the
// invocation, the single fixture definition and the derived login
// credentials — and the ABSENCE of the deleted inline convergence — so a
// "simplification" that re-grows a bash path beside the helper fails this
// pin instead of silently reintroducing a second mechanism.
describe('the venue-fixture provisioning in .e2e_web_base', () => {
  let content;

  beforeAll(() => {
    content = fs.readFileSync(path.join(ROOT, '.gitlab-ci.yml'), 'utf-8');
  });

  const sectionOf = (job) => gitlabSection(content, job);

  test('the job provisions the venue fixtures through the shared script', () => {
    const section = sectionOf('.e2e_web_base');
    const invocation = section.indexOf('node tests/e2e/provision-e2e-fixtures.js');
    // Provisioning must run BEFORE the suites — a reorder that leaves the
    // call present but after the Playwright item runs every spec against
    // whatever fixtures the realm happens to carry.
    expect(invocation).toBeGreaterThan(-1);
    const suites = section.indexOf('npx playwright test');
    // A named guard: if the invocation line itself is reworded or removed,
    // the failure must say so, not masquerade as an ordering violation.
    if (suites === -1) {
      throw new Error('the Playwright invocation line was reworded or removed in .e2e_web_base');
    }
    expect(invocation).toBeLessThan(suites);
    // The deleted inline mechanism must not grow back beside the helper:
    // these names existed only in the bash convergence this pin replaced.
    expect(section).not.toContain('create_testuser');
    expect(section).not.toContain('require_testuser_id');
    expect(section).not.toContain('require_fixture_healthy');
  });

  test('the fixtures module is the single definition of the venue users', () => {
    const fixtures = fs.readFileSync(path.join(ROOT, 'tests/e2e/helpers/e2e-fixtures.js'), 'utf-8');
    expect(fixtures).toContain("username: 'testuser'");
    // The CI venue's email domain is part of the fixture contract (the
    // docs phases and the CI job must agree on it).
    expect(fixtures).toContain("email: 'testuser@e2e.test'");
    // The documents suites drive ADMIN_ONLY surfaces — the primary login
    // user must carry the admin realm role. The role is asserted INSIDE
    // the testuser entry ([^}] cannot cross the object's closing brace),
    // so dropping testuser's own role line fails even though testadmin's
    // identical-looking entry would satisfy a bare containment check.
    expect(fixtures).toMatch(/username: 'testuser',[^}]*realmRoles: \['admin'\]/);
    expect(fixtures).toContain("username: 'testadmin'");
    expect(fixtures).toContain("username: 'testplain'");
  });

  test('the venue credentials are derived, never re-sourced', () => {
    // The credential accessors and the derived login credentials live in
    // the fixtures module — beside the data they read.
    const fixtures = fs.readFileSync(path.join(ROOT, 'tests/e2e/helpers/e2e-fixtures.js'), 'utf-8');
    expect(fixtures).toContain("credentialsOf('testuser')");
    expect(fixtures).toContain("credentialsOf('testadmin')");
    expect(fixtures).toContain("credentialsOf('testplain')");
    // No venue-fixture password literal may reappear beside or after the
    // fixtures module: the helpers and the spec directories this campaign
    // converged must derive their credentials from it. Scoped, NOT a
    // blanket scan: epic2's k1/i1 specs mint tokens for their own
    // ephemeral self-created users (noroles-e2e, genie2's testuser2) and
    // legitimately carry their own password literals.
    const chatbot = fs.readFileSync(path.join(ROOT, 'tests/e2e/helpers/chatbot.js'), 'utf-8');
    expect(chatbot).not.toContain('TestPass123!');
    expect(chatbot).not.toContain('TestAdmin123!');
    expect(chatbot).not.toContain('TestPlain123!');
    const fixturePasswords = ['TestPass123!', 'TestAdmin123!', 'TestPlain123!'];
    const assertNoFixturePassword = (label, source) => {
      for (const password of fixturePasswords) {
        if (source.includes(password)) {
          throw new Error(`${label} carries the fixture password ${password} — derive it from the fixtures module`);
        }
      }
    };
    // The helpers beside the fixtures module too — chatbot re-exports, the
    // rest must derive.
    const helpersDir = path.join(ROOT, 'tests/e2e/helpers');
    for (const name of fs.readdirSync(helpersDir)) {
      if (!name.endsWith('.js') || name === 'e2e-fixtures.js') continue;
      assertNoFixturePassword(`helpers/${name}`, fs.readFileSync(path.join(helpersDir, name), 'utf-8'));
    }
    const specDirs = ['chatbot', 'documents', 'admin', 'epic1', 'epic3'];
    for (const dir of specDirs) {
      const dirPath = path.join(ROOT, 'tests/e2e', dir);
      for (const name of fs.readdirSync(dirPath)) {
        if (!name.endsWith('.js')) continue;
        assertNoFixturePassword(`${dir}/${name}`, fs.readFileSync(path.join(dirPath, name), 'utf-8'));
      }
    }
    // The top-level suite specs the train also runs.
    for (const name of fs.readdirSync(path.join(ROOT, 'tests/e2e'))) {
      if (!name.endsWith('.spec.js')) continue;
      assertNoFixturePassword(name, fs.readFileSync(path.join(ROOT, 'tests/e2e', name), 'utf-8'));
    }
  });
});

// --- parseGitlabCiJobChanges: block scoping ---
describe('parseGitlabCiJobChanges', () => {
  const tempDirs = [];
  const writeTempCi = (lines) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-job-changes-'));
    tempDirs.push(dir);
    const file = path.join(dir, '.gitlab-ci.yml');
    fs.writeFileSync(file, lines.join('\n') + '\n');
    return file;
  };

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('entries are scoped to their changes: block — the next rule is not swallowed', () => {
    const file = writeTempCi([
      'job-a:',
      '  rules:',
      '    - if: \'$CI_PIPELINE_SOURCE == "merge_request_event"\'',
      '      changes:',
      '        - tests/e2e/chatbot/**/*',
      '    - if: \'$CI_PIPELINE_SOURCE == "web"\'',
      '      when: manual',
      '',
      'job-b:',
      '  rules:',
      '    - if: \'$CI_PIPELINE_SOURCE == "merge_request_event"\'',
      '      changes:',
      '        - tests/e2e/chatbot/**/*'
    ]);
    const parsed = parseGitlabCiJobChanges(file, ['job-a', 'job-b']);
    expect(parsed.get('job-a')).toEqual(['tests/e2e/chatbot/**/*']);
    expect(parsed.get('job-b')).toEqual(['tests/e2e/chatbot/**/*']);
  });

  test('inline comments are stripped from entries', () => {
    const file = writeTempCi([
      'job-a:',
      '  rules:',
      "    - if: '$X'",
      '      changes:',
      '        - tests/x/**/*  # not executed yet (wired by a later MR)'
    ]);
    const parsed = parseGitlabCiJobChanges(file, ['job-a']);
    expect(parsed.get('job-a')).toEqual(['tests/x/**/*']);
  });

  test('a changes: key carrying a trailing comment still starts a block', () => {
    const file = writeTempCi([
      'job-a:',
      '  rules:',
      "    - if: '$X'",
      '      changes:  # why these paths',
      '        - tests/a/**/*'
    ]);
    const parsed = parseGitlabCiJobChanges(file, ['job-a']);
    expect(parsed.get('job-a')).toEqual(['tests/a/**/*']);
  });

  test('a same-indent sequence is a valid changes: block', () => {
    const file = writeTempCi([
      'job-a:',
      '  rules:',
      "    - if: '$X'",
      '      changes:',
      '      - tests/a/**/*',
      '      - tests/b/**/*  # trailing comment',
      "    - if: '$Y'",
      '      when: manual'
    ]);
    const parsed = parseGitlabCiJobChanges(file, ['job-a']);
    expect(parsed.get('job-a')).toEqual(['tests/a/**/*', 'tests/b/**/*']);
  });

  test('hidden anchor keys parse their direct list; aliases stay opaque', () => {
    const file = writeTempCi([
      '.shared_changes: &shared_changes',
      '  - tests/a/**/*',
      '  - tests/b/**/*  # trailing comment',
      '',
      'job-a:',
      '  rules:',
      "    - if: '$X'",
      '      changes:',
      '        paths: *shared_changes'
    ]);
    const parsed = parseGitlabCiJobChanges(file, ['.shared_changes', 'job-a']);
    expect(parsed.get('.shared_changes')).toEqual(['tests/a/**/*', 'tests/b/**/*']);
    expect(parsed.get('job-a')).toEqual([]);
  });

  test('a hidden anchor whose sequence sits at indent 0 still parses', () => {
    const file = writeTempCi([
      '.shared_changes: &shared_changes',
      '- tests/a/**/*',
      '- tests/b/**/*',
      '',
      'job-a:',
      '  rules:',
      "    - if: '$X'",
      '      changes:',
      '        paths: *shared_changes'
    ]);
    const parsed = parseGitlabCiJobChanges(file, ['.shared_changes', 'job-a']);
    expect(parsed.get('.shared_changes')).toEqual(['tests/a/**/*', 'tests/b/**/*']);
    expect(parsed.get('job-a')).toEqual([]);
  });

  test('a job key carrying a trailing comment is still recognized', () => {
    const file = writeTempCi([
      'job-a:  # annotated key',
      '  rules:',
      "    - if: '$X'",
      '      changes:',
      '        - tests/a/**/*'
    ]);
    const parsed = parseGitlabCiJobChanges(file, ['job-a']);
    expect(parsed.get('job-a')).toEqual(['tests/a/**/*']);
  });
});
