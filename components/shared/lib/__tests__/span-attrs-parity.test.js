// Cross-language parity between components/shared/lib/span-attrs.js and
// genie-ai-overlay/core/span_attrs.py.
//
// The Node side mints genie.query_id into OTel baggage; the Python side reads it
// back off that baggage and stamps it on every RAG span. If the two disagree on
// the key, the id is written under one name and read under another, and every
// span silently loses its correlation — with no error anywhere. MAX_STRING_LEN
// is the privacy bound; a divergence means one side accepts a value the other
// considers prose.
//
// The Python side is read FROM DISK rather than restated here: a hard-coded copy
// of the two constants would agree with this file and disagree with production
// the first time someone edits span_attrs.py, which is exactly the drift this
// test exists to catch.

const fs = require('fs');
const path = require('path');

const { MAX_STRING_LEN, QUERY_ID_KEY } = require('../span-attrs');

// components/shared/lib/__tests__ -> lib -> shared -> components -> repo root
const PYTHON_SOURCE = path.join(__dirname, '..', '..', '..', '..', 'genie-ai-overlay', 'core', 'span_attrs.py');

function readPythonSource() {
  expect(fs.existsSync(PYTHON_SOURCE)).toBe(true);
  return fs.readFileSync(PYTHON_SOURCE, 'utf8');
}

function readAssignment(source, name) {
  const match = source.match(new RegExp(`^${name}\\s*=\\s*(.+)$`, 'm'));
  expect(match).not.toBeNull();
  return match[1].trim();
}

describe('span-attrs cross-language parity', () => {
  it('resolves the Python source from the shared-lib test directory', () => {
    expect(PYTHON_SOURCE.endsWith(path.join('genie-ai-overlay', 'core', 'span_attrs.py'))).toBe(true);
    expect(fs.existsSync(PYTHON_SOURCE)).toBe(true);
  });

  it('the Python constants are single, module-level assignments', () => {
    const source = readPythonSource();
    expect(source.match(/^QUERY_ID_KEY\s*=/gm)).toHaveLength(1);
    expect(source.match(/^MAX_STRING_LEN\s*=/gm)).toHaveLength(1);
  });

  it('QUERY_ID_KEY agrees', () => {
    const python = readAssignment(readPythonSource(), 'QUERY_ID_KEY');
    expect(python).toMatch(/^"[^"]+"$/);
    expect(QUERY_ID_KEY).toBe(JSON.parse(python));
  });

  it('MAX_STRING_LEN agrees', () => {
    const python = readAssignment(readPythonSource(), 'MAX_STRING_LEN');
    expect(python).toMatch(/^\d+$/);
    expect(MAX_STRING_LEN).toBe(Number(python));
  });

  it('MAX_STRING_LEN is a bound a real value fits under', () => {
    // A bound of 0 or 1 would satisfy any equality assertion above while making
    // every id, model name and chunk key a leak.
    expect(MAX_STRING_LEN).toBeGreaterThan(32);
    expect(QUERY_ID_KEY.length).toBeLessThanOrEqual(MAX_STRING_LEN);
  });
});
