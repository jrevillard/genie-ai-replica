// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
/*
 * tableConcepts — the FR-42 tabular core (import-scope gap-analysis §5.3,
 * ADR-okf-038), extracted so EVERY tabular source (spreadsheet, CSV) renders
 * the SAME concept shape:
 *   - ONE data-dictionary concept per sheet (title, purpose, column table:
 *     name / inferred type / sample value), and
 *   - N data concepts = capped row-groups rendered as markdown tables.
 * The data concepts link[] back to the dictionary so "what does column X mean"
 * and "what was the 2025 value of Y" are BOTH first-class retrievable units.
 * Rows are NEVER concepts themselves.
 *
 * This module is PURE: no I/O, no LLM, no clock — it takes a grid of raw cells
 * (as SheetJS produces) and returns concept drafts. The per-source converters
 * (xlsxSheetConverter, csvSheetConverter) own only the PARSING step and the
 * loud-reject policy.
 */

const DEFAULT_ROWS_PER_CONCEPT = 200;
const MAX_ROWS_PER_CONCEPT = 500;

/** Clamp an operator-supplied rows-per-concept value to the safe band.
 * A spreadsheet/CSV export is attacker-shaped data: without a clamp,
 * OKF_*_ROWS_PER_CONCEPT=0 would emit one concept per row, and a huge value
 * would emit a single concept whose markdown table blows past any embedding
 * budget. */
function resolveRowsPerConcept(raw) {
  const parsed = parseInt(raw, 10);
  return Math.min(MAX_ROWS_PER_CONCEPT, Math.max(10, parsed || DEFAULT_ROWS_PER_CONCEPT));
}

/** Escape a cell so it cannot break out of a GFM markdown table.
 *
 * ORDER IS LOAD-BEARING: backslashes must be escaped BEFORE pipes.
 *
 * Escaping only the pipe is not enough. A cell holding a literal
 * backslash immediately before a pipe — `C:\path\|match`, a Windows
 * path or a regex — renders as `C:\path\|match`, and GFM reads the
 * backslash as an escape of the pipe: the row then parses as FOUR
 * cells against three headers and every column after the shift is
 * attributed to the wrong field. That is silent data corruption in a
 * retrieval artifact, not a rendering nit.
 *
 * Escaping backslashes first makes both cases correct:
 *   `a|b`      -> no backslash -> pipe escaped        -> `a\|b`
 *   `a\|b`     -> `a\\|b`    -> pipe escaped too     -> `a\\\|b`
 * which GFM reads as a literal backslash followed by a literal pipe.
 */
function mdEscape(s) {
  return String(s == null ? '' : s)
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ')
    .trim();
}

/** Infer a coarse column type from the sheet's own cell types (cheap, honest).
 * Cells may be OBJECTS ({v,t,z}) or RAW VALUES depending on sheet_to_json's
 * raw flag — both are handled.
 *
 * ORDERING IS LOAD-BEARING (bug fixed 2026-10-12): the raw-value branch runs
 * BEFORE the `.v` probe. sheet_to_json is called with `{raw:true}`, so cells
 * arrive as primitives ('North', 100, true) which have NO `.v` property — the
 * old `.v`-first guard returned 'empty' for every one of them and the entire
 * primitive branch below was dead code. The data dictionary's Type column read
 * 'empty' for EVERY column on EVERY spreadsheet. A Date is also an object, so
 * it must be caught before the object branch as well. */
function inferType(cell) {
  if (cell == null) return 'empty';
  // Date first: an instance of Date IS typeof 'object', so the raw-value
  // branch alone would not catch it.
  if (cell instanceof Date) return 'date';
  if (typeof cell !== 'object') {
    if (typeof cell === 'number') return 'number';
    if (typeof cell === 'boolean') return 'boolean';
    return 'text';
  }
  // Object form: unwrap `.v` first so an empty {v:null} wrapper still reads
  // as 'empty' rather than falling through to 'text'.
  if (cell.v === undefined || cell.v === null) return 'empty';
  if (cell.v instanceof Date) return 'date';
  if (cell.t === 'n') return cell.z && /[%$]/.test(cell.z) ? 'number(formatted)' : 'number';
  if (cell.t === 'd') return 'date';
  if (cell.t === 'b') return 'boolean';
  if (cell.t === 'e') return 'error';
  return 'text';
}

/** Render one cell as markdown-table text.
 * The `instanceof Date` check is FIRST because a Date is typeof 'object': the
 * old object branch read `.v` off a raw Date (undefined) and rendered the
 * empty string, silently dropping every date cell from a data table. */
function cellText(cell) {
  if (cell == null) return '';
  if (cell instanceof Date) return cell.toISOString().slice(0, 10);
  if (typeof cell !== 'object') return String(cell);
  if (cell.v instanceof Date) return cell.v.toISOString().slice(0, 10);
  if (cell.t === 'd') return String(cell.v);
  return String(cell.v == null ? '' : cell.v);
}

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/**
 * Turn ONE parsed grid into the FR-42 concept pair set.
 *
 * @param {object} args
 * @param {Array<Array<*>>} args.grid raw cells, row 0 = header (SheetJS shape)
 * @param {string} args.sheetName human label used in titles + sources[].locator
 * @param {string} args.sheetSlug path prefix (no .md) shared by all concepts
 * @param {object} args.meta {file_id, file_name, baseResource}
 * @param {number} args.rowsPerConcept already-clamped row-group size
 * @param {string} [args.locatorNoun] word for the locator ("sheet" for xlsx,
 *        "table" for CSV) — CSV has no sheets, and a locator claiming
 *        sheet "Sheet1" would be a fabricated provenance detail.
 * @returns {{skipped: string|null, concepts: Array, rows: number, groups: number,
 *            headers: string[]}}
 */
function buildSheetConcepts({ grid, sheetName, sheetSlug, meta, rowsPerConcept, locatorNoun = 'sheet' }) {
  if (
    !Array.isArray(grid) ||
    !grid.length ||
    !grid[0] ||
    grid[0].filter((c) => c != null && String(c).trim()).length === 0
  ) {
    return { skipped: 'no header row', concepts: [], rows: 0, groups: 0, headers: [] };
  }
  const headers = grid[0].map((h) => String(h == null ? '' : h).trim() || 'column');
  const rows = grid.slice(1);
  const concepts = [];

  // ── data-dictionary concept: the sheet's columns, types and samples ──
  // WHY the first NON-NULL cell per column rather than row 1: real exports
  // open with blank/merged cells, and a fixed first-row sample would render
  // an empty cell in the very table meant to describe the columns.
  const dictRows = headers.map((h, i) => {
    const sample = rows.find((r) => r && r[i] != null);
    return `| ${mdEscape(h)} | ${inferType(sample ? sample[i] : null)} | ${mdEscape(sample ? cellText(sample[i]) : '')} |`;
  });
  const dictPath = `${sheetSlug}-dictionary.md`;
  const dictTitle = `${meta.file_name} — ${sheetName} (data dictionary)`;
  concepts.push({
    path: dictPath,
    frontmatter: {
      type: 'data-dictionary',
      title: dictTitle,
      sources: [
        {
          kind: 'document',
          resource: meta.baseResource,
          file_id: meta.file_id,
          file_name: meta.file_name,
          locator: `${locatorNoun} "${sheetName}"`
        }
      ]
    },
    body:
      `# ${dictTitle}\n\n${locatorNoun === 'sheet' ? 'Sheet' : 'Table'} **${mdEscape(sheetName)}** of **${mdEscape(meta.file_name)}**: ${rows.length} data rows, ${headers.length} columns.\n\n` +
      `| Column | Type | First sample |\n|---|---|---|\n${dictRows.join('\n')}\n`
  });

  // ── data concepts: capped row-groups as markdown tables ──
  let groups = 0;
  for (let start = 0; start < rows.length; start += rowsPerConcept) {
    // WHY filter INSIDE the slice, not before it: the slice bounds are the
    // emitted row range, so dropping all-blank rows here keeps the stated
    // "rows 1–200" locator honest about the rows that actually rendered.
    const slice = rows
      .slice(start, start + rowsPerConcept)
      .filter((r) => r && r.some((c) => c != null && String(c).trim() !== ''));
    if (slice.length === 0) continue;
    groups += 1;
    const part = groups === 1 ? '' : `-part${groups}`;
    const dataPath = `${sheetSlug}-rows${part}.md`;
    const title = `${meta.file_name} — ${sheetName} rows ${start + 1}–${start + slice.length}`;
    const header = `| ${headers.map(mdEscape).join(' |')} |`;
    const sep = `|${headers.map(() => '---').join('|')}|`;
    const body = slice.map((r) => `| ${headers.map((_, i) => mdEscape(cellText(r[i]))).join(' |')} |`).join('\n');
    concepts.push({
      path: dataPath,
      frontmatter: {
        type: 'dataset',
        title,
        links: [{ to_concept_id: dictPath.replace(/\.md$/, ''), label: `data dictionary (${sheetName})` }],
        sources: [
          {
            kind: 'document',
            resource: meta.baseResource,
            file_id: meta.file_id,
            file_name: meta.file_name,
            locator: `${locatorNoun} "${sheetName}" rows ${start + 1}–${start + slice.length}`
          }
        ]
      },
      body: `# ${title}\n\n${header}\n${sep}\n${body}\n`
    });
  }

  return { skipped: null, concepts, rows: rows.length, groups, headers };
}

module.exports = {
  DEFAULT_ROWS_PER_CONCEPT,
  MAX_ROWS_PER_CONCEPT,
  resolveRowsPerConcept,
  mdEscape,
  inferType,
  cellText,
  slugify,
  buildSheetConcepts
};
