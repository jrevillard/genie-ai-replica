// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
//
// !1205 — the drift pin between dataprep's Contextual Retrieval budget
// arithmetic and the Node MIRROR of it.
//
// The OKF concept-document ceiling is DERIVED from the serving-model window
// the same endpoint dataprep reads (GitLab #1205, closing #1588). The
// derivation lives in two languages: dataprep's python computes the real
// budget, and components/okf-server/services/contextual-budget-mirror.js
// mirrors the formula so okf-server can compute the SAME number without a
// round trip to dataprep.
//
// Two derivations are two things to drift (the plan's §4 says so outright),
// and the numbers cannot be compared by a validator — they are RUNTIME
// answers on both sides. What CAN be compared is the CONSTANTS the two
// derivations subtract from the window: those are literals in both files,
// and this validator reads both and fails when they disagree.
//
// The gate is deliberately about CONSTANTS, never about the derived number:
// a validator that recomputed the ceiling would be a THIRD derivation, and
// the smoke harness asserts the live numbers instead (#1205 story 3).

const fs = require('fs');
const path = require('path');
const { stripJsComments } = require('./js-files');

/** The dataprep file that owns the budget arithmetic. */
const DATAPREP_FILE = path.join('genie-ai-overlay', 'dataprep', 'genieai_dataprep_arangodb.py');
/** The dataprep file that owns the chunk-size map. */
const DATAPREP_MICROSERVICE_FILE = path.join(
  'genie-ai-overlay',
  'dataprep',
  'genieai_dataprep_microservice.py'
);
/** The Node mirror of that arithmetic. */
const MIRROR_FILE = path.join('components', 'okf-server', 'services', 'contextual-budget-mirror.js');

/**
 * Read a python string literal and resolve the escapes it uses.
 *
 * Only the escapes these constants actually use are resolved (\n, \t, \",
 * \\) — a literal with an unknown escape is left as written, so the
 * comparison fails loudly instead of silently agreeing on a wrong value.
 */
function resolvePythonLiteral(literal) {
  return literal
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

/**
 * The value of a python module-level `NAME = <literal>` assignment.
 *
 * @param {string} source - the python source
 * @param {string} name - the constant name
 * @returns {string|null} the literal as written, or null when absent
 */
function pythonLiteral(source, name) {
  const match = source.match(new RegExp(`^${name}\\s*=\\s*(.+)$`, 'm'));
  if (!match) return null;
  const raw = match[1].trim();
  if (raw.startsWith('"') && raw.endsWith('"')) {
    return resolvePythonLiteral(raw.slice(1, -1));
  }
  if (raw.startsWith("'") && raw.endsWith("'")) {
    return resolvePythonLiteral(raw.slice(1, -1));
  }
  return raw;
}

/**
 * The value of a python module-level `NAME = <int>` assignment.
 *
 * @param {string} source - the python source
 * @param {string} name - the constant name
 * @returns {number|null}
 */
function pythonInt(source, name) {
  const literal = pythonLiteral(source, name);
  if (literal === null) return null;
  const parsed = parseInt(literal, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * The length of a python triple-quoted constant.
 *
 * @param {string} source - the python source
 * @param {string} name - the constant name
 * @returns {number|null}
 */
function pythonTripleQuotedLength(source, name) {
  const match = source.match(new RegExp(`${name}\\s*=\\s*"""([\\s\\S]*?)"""`));
  return match ? match[1].length : null;
}

/**
 * The value of a Node module-level `const NAME = <literal>` assignment.
 *
 * @param {string} source - the JS source (comments already stripped)
 * @param {string} name - the constant name
 * @returns {string|null} the literal as written, or null when absent
 */
function jsLiteral(source, name) {
  const match = source.match(new RegExp(`^const\\s+${name}\\s*=\\s*(.+?);?\\s*$`, 'm'));
  return match ? match[1].trim().replace(/;$/, '') : null;
}

/**
 * The value of a Node module-level `const NAME = <number>` assignment.
 *
 * @param {string} source - the JS source
 * @param {string} name - the constant name
 * @returns {number|null}
 */
function jsNumber(source, name) {
  const literal = jsLiteral(source, name);
  if (literal === null) return null;
  const parsed = parseInt(literal, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * The Node string constant, unescaped the way JS evaluates it.
 *
 * @param {string} source - the JS source
 * @param {string} name - the constant name
 * @returns {string|null}
 */
function jsString(source, name) {
  const literal = jsLiteral(source, name);
  if (literal === null) return null;
  if (!literal.startsWith("'") && !literal.startsWith('"')) return null;
  const quote = literal[0];
  const body = literal.slice(1, literal.endsWith(quote) ? -1 : undefined);
  return body.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\'/g, "'").replace(/\\"/g, '"');
}

/**
 * The per-extension chunk-size map dataprep resolves
 * (genieai_dataprep_microservice.py: get_chunk_size_for_file).
 *
 * @param {string} source - the microservice source
 * @returns {Array<[string, string]>} [extension, env var name] pairs
 */
function pythonChunkSizeMap(source) {
  const map = [];
  const pattern = /"(\.[a-z0-9]+)":\s*int\(os\.getenv\("([A-Z0-9_]+)"/g;
  for (const match of source.matchAll(pattern)) {
    map.push([match[1], match[2]]);
  }
  return map;
}

/**
 * The per-extension chunk-size map the Node mirror carries.
 *
 * The constant spans several lines, so it is read as a BLOCK (from the
 * opening bracket to its closing one) rather than as a single line.
 *
 * @param {string} source - the mirror source
 * @returns {Array<[string, string]>} [extension, env var name] pairs
 */
function jsChunkSizeMap(source) {
  const start = source.indexOf('const CHUNK_SIZE_EXTENSIONS');
  if (start === -1) return [];
  const open = source.indexOf('[', start);
  if (open === -1) return [];
  const close = source.indexOf('];', open);
  if (close === -1) return [];
  const block = source.slice(open, close);
  const map = [];
  for (const match of block.matchAll(/\['(\.[a-z0-9]+)',\s*'([A-Z0-9_]+)'\]/g)) {
    map.push([match[1], match[2]]);
  }
  return map;
}

/**
 * Check that the Node mirror and dataprep's arithmetic agree on every
 * constant the derivation subtracts from the window.
 *
 * @param {string} root - the repository root
 * @returns {{errors: string[], checked: string[]}}
 */
function validateContextualMirror(root) {
  const errors = [];
  const checked = [];

  const dataprepPath = path.join(root, DATAPREP_FILE);
  const microservicePath = path.join(root, DATAPREP_MICROSERVICE_FILE);
  const mirrorPath = path.join(root, MIRROR_FILE);
  for (const file of [dataprepPath, microservicePath, mirrorPath]) {
    if (!fs.existsSync(file)) {
      errors.push(`the mirror pin needs ${path.relative(root, file)}, which is missing`);
    }
  }
  if (errors.length) return { errors, checked };

  const dataprep = fs.readFileSync(dataprepPath, 'utf8');
  const microservice = fs.readFileSync(microservicePath, 'utf8');
  const mirror = stripJsComments(fs.readFileSync(mirrorPath, 'utf8'));

  /** Compare one integer constant across the two worlds. */
  const compareInt = (label, pyValue, jsValue) => {
    checked.push(label);
    if (pyValue === null) {
      errors.push(`${label}: dataprep no longer defines it (the mirror's ${jsValue} has nothing to match)`);
      return;
    }
    if (jsValue === null) {
      errors.push(`${label}: the mirror no longer defines it (dataprep says ${pyValue})`);
      return;
    }
    if (pyValue !== jsValue) {
      errors.push(`${label}: dataprep says ${pyValue}, the Node mirror says ${jsValue} — the derived ceiling would drift`);
    }
  };

  /** Compare one string constant across the two worlds. */
  const compareString = (label, pyValue, jsValue) => {
    checked.push(label);
    if (pyValue === null || jsValue === null) {
      errors.push(`${label}: one of the two sides no longer defines it (dataprep=${pyValue}, mirror=${jsValue})`);
      return;
    }
    if (pyValue !== jsValue) {
      errors.push(
        `${label}: dataprep says ${JSON.stringify(pyValue)}, the Node mirror says ${JSON.stringify(jsValue)} — the derived ceiling would drift`
      );
    }
  };

  // CHARS_PER_TOKEN — the chars-per-token ratio the whole conversion rests on.
  compareInt('CHARS_PER_TOKEN', pythonInt(dataprep, 'CHARS_PER_TOKEN'), jsNumber(mirror, 'CHARS_PER_TOKEN'));

  // DATAPREP_CONTEXTUAL_MAX_TOKENS — the per-chunk output reservation.
  const pyOutputDefault = (dataprep.match(/DATAPREP_CONTEXTUAL_MAX_TOKENS"\s*,\s*(\d+)/) || [])[1];
  compareInt(
    'DATAPREP_CONTEXTUAL_MAX_TOKENS default',
    pyOutputDefault === undefined ? null : parseInt(pyOutputDefault, 10),
    jsNumber(mirror, 'CONTEXTUAL_MAX_TOKENS_DEFAULT')
  );

  // DATAPREP_LLM_LABEL_BATCH_SIZE — the batch size (the output term scales
  // with it, and so does the batch term).
  const pyBatchDefault = (dataprep.match(/DATAPREP_LLM_LABEL_BATCH_SIZE"\s*,\s*"(\d+)"/) || [])[1];
  compareInt(
    'DATAPREP_LLM_LABEL_BATCH_SIZE default',
    pyBatchDefault === undefined ? null : parseInt(pyBatchDefault, 10),
    jsNumber(mirror, 'LABEL_LLM_BATCH_SIZE_DEFAULT')
  );

  // DATAPREP_CHUNK_SIZE — the global chunk-size fallback.
  const pyChunkDefault = (microservice.match(/DATAPREP_CHUNK_SIZE"\s*,\s*(\d+)/) || [])[1];
  compareInt(
    'DATAPREP_CHUNK_SIZE default',
    pyChunkDefault === undefined ? null : parseInt(pyChunkDefault, 10),
    jsNumber(mirror, 'CHUNK_SIZE_DEFAULT')
  );

  // The per-extension chunk-size map — the mirror must know every extension
  // dataprep resolves (a missing one would let the mirror derive a budget
  // from a chunk size dataprep never uses).
  checked.push('the per-extension chunk-size map');
  const pyMap = pythonChunkSizeMap(microservice);
  const jsMap = jsChunkSizeMap(mirror);
  if (pyMap.length === 0) {
    errors.push('the per-extension chunk-size map: dataprep no longer defines one the validator can read');
  } else if (jsMap.length === 0) {
    errors.push('the per-extension chunk-size map: the Node mirror no longer defines one the validator can read');
  } else {
    const pyKeys = pyMap.map(([ext]) => ext).sort().join(',');
    const jsKeys = jsMap.map(([ext]) => ext).sort().join(',');
    if (pyKeys !== jsKeys) {
      errors.push(
        `the per-extension chunk-size map: dataprep resolves ${pyKeys}, the Node mirror knows ${jsKeys} — a document type the mirror does not know would derive a budget from the wrong chunk size`
      );
    }
    for (const [ext, envName] of pyMap) {
      const mirrored = jsMap.find(([e]) => e === ext);
      if (mirrored && mirrored[1] !== envName) {
        errors.push(
          `the chunk-size env var for ${ext}: dataprep reads ${envName}, the Node mirror reads ${mirrored[1]}`
        );
      }
    }
  }

  // The prompt length — the prompt tokens reserved from the window.
  const pyPromptLength = pythonTripleQuotedLength(dataprep, '_CONTEXTUAL_RETRIEVAL_PROMPT_DEFAULT');
  compareInt(
    'the contextual prompt default length',
    pyPromptLength,
    jsNumber(mirror, 'CONTEXTUAL_RETRIEVAL_PROMPT_DEFAULT_CHARS')
  );

  // The scaffolding literals — header and truncation marker.
  compareString(
    'DOC_CONTEXT_HEADER',
    pythonLiteral(dataprep, 'DOC_CONTEXT_HEADER'),
    jsString(mirror, 'DOC_CONTEXT_HEADER')
  );
  compareString(
    'DOC_CONTEXT_TRUNCATION_MARKER',
    pythonLiteral(dataprep, 'DOC_CONTEXT_TRUNCATION_MARKER'),
    jsString(mirror, 'DOC_CONTEXT_TRUNCATION_MARKER')
  );

  // The fail-closed guess must NOT be mirrored: a guess-derived write
  // ceiling would refuse nearly every import during an endpoint blip.
  checked.push('the fail-closed guess is not mirrored');
  if (jsNumber(mirror, 'DERIVE_FALLBACK_WINDOW') !== null) {
    errors.push(
      'the Node mirror defines DERIVE_FALLBACK_WINDOW — dataprep\'s fail-closed guess is right for sizing a request and wrong for a write ceiling (the ladder in concept-ceiling.js owns the fallback)'
    );
  }

  return { errors, checked };
}

module.exports = {
  validateContextualMirror,
  DATAPREP_FILE,
  DATAPREP_MICROSERVICE_FILE,
  MIRROR_FILE
};
