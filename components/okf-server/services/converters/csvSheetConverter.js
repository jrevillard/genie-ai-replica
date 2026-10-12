// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
/*
 * csvSheetConverter — CSV import, FR-42 semantics (import-scope gap-analysis
 * §5.3, ADR-okf-038). David 2026-10-12: "import CSV files into an OKF
 * repository as tabular markdown data WITH TOPICS" — so a CSV is the
 * dictionary + row-group shape xlsxSheetConverter already produces, PLUS an
 * LLM-derived topic set summarised from the dictionary columns.
 *
 * A CSV IS one sheet, so there is exactly ONE dictionary concept and N capped
 * row-group concepts, each linking back to the dictionary. Rows are NEVER
 * concepts themselves. The rendering is the SHARED tableConcepts core, so a
 * CSV and a spreadsheet produce byte-identical concept shapes.
 *
 * PARSING — SheetJS (`xlsx`, already a dependency) rather than a hand-rolled
 * RFC-4180 parser or a new papaparse/csv-parse dependency. Chosen because:
 *   1. no new dependency, no lockfile churn, no new CVE surface;
 *   2. it is RFC-4180-correct on every case that matters, VERIFIED on this
 *      tree's xlsx@0.18.5 — delimiter inside quotes, "" escapes, embedded
 *      newlines, UTF-8 BOM, CRLF, and European ';' / tab delimiters (it
 *      sniffs the separator, so a semicolon export does not arrive as one
 *      giant single-column row);
 *   3. it yields the same {v,t,z}/raw grid shape the spreadsheet path already
 *      consumes, so the FR-42 core needs no CSV-specific branch at all.
 * Hand-rolling would have re-implemented (and had to unit-test) quoting,
 * escaped quotes and embedded newlines to arrive at the same grid.
 *
 * LOUD-REJECT (gap-analysis D-x discipline): an unreadable or empty file
 * throws with a `code`, never emitting a silent empty concept.
 */

const XLSX = require('xlsx');

const { logger } = require('../../shared-lib/logger');
const { resolveRowsPerConcept, slugify, buildSheetConcepts, inferType, cellText } = require('./tableConcepts');
const csvTopics = require('./csvTopicsService');

/** A NUL byte cannot appear in a legitimate text/CSV cell, so its presence
 * means the buffer is not CSV at all (an xlsx/docx/zip renamed to .csv, or a
 * truncated binary). SheetJS is lenient enough to "parse" such a buffer into a
 * single garbage column rather than throwing, which would surface as a
 * confusing empty-import instead of naming the real problem. */
function looksBinary(buffer) {
  const probe = buffer.slice(0, 4096);
  for (let i = 0; i < probe.length; i += 1) {
    if (probe[i] === 0) return true;
  }
  return false;
}

/** Parse a CSV buffer into the SheetJS grid shape (row 0 = header). */
function parseCsv(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const name = wb.SheetNames[0];
  const ws = wb.Sheets[name];
  if (!ws) return { grid: [], sheetName: 'Sheet1' };
  const grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: false });
  return { grid, sheetName: name || 'Sheet1' };
}

/** Build the dictionary summary handed to the topic prompt.
 * Only the first N columns are described: a 400-column export would otherwise
 * produce a prompt the 400-token budget cannot answer, and the model would
 * return a truncated, half-invented subject. */
function dictionaryForTopics(headers, grid, maxColumns = 30) {
  const rows = Array.isArray(grid) ? grid.slice(1) : [];
  return headers.slice(0, maxColumns).map((name, i) => {
    const sample = rows.find((r) => Array.isArray(r) && r[i] != null && String(r[i]).trim() !== '');
    const value = sample ? sample[i] : null;
    return {
      name,
      type: inferType(value),
      sample: value == null ? '' : cellText(value).slice(0, 80)
    };
  });
}

/**
 * Convert a .csv buffer into OKF concept drafts (dictionary + row-groups).
 *
 * @param {Buffer} buffer raw CSV bytes (BOM tolerated)
 * @param {object} meta {file_id, file_name, baseResource}
 * @param {object} [opts]
 * @param {Function} [opts.deriveTopics] injectable topic summariser (tests);
 *        defaults to the remote-endpoint LLM call, which fails soft.
 * @returns {Promise<{concepts: Array<{path, frontmatter, body}>,
 *          sheets: Array<{name, rows, groups}>, topics: object}>}
 * @throws Error with `.code` when the CSV is unreadable or empty.
 */
async function convertCsv(buffer, meta, opts = {}) {
  const fileName = meta && meta.file_name;
  logger.info('CSV conversion started', {
    file_id: meta && meta.file_id,
    file_name: fileName,
    bytes: buffer && buffer.length
  });

  let parsed;
  try {
    if (looksBinary(buffer)) {
      // Named loud so the operator sees "this is not a CSV" rather than an
      // empty-import report they would spend an hour debugging.
      const e = new Error('unreadable csv (binary content — not a CSV file; was an office/zip file renamed to .csv?)');
      e.code = 'CSV_UNREADABLE';
      throw e;
    }
    parsed = parseCsv(buffer);
  } catch (err) {
    // Rethrow our own binary-guard error verbatim; wrapping it again would
    // read "unreadable csv (unreadable csv (binary content …))".
    if (err && err.code === 'CSV_UNREADABLE') throw err;
    // SheetJS is lenient (a text blob parses as one column), so reaching here
    // means genuinely corrupt input.
    logger.error('CSV conversion failed: unreadable buffer', {
      file_id: meta && meta.file_id,
      file_name: fileName,
      error: err.message
    });
    const e = new Error(`unreadable csv (${err.message})`);
    e.code = 'CSV_UNREADABLE';
    throw e;
  }

  const { grid, sheetName } = parsed;
  const rowsPerConcept = resolveRowsPerConcept(process.env.OKF_CSV_ROWS_PER_CONCEPT);

  // SheetJS synthesises the sheet name 'Sheet1'. Using it verbatim would put
  // a meaningless "sheet1" into every concept path, title and source locator,
  // so a CSV is labelled by its FILE basename instead — which is also what
  // makes two differently-named CSVs produce distinct, meaningful slugs.
  const label = slugify(String(fileName || sheetName || 'table').replace(/\.[^.]+$/, '')) || 'table';

  const built = buildSheetConcepts({
    grid,
    sheetName: label,
    sheetSlug: label,
    meta,
    rowsPerConcept,
    locatorNoun: 'table'
  });

  // WHY `groups === 0` also rejects: a header row with NO data rows yields a
  // dictionary whose every sample cell is empty and whose row count is 0 — a
  // concept that looks imported but carries no data. That is precisely the
  // silent-empty failure the D-x discipline forbids, so it loud-rejects.
  if (built.skipped || built.concepts.length === 0 || built.groups === 0) {
    logger.warn('CSV conversion loud-rejected: no data rows to import', {
      file_id: meta && meta.file_id,
      file_name: fileName,
      reason: built.skipped || 'header row present but no data rows'
    });
    const e = new Error('no readable rows in csv (empty file, or a header row with no data rows)');
    e.code = 'CSV_NO_DATA';
    throw e;
  }

  // TOPICS (David 2026-10-12: "tabular markdown data WITH topics"). One call
  // per file against the REMOTE endpoint; it never throws — see
  // csvTopicsService for the fail-soft contract.
  const dictionary = dictionaryForTopics(built.headers, grid);
  const derive = opts.deriveTopics || csvTopics.deriveTopics;
  let topics;
  try {
    topics = await derive({ columns: dictionary, fileName });
  } catch (err) {
    // Defensive: the service already swallows its own errors, so this only
    // fires if an injected/test double throws. An import must still land.
    logger.warn('CSV topics: summariser threw — continuing without topics', {
      file_id: meta && meta.file_id,
      error: err.message
    });
    topics = { topics: [], purpose: '', source: 'fallback-threw' };
  }

  // Stamp the topics on EVERY concept (dictionary AND each row-group): a
  // row-group carrying no topic is a retrieval orphan, and the row-groups are
  // what actually answer "what was the 2025 value".
  const stamp = topics && Array.isArray(topics.topics) && topics.topics.length ? topics.topics : null;
  for (const c of built.concepts) {
    if (stamp) c.frontmatter.topic = stamp;
    if (topics && topics.purpose) c.frontmatter.description = topics.purpose;
  }

  logger.info('CSV conversion completed', {
    file_id: meta && meta.file_id,
    file_name: fileName,
    concepts: built.concepts.length,
    rows: built.rows,
    groups: built.groups,
    columns: built.headers.length,
    rows_per_concept: rowsPerConcept,
    topics_source: topics && topics.source,
    topics: stamp ? stamp.length : 0
  });

  return {
    concepts: built.concepts,
    sheets: [{ name: label, rows: built.rows, groups: built.groups }],
    topics
  };
}

module.exports = { convertCsv, parseCsv, dictionaryForTopics };
