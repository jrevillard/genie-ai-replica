'use strict';

require('../setup-env');

// The shared routing helper. The helper is the ONLY place
// in the component that reads AGENT_ENABLED (the single-read invariant is
// pinned by the source scan below), and its read happens ONCE at module load
// (the OKF_ENABLED pattern): a test that wants a different flag value
// re-requires the module under jest.isolateModules with the env set first.

const fs = require('fs');
const path = require('path');

function requireRouting() {
  let mod;
  jest.isolateModules(() => {
    mod = require('../../services/agent-routing');
  });
  return mod;
}

describe('isAgentPathEnabled', () => {
  const originalValue = process.env.AGENT_ENABLED;

  afterEach(() => {
    if (originalValue === undefined) {
      delete process.env.AGENT_ENABLED;
    } else {
      process.env.AGENT_ENABLED = originalValue;
    }
  });

  it('is OFF when the flag is unset (dark-launch polarity — unset means parked)', () => {
    delete process.env.AGENT_ENABLED;
    const { isAgentPathEnabled } = requireRouting();
    expect(isAgentPathEnabled()).toBe(false);
  });

  it('is ON only for the exact value 1', () => {
    process.env.AGENT_ENABLED = '1';
    expect(requireRouting().isAgentPathEnabled()).toBe(true);
  });

  it('accepts a padded 1 (trimmed, like the OKF_ENABLED read)', () => {
    process.env.AGENT_ENABLED = ' 1 ';
    expect(requireRouting().isAgentPathEnabled()).toBe(true);
  });

  it('is OFF for 0, empty and every non-01 value (true included — the contract is 0/1)', () => {
    for (const value of ['0', '', 'true', 'false', 'yes', '01', '2']) {
      process.env.AGENT_ENABLED = value;
      expect(requireRouting().isAgentPathEnabled()).toBe(false);
    }
  });

  it('reads the flag ONCE at module load (a later env change does not flip a loaded module)', () => {
    process.env.AGENT_ENABLED = '0';
    const { isAgentPathEnabled } = requireRouting();
    expect(isAgentPathEnabled()).toBe(false);
    process.env.AGENT_ENABLED = '1';
    // The loaded module keeps its load-time answer — the branch decision is
    // fixed per process, not per request.
    expect(isAgentPathEnabled()).toBe(false);
  });
});

describe('agentServiceUrl', () => {
  const originalValue = process.env.AGENT_SERVICE_URL;

  afterEach(() => {
    if (originalValue === undefined) {
      delete process.env.AGENT_SERVICE_URL;
    } else {
      process.env.AGENT_SERVICE_URL = originalValue;
    }
  });

  it('defaults to the compose service name + port when unset', () => {
    delete process.env.AGENT_SERVICE_URL;
    // The run surface the agent service serves is joined to the configured
    // base: a POST to the bare base is a 404 on every agentic turn.
    expect(requireRouting().agentServiceUrl()).toBe('http://agent-service:8010/v1/runs');
  });

  it('honors the AGENT_SERVICE_URL override', () => {
    process.env.AGENT_SERVICE_URL = 'http://agent-svc:9999';
    expect(requireRouting().agentServiceUrl()).toBe('http://agent-svc:9999/v1/runs');
  });

  it('falls back to the default on an empty/blank override', () => {
    process.env.AGENT_SERVICE_URL = '   ';
    expect(requireRouting().agentServiceUrl()).toBe('http://agent-service:8010/v1/runs');
  });

  it('does not append the run surface twice when the override already names it', () => {
    // A deployment may configure the full path (the V08 rehearsal did).
    process.env.AGENT_SERVICE_URL = 'http://agent-svc:9999/v1/runs';
    expect(requireRouting().agentServiceUrl()).toBe('http://agent-svc:9999/v1/runs');
  });

  it('tolerates a trailing slash on the configured base', () => {
    process.env.AGENT_SERVICE_URL = 'http://agent-svc:9999/';
    expect(requireRouting().agentServiceUrl()).toBe('http://agent-svc:9999/v1/runs');
  });
});

describe('the single-read invariant (story 2.4 — the helper is the only AGENT_ENABLED read)', () => {
  const COMPONENT_ROOT = path.join(__dirname, '..', '..', '..');

  function componentSources(dir) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (
          entry.name === 'node_modules' ||
          entry.name === '__tests__' ||
          entry.name === 'uploads' ||
          entry.name === 'logs'
        ) {
          continue;
        }
        out.push(...componentSources(full));
      } else if (entry.name.endsWith('.js')) {
        out.push(full);
      }
    }
    return out;
  }

  it('no shipped component source reads process.env.AGENT_ENABLED outside agent-routing.js', () => {
    const offenders = componentSources(COMPONENT_ROOT)
      .map((file) => ({ file, source: fs.readFileSync(file, 'utf8') }))
      .filter(
        ({ file, source }) => path.basename(file) !== 'agent-routing.js' && source.includes('process.env.AGENT_ENABLED')
      )
      .map(({ file }) => path.relative(COMPONENT_ROOT, file));

    expect(offenders).toEqual([]);
  });
});
