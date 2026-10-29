// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
//
// 2026-10-19 field report: the advisor auto-load's silent flag was passed in
// httpService.get's PARAMS slot — it leaked onto the wire as ?silent=true and
// never reached error.config.silent, so the expected 404 still logged
// [OKF-ERR]. This pins the wire shape: silent is an axios OPTION (third
// argument), the same convention as the crawl-job lookups.

import ragasService from '@/services/ragasService';
import httpService from '@/services/httpService';

jest.mock('@/services/httpService', () => ({
  __esModule: true,
  default: { get: jest.fn(async () => ({ data: null })) }
}));

describe('ragasService.getExplain silent wiring', () => {
  beforeEach(() => jest.clearAllMocks());

  it('silent rides the axios OPTIONS slot, never the query params', async () => {
    await ragasService.getExplain('repo', 'suite', 'run-key', { silent: true });
    const [url, params, options] = httpService.get.mock.calls[0];
    expect(url).toContain('/explain/run-key');
    expect(url).not.toContain('silent');
    expect(params).toEqual({});
    expect(options).toEqual({ silent: true });
  });

  it('non-silent callers pass no silent option at all', async () => {
    await ragasService.getExplain('repo', 'suite', 'run-key');
    const [, , options] = httpService.get.mock.calls[0];
    expect(options).toBeUndefined();
  });
});
