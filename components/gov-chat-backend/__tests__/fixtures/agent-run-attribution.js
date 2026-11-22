'use strict';

// Story 2.11 — the FR-17 execution-version record the agent service emits
// on the `run_started` seam event (ids and fingerprints only — never
// credentials, never a prompt body, never question/answer text). ONE
// fixture home for every suite that pins the run-start handshake: a
// contract-shape change edits this file, not three drifting copies.

const EXECUTION_VERSIONS = {
  implementation: { version: '0.1.0' },
  model: { id: 'test-model', source: 'discovered' },
  prompt: { version: 'prod-1', sha256: 'abc123def456' },
  configuration: {
    sha256: '0123456789ab',
    values: { max_steps: 6, verdict_policy: 'verdict-marked' }
  }
};

module.exports = { EXECUTION_VERSIONS };
