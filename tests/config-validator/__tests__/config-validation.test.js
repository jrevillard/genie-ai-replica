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

    // The compose VLLM_MODEL_ID entry interpolates VLLM_LLM_MODEL_ID first
    // (`${VLLM_LLM_MODEL_ID:-${VLLM_MODEL_ID:-}}`) — an env.j2 emission of
    // the primary alias satisfies the parity for the container-side name.
    const ANSIBLE_ALIAS = { VLLM_MODEL_ID: 'VLLM_LLM_MODEL_ID' };

    test('every OKF compose var is emitted by env.j2', () => {
      expect(PARITY_VARS.length).toBeGreaterThanOrEqual(15); // guard: block actually parsed
      const missing = PARITY_VARS.filter((v) => !ansibleVars[v] && !ansibleVars[ANSIBLE_ALIAS[v]]);
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
  // plumbing drift between the three surfaces (compose pipe / env template
  // doc / ansible env.j2) would silently retune production routing. Defaults
  // live in genie-ai-overlay/retriever/config.py; these pins keep the
  // plumbing honest (code default = compose default = template doc default).
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
