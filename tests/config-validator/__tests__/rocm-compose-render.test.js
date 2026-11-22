// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Render gate for the AMD ROCm GPU tier — ONE file set, vendor as values.
//
// The vendor axis lives in the BASE compose files: env.strixhalo pins the
// images (VLLM_IMAGE, TEI_EMBEDDING_IMAGE, TEI_RERANKING_IMAGE), the device
// paths (GPU_DEVICE_KFD, GPU_DEVICE_DRI) and the device-group GIDs, and the
// two vLLM pooling services (vllm-embedding, vllm-reranker) sit behind the
// `rocm-models` profile in the same files. The overlays that used to carry
// all of this are gone — an unrendered overlay was exactly the hole this
// gate existed to close: the config-validator suite parses the base files
// only, and a typo in an overlay's merge tag, environment merge or service
// name reached the branch unrendered.
//
// The gate renders BOTH vendor shapes of the SAME files with the real
// compose binary:
//
//   ROCm shape:    base file(s) + env.strixhalo + --profile rocm-models
//   NVIDIA shape:  base file(s), no Strix Halo env, no rocm-models profile
//
// and asserts the ROCm facts (device rows, void env, pooling backends,
// image pins) AND the NVIDIA inertness (the profile firewall, the
// every-host device defaults, the entrypoint no-op).
//
// `docker compose config` is a CLIENT-SIDE render - it needs no daemon and
// touches no container - so the gate runs wherever a compose binary exists.

'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const { parseEnvTemplate } = require('../validators/parse-env');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const ENV_FILE = 'env.strixhalo';
const COMPOSE_TIMEOUT_MS = 120000;

// Secrets the base compose interpolates. They carry no default, so an unset
// value renders as an empty string plus a warning - harmless for the render,
// but the placeholders keep the output free of unset-variable noise and make
// the render independent of whatever the developer's shell happens to hold.
const SECRET_PLACEHOLDERS = [
  'ARANGO_PASSWORD',
  'POSTGRES_PASSWORD',
  'KONG_DB_PASSWORD',
  'KEYCLOAK_DB_PASSWORD',
  'KEYCLOAK_ADMIN_PASSWORD',
  'KEYCLOAK_CLIENT_SECRET',
  'KEYCLOAK_PROXY_CLIENT_SECRET',
  'KC_DATAPREP_CLIENT_SECRET',
  'GENIE_ADMIN_PASSWORD',
  'GENIE_ADMIN_EMAIL',
  'KC_GRAFANA_CLIENT_SECRET',
  'KC_MOBILE_CLIENT_ID',
  'KC_MOBILE_REDIRECT_SCHEME',
  'HUGGING_FACE_HUB_TOKEN',
  'TRANSLATION_CACHE_PASSWORD',
  'NGINX_PUBLIC_DOMAIN'
];

// Knobs the assertions read. They are deleted from the child environment on
// purpose: compose gives the shell environment precedence over --env-file,
// so an ambient value would mask a missing pin in env.strixhalo. The env
// file must be the ONLY source of these on the ROCm render, and their
// ABSENCE must be the only source on the NVIDIA render.
const FILE_OWNED_KNOBS = [
  'EMBEDDING_BACKEND',
  'RERANKER_BACKEND',
  'RERANKER_VLLM_ENDPOINT',
  'EMBEDDING_VLLM_ENDPOINT',
  'NVIDIA_VISIBLE_DEVICES',
  'VLLM_IMAGE',
  'TEI_EMBEDDING_IMAGE',
  'TEI_RERANKING_IMAGE',
  'GPU_DEVICE_KFD',
  'GPU_DEVICE_DRI',
  'GPU_HTTPS_PORT',
  'GPU_HTTP_PORT',
  'RENDER_GID',
  'VIDEO_GID'
];

/**
 * Build the environment the compose render runs in.
 *
 * @returns {Object<string, string>} the child environment
 */
function buildRenderEnv() {
  const env = { ...process.env };
  for (const name of SECRET_PLACEHOLDERS) {
    env[name] = 'render-check-placeholder';
  }
  for (const name of FILE_OWNED_KNOBS) {
    delete env[name];
  }
  return env;
}

const RENDER_ENV = buildRenderEnv();

/**
 * Probe for a usable compose binary.
 *
 * `docker compose version` is daemon-free, so a binary without a running
 * daemon still probes green - which is what the render needs.
 *
 * @returns {{ available: boolean, version: string, raw: string }}
 */
function probeCompose() {
  const probe = spawnSync('docker', ['compose', 'version', '--short'], {
    encoding: 'utf8',
    timeout: COMPOSE_TIMEOUT_MS
  });
  if (probe.error || probe.status !== 0) {
    return { available: false, version: '', raw: (probe.stderr || '') + (probe.stdout || '') };
  }
  const version = (probe.stdout || '').trim();
  return { available: true, version, raw: version };
}

/**
 * Run `docker compose ... config` over a set of compose files.
 *
 * @param {string[]} files - compose file paths, in merge order
 * @param {string[]} profiles - profile names to enable
 * @param {{ json?: boolean, envFile?: string|null, env?: Object }} options -
 *   json=true renders to JSON, otherwise --quiet; envFile=null renders the
 *   NVIDIA shape (no Strix Halo env — and the ROCm pins pinned empty so a
 *   machine-local .env cannot change the answer)
 * @returns {{ status: number, stdout: string, stderr: string }}
 */
function runComposeConfig(files, profiles, options = {}) {
  const args = ['compose'];
  if (options.envFile !== null) {
    args.push('--env-file', options.envFile || ENV_FILE);
  }
  for (const file of files) {
    args.push('-f', file);
  }
  for (const profile of profiles) {
    args.push('--profile', profile);
  }
  args.push('config');
  if (options.json) {
    args.push('--format', 'json');
  } else {
    args.push('--quiet');
  }

  const result = spawnSync('docker', args, {
    cwd: REPO_ROOT,
    env: { ...RENDER_ENV, ...(options.env || {}) },
    encoding: 'utf8',
    timeout: COMPOSE_TIMEOUT_MS
  });

  if (result.error) {
    throw new Error(`docker compose config could not run: ${result.error.message}`);
  }
  return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}

/**
 * Read one variable out of the env file the render consumes.
 *
 * @param {Object<string, string>} envValues - name → value map
 * @param {string} name - the variable name
 * @returns {string}
 */
function envValue(envValues, name) {
  const value = envValues[name];
  if (value === undefined) {
    throw new Error(`${ENV_FILE} does not define ${name}`);
  }
  return value;
}

/**
 * The device sources a rendered service is given.
 *
 * @param {Object} service - a rendered compose service
 * @returns {string[]}
 */
function deviceSources(service) {
  return (service.devices || []).map((device) => device.source);
}

/**
 * The published host ports a rendered service exposes.
 *
 * @param {Object} service - a rendered compose service
 * @returns {string[]}
 */
function publishedPorts(service) {
  return (service.ports || []).map((port) => String(port.published));
}

const compose = probeCompose();
const envValues = Object.fromEntries(
  parseEnvTemplate(path.join(REPO_ROOT, ENV_FILE)).variables.map((variable) => [variable.name, variable.value])
);

// A machine without a compose binary is not a broken repository: the gate
// skips there rather than blocking the developer. CI installs the compose
// CLI in the config:validate job, so the gate runs there.
const describeCompose = compose.available ? describe : describe.skip;

if (!compose.available) {
  // A skip is right on a developer machine without the compose CLI. In CI
  // it is a lie: the gate reports itself "skipped" and the pipeline reads
  // green while asserting NOTHING — the ROCm vendor axis would be rendered
  // by no gate at all. So in CI, a missing compose binary FAILS the job.
  if (process.env.CI) {
    throw new Error(
      "[rocm-compose-render] no usable 'docker compose' binary in CI " +
        `(${compose.raw.trim() || 'not found'}). The gate would assert nothing ` +
        'while the pipeline reads green - install the compose CLI in the CI image.'
    );
  }
  console.warn(
    `[rocm-compose-render] skipped: no usable 'docker compose' binary (${compose.raw.trim() || 'not found'})`
  );
}

describeCompose('ROCm compose render gate (single file set, vendor as values)', () => {
  let single;
  let gpu;
  let singleNvidia;
  let gpuNvidia;

  beforeAll(() => {
    // The ROCm shapes: the base files, the Strix Halo env, the rocm-models
    // profile. Nothing else — there is no overlay to merge anymore.
    single = runComposeConfig(['docker-compose.yaml'], ['opea', 'gpu-models', 'rocm-models', 'okf'], {
      json: true
    });
    gpu = runComposeConfig(['docker-compose.gpu.yaml'], ['rocm-models'], { json: true });
    // The NVIDIA shapes: the SAME files, no Strix Halo env, no rocm-models
    // profile. These are the renders every existing NVIDIA deployment gets.
    singleNvidia = runComposeConfig(['docker-compose.yaml'], ['opea', 'gpu-models', 'okf'], {
      json: true,
      envFile: null,
      env: {
        EMBEDDING_VLLM_ENDPOINT: '',
        RERANKER_VLLM_ENDPOINT: '',
        GPU_DEVICE_KFD: '',
        GPU_DEVICE_DRI: '',
        RENDER_GID: '',
        VIDEO_GID: '',
        TEI_EMBEDDING_IMAGE: '',
        TEI_RERANKING_IMAGE: '',
        VLLM_IMAGE: ''
      }
    });
    gpuNvidia = runComposeConfig(['docker-compose.gpu.yaml'], [], {
      json: true,
      envFile: null,
      env: {
        GPU_DEVICE_KFD: '',
        GPU_DEVICE_DRI: '',
        RENDER_GID: '',
        VIDEO_GID: '',
        TEI_EMBEDDING_IMAGE: '',
        TEI_RERANKING_IMAGE: '',
        VLLM_IMAGE: '',
        GPU_HTTP_PORT: '',
        GPU_HTTPS_PORT: ''
      }
    });
  });

  describe('vendor files are gone (one file set)', () => {
    test.each(['docker-compose.rocm.yaml', 'docker-compose.rocm.gpu.yaml'])('%s no longer exists', (file) => {
      expect({ file, exists: fs.existsSync(path.join(REPO_ROOT, file)) }).toEqual({ file, exists: false });
    });
  });

  describe('the Compose floor holds (no merge tags in the base files)', () => {
    // `!override` requires Compose >= 2.24.4, while the repo documents
    // 2.20+ as its floor. The ports are VALUES in the base files now, so
    // no merge tag is needed anywhere in the GPU path; one creeping back
    // in silently raises the minimum compose version. The files that carry
    // them are named here.
    for (const file of ['docker-compose.yaml', 'docker-compose.gpu.yaml']) {
      test(`${file} carries no merge tag`, () => {
        const text = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
        const withoutComments = text
          .split('\n')
          .filter((line) => !line.trim().startsWith('#'))
          .join('\n');
        expect({ file, mergeTag: /!override|!reset|!replace/.test(withoutComments) }).toEqual({
          file,
          mergeTag: false
        });
      });
    }
  });

  describe('ROCm single-server render (docker-compose.yaml + env.strixhalo + rocm-models)', () => {
    test('renders without error', () => {
      if (single.status !== 0) {
        throw new Error(`docker compose config failed (exit ${single.status}):\n${single.stderr}`);
      }
      expect(single.status).toBe(0);
    });

    test('the pooling services are in the render under the rocm-models profile', () => {
      const services = JSON.parse(single.stdout).services;
      expect(Object.keys(services)).toEqual(expect.arrayContaining(['vllm-embedding', 'vllm-reranker']));
      expect(services['vllm-embedding'].profiles).toContain('rocm-models');
      expect(services['vllm-reranker'].profiles).toContain('rocm-models');
    });

    test('the image pins from env.strixhalo reach every GPU-tier service', () => {
      const services = JSON.parse(single.stdout).services;
      const rocmImage = envValue(envValues, 'VLLM_IMAGE');
      expect(services.vllm.image).toBe(rocmImage);
      expect(services['vllm-translation-guardrail'].image).toBe(rocmImage);
      expect(services['vllm-embedding'].image).toBe(rocmImage);
      expect(services['vllm-reranker'].image).toBe(rocmImage);
      expect(services.tei.image).toBe(envValue(envValues, 'TEI_EMBEDDING_IMAGE'));
      expect(services.tei_reranker.image).toBe(envValue(envValues, 'TEI_RERANKING_IMAGE'));
    });

    test('the vLLM services carry the serve entrypoint (repairs the ROCm image)', () => {
      // The ROCm image ships ENTRYPOINT=null, CMD=/bin/bash; the NVIDIA
      // image's own entrypoint IS `vllm serve`. One explicit entrypoint on
      // the service makes the flag `command:` attach on both vendors from
      // the same definition.
      const services = JSON.parse(single.stdout).services;
      for (const name of ['vllm', 'vllm-translation-guardrail', 'vllm-embedding', 'vllm-reranker']) {
        expect({ service: name, entrypoint: services[name].entrypoint }).toEqual({
          service: name,
          entrypoint: ['vllm', 'serve']
        });
      }
    });

    test('the vLLM tool-calling pin resolves per vendor shape (#2052)', () => {
      // granite4 is the vLLM 0.29 parser for Granite 4.x (the base files'
      // default model); env.strixhalo serves granite-3.1-2b and pins
      // VLLM_TOOL_CALL_PARSER=granite. The RESOLVED command must carry the
      // right parser per shape — a flipped or dropped pin silently misparses
      // the model's tool output (checked on the resolved render, not the raw
      // file: the interpolation default is part of the contract).
      const parserOf = (services) => {
        const parts = String(services.vllm.command).split(/\s+/);
        return parts[parts.indexOf('--tool-call-parser') + 1];
      };
      const singleServices = JSON.parse(single.stdout).services;
      const nvidiaServices = JSON.parse(singleNvidia.stdout).services;
      expect(parserOf(singleServices)).toBe('granite');
      expect(parserOf(nvidiaServices)).toBe('granite4');
      for (const services of [singleServices, nvidiaServices]) {
        expect(String(services.vllm.command)).toContain('--enable-auto-tool-choice');
      }
    });

    test('the GPU device mappings come from env.strixhalo', () => {
      const services = JSON.parse(single.stdout).services;
      for (const name of ['vllm', 'vllm-translation-guardrail', 'vllm-embedding', 'vllm-reranker']) {
        expect({ service: name, devices: deviceSources(services[name]) }).toEqual({
          service: name,
          devices: expect.arrayContaining(['/dev/kfd', '/dev/dri'])
        });
      }
    });

    test('the device-group GIDs come from env.strixhalo', () => {
      const services = JSON.parse(single.stdout).services;
      const expected = [envValue(envValues, 'RENDER_GID'), envValue(envValues, 'VIDEO_GID')];
      for (const name of ['vllm', 'vllm-translation-guardrail', 'vllm-embedding', 'vllm-reranker']) {
        expect({ service: name, groupAdd: services[name].group_add }).toEqual({
          service: name,
          groupAdd: expect.arrayContaining(expected)
        });
      }
    });

    test('the NVIDIA device variable is neutralized on every ROCm GPU-tier service', () => {
      const services = JSON.parse(single.stdout).services;
      for (const name of [
        'vllm',
        'vllm-translation-guardrail',
        'tei',
        'tei_reranker',
        'vllm-embedding',
        'vllm-reranker'
      ]) {
        expect({ service: name, nvidia: services[name].environment.NVIDIA_VISIBLE_DEVICES }).toEqual({
          service: name,
          nvidia: 'void'
        });
      }
    });

    test('the embedding and reranker backends switch to the GPU instances', () => {
      // The base compose already wires these knobs with a `${VAR:-tei}`
      // default, so the EFFECTIVE value is what env.strixhalo pins (the
      // single-server profile documents EMBEDDING_BACKEND=vllm and
      // RERANKER_BACKEND=vllm as its contract). A flip in either the env
      // file or the base default silently demotes the whole ROCm profile to
      // the TEI path - the gate catches it here.
      const services = JSON.parse(single.stdout).services;
      expect(services['dataprep-arango-service'].environment.EMBEDDING_BACKEND).toBe('vllm');
      expect(services['retriever-arango-service'].environment.EMBEDDING_BACKEND).toBe('vllm');
      expect(services.reranker.environment.RERANKER_BACKEND).toBe('vllm');
      expect(services.reranker.environment.RERANKER_VLLM_MAX_MODEL_LEN).toBe(
        envValue(envValues, 'VLLM_RERANKER_MAX_MODEL_LEN')
      );
    });

    test('the backend endpoints name services that exist in the render', () => {
      // The endpoints address the pooling services by compose name. A
      // renamed service leaves the wrapper pointing at a name that resolves
      // to nothing - the container resolves at request time and fails every
      // call, long after the render succeeded.
      const services = JSON.parse(single.stdout).services;
      const hosts = (url) =>
        String(url || '')
          .replace(/^https?:\/\//, '')
          .split(':')[0];
      expect(hosts(services.reranker.environment.RERANKER_VLLM_ENDPOINT)).toBe('vllm-reranker');
      expect(hosts(services['dataprep-arango-service'].environment.EMBEDDING_VLLM_ENDPOINT)).toBe('vllm-embedding');
      expect(Object.keys(services)).toEqual(expect.arrayContaining(['vllm-reranker', 'vllm-embedding']));
    });

    test('the QUERY encoder moves to the GPU pool with the corpus encoder', () => {
      // MR !968 review: "only two embedding consumers move to vLLM — the
      // query encoder stays on the CPU TEI". chatqna's RAG graph encodes the
      // query through its `embedding` node, which the base compose points at
      // the OPEA embedding microservice — which fronts the CPU TEI. So the
      // GPU embedder served ingestion only.
      //
      // All three consumers now read the same base URL:
      //   - dataprep (corpus), the retriever's fallback branch, and
      //   - chatqna's embedding node (the query).
      const services = JSON.parse(single.stdout).services;
      const gpuPool = 'http://vllm-embedding:8000';
      expect(services['dataprep-arango-service'].environment.EMBEDDING_BACKEND).toBe('vllm');
      expect(services['dataprep-arango-service'].environment.EMBEDDING_VLLM_ENDPOINT).toBe(gpuPool);
      expect(services['retriever-arango-service'].environment.EMBEDDING_BACKEND).toBe('vllm');
      expect(services['retriever-arango-service'].environment.EMBEDDING_VLLM_ENDPOINT).toBe(gpuPool);
      expect(services['chatqna-xeon-backend-server'].environment.EMBEDDING_VLLM_ENDPOINT).toBe(gpuPool);
    });

    test('the split-URL OIDC passthroughs carry the env values', () => {
      // The trio (backend / okf-server / document-repository) reads
      // KEYCLOAK_DISCOVERY_URL / KEYCLOAK_JWKS_URL / KEYCLOAK_PUBLIC_URL from
      // the base compose with EMPTY defaults — the NVIDIA shape. The Strix
      // Halo env supplies the in-network legs; the venue .env supplies the
      // browser-edge leg (it needs the venue's domain, so it is not in the
      // shared profile). Here only the shared profile is in play: the
      // discovery/JWKS pins must reach the services, and the render must not
      // depend on a venue .env.
      const services = JSON.parse(single.stdout).services;
      const discovery = envValue(envValues, 'KEYCLOAK_DISCOVERY_URL');
      const jwks = envValue(envValues, 'KEYCLOAK_JWKS_URL');
      for (const name of ['backend', 'okf-server', 'document-repository']) {
        expect({ service: name, discovery: services[name].environment.KEYCLOAK_DISCOVERY_URL }).toEqual({
          service: name,
          discovery
        });
        expect({ service: name, jwks: services[name].environment.KEYCLOAK_JWKS_URL }).toEqual({
          service: name,
          jwks
        });
      }
    });
  });

  describe('NVIDIA single-server render (docker-compose.yaml, no Strix Halo env)', () => {
    test('renders without error', () => {
      if (singleNvidia.status !== 0) {
        throw new Error(`docker compose config failed (exit ${singleNvidia.status}):\n${singleNvidia.stderr}`);
      }
      expect(singleNvidia.status).toBe(0);
    });

    test('the profile firewall: the pooling services do NOT render', () => {
      // A profile-disabled service is absent from the resolved config —
      // not stopped, not created, not visible to `docker compose up` or a
      // `docker stack deploy` resolved file. This is what keeps every
      // NVIDIA deployment exactly the stack it always was.
      const services = JSON.parse(singleNvidia.stdout).services;
      expect(services['vllm-embedding']).toBeUndefined();
      expect(services['vllm-reranker']).toBeUndefined();
    });

    test('the vendor-axis deltas are the every-host defaults (inert by construction)', () => {
      // The one NVIDIA-visible change the collapse makes, pinned so it
      // cannot silently grow: devices map /dev/null and /dev/zero (paths
      // that exist on every host — a missing device path is a hard
      // create-time error), the groups are nobody/nogroup (two DISTINCT
      // numbers: the group_add list rejects duplicates), and the
      // entrypoint restates the NVIDIA image's own (`vllm serve` — the
      // flag `command:` always attached to it), so it is a no-op there.
      const services = JSON.parse(singleNvidia.stdout).services;
      for (const name of ['vllm', 'vllm-translation-guardrail']) {
        expect({ service: name, devices: deviceSources(services[name]) }).toEqual({
          service: name,
          devices: ['/dev/null', '/dev/zero']
        });
        expect({ service: name, groupAdd: services[name].group_add }).toEqual({
          service: name,
          groupAdd: ['65534', '65533']
        });
        expect({ service: name, entrypoint: services[name].entrypoint }).toEqual({
          service: name,
          entrypoint: ['vllm', 'serve']
        });
        expect({ service: name, image: services[name].image }).toEqual({
          service: name,
          image: 'vllm/vllm-openai:v0.29.0'
        });
        expect({ service: name, nvidia: services[name].environment.NVIDIA_VISIBLE_DEVICES }).toEqual({
          service: name,
          nvidia: 'all'
        });
      }
    });

    test('the reranker window pin reaches the wrapper only as the wrapper reads it', () => {
      // RERANKER_VLLM_MAX_MODEL_LEN is new in the base render (the
      // `${VAR:-${VLLM_RERANKER_MAX_MODEL_LEN:-8192}}` row). The TEI
      // backend never reads it — this pins the VALUE the wrapper would see
      // if a venue flipped RERANKER_BACKEND=vllm without setting anything
      // else: the same window the pooling instance is started with.
      const services = JSON.parse(singleNvidia.stdout).services;
      expect(services.reranker.environment.RERANKER_VLLM_MAX_MODEL_LEN).toBe('8192');
      expect(services.reranker.environment.RERANKER_BACKEND).toBe('tei');
    });

    test('the NVIDIA base render leaves the query encoder on the microservice', () => {
      // The NVIDIA-inertness proof: with EMBEDDING_VLLM_ENDPOINT unset, the
      // chatqna code keeps the base compose's embedding microservice (TEI)
      // — the row is empty, so the derivation never fires.
      const services = JSON.parse(singleNvidia.stdout).services;
      expect(services['chatqna-xeon-backend-server'].environment.EMBEDDING_VLLM_ENDPOINT).toBe('');
      expect(services['chatqna-xeon-backend-server'].environment.EMBEDDING_SERVER_HOST_IP).toBe('embedding');
      expect(String(services['chatqna-xeon-backend-server'].environment.EMBEDDING_SERVER_PORT)).toBe('6000');
    });

    test('the split-URL OIDC passthroughs stay empty (the NVIDIA shape)', () => {
      // The trio's defaults are EMPTY in the base compose — the one-URL
      // shape every NVIDIA deployment runs. The Strix Halo env is what
      // fills them on the ROCm venue; without it, NVIDIA renders must not
      // suddenly carry discovery/JWKS pins.
      const services = JSON.parse(singleNvidia.stdout).services;
      for (const name of ['backend', 'okf-server', 'document-repository']) {
        expect({ service: name, discovery: services[name].environment.KEYCLOAK_DISCOVERY_URL }).toEqual({
          service: name,
          discovery: ''
        });
        expect({ service: name, jwks: services[name].environment.KEYCLOAK_JWKS_URL }).toEqual({
          service: name,
          jwks: ''
        });
      }
    });

    test('the collector host publish survives profile activation', () => {
      // The base publishes the fluentforward receiver on 127.0.0.1:24224 —
      // the endpoint the Docker logging driver delivers every container's
      // stdout to. Activating rocm-models must not change that (the old
      // overlay once dropped it with a `ports: !override []`).
      const withProfile = runComposeConfig(['docker-compose.yaml'], ['opea', 'gpu-models', 'rocm-models', 'okf'], {
        json: true,
        envFile: null,
        env: { GPU_DEVICE_KFD: '', GPU_DEVICE_DRI: '', RENDER_GID: '', VIDEO_GID: '' }
      });
      const basePorts = JSON.parse(singleNvidia.stdout).services['otel-collector'].ports ?? null;
      const profiledPorts = JSON.parse(withProfile.stdout).services['otel-collector'].ports ?? null;
      expect({ service: 'otel-collector', ports: profiledPorts }).toEqual({
        service: 'otel-collector',
        ports: basePorts
      });
      expect(publishedPorts({ ports: basePorts })).toContain('24224');
    });
  });

  describe('ROCm GPU-node render (docker-compose.gpu.yaml + env.strixhalo + rocm-models)', () => {
    test('renders without error', () => {
      if (gpu.status !== 0) {
        throw new Error(`docker compose config failed (exit ${gpu.status}):\n${gpu.stderr}`);
      }
      expect(gpu.status).toBe(0);
    });

    test('the pooling services are in the render under the rocm-models profile', () => {
      const services = JSON.parse(gpu.stdout).services;
      expect(Object.keys(services)).toEqual(expect.arrayContaining(['vllm-embedding', 'vllm-reranker']));
      expect(services['vllm-embedding'].profiles).toContain('rocm-models');
      expect(services['vllm-reranker'].profiles).toContain('rocm-models');
      expect(services['vllm-reranker'].image).toBe(envValue(envValues, 'VLLM_IMAGE'));
    });

    test('the GPU device mappings come from env.strixhalo', () => {
      const services = JSON.parse(gpu.stdout).services;
      for (const name of ['vllm-llm', 'vllm-translation', 'vllm-reranker', 'vllm-embedding']) {
        expect({ service: name, devices: deviceSources(services[name]) }).toEqual({
          service: name,
          devices: expect.arrayContaining(['/dev/kfd', '/dev/dri'])
        });
      }
    });

    test('the vLLM services carry the serve entrypoint (repairs the ROCm image)', () => {
      const services = JSON.parse(gpu.stdout).services;
      for (const name of ['vllm-llm', 'vllm-translation', 'vllm-reranker', 'vllm-embedding']) {
        expect({ service: name, entrypoint: services[name].entrypoint }).toEqual({
          service: name,
          entrypoint: ['vllm', 'serve']
        });
      }
    });

    test('the NVIDIA device variable is neutralized on every ROCm service', () => {
      const services = JSON.parse(gpu.stdout).services;
      for (const name of ['vllm-llm', 'vllm-translation', 'tei-embedding', 'tei-reranker']) {
        expect({ service: name, nvidia: services[name].environment.NVIDIA_VISIBLE_DEVICES }).toEqual({
          service: name,
          nvidia: 'void'
        });
      }
    });

    test('the TEI images are the CPU build on this venue', () => {
      const services = JSON.parse(gpu.stdout).services;
      expect(services['tei-embedding'].image).toBe(envValue(envValues, 'TEI_EMBEDDING_IMAGE'));
      expect(services['tei-reranker'].image).toBe(envValue(envValues, 'TEI_RERANKING_IMAGE'));
    });

    test('the published ports are values on the base file — no clash, no merge tag', () => {
      // The base GPU file publishes "80:80" alongside the configurable HTTPS
      // port. The rows are parameterized values now (that is why no merge
      // tag is needed), so the published pair is exactly the two configured
      // ports.
      const baseGpu = fs.readFileSync(path.join(REPO_ROOT, 'docker-compose.gpu.yaml'), 'utf8');
      expect(baseGpu).toMatch(/"\$\{GPU_HTTP_PORT:-80\}:80"/);
      expect(baseGpu).toMatch(/"\$\{GPU_HTTPS_PORT:-443\}:443"/);

      const services = JSON.parse(gpu.stdout).services;
      const published = publishedPorts(services['nginx-gpu']);
      expect(published.sort()).toEqual(
        [envValue(envValues, 'GPU_HTTPS_PORT'), envValue(envValues, 'GPU_HTTP_PORT')].sort()
      );
      expect(published).not.toContain('80');
    });
  });

  describe('NVIDIA GPU-node render (docker-compose.gpu.yaml, no Strix Halo env)', () => {
    test('renders without error', () => {
      if (gpuNvidia.status !== 0) {
        throw new Error(`docker compose config failed (exit ${gpuNvidia.status}):\n${gpuNvidia.stderr}`);
      }
      expect(gpuNvidia.status).toBe(0);
    });

    test('the profile firewall: the pooling services do NOT render', () => {
      const services = JSON.parse(gpuNvidia.stdout).services;
      expect(services['vllm-embedding']).toBeUndefined();
      expect(services['vllm-reranker']).toBeUndefined();
    });

    test('the vendor-axis deltas are the every-host defaults (inert by construction)', () => {
      const services = JSON.parse(gpuNvidia.stdout).services;
      for (const name of ['vllm-llm', 'vllm-translation']) {
        expect({ service: name, devices: deviceSources(services[name]) }).toEqual({
          service: name,
          devices: ['/dev/null', '/dev/zero']
        });
        expect({ service: name, groupAdd: services[name].group_add }).toEqual({
          service: name,
          groupAdd: ['65534', '65533']
        });
        expect({ service: name, entrypoint: services[name].entrypoint }).toEqual({
          service: name,
          entrypoint: ['vllm', 'serve']
        });
        expect({ service: name, image: services[name].image }).toEqual({
          service: name,
          image: 'vllm/vllm-openai:v0.29.0'
        });
        expect({ service: name, nvidia: services[name].environment.NVIDIA_VISIBLE_DEVICES }).toEqual({
          service: name,
          nvidia: 'all'
        });
      }
    });

    test('the NVIDIA GPU-node render keeps its historical published ports', () => {
      // The NVIDIA GPU-node stack must publish exactly what it always did:
      // the parameterized rows render as "443"/"80" when the port vars are
      // unset.
      const services = JSON.parse(gpuNvidia.stdout).services;
      expect(publishedPorts(services['nginx-gpu']).sort()).toEqual(['443', '80']);
    });

    test('the NVIDIA GPU-node TEI images fall back to the NVIDIA-capable build', () => {
      // TEI_EMBEDDING_IMAGE / TEI_RERANKING_IMAGE unset → the compose
      // defaults: the same image this file always shipped. The CPU build is
      // a Strix Halo env value, never a file default — otherwise a compose
      // NVIDIA GPU node would lose GPU embedding.
      const services = JSON.parse(gpuNvidia.stdout).services;
      expect(services['tei-embedding'].image).toMatch(/text-embeddings-inference:1\.9\.3$/);
      expect(services['tei-reranker'].image).toMatch(/text-embeddings-inference:1\.9\.3$/);
      expect(services['tei-embedding'].image).not.toMatch(/cpu-/);
      expect(services['tei-reranker'].image).not.toMatch(/cpu-/);
    });
  });
});
