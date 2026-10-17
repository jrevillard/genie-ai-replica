const path = require('path');
const fs = require('fs');
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
    const { unwired, allowlisted } = findUnwiredDocumented(
      envParsed.documented,
      composeVars,
      { allowlist: UNIMPLEMENTED_OKF_KNOBS }
    );

    expect(
      unwired.map((u) => `${u.name} (env section: ${u.section})`)
    ).toEqual([]);

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
        if (composeDefault !== '' && a.default !== composeDefault) mismatches.push(v + ': compose=' + composeDefault + ' ansible=' + a.default);
      }
      expect(mismatches).toEqual([]);
    });

    test('env.j2 emits each OKF var exactly once (no last-wins shadowing)', () => {
      const dupes = Object.entries(ansibleVars).filter(([k, a]) => /^OKF_/.test(k) && a.count > 1).map(([k]) => k);
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
    // emits them with the code's own default", not "compose agrees".
    const PII_CODE_DEFAULTS = {
      // 4 since !1080, matching the uvicorn --workers default in
      // components/pii-service/Dockerfile. This map is a HAND-MAINTAINED MIRROR
      // of the code's own defaults — the same "the same fact stated in two
      // places" shape as BUG-11/12/15 — so it is the 4th copy to move when the
      // default moves: Dockerfile CMD, compose, env.j2, and here. The assertion
      // below is what makes forgetting one of them loud instead of silent.
      PII_WEB_CONCURRENCY: '4',
      PII_REGION_MAX_CHARS: '50000',
      PII_CONCEPT_RETRY_PAUSE_MS: '8000',
      PII_SERVICE_URL: 'http://pii-service:8000',
      PII_TIMEOUT_MS: '10000',
      PII_RETRIES: '2'
    };

    test('ansible env.j2 emits every PII var the cloud deployment needs', () => {
      const missing = Object.keys(PII_CODE_DEFAULTS).filter((v) => !ansibleVars[v]);
      expect(missing).toEqual([]);
    });

    test('ansible PII defaults match the values the code itself defaults to', () => {
      const mismatches = Object.entries(PII_CODE_DEFAULTS)
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
      expect({ name: 'OKF_SCOPE_MODE', found: !!scopeVars.OKF_SCOPE_MODE, default: scopeVars.OKF_SCOPE_MODE ? scopeVars.OKF_SCOPE_MODE.default : null }).toEqual({
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
      expect({ found: !!vars.OKF_RERANK_ENDPOINT, default: vars.OKF_RERANK_ENDPOINT ? vars.OKF_RERANK_ENDPOINT.default : null }).toEqual({
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
      expect(block).toMatch(/- RAGAS_EMBED_MODEL=\$\{RAGAS_EMBED_MODEL:-\$\{EMBED_MODEL_ID:-\}\}/);
    });

    test('OKF_RAGAS_TESTSET_SIZE_DEFAULT is documented in the env template with the 20 default', () => {
      const envText = fs.readFileSync(ENV_FILE, 'utf8');
      expect(envText).toMatch(/^#\s*OKF_RAGAS_TESTSET_SIZE_DEFAULT=20.*$/m);
    });

    test('the ragas vars are emitted by ansible env.j2 (inherited defaults)', () => {
      const vars = parseAnsibleEnvVars(
        fs.readFileSync(path.resolve(__dirname, '../../../deploy/ansible/templates/env.j2'), 'utf8')
      );
      expect({ found: !!vars.OKF_RAGAS_URL, url: vars.OKF_RAGAS_URL ? vars.OKF_RAGAS_URL.default : null }).toEqual({
        found: true,
        url: 'http://ragas-service:8090'
      });
      expect({ found: !!vars.RAGAS_JUDGE_BASE_URL, url: vars.RAGAS_JUDGE_BASE_URL ? vars.RAGAS_JUDGE_BASE_URL.default : null }).toEqual({
        found: true,
        url: 'http://vllm:8000/v1'
      });
      expect({ found: !!vars.RAGAS_EMBED_BASE_URL, url: vars.RAGAS_EMBED_BASE_URL ? vars.RAGAS_EMBED_BASE_URL.default : null }).toEqual({
        found: true,
        url: 'http://tei-embedding-server:80/v1'
      });
      expect({ found: !!vars.OKF_RAGAS_TESTSET_SIZE_DEFAULT, v: vars.OKF_RAGAS_TESTSET_SIZE_DEFAULT ? vars.OKF_RAGAS_TESTSET_SIZE_DEFAULT.default : null }).toEqual({
        found: true,
        v: '20'
      });
    });

    test('the ragas-service image is in the ansible image list', () => {
      const facts = fs.readFileSync(path.resolve(__dirname, '../../../deploy/ansible/tasks/deploy-shared-facts.yml'), 'utf8');
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
  // The budget is now derived from VLLM_MAX_MODEL_LEN, which makes agreement
  // between these surfaces load-bearing rather than cosmetic.
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
      'DATAPREP_CONTEXTUAL_MAX_TOKENS',
      'CONTEXTUAL_STRATEGY',
      'CONTEXTUAL_RETRIEVAL_ENABLED',
      'CONTEXTUAL_LABEL_RAW',
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
      // 0 = derive from VLLM_MAX_MODEL_LEN. A non-zero compose default would
      // silently reinstate the one-number-for-every-hardware bug, because
      // compose ALWAYS injects the variable — so "unset" never reaches Python.
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
      // document context above the budget derived from VLLM_MAX_MODEL_LEN. If
      // these two drift apart the corpus silently degrades again — documents get
      // stored that will be truncated, or split that did not need it.
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
});
