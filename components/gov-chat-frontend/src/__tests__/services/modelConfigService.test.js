// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// The model-configuration LIST envelope.
//
// David 2026-10-25: "you removed the model selection from the RAGAS
// generation and benchmarking ... make sure it INCLUDES the default
// configured model from the .env as an OPTION."
//
// The service used to return `body.configs` — the array alone — dropping
// `env_judge` and `env_pick`. The store action spread that array into an
// object, so the result had neither `configs` nor `env_judge`: the RAGAS
// judge dropdown rendered nothing at all (for the admin too), and the
// Admin Dashboard's Models tab was blank.
//
// The panel tests could not see this: they mock the STORE with the full
// envelope, so they asserted against a shape the real service never
// produced. The seam has to be pinned where the defect was.

import modelConfigService from '@/services/modelConfigService';
import httpService from '@/services/httpService';

jest.mock('@/services/httpService', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() }
}));

const ENVELOPE = {
  configs: [
    { _key: 'mc1', name: 'GLM-5.3 Flash ITU - OpenAI', active: true },
    { _key: 'mc2', name: 'Minimax David OpenAI', active: false }
  ],
  env_judge: { base_url: 'https://ai.assembly.govstack.global:444/llm/v1', model: 'ibm-granite/granite-4.1-8b' },
  env_pick: '__env__'
};

beforeEach(() => {
  jest.clearAllMocks();
  httpService.get.mockResolvedValue({ data: ENVELOPE });
});

describe('modelConfigService.list', () => {
  it('returns the WHOLE envelope — the array alone is what blanked the UI', async () => {
    const out = await modelConfigService.list();
    expect(out.configs).toEqual(ENVELOPE.configs);
    expect(out.env_judge).toEqual(ENVELOPE.env_judge);
    expect(out.env_pick).toBe('__env__');
  });

  it('never loses the env judge when the configuration list is empty', async () => {
    httpService.get.mockResolvedValue({ data: { configs: [], env_judge: ENVELOPE.env_judge, env_pick: '__env__' } });
    const out = await modelConfigService.list();
    expect(out.configs).toEqual([]);
    expect(out.env_judge.model).toBe('ibm-granite/granite-4.1-8b');
  });

  it('degrades to an empty envelope, never to undefined fields', async () => {
    httpService.get.mockResolvedValue({});
    const out = await modelConfigService.list();
    expect(out).toEqual({ configs: [], env_judge: null, env_pick: null });
  });
});
