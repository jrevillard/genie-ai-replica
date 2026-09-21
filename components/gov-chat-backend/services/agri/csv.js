/**
 * Minimal RFC-4180 CSV parser.
 *
 * Written dependency-free because the WFP/HDX datasets use quoted fields
 * containing commas and the backend carries no CSV library. Handles:
 * - double-quoted fields with embedded commas, quotes ("" escape) and newlines
 * - \r\n and \n line endings
 * - a trailing newline without emitting an empty row
 *
 * @param {string} text - raw CSV content (UTF-8 decoded by the caller)
 * @param {Object} [opts]
 * @param {number} [opts.maxRows=200000] - hard cap to bound hostile/misparsed input
 * @returns {string[][]} rows of cells (header row included)
 */
function parseCsv(text, opts = {}) {
  const maxRows = opts.maxRows || 200000;
  if (typeof text !== 'string') {
    throw new Error('parseCsv: input must be a string');
  }
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  let i = 0;

  const pushCell = () => {
    row.push(cell);
    cell = '';
  };
  const pushRow = () => {
    pushCell();
    // Skip fully-empty rows (e.g. trailing newline)
    if (row.length > 1 || row[0] !== '') {
      rows.push(row);
    }
    row = [];
  };

  while (i < text.length && rows.length < maxRows) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
        } else {
          inQuotes = false;
          i += 1;
        }
      } else {
        cell += ch;
        i += 1;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i += 1;
    } else if (ch === ',') {
      pushCell();
      i += 1;
    } else if (ch === '\n' || ch === '\r') {
      // Treat \r\n as one terminator
      if (ch === '\r' && text[i + 1] === '\n') {
        i += 2;
      } else {
        i += 1;
      }
      pushRow();
    } else {
      cell += ch;
      i += 1;
    }
  }

  // Final cell/row without trailing newline
  if (cell !== '' || row.length > 0) {
    pushRow();
  }

  return rows;
}

/**
 * Parse CSV rows into objects keyed by the header row.
 * Rows shorter than the header keep undefined fields; longer rows are trimmed.
 *
 * @param {string} text
 * @param {Object} [opts]
 * @param {number} [opts.maxRows]
 * @returns {Object[]}
 */
function parseCsvObjects(text, opts = {}) {
  const rows = parseCsv(text, opts);
  if (rows.length === 0) return [];
  const header = rows[0];
  return rows.slice(1).map((row) => {
    const obj = {};
    header.forEach((key, idx) => {
      obj[key] = row[idx];
    });
    return obj;
  });
}

module.exports = { parseCsv, parseCsvObjects };
