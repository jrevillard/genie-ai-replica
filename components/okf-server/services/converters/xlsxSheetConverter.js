// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
/*
 * xlsxSheetConverter — Story 7.7 / FR-42 (DECIDED semantics, import-scope
 * gap-analysis §5.3, ADR-okf-038): a spreadsheet becomes, per SHEET,
 *   - ONE data-dictionary concept (title, purpose, column table:
 *     name / inferred type / sample value), and
 *   - N data concepts = capped row-groups rendered as markdown tables
 *     (~rows-per-concept, split on natural row boundaries).
 * The dictionary concept links[] to its row-group concepts (dictionary ← →
 * data), so "what does column X mean" and "what was the 2025 value of Y"
 * are BOTH first-class retrievable units. Rows are NEVER concepts themselves.
 * Unreadable sheets are LOUD-rejected (per-file error in the import report)
 * — never a silent empty concept (gap-analysis D-x discipline).
 *
 * The FR-42 RENDERING lives in tableConcepts.js and is shared verbatim with
 * csvSheetConverter — a CSV import and a spreadsheet import must produce the
 * same concept shape, so the two converters differ ONLY in how they parse.
 */
const XLSX = require('xlsx');

const { resolveRowsPerConcept, slugify, inferType, cellText, buildSheetConcepts } = require('./tableConcepts');

/**
 * Convert an .xlsx buffer into OKF concept drafts.
 * @param {Buffer} buffer
 * @param {object} meta {file_id, file_name, baseResource}
 * @returns {{concepts: Array<{path, frontmatter, body}>, sheets: Array<{name, rows, groups}>}}
 * @throws when NO sheet is readable (the file loud-rejects — per_file error).
 */
function convertXlsx(buffer, meta) {
  let wb;
  try {
    wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  } catch (err) {
    const e = new Error(`unreadable xlsx (${err.message})`);
    e.code = 'XLSX_UNREADABLE';
    throw e;
  }
  const rowsPerConcept = resolveRowsPerConcept(process.env.OKF_XLSX_ROWS_PER_CONCEPT);
  const concepts = [];
  const sheets = [];
  const baseSlug = slugify(String(meta.file_name || 'spreadsheet').replace(/\.[^.]+$/, '')) || 'sheet';

  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws || !ws['!ref']) {
      sheets.push({ name, rows: 0, groups: 0, skipped: 'empty sheet' });
      continue;
    }
    const grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: false });
    const built = buildSheetConcepts({
      grid,
      sheetName: name,
      sheetSlug: `${baseSlug}-${slugify(name)}`,
      meta,
      rowsPerConcept,
      locatorNoun: 'sheet'
    });
    if (built.skipped) {
      sheets.push({ name, rows: 0, groups: 0, skipped: built.skipped });
      continue;
    }
    concepts.push(...built.concepts);
    sheets.push({ name, rows: built.rows, groups: built.groups });
  }

  if (concepts.length === 0) {
    const e = new Error('no readable sheets in xlsx (all empty or unparsable)');
    e.code = 'XLSX_NO_SHEETS';
    throw e;
  }
  return { concepts, sheets };
}

module.exports = { convertXlsx, slugify, inferType, cellText };
