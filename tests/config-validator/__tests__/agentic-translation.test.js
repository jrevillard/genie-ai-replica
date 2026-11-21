// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Story 2.10 (Epic 2): the agentic answer-translation leg is wired, its
// REQUIRED knobs are present, and the OPEA translation image stays out of
// the agentic path (AD-14). These gates are STATIC repository checks - they
// inspect the sources, they never start the stack.

'use strict';

const fs = require('fs');
const path = require('path');
const {
  parseComposeServiceContracts,
  parseComposeImages,
  parseComposeServiceBlock
} = require('../validators/parse-compose');
const { parseEnvTemplate } = require('../validators/parse-env');

const ROOT = path.join(__dirname, '..', '..', '..');
const COMPOSE_PATH = path.join(ROOT, 'docker-compose.yaml');
const ENV_PATH = path.join(ROOT, 'env');

// The two REQUIRED knobs (story 2.10): the BFF reads them fail-closed, so a
// deployment without them skips answer translation — the wiring must at
// least reach the container and be documented.
const KNOBS = ['AGENT_TRANSLATION_MAX_TOKENS', 'AGENT_TRANSLATION_MAX_CALLS'];

describe('the agentic translation leg is wired and GPU-only (story 2.10)', () => {
  let composeText;
  let backendBlock;
  let contracts;
  let env;

  beforeAll(() => {
    composeText = fs.readFileSync(COMPOSE_PATH, 'utf-8');
    backendBlock = parseComposeServiceBlock(composeText, 'backend');
    contracts = parseComposeServiceContracts(COMPOSE_PATH);
    env = parseEnvTemplate(ENV_PATH);
  });

  test('both REQUIRED knobs reach the backend container with empty defaults', () => {
    expect(backendBlock).not.toBeNull();
    const backend = contracts.find((entry) => entry.service === 'backend');
    for (const knob of KNOBS) {
      // The 2.3 knob pattern: pass-through with an empty default — unset
      // there, so the fail-closed reader sees a missing knob and skips.
      expect(backendBlock).toMatch(new RegExp(`- ${knob}=\\$\\{${knob}:-\\}`));
      expect(backend.envVars).toContain(knob);
    }
  });

  test('the env template documents both knobs as unset-by-default', () => {
    for (const knob of KNOBS) {
      const documented = env.documented.find((entry) => entry.name === knob);
      expect(documented).toBeDefined();
      expect(documented.value).toBe('');
    }
  });

  test('the OPEA translation image stays profile-gated on the opea profile', () => {
    const translation = contracts.find((entry) => entry.service === 'translation');
    expect(translation).toBeDefined();
    expect(translation.profiles).toEqual(['opea']);
  });

  test('the OPEA translation service is the opea/translation image', () => {
    const images = parseComposeImages(COMPOSE_PATH);
    const translation = images.find((entry) => entry.service === 'translation');
    expect(translation).toBeDefined();
    expect(translation.image).toMatch(/^opea\/translation:/);
  });

  test('the backend block never references the OPEA translation service', () => {
    // The agentic selection is GPU-only (AD-14): the BFF names the vLLM
    // translation worker, never the OPEA image or its service endpoint.
    expect(backendBlock).not.toMatch(/opea\/translation/);
    // The OPEA service's own endpoint wiring (chatqna's env carries it; the
    // BFF must not).
    expect(backendBlock).not.toMatch(/TRANSLATION_SERVICE_HOST_IP/);
    expect(backendBlock).not.toMatch(/\btranslation:8888\b/);
    // The only translation endpoint the block names is the vLLM worker.
    const endpointLine = backendBlock.split('\n').find((line) => line.includes('VLLM_TRANSLATION_ENDPOINT'));
    expect(endpointLine).toBeDefined();
    expect(endpointLine).toMatch(/vllm-translation-guardrail/);
  });
});
