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
 */
const XLSX = require('xlsx');

const DEFAULT_ROWS_PER_CONCEPT = 200;
const MAX_ROWS_PER_CONCEPT = 500;

function mdEscape(s) {
  return String(s == null ? '' : s)
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ')
    .trim();
}

/** Infer a coarse column type from the sheet's own cell types (cheap, honest).
 * Cells may be OBJECTS ({v,t,z}) or RAW VALUES depending on sheet_to_json's
 * raw flag — both are handled. */
function inferType(cell) {
  if (cell == null || cell.v === undefined || cell.v === null) return 'empty';
  if (typeof cell !== 'object') {
    if (cell instanceof Date) return 'date';
    if (typeof cell === 'number') return 'number';
    if (typeof cell === 'boolean') return 'boolean';
    return 'text';
  }
  if (cell.t === 'n') return cell.z && /[%$]/.test(cell.z) ? 'number(formatted)' : 'number';
  if (cell.t === 'd') return 'date';
  if (cell.t === 'b') return 'boolean';
  if (cell.t === 'e') return 'error';
  return 'text';
}

function cellText(cell) {
  if (cell == null) return '';
  if (typeof cell !== 'object') return cell instanceof Date ? cell.toISOString().slice(0, 10) : String(cell);
  if (cell.t === 'd') return cell.v instanceof Date ? cell.v.toISOString().slice(0, 10) : String(cell.v);
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
  const rowsPerConcept = Math.min(
    MAX_ROWS_PER_CONCEPT,
    Math.max(10, parseInt(process.env.OKF_XLSX_ROWS_PER_CONCEPT, 10) || DEFAULT_ROWS_PER_CONCEPT)
  );
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
    if (!grid.length || !grid[0] || grid[0].filter((c) => c != null && String(c).trim()).length === 0) {
      sheets.push({ name, rows: 0, groups: 0, skipped: 'no header row' });
      continue;
    }
    const headers = grid[0].map((h) => String(h == null ? '' : h).trim() || 'column');
    const rows = grid.slice(1);
    const sheetSlug = `${baseSlug}-${slugify(name)}`;

    // ── data-dictionary concept: the sheet's columns, types and samples ──
    const dictRows = headers.map((h, i) => {
      const sample = rows.find((r) => r && r[i] != null);
      return `| ${mdEscape(h)} | ${inferType(sample ? sample[i] : null)} | ${mdEscape(sample ? cellText(sample[i]) : '')} |`;
    });
    const dictPath = `${sheetSlug}-dictionary.md`;
    const dictTitle = `${meta.file_name} — ${name} (data dictionary)`;
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
            locator: `sheet "${name}"`
          }
        ]
      },
      body:
        `# ${dictTitle}\n\nSheet **${mdEscape(name)}** of **${mdEscape(meta.file_name)}**: ${rows.length} data rows, ${headers.length} columns.\n\n` +
        `| Column | Type | First sample |\n|---|---|---|\n${dictRows.join('\n')}\n`
    });

    // ── data concepts: capped row-groups as markdown tables ──
    let groups = 0;
    for (let start = 0; start < rows.length; start += rowsPerConcept) {
      const slice = rows
        .slice(start, start + rowsPerConcept)
        .filter((r) => r && r.some((c) => c != null && String(c).trim() !== ''));
      if (slice.length === 0) continue;
      groups += 1;
      const part = groups === 1 ? '' : `-part${groups}`;
      const dataPath = `${sheetSlug}-rows${part}.md`;
      const title = `${meta.file_name} — ${name} rows ${start + 1}–${start + slice.length}`;
      const header = `| ${headers.map(mdEscape).join(' |')} |`;
      const sep = `|${headers.map(() => '---').join('|')}|`;
      const body = slice.map((r) => `| ${headers.map((_, i) => mdEscape(cellText(r[i]))).join(' |')} |`).join('\n');
      concepts.push({
        path: dataPath,
        frontmatter: {
          type: 'dataset',
          title,
          links: [{ to_concept_id: dictPath.replace(/\.md$/, ''), label: `data dictionary (${name})` }],
          sources: [
            {
              kind: 'document',
              resource: meta.baseResource,
              file_id: meta.file_id,
              file_name: meta.file_name,
              locator: `sheet "${name}" rows ${start + 1}–${start + slice.length}`
            }
          ]
        },
        body: `# ${title}\n\n${header}\n${sep}\n${body}\n`
      });
    }
    sheets.push({ name, rows: rows.length, groups });
  }

  if (concepts.length === 0) {
    const e = new Error('no readable sheets in xlsx (all empty or unparsable)');
    e.code = 'XLSX_NO_SHEETS';
    throw e;
  }
  return { concepts, sheets };
}

module.exports = { convertXlsx, slugify, inferType };
