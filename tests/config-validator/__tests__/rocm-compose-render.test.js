// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Render gate for the AMD ROCm compose overlays.
//
// The two overlays layer onto the NVIDIA base files and are never rendered by
// any other check: the config-validator suite parses docker-compose.yaml and
// docker-compose.gpu.yaml only, and scripts/ci/config-parity-check.py reads
// docker-compose.yaml only. A typo in an `!override` tag, a bad `environment:`
// merge or a service that exists in the overlay but not in the render reached
// the branch unrendered.
//
// The gate renders both overlay pairs with the real compose binary and
// asserts the ROCm-specific facts survive the merge: the GPU device
// mappings, the NVIDIA env neutralization, the vLLM embedding/reranker
// backends, the ROCm image pins and the `!override` port replacement.
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

// The `!override` merge tag landed in Compose v2.24.4 (Feb 2024).
// docker-compose.rocm.gpu.yaml uses it to REPLACE nginx-gpu's port list
// (a plain list would union with the base file's hardcoded "80:80"). An
// older binary does not implement the tag, so the floor is checked
// explicitly to name the remedy instead of letting the render fail with an
// opaque merge error.

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
// so an ambient value would mask a missing pin in env.strixhalo or in the
// overlay. The env file and the overlay must be the ONLY source.
const FILE_OWNED_KNOBS = [
  'EMBEDDING_BACKEND',
  'RERANKER_BACKEND',
  'RERANKER_VLLM_ENDPOINT',
  'EMBEDDING_VLLM_ENDPOINT',
  'NVIDIA_VISIBLE_DEVICES',
  'VLLM_ROCM_IMAGE',
  'TEI_ROCM_EMBEDDING_IMAGE',
  'TEI_ROCM_RERANKING_IMAGE',
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
 * @param {{ json?: boolean }} options - json=true renders to JSON, otherwise --quiet
 * @returns {{ status: number, stdout: string, stderr: string }}
 */
function runComposeConfig(files, profiles, options = {}) {
  const args = ['compose'];
  // The ROCm profile is the default env file for these renders. A render
  // that must see the NVIDIA defaults passes envFile: null (and pins the
  // two port vars empty, so a machine-local .env cannot change the answer).
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
  console.warn(
    `[rocm-compose-render] skipped: no usable 'docker compose' binary (${compose.raw.trim() || 'not found'})`
  );
}

describeCompose('ROCm compose overlay render gate', () => {
  let single;
  let gpu;
  let base;

  beforeAll(() => {
    single = runComposeConfig(['docker-compose.yaml', 'docker-compose.rocm.yaml'], ['opea', 'gpu-models', 'okf'], {
      json: true
    });
    gpu = runComposeConfig(['docker-compose.gpu.yaml', 'docker-compose.rocm.gpu.yaml'], [], {
      json: true
    });
    // The base pair alone — the reference the overlay's merge is compared
    // against (the overlay must not silently change what the base ships).
    base = runComposeConfig(['docker-compose.yaml'], ['opea', 'gpu-models', 'okf'], { json: true });
  });

  test("the ROCm overlays need NO merge tag — the repo's Compose floor holds", () => {
    // `!override` requires Compose >= 2.24.4, while the repo documents
    // 2.20+ as its floor (site/content/en/docs/get-started/
    // quickstart-deployer.md). On a supported host the overlay did not parse
    // at all ("unknown tag") — the failure surfaced as a YAML error, not as
    // a readable message (MR !968 review, Jerome).
    //
    // The ports are VALUES now (the base file's rows are parameterized), so
    // no merge tag is needed anywhere in the ROCm path. This test pins that:
    // a merge tag creeping back in raises the repo's minimum compose
    // version, and the files that carry them are named here.
    for (const file of ['docker-compose.rocm.yaml', 'docker-compose.rocm.gpu.yaml']) {
      const text = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
      const withoutComments = text
        .split('\n')
        .filter((line) => !line.trim().startsWith('#'))
        .join('\n');
      expect({ file, mergeTag: /!override|!reset|!replace/.test(withoutComments) }).toEqual({
        file,
        mergeTag: false
      });
    }
  });

  describe('single-server pair (docker-compose.yaml + docker-compose.rocm.yaml)', () => {
    test('renders without error', () => {
      const result = runComposeConfig(
        ['docker-compose.yaml', 'docker-compose.rocm.yaml'],
        ['opea', 'gpu-models', 'okf']
      );
      if (result.status !== 0) {
        throw new Error(`docker compose config failed (exit ${result.status}):\n${result.stderr}`);
      }
      expect(result.status).toBe(0);
    });

    test('the overlay-only GPU services are in the render', () => {
      const services = JSON.parse(single.stdout).services;
      expect(Object.keys(services)).toEqual(expect.arrayContaining(['vllm-embedding', 'vllm-reranker']));
    });

    test('the ROCm image pins from env.strixhalo reach the rendered services', () => {
      const services = JSON.parse(single.stdout).services;
      const rocmImage = envValue(envValues, 'VLLM_ROCM_IMAGE');
      expect(services.vllm.image).toBe(rocmImage);
      expect(services['vllm-embedding'].image).toBe(rocmImage);
      expect(services['vllm-reranker'].image).toBe(rocmImage);
      expect(services.tei.image).toBe(envValue(envValues, 'TEI_ROCM_EMBEDDING_IMAGE'));
      expect(services.tei_reranker.image).toBe(envValue(envValues, 'TEI_ROCM_RERANKING_IMAGE'));
    });

    test('the GPU device mappings survive the merge', () => {
      const services = JSON.parse(single.stdout).services;
      for (const name of ['vllm', 'vllm-translation-guardrail', 'vllm-embedding', 'vllm-reranker']) {
        expect({ service: name, devices: deviceSources(services[name]) }).toEqual({
          service: name,
          devices: expect.arrayContaining(['/dev/kfd', '/dev/dri'])
        });
      }
    });

    test('the NVIDIA device variable is neutralized on every ROCm service', () => {
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
    });

    test('the backend endpoints name services that exist in the render', () => {
      // The endpoints address the overlay's own services by compose name.
      // A renamed overlay service leaves the wrapper pointing at a name
      // that resolves to nothing - the container resolves at request time
      // and fails every call, long after the render succeeded.
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

    test('the NVIDIA base render leaves the query encoder on the microservice', () => {
      // The NVIDIA-inertness proof: with EMBEDDING_VLLM_ENDPOINT unset, the
      // chatqna code keeps the base compose's embedding microservice (TEI)
      // — the row is empty, so the derivation never fires.
      // The render that shows the NVIDIA deployment: the base file alone,
      // with the ROCm profile's env out of the way and the switch pinned
      // empty (compose treats an empty var as unset).
      const nvidia = runComposeConfig(['docker-compose.yaml'], ['opea', 'gpu-models', 'okf'], {
        json: true,
        envFile: null,
        env: { EMBEDDING_VLLM_ENDPOINT: '' }
      });
      const services = JSON.parse(nvidia.stdout).services;
      expect(services['chatqna-xeon-backend-server'].environment.EMBEDDING_VLLM_ENDPOINT).toBe('');
      expect(services['chatqna-xeon-backend-server'].environment.EMBEDDING_SERVER_HOST_IP).toBe('embedding');
      expect(String(services['chatqna-xeon-backend-server'].environment.EMBEDDING_SERVER_PORT)).toBe('6000');
    });

    test('the overlay leaves the collector host publish as the base declares it', () => {
      // The base publishes the fluentforward receiver on 127.0.0.1:24224 —
      // the endpoint the Docker logging driver delivers every container's
      // stdout to. An overlay `ports: !override []` drops that publish and
      // the container logs then never reach VictoriaLogs or the admin UI
      // (docker logs still works: dual logging). The base pair rendered on
      // its own is the reference for what the overlay must not change.
      const overlayPorts = JSON.parse(single.stdout).services['otel-collector'].ports ?? null;
      const basePorts = JSON.parse(base.stdout).services['otel-collector'].ports ?? null;
      expect({ service: 'otel-collector', overlay: overlayPorts }).toEqual({
        service: 'otel-collector',
        overlay: basePorts
      });
      expect(publishedPorts({ ports: basePorts })).toContain('24224');
    });
  });

  describe('GPU-node pair (docker-compose.gpu.yaml + docker-compose.rocm.gpu.yaml)', () => {
    test('renders without error', () => {
      const result = runComposeConfig(['docker-compose.gpu.yaml', 'docker-compose.rocm.gpu.yaml'], []);
      if (result.status !== 0) {
        throw new Error(`docker compose config failed (exit ${result.status}):\n${result.stderr}`);
      }
      expect(result.status).toBe(0);
    });

    test('the overlay-only GPU reranker is in the render', () => {
      const services = JSON.parse(gpu.stdout).services;
      expect(Object.keys(services)).toEqual(expect.arrayContaining(['vllm-reranker']));
      expect(services['vllm-reranker'].image).toBe(envValue(envValues, 'VLLM_ROCM_IMAGE'));
    });

    test('the GPU device mappings survive the merge', () => {
      const services = JSON.parse(gpu.stdout).services;
      for (const name of ['vllm-llm', 'vllm-translation', 'vllm-reranker']) {
        expect({ service: name, devices: deviceSources(services[name]) }).toEqual({
          service: name,
          devices: expect.arrayContaining(['/dev/kfd', '/dev/dri'])
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

    test('the published ports are values on BOTH files — no clash, no merge tag', () => {
      // The base GPU file publishes "80:80" alongside the configurable HTTPS
      // port. That hardcoded row is why the overlay once needed a
      // `ports: !override` to move it (compose unions port sequences, so an
      // overlay could only ADD to the list, never replace it) — and the
      // merge tag raised the repo's compose floor to 2.24.4.
      //
      // Both rows are parameterized now, so the overlay restates the SAME
      // values and compose's union collapses them: the published pair is
      // exactly the two configured ports, and the base's own render keeps
      // its historical 443/80.
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

    test('the NVIDIA base render keeps its historical published ports', () => {
      // The NVIDIA GPU-node stack must publish exactly what it always did:
      // the parameterized row renders as "80:80" when GPU_HTTP_PORT is unset.
      const baseGpu = runComposeConfig(['docker-compose.gpu.yaml'], [], {
        json: true,
        envFile: null,
        env: { GPU_HTTP_PORT: '', GPU_HTTPS_PORT: '' }
      });
      const services = JSON.parse(baseGpu.stdout).services;
      expect(publishedPorts(services['nginx-gpu']).sort()).toEqual(['443', '80']);
    });
  });
});
