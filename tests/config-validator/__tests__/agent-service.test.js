// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// The agent service must stay deployable, switchable and
// parked by default. These gates are STATIC repository checks - they inspect
// the sources, they never start the stack.

'use strict';

const fs = require('fs');
const path = require('path');
const { parseComposeServiceContracts, parseComposeServiceBlock } = require('../validators/parse-compose');
const { parseEnvTemplate } = require('../validators/parse-env');
const { parseGenieAiImageNames, parseEnvTemplateImageVars } = require('../validators/parse-env-template');

const ROOT = path.join(__dirname, '..', '..', '..');
const COMPOSE_PATH = path.join(ROOT, 'docker-compose.yaml');
const ENV_PATH = path.join(ROOT, 'env');
const ENV_J2_PATH = path.join(ROOT, 'deploy/ansible/templates/env.j2');
const SHARED_FACTS_PATH = path.join(ROOT, 'deploy/ansible/tasks/deploy-shared-facts.yml');
const GROUP_VARS_PATH = path.join(ROOT, 'deploy/ansible/group_vars/all.yml');
const CI_PATH = path.join(ROOT, '.gitlab-ci.yml');
const AGENT_DIR = path.join(ROOT, 'components/agent-service');
const EVIDENCE_PATH = path.join(ROOT, 'docs/dependencies/agent-service-dependency-evidence.json');

// The licence identities that count as NOT verified. NOASSERTION is one of
// them: the checklist counts an unidentified licence as unverified, and an
// unverified licence blocks the adoption.
const UNVERIFIED_LICENCES = ['', 'NOASSERTION', 'UNKNOWN', 'NONE', 'N/A'];

function jobBlock(ciText, job) {
  // The block of ONE job: the file up to the next top-level key. A regex
  // across the whole file would let another job's line satisfy the assertion.
  return ciText.slice(ciText.indexOf(`${job}:`)).split(/\n(?=\S)/)[0];
}

function pinnedDependencies(requirementsText) {
  return requirementsText
    .split('\n')
    .map((line) => line.split('#')[0].trim())
    .filter((line) => line.includes('=='))
    .map((line) => {
      const [name, version] = line.split('==');
      return { name: name.trim(), version: version.trim() };
    });
}

describe('agent service (story 1.3)', () => {
  let composeText;
  let block;

  beforeAll(() => {
    composeText = fs.readFileSync(COMPOSE_PATH, 'utf-8');
    block = parseComposeServiceBlock(composeText, 'agent-service');
  });

  test('the compose block exists and carries the deployment contract', () => {
    expect(block).not.toBeNull();
    // Least privilege: no capabilities at all, no privilege escalation.
    expect(block).toMatch(/cap_drop:\s*\n\s*- ALL/);
    expect(block).toMatch(/no-new-privileges:true/);
    // The logs travel through the fluentd driver like every other service.
    expect(block).toMatch(/logging: \*fluent-logging/);
    // A healthcheck, so the stack knows whether the service answers.
    expect(block).toMatch(/healthcheck:/);
    expect(block).toMatch(/\/ready/);
    // Non-root: the image's runtime user is pinned at compose level too.
    expect(block).toMatch(/user: "10001:10001"/);
  });

  test('the service is internal only - it declares no host port', () => {
    expect(block).not.toMatch(/^\s*ports:/m);
  });

  test('the image comes from the per-service image variable', () => {
    expect(block).toMatch(/image: \$\{GENIE_AI_AGENT_SERVER_IMAGE:-/);
    expect(block).toMatch(/GENIE_AI_AGENT_SERVER_IMAGE_TAG:-/);
  });

  test('the activation flag gates the service and defaults to parked', () => {
    const contracts = parseComposeServiceContracts(COMPOSE_PATH);
    const contract = contracts.find((entry) => entry.service === 'agent-service');

    expect(contract).toBeDefined();
    // Profile + replicas pair — the okf-server/certbot shape; the
    // rationale lives on the compose block itself.
    expect(contract.profiles).toEqual(['agent']);
    expect(contract.replicas).toBe('${AGENT_ENABLED:-0}');
    expect(contract.envVars).toContain('AGENT_ENABLED');
  });
});

describe('the agent service is documented and wired', () => {
  test('the env template documents the activation flag', () => {
    const env = parseEnvTemplate(ENV_PATH);
    const documented = env.documented.find((entry) => entry.name === 'AGENT_ENABLED');

    expect(documented).toBeDefined();
    expect(documented.value).toBe('1');
  });

  test('the ansible deployment carries the image and the flag', () => {
    const images = parseGenieAiImageNames(SHARED_FACTS_PATH);
    expect(images).toContain('genie-ai-agent-server');

    const imageVars = parseEnvTemplateImageVars(ENV_J2_PATH, SHARED_FACTS_PATH);
    const agent = imageVars.find((entry) => entry.image === 'genie-ai-agent-server');
    expect(agent).toBeDefined();
    expect(agent.imageVar).toBe('GENIE_AI_AGENT_SERVER_IMAGE');
    expect(agent.tagVar).toBe('GENIE_AI_AGENT_SERVER_IMAGE_TAG');

    const envJ2 = fs.readFileSync(ENV_J2_PATH, 'utf-8');
    expect(envJ2).toMatch(/AGENT_ENABLED=\{\{ agent_enabled \| default\('0'\) \}\}/);

    const groupVars = fs.readFileSync(GROUP_VARS_PATH, 'utf-8');
    expect(groupVars).toMatch(/^agent_enabled: "0"$/m);
  });

  test('the CI triplet, the lint lane and the test lane exist', () => {
    const ci = fs.readFileSync(CI_PATH, 'utf-8');

    for (const job of ['build:agent-service', 'scan:agent-service', 'promote:agent-service']) {
      expect(ci).toContain(`${job}:`);
    }
    expect(ci).toContain('lint:agent-service:');
    expect(ci).toContain('test:agent-service:');
    // The lanes build the image the ansible deployment pulls - asserted on
    // the job's OWN block, so another job's IMAGE_NAME cannot satisfy it.
    const build = jobBlock(ci, 'build:agent-service');
    expect(build).toMatch(/IMAGE_NAME: "genie-ai-agent-server"/);
    expect(build).toMatch(/CONTEXT: "components\/agent-service\/"/);
  });

  test('the gateway routes nothing to the agent service', () => {
    // The agentic path is not reachable from the gateway: no route, no
    // service, no caller. A route added later must arrive with its flag
    // wiring - this gate is what makes that visible.
    for (const file of [
      'api-gateway-solution/new-config/kong_config.json',
      'api-gateway-solution/new-config/restore-kong-config.sh'
    ]) {
      expect(fs.readFileSync(path.join(ROOT, file), 'utf-8')).not.toMatch(/agent-service/);
    }
  });
});

describe('the agent service compose block forwards the shared corpus/model endpoints', () => {
  let agentBlock;
  let env;

  beforeAll(() => {
    agentBlock = parseComposeServiceBlock(fs.readFileSync(COMPOSE_PATH, 'utf-8'), 'agent-service');
    env = parseEnvTemplate(ENV_PATH);
  });

  test('the TEI pair and the LLM endpoint ride the shared spellings', () => {
    // The run surface's assembly reads these fail-closed: an unset TEI
    // endpoint is a 503 naming it, and the LLM endpoint is what the
    // generation leg calls. The same `${}` spellings the OPEA services
    // read, so one .env line moves both worlds.
    expect(agentBlock).toMatch(/- TEI_EMBEDDING_ENDPOINT=\$\{EMBEDDING_SERVICE_URL:-http:\/\/tei:80\}/);
    expect(agentBlock).toMatch(/- TEI_RERANKING_ENDPOINT=\$\{RERANKER_SERVICE_URL:-http:\/\/tei_reranker:80\}/);
    expect(agentBlock).toMatch(/- VLLM_ENDPOINT=\$\{VLLM_ENDPOINT:-http:\/\/vllm:8000\}/);
  });

  test('the ArangoDB knobs follow the deployment, not the code defaults', () => {
    // The graph name MUST follow the deployment's real graph: a diverging
    // default silently drops every legacy hit and refuses every legacy
    // read_source. The credential has no default (a placeholder would
    // authenticate nothing).
    expect(agentBlock).toMatch(/- ARANGO_URL=\$\{ARANGO_URL:-http:\/\/arango-vector-db:8529\}/);
    expect(agentBlock).toMatch(/- ARANGO_DB=\$\{ARANGO_DB:-genie-ai\}/);
    // One spelling for the database user: ARANGO_USERNAME, everywhere the
    // agent service reads.
    expect(agentBlock).toMatch(/- ARANGO_USERNAME=\$\{ARANGO_USERNAME:-root\}/);
    expect(agentBlock).toMatch(/- ARANGO_PASSWORD=\$\{ARANGO_PASSWORD\}/);
    expect(agentBlock).toMatch(/- ARANGO_GRAPH_NAME=\$\{ARANGO_GRAPH_NAME:-GRAPH\}/);
  });

  test('the env template documents the knobs that have no other home', () => {
    // ARANGO_DB / ARANGO_PASSWORD / ARANGO_GRAPH_NAME / VLLM_ENDPOINT are
    // documented at their own sections; the agent section carries only the
    // four knobs that were homeless.
    for (const name of ['TEI_EMBEDDING_ENDPOINT', 'TEI_RERANKING_ENDPOINT', 'ARANGO_URL', 'ARANGO_USERNAME']) {
      const documented = env.documented.find((entry) => entry.name === name);
      expect(documented).toBeDefined();
    }
  });
});

describe('the agent service carries no OPEA overlay dependency', () => {
  test('no module of the service imports the overlay package', () => {
    const offenders = [];

    for (const file of fs.readdirSync(AGENT_DIR)) {
      if (!file.endsWith('.py')) {
        continue;
      }
      const source = fs.readFileSync(path.join(AGENT_DIR, file), 'utf-8');
      if (/^\s*(?:from|import)\s+comps\b/m.test(source)) {
        offenders.push(file);
      }
    }
    for (const file of fs.readdirSync(path.join(AGENT_DIR, 'tests'))) {
      if (!file.endsWith('.py')) {
        continue;
      }
      const source = fs.readFileSync(path.join(AGENT_DIR, 'tests', file), 'utf-8');
      if (/^\s*(?:from|import)\s+comps\b/m.test(source)) {
        offenders.push(`tests/${file}`);
      }
    }

    expect(offenders).toEqual([]);
  });
});

describe('the agent service observability pair (story 2.11 — AD-11)', () => {
  let tracingSource;
  let appSource;
  let agentBlock;

  beforeAll(() => {
    agentBlock = parseComposeServiceBlock(fs.readFileSync(COMPOSE_PATH, 'utf-8'), 'agent-service');
    tracingSource = fs.readFileSync(path.join(AGENT_DIR, 'tracing.py'), 'utf-8');
    appSource = fs.readFileSync(path.join(AGENT_DIR, 'app.py'), 'utf-8');
  });

  test('the compose block carries the OTel env pair naming the service', () => {
    // The compose↔source pair convention (the backend block is the
    // pattern): the SDK gate, the collector endpoint and the service name —
    // the name the dashboards' `service_name` label discovery resolves.
    expect(agentBlock).toMatch(/- ENABLE_OBSERVABILITY=\$\{ENABLE_OBSERVABILITY:-0\}/);
    expect(agentBlock).toMatch(
      /- OTEL_EXPORTER_OTLP_ENDPOINT=\$\{OTEL_EXPORTER_OTLP_ENDPOINT:-http:\/\/otel-collector:4318\}/
    );
    expect(agentBlock).toMatch(/- OTEL_SERVICE_NAME=agent-service/);
    // The fluentd anchor stays: container logs reach VictoriaLogs
    // unconditionally (the existing pin, re-asserted on the same block).
    expect(agentBlock).toMatch(/logging: \*fluent-logging/);
  });

  test('the source default and the compose name agree', () => {
    expect(appSource).toMatch(/SERVICE_NAME = "agent-service"/);
    expect(appSource).toMatch(/setup_tracing\(SERVICE_NAME\)/);
    expect(agentBlock).toMatch(/OTEL_SERVICE_NAME=agent-service/);
  });

  test('the outbound hops are instrumented behind the observability gate', () => {
    // W3C propagation on every outbound hop: httpx (the model endpoint, the
    // TEI calls) and requests (the doc-repo / okf-server adapters).
    expect(tracingSource).toMatch(/HTTPXClientInstrumentor/);
    expect(tracingSource).toMatch(/RequestsInstrumentor/);
    // Behind the SINGLE gate: the instrumentors are installed inside
    // setup_tracing, which no-ops unless ENABLE_OBSERVABILITY is "1" — the
    // install sites must come after the gate check.
    const gate = tracingSource.indexOf('ENABLE_OBSERVABILITY');
    const httpxInstall = tracingSource.indexOf('HTTPXClientInstrumentor().instrument()');
    const requestsInstall = tracingSource.indexOf('RequestsInstrumentor().instrument()');
    expect(gate).toBeGreaterThan(-1);
    expect(httpxInstall).toBeGreaterThan(gate);
    expect(requestsInstall).toBeGreaterThan(gate);
  });

  test('the outbound instrumentation pins are in the audited tree', () => {
    const requirements = fs.readFileSync(path.join(AGENT_DIR, 'requirements.txt'), 'utf-8');
    expect(requirements).toMatch(/^opentelemetry-instrumentation-httpx==0\.48b0$/m);
    expect(requirements).toMatch(/^opentelemetry-instrumentation-requests==0\.48b0$/m);
    // Their licence evidence rows exist (the generic per-pin gate below
    // verifies licence + defaults; this pins the pins' PRESENCE).
    const evidence = JSON.parse(fs.readFileSync(EVIDENCE_PATH, 'utf-8'));
    const names = evidence.packages.map((entry) => entry.name);
    expect(names).toContain('opentelemetry-instrumentation-httpx');
    expect(names).toContain('opentelemetry-instrumentation-requests');
  });
});

describe('the pre-adoption checklist is satisfied for every pinned dependency', () => {
  const evidence = JSON.parse(fs.readFileSync(EVIDENCE_PATH, 'utf-8'));
  // The evidence declares the trees it covers (the runtime tree and the
  // test tree): the gate checks their union, so a package added to either
  // one without an audit fails here.
  const pins = evidence.requirements.flatMap((relative) =>
    pinnedDependencies(fs.readFileSync(path.join(ROOT, relative), 'utf-8'))
  );

  test('every pin carries a verified licence and a defaults audit', () => {
    const rows = new Map(evidence.packages.map((entry) => [entry.name, entry]));

    expect(pins.length).toBeGreaterThan(0);
    for (const pin of pins) {
      const row = rows.get(pin.name);
      expect(row).toBeDefined();
      expect(row.version).toBe(pin.version);
      expect(UNVERIFIED_LICENCES).not.toContain((row.license || '').trim());
      expect((row.license_source || '').trim()).not.toBe('');
      expect((row.defaults.telemetry || '').trim()).not.toBe('');
      expect((row.defaults.cloud_export || '').trim()).not.toBe('');
      // A release that is not stable needs an explicit risk acceptance.
      expect((row.status || '').trim()).not.toBe('');
      if (row.status.trim().toLowerCase() !== 'stable') {
        expect((row.risk_acceptance || '').trim()).not.toBe('');
      }
    }
  });

  test('the evidence carries no row for a package the tree no longer pins', () => {
    const pinned = new Set(pins.map((pin) => pin.name));

    expect(evidence.packages.map((entry) => entry.name).filter((name) => !pinned.has(name))).toEqual([]);
  });

  test('the CI lanes install the audited trees, not a floating pin list', () => {
    const ci = fs.readFileSync(CI_PATH, 'utf-8');
    // The lane block only: the repository's other lanes pin their own test
    // dependencies, and this gate is about the agent service's own surface.
    const lane = jobBlock(ci, 'test:agent-service');

    expect(lane).toMatch(/-r components\/agent-service\/requirements-test\.txt/);
    // No dependency pinned outside the audited tree sneaks back into the lane.
    expect(lane).not.toMatch(/httpx==/);
    expect(lane).not.toMatch(/pytest==/);
  });
});

describe('the dependency-evidence gate runs in CI', () => {
  // The job mirrors the pin above with the verifier itself instead of the JS
  // re-implementation: a defect this file cannot see (a duplicate evidence
  // row, a row without a usable name) still fails the pipeline.
  const JOB = 'verify:dependency-licenses';

  test('the job runs the verifier against the committed evidence and trees', () => {
    const block = jobBlock(fs.readFileSync(CI_PATH, 'utf-8'), JOB);
    expect(block).toMatch(
      /python3 scripts\/dependencies\/verify-dependency-licenses\.py --verify components\/agent-service\/requirements\.txt components\/agent-service\/requirements-test\.txt --evidence docs\/dependencies\/agent-service-dependency-evidence\.json/
    );
    // The gate's FAIL branches are unit-tested beside the real run: a branch
    // that stops reporting is a red pipeline, not a weaker audit.
    expect(block).toMatch(/python3 -m pytest scripts\/dependencies\/test_verify_dependency_licenses\.py/);
  });

  test('every trigger branch of the job fires on an audit input', () => {
    // One glob per input the gate reads, carried by ONE anchor the three
    // trigger branches reference: dropping a glob from the anchor (or the
    // anchor reference from one branch — say the merge-request rule) would
    // let an MR stale the audit while the other pipelines stay green.
    const ci = fs.readFileSync(CI_PATH, 'utf-8');
    // The anchor lives beside the job it serves (the module-source-changes
    // idiom), not inside the job block: the definition is asserted on the
    // whole file, the references on the job's own block.
    const anchorAt = ci.indexOf('.agent_audit_source_changes: &agent_audit_source_changes');
    expect(anchorAt).toBeGreaterThan(-1);
    const anchor = ci.slice(anchorAt, ci.indexOf('verify:dependency-licenses:'));
    const block = jobBlock(ci, JOB);
    for (const input of [
      '"components/agent-service/requirements*.txt"',
      '"docs/dependencies/agent-service-dependency-evidence.json"',
      '"scripts/dependencies/**"'
    ]) {
      expect(anchor).toContain(input);
    }
    const triggerBranches = [
      '$CI_PIPELINE_SOURCE == "merge_request_event"',
      '$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH',
      '$CI_COMMIT_BRANCH =~ /^release\\//'
    ];
    for (const condition of triggerBranches) {
      const at = block.indexOf(condition);
      expect(at).toBeGreaterThan(-1);
      const rule = block.slice(at).split(/\n\s+- if:/)[0];
      expect(rule).toContain('paths: *agent_audit_source_changes');
    }
  });
});

describe('agentic activation wiring on the BFF container', () => {
  let backendBlock;
  let backendEnvVars;
  let envDocumented;

  beforeAll(() => {
    const composeText = fs.readFileSync(COMPOSE_PATH, 'utf-8');
    backendBlock = parseComposeServiceBlock(composeText, 'backend');
    backendEnvVars = parseComposeServiceContracts(COMPOSE_PATH).find((s) => s.service === 'backend').envVars;
    envDocumented = parseEnvTemplate(ENV_PATH).documented;
  });

  test('the backend container receives AGENT_ENABLED and AGENT_SERVICE_URL', () => {
    // Guards the wiring the shared query routing helper needs: a variable
    // absent from the service's environment block is unreachable by the
    // container, so an unwired flag leaves the BFF serving legacy while the
    // agent service runs. The exact defaults are pinned below — the flag
    // default must park the agentic branch ('0') and the URL default must
    // name the documented topology.
    expect(backendEnvVars).toEqual(expect.arrayContaining(['AGENT_ENABLED', 'AGENT_SERVICE_URL']));
    expect(backendBlock).toMatch(/- AGENT_ENABLED=\$\{AGENT_ENABLED:-0\}/);
    expect(backendBlock).toMatch(/- AGENT_SERVICE_URL=\$\{AGENT_SERVICE_URL:-http:\/\/agent-service:8010\}/);
  });

  test('the env template documents the routing target as an optional override', () => {
    const documented = envDocumented.find((entry) => entry.name === 'AGENT_SERVICE_URL');
    expect(documented).toBeDefined();
    expect(documented.value).toBe('http://agent-service:8010');
    // The ansible channel renders the same knob (the pair rides together —
    // the flag and its target must never half-wire on one deployment
    // channel).
    const envJ2 = fs.readFileSync(ENV_J2_PATH, 'utf-8');
    expect(envJ2).toMatch(/AGENT_SERVICE_URL=\{\{ agent_service_url \| default\('http:\/\/agent-service:8010'\) \}\}/);
    const groupVars = fs.readFileSync(GROUP_VARS_PATH, 'utf-8');
    expect(groupVars).toMatch(/^agent_service_url: "http:\/\/agent-service:8010"$/m);
  });
});

describe('the agent tool catalog is declared, mounted and seeded', () => {
  test('the env template documents the catalog path', () => {
    const env = parseEnvTemplate(ENV_PATH);
    const documented = env.documented.find((entry) => entry.name === 'AGENT_TOOL_CATALOG_PATH');

    expect(documented).toBeDefined();
    expect(documented.value).toBe('/app/config/tool-catalog.json');
  });

  test('the compose block forwards the knob and mounts the catalog read-only', () => {
    const composeText = fs.readFileSync(COMPOSE_PATH, 'utf-8');
    const block = parseComposeServiceBlock(composeText, 'agent-service');

    expect(block).toMatch(/AGENT_TOOL_CATALOG_PATH=\$\{AGENT_TOOL_CATALOG_PATH:-\/app\/config\/tool-catalog\.json\}/);
    // Read-only: the service reads the catalog, it never writes it.
    expect(block).toMatch(/\.\/configs\/agent\/tool-catalog\.json:\/app\/config\/tool-catalog\.json:ro/);
  });

  test('the ansible deployment renders the knob and seeds the file', () => {
    const envJ2 = fs.readFileSync(ENV_J2_PATH, 'utf-8');
    expect(envJ2).toMatch(
      /AGENT_TOOL_CATALOG_PATH=\{\{ agent_tool_catalog_path \| default\('\/app\/config\/tool-catalog\.json'\) \}\}/
    );

    const groupVars = fs.readFileSync(GROUP_VARS_PATH, 'utf-8');
    expect(groupVars).toMatch(/^agent_tool_catalog_path: "\/app\/config\/tool-catalog\.json"$/m);

    // The node must carry the file: the bind mount's source has to exist
    // there (swarmkit silently creates a missing bind source ROOT-owned).
    // The assertion is ANCHORED, not a substring: the var must be defined
    // INSIDE the "Define deploy files" task's vars: mapping (a definition
    // anywhere else is swallowed by the union's | default([]) — silently,
    // with no error), the union must name it, and the gating must be the
    // swarm activation flag.
    const deploy = fs.readFileSync(path.join(ROOT, 'deploy/ansible/deploy.yml'), 'utf-8');
    const taskMatch = deploy.match(/- name: Define deploy files\n(?:(?!- name:)[\s\S])*/);
    expect(taskMatch).not.toBeNull();
    const task = taskMatch[0];
    const varsMatch = task.match(/vars:\n(?:(?!- name:)[\s\S])*/);
    expect(varsMatch).not.toBeNull();
    expect(varsMatch[0]).toMatch(/_deploy_files_agent: "[^"]*configs\/agent\/tool-catalog\.json[^"]*"/);
    expect(varsMatch[0]).toMatch(/agent_enabled \| default\('0'\) == '1'/);
    expect(task).toMatch(/union\(_deploy_files_agent \| default\(\[\]\)\)/);
  });

  test('the shipped catalog carries the two document tools', () => {
    const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'configs/agent/tool-catalog.json'), 'utf-8'));

    expect(catalog.version).toBe(1);
    expect(catalog.tools.map((entry) => entry.name).sort()).toEqual(['read_source', 'search_knowledge']);
  });
});
