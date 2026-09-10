'use strict';

/**
 * SUBJECT AREAS follow the Knowledge Hierarchy Categories (David,
 * 2026-09-04) — loadSubjectAreaOptions contract:
 *   - options come from the CATEGORY level of the curated tree,
 *   - 'general' is the fallback ONLY when the hierarchy is unreachable or
 *     empty (never a listed option when the tree loads),
 *   - legacy repo domains missing from the KH list are appended as
 *     "X (legacy)" so filters never orphan existing repos.
 */

jest.mock('@/services/serviceTreeService', () => ({
  __esModule: true,
  default: { getAdminCategories: jest.fn() }
}));

const serviceTreeService = require('@/services/serviceTreeService').default;
const { loadSubjectAreaOptions } = require('@/services/okfRepoOps');

const KH = [
  { name: 'Water Supply', children: [{ name: 'Pipes' }] },
  { nameEN: 'Health Services', children: [] },
  { children: [{ name: 'orphan' }] } // nameless category — skipped
];

beforeEach(() => {
  jest.clearAllMocks();
});

it('maps the CATEGORY level to options (KH names as values, display as labels)', async () => {
  serviceTreeService.getAdminCategories.mockResolvedValueOnce(KH);
  const opts = await loadSubjectAreaOptions([]);
  expect(opts).toEqual([
    { value: 'Water Supply', label: 'Water Supply' },
    { value: 'Health Services', label: 'Health Services' }
  ]);
  expect(serviceTreeService.getAdminCategories).toHaveBeenCalledWith('en');
});

it("'general' is the fallback ONLY when the hierarchy is unreachable", async () => {
  serviceTreeService.getAdminCategories.mockRejectedValueOnce(new Error('down'));
  const opts = await loadSubjectAreaOptions(['transport']);
  expect(opts).toEqual([{ value: 'general', label: 'General' }]);
});

it("'general' is the fallback when the tree loads empty", async () => {
  serviceTreeService.getAdminCategories.mockResolvedValueOnce([]);
  const opts = await loadSubjectAreaOptions();
  expect(opts).toEqual([{ value: 'general', label: 'General' }]);
});

it('legacy repo domains missing from the KH list are appended as (legacy)', async () => {
  serviceTreeService.getAdminCategories.mockResolvedValueOnce(KH);
  const opts = await loadSubjectAreaOptions(['transport', 'water supply', 'health', 'agriculture']);
  // Matching is EXACT: 'water supply' ≠ 'Water Supply', 'health' ≠
  // 'Health Services' — all four are legacy. Nothing is silently dropped.
  const legacy = opts.filter((o) => o.label.endsWith('(legacy)')).map((o) => o.value);
  expect(legacy).toEqual(['transport', 'water supply', 'health', 'agriculture']);
  // KH options stay first, in tree order, untouched
  expect(opts[0]).toEqual({ value: 'Water Supply', label: 'Water Supply' });
});

it('a KH-listed domain is NOT duplicated as legacy', async () => {
  serviceTreeService.getAdminCategories.mockResolvedValueOnce(KH);
  const opts = await loadSubjectAreaOptions(['Water Supply']);
  expect(opts.filter((o) => o.value === 'Water Supply')).toHaveLength(1);
});
