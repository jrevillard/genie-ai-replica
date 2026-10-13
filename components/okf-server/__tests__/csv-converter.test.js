// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// CSV → OKF import (David 2026-10-12: "import CSV files into an OKF repository
// as tabular markdown data WITH TOPICS"). Covers the four things that actually
// break this path: RFC-4180 parsing correctness, the FR-42 concept shape
// (dictionary + capped row-groups + links), the loud-reject discipline, and the
// topic stamp — plus the two converter bugs this work fixed, which are
// asserted on RENDERED VALUES because structural-only assertions are exactly
// why they survived.

jest.mock('../shared-lib/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }
}));

const { convertCsv, parseCsv, dictionaryForTopics } = require('../services/converters/csvSheetConverter');
const { convertXlsx } = require('../services/converters/xlsxSheetConverter');
const { inferType, cellText } = require('../services/converters/tableConcepts');
const { parseTopics, normalizeTopics } = require('../services/converters/csvTopicsService');
const { logger } = require('../shared-lib/logger');
const XLSX = require('xlsx');

const META = {
  file_id: 'f9',
  file_name: 'market.csv',
  baseResource: 'http://document-repository:3001/api/files/f9'
};

const csv = (s) => Buffer.from(s, 'utf8');

/** Topic stub — the real summariser is exercised separately below against a
 * mocked vllmChatCompletions. */
const stubTopics =
  (topics = ['maize-production'], purpose = 'Records maize output by region.') =>
  async () => ({
    topics,
    purpose,
    source: 'llm'
  });

describe('csvSheetConverter — RFC-4180 parsing correctness', () => {
  it('keeps a quoted delimiter inside its field', () => {
    expect(parseCsv(csv('a,b\n"x, y",2\n')).grid).toEqual([
      ['a', 'b'],
      ['x, y', 2]
    ]);
  });

  it('unescapes a doubled quote ("" -> ")', () => {
    expect(parseCsv(csv('a,b\n"c""d",2\n')).grid).toEqual([
      ['a', 'b'],
      ['c"d', 2]
    ]);
  });

  it('keeps a newline embedded inside a quoted field', () => {
    expect(parseCsv(csv('a,b\n"line1\nline2",2\n')).grid).toEqual([
      ['a', 'b'],
      ['line1\nline2', 2]
    ]);
  });

  it('strips a UTF-8 BOM from the first header', () => {
    const grid = parseCsv(csv('﻿region,amount\nnorth,1\n')).grid;
    expect(grid[0][0]).toBe('region');
  });

  it('parses CRLF line endings', () => {
    expect(parseCsv(csv('a,b\r\n1,2\r\n')).grid).toEqual([
      ['a', 'b'],
      [1, 2]
    ]);
  });

  it('sniffs a semicolon delimiter (European export) rather than one wide column', () => {
    const grid = parseCsv(csv('name;amount\nnorth;100\n')).grid;
    expect(grid[0]).toEqual(['name', 'amount']);
    expect(grid[1]).toEqual(['north', 100]);
  });

  it('sniffs a tab delimiter', () => {
    expect(parseCsv(csv('a\tb\n1\t2\n')).grid).toEqual([
      ['a', 'b'],
      [1, 2]
    ]);
  });

  it('widens the grid so a short row never shifts a column', () => {
    // SheetJS sizes every row to the widest row in the file, so the header
    // gains a 4th column and the short row is null-padded — the invariant
    // that matters is that column 2 of the short row still reads as column 2.
    const grid = parseCsv(csv('a,b,c\n1,2\n3,4,5,6\n')).grid;
    expect(grid[1].slice(0, 3)).toEqual([1, 2, null]);
    expect(grid[1][0]).toBe(1);
    expect(grid[1][1]).toBe(2);
  });
});

describe('csvSheetConverter — FR-42 concept shape', () => {
  it('emits ONE dictionary concept + capped row-groups that link back to it', async () => {
    const rows = ['Region,Amount', ...Array.from({ length: 25 }, (_, i) => `R${i},${i}`)].join('\n');
    const { concepts, sheets } = await convertCsv(csv(rows), META, { deriveTopics: stubTopics() });

    expect(sheets[0]).toMatchObject({ rows: 25 });
    const dict = concepts.find((c) => c.frontmatter.type === 'data-dictionary');
    expect(dict).toBeTruthy();
    expect(dict.path).toBe('market-dictionary.md'); // basename slug, NOT "sheet1"
    expect(dict.body).toContain('| Region |');

    const data = concepts.filter((c) => c.frontmatter.type === 'dataset');
    expect(data.length).toBe(1); // 25 rows < 200 → one group
    expect(data[0].path).toBe('market-rows.md');
    expect(data[0].frontmatter.links[0].to_concept_id).toBe('market-dictionary');
    expect(data[0].body).toContain('| R0 |');
    expect(data[0].frontmatter.sources[0].locator).toContain('table "market"');
  });

  it('splits into MULTIPLE row-groups past the cap, each with its own path', async () => {
    const rows = ['a', ...Array.from({ length: 450 }, (_, i) => String(i))].join('\n');
    const { concepts } = await convertCsv(csv(rows), META, { deriveTopics: stubTopics() });
    const data = concepts.filter((c) => c.frontmatter.type === 'dataset');
    expect(data.length).toBe(3); // 200 + 200 + 50
    const paths = data.map((c) => c.path);
    expect(new Set(paths).size).toBe(3); // no path collision between groups
  });

  it('honours OKF_CSV_ROWS_PER_CONCEPT and clamps it to the 10..500 band', async () => {
    const rows = ['a', ...Array.from({ length: 40 }, (_, i) => String(i))].join('\n');
    const prev = process.env.OKF_CSV_ROWS_PER_CONCEPT;
    try {
      process.env.OKF_CSV_ROWS_PER_CONCEPT = '10';
      const low = await convertCsv(csv(rows), META, { deriveTopics: stubTopics() });
      expect(low.concepts.filter((c) => c.frontmatter.type === 'dataset').length).toBe(4);

      // Below the floor → clamped up to 10, not honoured at 1.
      process.env.OKF_CSV_ROWS_PER_CONCEPT = '1';
      const clampedLow = await convertCsv(csv(rows), META, { deriveTopics: stubTopics() });
      expect(clampedLow.concepts.filter((c) => c.frontmatter.type === 'dataset').length).toBe(4);

      // Above the ceiling → clamped down to 500.
      process.env.OKF_CSV_ROWS_PER_CONCEPT = '99999';
      const clampedHigh = await convertCsv(csv(rows), META, { deriveTopics: stubTopics() });
      expect(clampedHigh.concepts.filter((c) => c.frontmatter.type === 'dataset').length).toBe(1);
    } finally {
      if (prev === undefined) delete process.env.OKF_CSV_ROWS_PER_CONCEPT;
      else process.env.OKF_CSV_ROWS_PER_CONCEPT = prev;
    }
  });

  it('stamps sources on EVERY concept (dictionary AND each row-group)', async () => {
    const rows = ['Region,Amount', ...Array.from({ length: 25 }, (_, i) => `R${i},${i}`)].join('\n');
    const { concepts } = await convertCsv(csv(rows), META, { deriveTopics: stubTopics() });
    expect(concepts.length).toBeGreaterThan(1);
    for (const c of concepts) {
      expect(c.frontmatter.sources[0]).toMatchObject({
        kind: 'document',
        resource: META.baseResource,
        file_id: META.file_id,
        file_name: META.file_name
      });
    }
  });

  it('RENDERS cell values — pipes escaped, no raw delimiter breaking the table', async () => {
    const { concepts } = await convertCsv(csv('Name,Note\n"a|b","has, comma"\n'), META, {
      deriveTopics: stubTopics()
    });
    const data = concepts.find((c) => c.frontmatter.type === 'dataset');
    expect(data.body).toContain('a\\|b'); // pipe escaped, table not broken
    expect(data.body).toContain('has, comma');
  });

  it('labels the table by file basename, never the synthetic Sheet1', async () => {
    const { concepts, sheets } = await convertCsv(csv('a,b\n1,2\n'), META, { deriveTopics: stubTopics() });
    expect(sheets[0].name).toBe('market');
    for (const c of concepts) {
      expect(c.path).not.toMatch(/sheet1/);
      expect(JSON.stringify(c.frontmatter)).not.toMatch(/Sheet1/);
    }
  });
});

describe('csvSheetConverter — loud reject (never a silent empty concept)', () => {
  it('throws CSV_NO_DATA on a header-only file', async () => {
    await expect(convertCsv(csv('a,b\n'), META, { deriveTopics: stubTopics() })).rejects.toMatchObject({
      code: 'CSV_NO_DATA'
    });
  });

  it('throws CSV_NO_DATA on a completely empty file', async () => {
    await expect(convertCsv(csv(''), META, { deriveTopics: stubTopics() })).rejects.toMatchObject({
      code: 'CSV_NO_DATA'
    });
  });

  it('throws CSV_NO_DATA on a blank-lines-only file', async () => {
    await expect(convertCsv(csv('\n\n\n'), META, { deriveTopics: stubTopics() })).rejects.toMatchObject({
      code: 'CSV_NO_DATA'
    });
  });

  it('throws CSV_UNREADABLE on a buffer that is not text at all', async () => {
    // 0x00-heavy binary: not text, not a zip/xlsx container. SheetJS would
    // "parse" it as one garbage column rather than throwing, so the converter
    // guards on NUL bytes and names the real problem.
    await expect(convertCsv(Buffer.from([0, 1, 2, 0, 255, 254, 0, 0]), META, {})).rejects.toMatchObject({
      code: 'CSV_UNREADABLE'
    });
  });

  it('does not double-wrap its own binary-guard message', async () => {
    await expect(convertCsv(Buffer.from([0, 1, 2, 0, 255, 254, 0, 0]), META, {})).rejects.toThrow(
      /^unreadable csv \(binary content/
    );
  });

  it('logs the rejection rather than failing silently', async () => {
    logger.warn.mockClear();
    await expect(convertCsv(csv(''), META, { deriveTopics: stubTopics() })).rejects.toThrow();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('loud-rejected'), expect.any(Object));
  });
});

describe('csvSheetConverter — topics (David: tabular data WITH topics)', () => {
  it('stamps the topic set and purpose on EVERY concept', async () => {
    const rows = ['Region,Amount', ...Array.from({ length: 25 }, (_, i) => `R${i},${i}`)].join('\n');
    const { concepts, topics } = await convertCsv(csv(rows), META, {
      deriveTopics: stubTopics(['maize-production', 'regional-yields'], 'Records maize output by region.')
    });
    expect(topics.topics).toEqual(['maize-production', 'regional-yields']);
    for (const c of concepts) {
      expect(c.frontmatter.topic).toEqual(['maize-production', 'regional-yields']);
      expect(c.frontmatter.description).toBe('Records maize output by region.');
    }
  });

  it('hands the summariser the dictionary columns with type + sample', async () => {
    let seen = null;
    await convertCsv(csv('Region,Amount\nNorth,100\n'), META, {
      deriveTopics: async (args) => {
        seen = args;
        return { topics: ['t'], purpose: 'p', source: 'llm' };
      }
    });
    expect(seen.fileName).toBe('market.csv');
    expect(seen.columns).toEqual([
      { name: 'Region', type: 'text', sample: 'North' },
      { name: 'Amount', type: 'number', sample: '100' }
    ]);
  });

  it('pins the caller/service contract: columns is an ARRAY (a {headers} mismatch silently disabled the LLM)', async () => {
    // Regression pin. The converter passes `columns: <array>`; an earlier
    // version of deriveTopics read `dictionary.headers`, so it saw an empty
    // list and degraded to the filename slug on EVERY import — the LLM path
    // looked wired and never ran. Asserting the raw shape is what catches it.
    let seen = null;
    await convertCsv(csv('Region\nNorth\n'), META, {
      deriveTopics: async (args) => {
        seen = args;
        return { topics: ['t'], purpose: 'p', source: 'llm' };
      }
    });
    expect(Array.isArray(seen.columns)).toBe(true);
    expect(seen.columns.length).toBeGreaterThan(0);
  });

  it('imports successfully even when the summariser THROWS (import must not block on the LLM)', async () => {
    const { concepts } = await convertCsv(csv('Region,Amount\nNorth,100\n'), META, {
      deriveTopics: async () => {
        throw new Error('llm down');
      }
    });
    expect(concepts.length).toBe(2);
    for (const c of concepts) expect(c.frontmatter.topic).toBeUndefined();
  });

  it('falls back to the filename slug when the engine returns nothing usable', async () => {
    const { topics } = await convertCsv(csv('Region,Amount\nNorth,100\n'), META, {
      deriveTopics: async () => ({ topics: [], purpose: '', source: 'fallback-empty-topics' })
    });
    expect(topics.source).toBe('fallback-empty-topics');
  });
});

describe('csvTopicsService — response handling', () => {
  const originalEndpoint = process.env.VLLM_ENDPOINT;

  afterEach(() => {
    if (originalEndpoint === undefined) delete process.env.VLLM_ENDPOINT;
    else process.env.VLLM_ENDPOINT = originalEndpoint;
    jest.resetModules();
  });

  it('extracts JSON from a guided completion and tolerates a stray fence', () => {
    expect(parseTopics('```json\n{"topics":["a"],"purpose":"p"}\n```')).toEqual({
      topics: ['a'],
      purpose: 'p'
    });
  });

  it('returns null for an unparseable response rather than a half-trusted object', () => {
    expect(parseTopics('not json at all')).toBeNull();
    expect(parseTopics('{"topics":[')).toBeNull(); // truncated object
    expect(parseTopics('')).toBeNull();
    expect(parseTopics(null)).toBeNull();
  });

  it('normalizes to bounded kebab-case slugs, dropping junk and duplicates', () => {
    expect(normalizeTopics(['Maize Production!', 'maize-production', '', null, 42, 'Yields 2025'])).toEqual([
      'maize-production',
      'yields-2025'
    ]);
  });

  it('NEVER calls the LLM when VLLM_ENDPOINT is unset (no silent route to a local GPU)', async () => {
    delete process.env.VLLM_ENDPOINT;
    const called = jest.fn();
    jest.doMock('../services/frontmatter-service', () => ({ vllmChatCompletions: called }));
    const svc = require('../services/converters/csvTopicsService');
    const out = await svc.deriveTopics({ columns: [{ name: 'a', type: 'text', sample: 'x' }], fileName: 'x.csv' });
    expect(called).not.toHaveBeenCalled();
    expect(out.source).toBe('fallback-no-endpoint');
    expect(out.topics).toEqual(['x']); // filename slug
  });

  it('degrades to the filename slug when the LLM call throws', async () => {
    process.env.VLLM_ENDPOINT = 'https://gpu.example:444/llm';
    jest.doMock('../services/frontmatter-service', () => ({
      vllmChatCompletions: jest.fn(async () => {
        throw new Error('ECONNREFUSED');
      })
    }));
    const svc = require('../services/converters/csvTopicsService');
    const out = await svc.deriveTopics({ columns: [{ name: 'a', type: 'text', sample: 'x' }], fileName: 'yields.csv' });
    expect(out.source).toBe('fallback-llm-error');
    expect(out.topics).toEqual(['yields']);
  });

  it('returns LLM topics when the remote engine answers', async () => {
    process.env.VLLM_ENDPOINT = 'https://gpu.example:444/llm';
    jest.doMock('../services/frontmatter-service', () => ({
      vllmChatCompletions: jest.fn(async () => ({
        data: {
          choices: [
            {
              finish_reason: 'stop',
              message: { content: '{"topics":["maize-production"],"purpose":"Records maize output."}' }
            }
          ]
        }
      }))
    }));
    const svc = require('../services/converters/csvTopicsService');
    const out = await svc.deriveTopics({ columns: [{ name: 'Region', type: 'text', sample: 'N' }], fileName: 'm.csv' });
    expect(out).toMatchObject({ topics: ['maize-production'], purpose: 'Records maize output.', source: 'llm' });
  });
});

describe('tableConcepts — the two converter bugs fixed for CSV', () => {
  // These assert RENDERED VALUES, not just structure: the original bugs
  // produced structurally perfect concepts with 'empty' types and blank dates,
  // which structural assertions passed.
  it('inferType reads RAW primitives (sheet_to_json uses raw:true), not just {v,t} wrappers', () => {
    expect(inferType('North')).toBe('text');
    expect(inferType(100)).toBe('number');
    expect(inferType(true)).toBe('boolean');
    expect(inferType(new Date('2025-03-04'))).toBe('date');
    expect(inferType(null)).toBe('empty');
    expect(inferType({ v: 'North', t: 's' })).toBe('text'); // object form still works
  });

  it('cellText renders a Date (a Date is typeof object — the old branch read .v and returned "")', () => {
    expect(cellText(new Date('2025-03-04'))).toBe('2025-03-04');
    expect(cellText('plain')).toBe('plain');
    expect(cellText(42)).toBe('42');
    expect(cellText(null)).toBe('');
  });

  it('the CSV dictionary shows REAL inferred types, not "empty" for every column', async () => {
    const { concepts } = await convertCsv(csv('Region,Amount\nNorth,100\n'), META, {
      deriveTopics: stubTopics()
    });
    const dict = concepts.find((c) => c.frontmatter.type === 'data-dictionary');
    expect(dict.body).toContain('| Region | text | North |');
    expect(dict.body).toContain('| Amount | number | 100 |');
    expect(dict.body).not.toContain('| empty |');
  });

  it('infers number and boolean from a NATIVE xlsx cell (the raw-value branch)', async () => {
    // This is the exact path the inferType ordering bug broke: sheet_to_json
    // with {raw:true} hands back primitives, so a {v,t} -first guard read
    // 'empty' for every real cell.
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ['Amount', 'Active'],
        [100, true]
      ]),
      'S'
    );
    const { concepts } = convertXlsx(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }), {
      file_id: 'f',
      file_name: 'm.xlsx',
      baseResource: 'x'
    });
    const dict = concepts.find((c) => c.frontmatter.type === 'data-dictionary');
    expect(dict.body).toContain('| Amount | number | 100 |');
    expect(dict.body).toContain('| Active | boolean | true |');
  });
});

describe('convertXlsx — regression guard after the shared-core extraction', () => {
  it('still emits dictionary + row-groups with the dictionary link', () => {
    const wb = XLSX.utils.book_new();
    const rows = [['Region', 'Amount'], ...Array.from({ length: 25 }, (_, i) => [`R${i}`, i])];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Sales');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const { concepts, sheets } = convertXlsx(buf, {
      file_id: 'f9',
      file_name: 'market.xlsx',
      baseResource: 'http://document-repository:3001/api/files/f9'
    });
    expect(sheets[0]).toMatchObject({ name: 'Sales', rows: 25 });
    const dict = concepts.find((c) => c.frontmatter.type === 'data-dictionary');
    expect(dict.path).toBe('market-sales-dictionary.md');
    expect(dict.body).toContain('| Region |');
    const data = concepts.filter((c) => c.frontmatter.type === 'dataset');
    expect(data.length).toBe(1);
    expect(data[0].frontmatter.links[0].to_concept_id).toBe('market-sales-dictionary');
    expect(data[0].frontmatter.sources[0].locator).toContain('sheet "Sales"');
  });

  it('renders a real Date cell (was silently blank before the fix)', () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ['Region', 'Date'],
        ['North', new Date('2025-03-04')]
      ]),
      'Sales'
    );
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const { concepts } = convertXlsx(buf, { file_id: 'f', file_name: 'm.xlsx', baseResource: 'x' });
    const data = concepts.find((c) => c.frontmatter.type === 'dataset');
    expect(data.body).toContain('2025-03-04');
  });

  it('loud-rejects a workbook with no readable sheets', () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[]]), 'Empty');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    expect(() => convertXlsx(buf, { file_id: 'f', file_name: 'e.xlsx', baseResource: 'x' })).toThrow(
      /no readable sheets/
    );
  });
});

describe('dictionaryForTopics — column summary bounds', () => {
  it('caps the described columns so a wide export cannot blow the token budget', () => {
    const headers = Array.from({ length: 100 }, (_, i) => `c${i}`);
    const grid = [headers, Array.from({ length: 100 }, (_, i) => i)];
    expect(dictionaryForTopics(headers, grid, 30)).toHaveLength(30);
  });

  it('skips a leading blank cell when picking the sample (real exports open with gaps)', () => {
    const grid = [
      ['Region', 'Amount'],
      ['', ''],
      ['North', '100']
    ];
    expect(dictionaryForTopics(['Region', 'Amount'], grid)).toEqual([
      { name: 'Region', type: 'text', sample: 'North' },
      { name: 'Amount', type: 'text', sample: '100' }
    ]);
  });
});
// mdEscape — a cell can never shift its row's column count.
//
// Escaping only the pipe is not enough. A cell holding a literal backslash
// immediately before a pipe - a Windows path like C:\path\|match, or a regex -
// renders with GFM reading that backslash as an escape of the pipe, so the row
// parses as FOUR cells against three headers and every column after the shift
// is attributed to the wrong field. That is silent corruption inside a
// retrieval artifact, so the arithmetic is pinned here.
//
// The helper is shared by the CSV and xlsx converters, so a fix that covered
// only one would leave the other silently broken.
describe('mdEscape — a cell can never shift its column count', () => {
  // A literal backslash, built without one in this source so the intent
  // survives copy/paste and shell quoting.
  const BS = String.fromCharCode(92);

  // Minimal GFM row splitter that honours backslash escapes.
  function cells(row) {
    const out = [];
    let cur = '';
    for (let i = 0; i < row.length; i += 1) {
      if (row[i] === BS && i + 1 < row.length) {
        cur += row[i] + row[i + 1];
        i += 1;
        continue;
      }
      if (row[i] === '|') {
        out.push(cur);
        cur = '';
        continue;
      }
      cur += row[i];
    }
    out.push(cur);
    return out;
  }

  const rowCells = (line) => cells(line.replace(/^\|/, '').replace(/\|$/, ''));

  // The markdown table in a dataset body is: header, separator, then one line
  // per row. Filtering to lines that start with '|' isolates exactly that.
  function tableRowsOf(concept) {
    return concept.body.split('\n').filter((l) => l.trim().startsWith('|'));
  }

  test('a backslash immediately before a pipe does not add a column (the regression)', async () => {
    const raw = `C:${BS}path${BS}|match`;
    const { concepts } = await convertCsv(csv(`a,b,c\n${raw},2,3`), META);
    const rows = tableRowsOf(concepts.find((c) => c.frontmatter.type === 'dataset'));
    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(rowCells(rows[0]).length).toBe(3); // header
    expect(rowCells(rows[2]).length).toBe(3); // the data row carrying the nasty cell
  });

  test.each([
    ['a plain value', 'north'],
    ['an unescaped pipe', 'x | y | z'],
    ['two backslashes', `a${BS}${BS}b`],
    ['a pipe then a trailing backslash', `a|b${BS}`],
    ['a quote, a pipe and a newline', 'say "q" | then\nnewline']
  ])('%s keeps the row three columns wide', async (_label, raw) => {
    const { concepts } = await convertCsv(csv(`a,b,c\n${raw},2,3`), META);
    const rows = tableRowsOf(concepts.find((c) => c.frontmatter.type === 'dataset'));
    expect(rowCells(rows[2]).length).toBe(3);
  });

  test('the xlsx path shares the helper and is equally protected', async () => {
    const raw = `C:${BS}path${BS}|match`;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['a', 'b', 'c'], [raw, 2, 3]]), 'Sheet1');
    const { concepts } = await convertXlsx(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }), {
      file_id: 'f',
      file_name: 'e.xlsx',
      baseResource: 'x'
    });
    const rows = tableRowsOf(concepts.find((c) => c.frontmatter.type === 'dataset'));
    expect(rowCells(rows[2]).length).toBe(3);
  });
});