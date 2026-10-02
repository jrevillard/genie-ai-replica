'use strict';
/**
 * Step-7 validation service tests (#1030 + #1036): the unified issue list
 * (conformance / orphans / near-duplicates / citations) and the citation
 * hub wiring — hub generation through the import pipeline + frontmatter
 * links[] appends through patchConceptFields.
 */

jest.mock('../shared-lib/db-connection-service', () => {
  const mockDb = require('./mocks/arango-mock').createMockDb();
  return { getConnection: jest.fn(() => Promise.resolve(mockDb)), __mockDb: mockDb };
});
jest.mock('../services/concept-meta-service', () => ({
  patchConceptFields: jest.fn(async () => ({}))
}));
jest.mock('../services/ingest-service', () => ({
  ingestRepoConcepts: jest.fn(async () => ({ total: 1, created: 1, summary: {} }))
}));
jest.mock('../services/repository-service', () => ({
  getById: jest.fn(async () => ({ repo_id: 'repo-1', lifecycle_state: 'draft', version: null }))
}));

const db = require('../shared-lib/db-connection-service').__mockDb;
const conceptMeta = require('../services/concept-meta-service');
const ingestService = require('../services/ingest-service');
const validationService = require('../services/validation-service');

function row(over = {}) {
  return {
    concept_id: 'c1',
    title: 'C1',
    is_index: false,
    links: [],
    issues: [],
    sources: null,
    body_head: '',
    body_len: 0,
    ...over
  };
}

describe('computeReport — orphans (#1036 Class A)', () => {
  test('a page with no links out and none in is an orphan; linked pages are not', () => {
    const report = validationService.computeReport([
      row({ concept_id: 'index', links: [{ to_concept_id: 'a' }] }),
      row({ concept_id: 'a', links: [{ to_concept_id: 'b' }] }),
      row({ concept_id: 'b', links: [] }),
      row({ concept_id: 'lonely', links: [] })
    ]);
    const orphans = report.issues.filter((i) => i.type === 'orphan').map((i) => i.concept_id);
    expect(orphans).toEqual(['lonely']);
    expect(orphans).not.toContain('b'); // b has no OUT but HAS in — reachable
    for (const i of report.issues) expect(i.remedy).toBeTruthy(); // #1030 bar
  });

  test('a page linking only to itself counts as an orphan (self-loops are dropped)', () => {
    const report = validationService.computeReport([row({ concept_id: 's', links: [{ to_concept_id: 's' }] })]);
    expect(report.issues.filter((i) => i.type === 'orphan')).toHaveLength(1);
  });
});

describe('computeReport — near-duplicates (#1036 Class B)', () => {
  const filler = (seed) =>
    (seed + ' The clinical management of noncommunicable diseases requires continuous attention.').repeat(40);

  test('near-identical bodies group; distinct content does not', () => {
    const base = filler('alpha');
    const rows = [
      row({ concept_id: 'set-1', body_head: base, body_len: base.length }),
      row({ concept_id: 'set-2', body_head: base.replace('alpha', 'beta'), body_len: base.length }),
      row({ concept_id: 'other', body_head: filler('completely different content about maritime law'), body_len: 1400 })
    ];
    const groups = validationService.findNearDuplicateGroups(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0].sort()).toEqual(['set-1', 'set-2']);
  });

  test('short bodies are never compared (too small to judge)', () => {
    const report = validationService.computeReport([
      row({ concept_id: 'x1', body_head: 'tiny', body_len: 4 }),
      row({ concept_id: 'x2', body_head: 'tiny', body_len: 4 })
    ]);
    expect(report.issues.filter((i) => i.type === 'near_duplicate')).toHaveLength(0);
  });
});

describe('computeReport — citations (#1036 Option 2)', () => {
  test('citing pages with no hub → one issue, hub_concept_id null', () => {
    const report = validationService.computeReport([
      row({ concept_id: 'a', sources: [{ id: 's1', resource: 'https://x' }] }),
      row({ concept_id: 'b', sources: [{ id: 's2', resource: 'https://y' }] }),
      row({ concept_id: 'plain' })
    ]);
    const cit = report.issues.find((i) => i.type === 'citation');
    expect(cit).toBeTruthy();
    expect(cit.hub_concept_id).toBeNull();
    expect(report.citations.citing.sort()).toEqual(['a', 'b']);
  });

  test('a bundled sources page is detected as the hub; unlinked citing pages counted', () => {
    const rows = [
      row({ concept_id: 'who-sources', title: 'WHO Primary Sources Used in this Bundle', links: [] }),
      row({
        concept_id: 'a',
        sources: [{ id: 's1' }],
        links: [{ to_concept_id: 'who-sources', label: 'Sources' }]
      }),
      row({ concept_id: 'b', sources: [{ id: 's2' }], links: [] })
    ];
    const report = validationService.computeReport(rows);
    const cit = report.issues.find((i) => i.type === 'citation');
    expect(cit.hub_concept_id).toBe('who-sources');
    expect(report.citations.needing_link).toEqual(['b']);
  });

  test('no issue when every citing page already links to the hub', () => {
    const rows = [
      row({ concept_id: 'sources', title: 'Sources' }),
      row({
        concept_id: 'a',
        sources: [{ id: 's1' }],
        links: [{ to_concept_id: 'sources' }]
      })
    ];
    expect(validationService.computeReport(rows).issues.filter((i) => i.type === 'citation')).toHaveLength(0);
  });
});

describe('computeReport — conformance mapping', () => {
  test('blocker codes map to blocker severity; remedy always present', () => {
    const report = validationService.computeReport([
      row({ concept_id: 'c1', issues: [{ code: 'MISSING_TYPE', message: 'no type' }] }),
      row({ concept_id: 'c2', issues: [{ code: 'UNPARSEABLE_STALE_AFTER', message: 'bad date' }] })
    ]);
    const byCode = Object.fromEntries(report.issues.map((i) => [i.code, i]));
    expect(byCode.MISSING_TYPE.severity).toBe('blocker');
    expect(byCode.UNPARSEABLE_STALE_AFTER.severity).toBe('warning');
  });
});

describe('wireCitationHub', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db._reset();
    db.query.mockReset();
  });

  function mockRows(rows) {
    db.query.mockImplementation(async () => ({ all: async () => rows }));
  }

  test('generates the hub through the import pipeline when missing, then wires citing pages', async () => {
    mockRows([
      {
        concept_id: 'a',
        title: 'A',
        links: [],
        sources: [{ id: 's1', title: 'WHO fact sheet', resource: 'https://who/x' }],
        fm_links: []
      },
      {
        concept_id: 'b',
        title: 'B',
        links: [],
        sources: [{ id: 's2', title: 'PEN', resource: 'https://who/pen' }],
        fm_links: []
      },
      { concept_id: 'plain', title: 'P', links: [], sources: null, fm_links: [] }
    ]);
    const result = await validationService.wireCitationHub('repo-1', { actor: { sub: 'steward' } });

    expect(result.hub_created).toBe(true);
    expect(result.hub_concept_id).toBe('sources');
    expect(result.wired).toBe(2);
    // Hub born through the SAME import pipeline (skipCuration — no label pass).
    expect(ingestService.ingestRepoConcepts).toHaveBeenCalledTimes(1);
    const call = ingestService.ingestRepoConcepts.mock.calls[0];
    expect(call[1].skipCuration).toBe(true);
    expect(call[1].concepts[0].concept_id).toBe('sources');
    expect(call[1].concepts[0].body).toContain('WHO fact sheet');
    // Frontmatter links[] appends through patchConceptFields — born right.
    expect(conceptMeta.patchConceptFields).toHaveBeenCalledTimes(2);
    expect(conceptMeta.patchConceptFields.mock.calls[0][2]).toEqual({
      frontmatterPatch: { links: [{ target: 'sources.md', label: 'Sources' }] }
    });
  });

  test('wires to an EXISTING hub (explicit) without creating one; skips already-linked', async () => {
    mockRows([
      { concept_id: 'who-sources', title: 'Sources', links: [], sources: null, fm_links: [] },
      {
        concept_id: 'a',
        title: 'A',
        links: [{ to_concept_id: 'who-sources' }],
        sources: [{ id: 's1' }],
        fm_links: [{ target: 'who-sources.md', label: 'Sources' }]
      },
      { concept_id: 'b', title: 'B', links: [], sources: [{ id: 's2' }], fm_links: [{ target: 'other.md' }] }
    ]);
    const result = await validationService.wireCitationHub('repo-1', { hub_concept_id: 'who-sources' });

    expect(result.hub_created).toBe(false);
    expect(ingestService.ingestRepoConcepts).not.toHaveBeenCalled();
    expect(result.already_linked).toBe(1);
    expect(result.wired).toBe(1);
    // The existing fm link is PRESERVED (array replaced whole — send merged).
    expect(conceptMeta.patchConceptFields.mock.calls[0][2]).toEqual({
      frontmatterPatch: { links: [{ target: 'other.md' }, { target: 'who-sources.md', label: 'Sources' }] }
    });
  });
});

describe('proposeLinks (llm-curation-service)', () => {
  const axios = require('axios');
  jest.mock('axios');

  beforeEach(() => {
    jest.clearAllMocks();
    db._reset();
    db.query.mockReset();
    process.env.VLLM_ENDPOINT = 'https://llm.test';
    process.env.VLLM_MODEL_ID = 'test-model';
  });

  test('validates targets against the repo catalog; drops self/linked/invented', async () => {
    const repo = { repo_id: 'r1' };
    db.query.mockImplementation(async (query) => {
      const q = String(query || '');
      if (q.includes('m.concept_id == @c')) {
        return {
          all: async () => [
            {
              concept_id: 'lonely',
              title: 'Lonely',
              body: 'Talks about PEN and stroke care.',
              links: [{ to_concept_id: 'existing' }]
            }
          ]
        };
      }
      return {
        all: async () => [
          { id: 'who-pen', title: 'PEN package' },
          { id: 'stroke', title: 'Stroke' },
          { id: 'existing', title: 'Existing' }
        ]
      };
    });
    axios.post.mockResolvedValueOnce({
      data: {
        choices: [
          {
            message: {
              content: JSON.stringify({
                links: [
                  { to_concept_id: 'who-pen', label: 'PEN package' },
                  { to_concept_id: 'invented-id', label: 'Fake' },
                  { to_concept_id: 'existing', label: 'Dup' },
                  { to_concept_id: 'lonely', label: 'Self' }
                ]
              })
            }
          }
        ]
      }
    });

    const { proposeLinks } = require('../services/llm-curation-service');
    const result = await proposeLinks(repo, 'lonely');
    expect(result.proposals).toEqual([{ to_concept_id: 'who-pen', label: 'PEN package', title: 'PEN package' }]);
  });

  test('fail-soft: an LLM error returns empty proposals, never throws', async () => {
    db.query.mockImplementation(async (query) => {
      const q = String(query || '');
      if (q.includes('m.concept_id == @c'))
        return { all: async () => [{ concept_id: 'l', title: 'L', body: 'b', links: [] }] };
      return { all: async () => [{ id: 'p1', title: 'P1' }] };
    });
    axios.post.mockRejectedValueOnce(new Error('llm down'));
    const { proposeLinks } = require('../services/llm-curation-service');
    const result = await proposeLinks({ repo_id: 'r1' }, 'l');
    expect(result.proposals).toEqual([]);
    expect(result.error).toContain('llm down');
  });
});
