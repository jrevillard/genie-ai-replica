// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Story 8-6 (2026-10-23) — the RAGAS attribution EVIDENCE layer.
//
// The bug these tests exist for: the failure-attribution matrix decided
// "the expected passage is not retrievable" (=> "re-curate the concept")
// from data that could not support it. The run stored 24 candidate KEYS
// but only 8 candidate TEXTS truncated to 200 chars, and the matrix
// matched an 80-char prefix against those 8. Both discards bias the same
// way — toward "not found" — so content that was already indexed was
// reported as missing, and 18 of 29 live failures became phantom
// content-curation work.
//
// These tests pin the evidence rules that replace it:
//   * a passage is located by CONTAINMENT (an 8-word needle) plus a
//     SPECIFICITY check (token coverage), never by one brittle probe;
//   * "was it a candidate / was it selected" is KEY membership — exact;
//   * a passage that cannot be found is reported as such, and never
//     silently as "corpus gap" when the probe was merely too strict.
//
// Arango is mocked; the corpus is a small in-memory set.

jest.mock('../shared-lib/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }
}));
jest.mock('../services/frontmatter-service', () => ({
  teiEmbed: jest.fn(async () => [[0.1, 0.2, 0.3]])
}));

const svc = require('../services/ragas-attribution-service');

// A chunk whose text is long enough that an 8-word needle fits inside it,
// and which shares the document boilerplate with the other chunks — the
// shape that made the old coverage metric suspicious.
function chunk(key, body) {
  return {
    key,
    text: `This document, titled "Boletin Centa Maiz", focuses on the topic of maize production in El Salvador. ${body}`
  };
}

const CORPUS = [
  chunk(
    'k-maize',
    'Maize sowing recommendations depend on the rainfall regime and the altitude of the plot in question.'
  ),
  chunk('k-frost', 'Tomatoes are planted after the last frost date has passed in the highlands of the country.'),
  chunk(
    'k-legal',
    'Legal aid income criteria are applied per household and are reviewed every fiscal year by the ministry.'
  )
];

// A db stub: the corpus probe is ONE AQL scan returning the chunks whose
// text contains any needle.
function mockDb(corpus = CORPUS) {
  return {
    query: jest.fn(async (aql, bind) => {
      const needles = (bind && bind.probes) || [];
      const rows = [];
      for (const c of corpus) {
        const lc = c.text.toLowerCase();
        const hits = needles.filter((p) => lc.includes(p.needle)).map((p) => p.pid);
        if (hits.length) rows.push({ key: c.key, text: c.text, hits });
      }
      return { all: async () => rows };
    })
  };
}

const MAIZE_PASSAGE =
  'Maize sowing recommendations depend on the rainfall regime and the altitude of the plot in question.';

describe('ragas attribution evidence', () => {
  it('locates a passage by containment + coverage and reports the carrier chunk', async () => {
    const db = mockDb();
    const ev = await svc.collectEvidence(db, {
      rows: [{ id: 'new-1', query: 'q', passages: [MAIZE_PASSAGE] }],
      graphs: ['G']
    });
    const row = ev.byRow.get('new-1');
    expect(row.passages).toBe(1);
    expect(row.corpus_hits).toBe(1);
    expect(row.carriers[0].present).toBe(true);
    const carriers = row.carriers[0].chunks;
    expect(carriers.length).toBeGreaterThan(0);
    // The carrier must be the chunk that ACTUALLY carries the passage —
    // not another chunk of the same document that shares the boilerplate.
    expect(carriers[0].key).toBe('k-maize');
    expect(carriers[0].coverage).toBeGreaterThanOrEqual(svc.COVERAGE_MIN);
  });

  it('does not report a passage as present when only the boilerplate matches', async () => {
    // The passage shares the document preamble with k-frost but its BODY is
    // absent from the corpus. The old matrix called this "the content is
    // missing" — the whole point of the coverage filter is that a chunk
    // holding only the preamble is NOT a carrier.
    const db = mockDb();
    const ev = await svc.collectEvidence(db, {
      rows: [
        {
          id: 'new-1',
          query: 'q',
          passages: [
            'Sorghum planting in the dry corridor follows a calendar that is entirely unlike the maize cycle described above.'
          ]
        }
      ],
      graphs: ['G']
    });
    const row = ev.byRow.get('new-1');
    // The body is not in the corpus, so there is no carrier...
    expect(row.corpus_hits).toBe(0);
    // ...and the passage matched no needle at all, so nothing was even
    // a candidate carrier. The evidence records the method so the verdict
    // can be audited rather than taken on trust.
    expect(ev.method).toContain('containment');
    expect(row.carriers[0].chunks.length).toBe(0);
  });

  it('does not mistake a boilerplate match for the passage being present', async () => {
    // The corpus chunk carries the same DOCUMENT PREAMBLE as the passage
    // (every chunk of a document starts the same way), so a needle that
    // lands in the preamble matches. The passage's actual BODY is absent.
    // Counting the preamble as coverage would report the passage as
    // present — the false positive that turns a real corpus gap into a
    // silent "retrieval" verdict.
    const preamble =
      'This document, titled "Boletin Centa Maiz", focuses on the topic of maize production in El Salvador.';
    const db = mockDb([
      { key: 'k-other', text: `${preamble} The beans were harvested in the second semester of the year.` }
    ]);
    const ev = await svc.collectEvidence(db, {
      rows: [
        {
          id: 'new-1',
          query: 'q',
          passages: [
            `${preamble} Sorghum planting in the dry corridor follows a calendar that is entirely unlike the maize cycle described above.`
          ]
        }
      ],
      graphs: ['G']
    });
    const row = ev.byRow.get('new-1');
    // The preamble matched (so the probe DID look at this chunk)...
    expect(row.carriers[0].chunks.length).toBeGreaterThan(0);
    // ...but the passage is not present: the preamble alone is not the
    // passage, and reporting it as present would hide a real corpus gap.
    expect(row.carriers[0].present).toBe(false);
    expect(row.corpus_hits).toBe(0);
  });

  it('finds a passage whose window straddles a chunk boundary', async () => {
    // miss it (the 12-word needle used to report FALSE ABSENCES for 17 of
    // 29 live rows); the sliding window must find it.
    const a = 'Maize sowing recommendations depend on the rainfall regime';
    const b = 'and on the altitude of the plot in question and on drainage.';
    const db = mockDb([chunk('k-a', `${a}`), chunk('k-b', `${b}`)]);
    const ev = await svc.collectEvidence(db, {
      rows: [{ id: 'new-1', query: 'q', passages: [`${a} ${b}`] }],
      graphs: ['G']
    });
    const row = ev.byRow.get('new-1');
    expect(row.corpus_hits).toBe(1);
  });

  it('reports a passage absent from the corpus as absent (0 carriers)', async () => {
    const db = mockDb();
    const ev = await svc.collectEvidence(db, {
      rows: [
        {
          id: 'new-1',
          query: 'q',
          passages: [
            'Completely unrelated text about the municipal budget cycle and its quarterly reporting deadlines.'
          ]
        }
      ],
      graphs: ['G']
    });
    const row = ev.byRow.get('new-1');
    expect(row.corpus_hits).toBe(0);
    expect(row.carriers[0].chunks.length).toBe(0);
  });

  it('keeps the probe method on the evidence so a verdict can be audited', async () => {
    const db = mockDb();
    const ev = await svc.collectEvidence(db, {
      rows: [{ id: 'new-1', query: 'q', passages: [MAIZE_PASSAGE] }],
      graphs: ['G']
    });
    expect(ev.method).toContain('containment');
    expect(ev.method).toContain('coverage');
    expect(ev.byRow.get('new-1').matched_chunks).toBeGreaterThan(0);
  });

  it('degrades to no carriers when the corpus cannot be read, instead of throwing', async () => {
    const db = {
      query: jest.fn(async () => {
        throw new Error('collection not found');
      })
    };
    const ev = await svc.collectEvidence(db, {
      rows: [{ id: 'new-1', query: 'q', passages: [MAIZE_PASSAGE] }],
      graphs: ['G']
    });
    expect(ev.byRow.get('new-1').corpus_hits).toBe(0);
  });

  it('needs no needles for a passage shorter than the window', () => {
    expect(svc.needlesFor('too short')).toEqual([]);
    expect(svc.needlesFor('one two three four five six seven eight').length).toBe(1);
  });

  describe('candidate-rank probe', () => {
    it('reports the carrier rank when the vector search finds it', async () => {
      const db = {
        query: jest.fn(async () => ({
          all: async () => [
            { key: 'k-a', score: 0.9 },
            { key: 'k-b', score: 0.5 }
          ]
        }))
      };
      const rank = await svc.probeCandidateRank(db, {
        graphs: ['G'],
        query: 'q',
        carrierKey: 'k-b'
      });
      expect(rank.rank).toBe(2);
      expect(rank.searched).toBe(2);
      expect(rank.caveat).toBeTruthy();
    });

    it('returns null (not a throw) when the embedding fails', async () => {
      const frontmatter = require('../services/frontmatter-service');
      frontmatter.teiEmbed.mockImplementationOnce(async () => {
        throw new Error('TEI down');
      });
      const rank = await svc.probeCandidateRank({ query: jest.fn() }, { graphs: ['G'], query: 'q', carrierKey: 'k-a' });
      expect(rank).toBeNull();
    });

    it('returns null when the carrier is not in the searched range', async () => {
      const db = {
        query: jest.fn(async () => ({ all: async () => [{ key: 'k-z', score: 0.9 }] }))
      };
      const rank = await svc.probeCandidateRank(db, { graphs: ['G'], query: 'q', carrierKey: 'k-a' });
      expect(rank).toBeNull();
    });
  });
});
