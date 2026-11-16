// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
//
// contextual-budget-mirror — the MIRROR of dataprep's Contextual Retrieval
// budget arithmetic, in Node, for the OKF concept-document ceiling (#1205,
// closes #1588).
//
// WHY A MIRROR AT ALL. dataprep derives the per-document context budget from
// the serving model's window at runtime
// (genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py: _serving_model_window
// + _resolve_doc_budget). okf-server enforces a ceiling on one concept
// document so that "over the ceiling" and "the document context will be
// truncated" are the SAME condition — the equivalence the shared number
// exists for (services/concept-ceiling.js header; plan §4). A static literal
// cannot stay in step with a runtime derivation, and no validator can
// compare a literal against a runtime answer: the ceiling had to become a
// derivation, and a derivation has to live in two languages.
//
// THE MIRROR IS PINNED, NOT TRUSTED. Every constant below is read from the
// deployment's own env when that env sets it, and otherwise mirrors the
// dataprep default. The DEFAULTS are pinned against dataprep's python source
// by tests/config-validator (validators/validate-contextual-mirror.js): the
// validator parses the python and compares the values, so the two worlds
// cannot drift silently — which is the failure mode #1588 describes.
//
// WHAT IS MIRRORED AND WHY (dataprep's names):
//   CHARS_PER_TOKEN            dataprep: CHARS_PER_TOKEN = 4
//   CONTEXTUAL_MAX_TOKENS      dataprep: DATAPREP_CONTEXTUAL_MAX_TOKENS (512)
//   LABEL_LLM_BATCH_SIZE       dataprep: DATAPREP_LLM_LABEL_BATCH_SIZE (4)
//   chunk size                 dataprep: DATAPREP_CHUNK_SIZE + the per-extension
//                              map in genieai_dataprep_microservice.py
//                              (get_chunk_size_for_file)
//   prompt length              dataprep: CONTEXTUAL_RETRIEVAL_PROMPT (default
//                              _CONTEXTUAL_RETRIEVAL_PROMPT_DEFAULT, 1016 chars)
//   header / marker            dataprep: DOC_CONTEXT_HEADER,
//                              DOC_CONTEXT_TRUNCATION_MARKER
//
// THE BATCH TERM — WHY THE SMALLEST CONFIGURED CHUNK SIZE. dataprep reserves
// the serialized user turn of the LARGEST chunks of the document it is
// processing, so its budget SHRINKS as the chunk size grows. The ceiling
// must be a number that is safe for EVERY document, i.e. it must be at most
// the largest budget any document can have — and the largest budget belongs
// to the SMALLEST configured chunk size. Deriving from the smallest chunk
// size therefore makes "over the ceiling ⇒ truncated" hold for every
// document type, while deriving from the largest would let a document pass
// a gate whose own (smaller) budget would have truncated it.
//
// THE OUTPUT TERM SCALES WITH THE BATCH. dataprep reserves
// DATAPREP_CONTEXTUAL_MAX_TOKENS per chunk of the batch (max_tokens is
// multiplied by the batch size), so the reservation is
// CONTEXTUAL_MAX_TOKENS × LABEL_LLM_BATCH_SIZE — not a flat cap.
//
// THE SCAFFOLD TERM IS REPRESENTATIVE. dataprep measures the scaffolding
// (the filename line, the labels line, the header, the truncation marker)
// per document, because a filename and a label list are unbounded. The
// ceiling has no document, so it reserves a representative allowance. The
// representative is generous by construction: it assumes a filename and a
// two-label line, which is what the measured deployment carried.

/** dataprep: CHARS_PER_TOKEN = 4 (~4 chars/token for English prose). */
const CHARS_PER_TOKEN = 4;

/** dataprep: DATAPREP_CONTEXTUAL_MAX_TOKENS (default 512). */
const CONTEXTUAL_MAX_TOKENS_DEFAULT = 512;

/** dataprep: DATAPREP_LLM_LABEL_BATCH_SIZE (default 4). */
const LABEL_LLM_BATCH_SIZE_DEFAULT = 4;

/** dataprep: DATAPREP_CHUNK_SIZE (the global fallback, default 500). */
const CHUNK_SIZE_DEFAULT = 500;

/** The per-extension chunk-size map dataprep resolves
 * (genieai_dataprep_microservice.py: get_chunk_size_for_file). */
const CHUNK_SIZE_EXTENSIONS = [
  ['.pdf', 'DATAPREP_CHUNK_SIZE_PDF'],
  ['.docx', 'DATAPREP_CHUNK_SIZE_DOCX'],
  ['.xlsx', 'DATAPREP_CHUNK_SIZE_XLSX'],
  ['.pptx', 'DATAPREP_CHUNK_SIZE_PPTX'],
  ['.html', 'DATAPREP_CHUNK_SIZE_HTML'],
  ['.txt', 'DATAPREP_CHUNK_SIZE_TXT'],
  ['.md', 'DATAPREP_CHUNK_SIZE_MD']
];

/** dataprep: DOC_CONTEXT_HEADER. */
const DOC_CONTEXT_HEADER = 'Document content (may be truncated):\n';

/** dataprep: DOC_CONTEXT_TRUNCATION_MARKER. */
const DOC_CONTEXT_TRUNCATION_MARKER = '...[truncated]';

/** dataprep: _CONTEXTUAL_RETRIEVAL_PROMPT_DEFAULT (1016 chars) — the
 * per-chunk system prompt whose tokens are reserved from the window. */
const CONTEXTUAL_RETRIEVAL_PROMPT_DEFAULT_CHARS = 1016;

/** The representative scaffolding a concept document carries: the filename
 * line and a two-label line, joined the way dataprep joins them
 * (a newline between the prefix and the header). */
const REPRESENTATIVE_SCAFFOLD_PREFIX = 'Filename: concept.md\nDocument labels: category, service';

/** Read an int env var, or the default when unset/unusable. */
function intEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
  const parsed = parseInt(String(raw).trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** The batch size dataprep would use (DATAPREP_LLM_LABEL_BATCH_SIZE). */
function labelBatchSize() {
  return intEnv('DATAPREP_LLM_LABEL_BATCH_SIZE', LABEL_LLM_BATCH_SIZE_DEFAULT);
}

/** The output reservation dataprep would make:
 * DATAPREP_CONTEXTUAL_MAX_TOKENS per chunk of the batch. */
function outputTokens() {
  return intEnv('DATAPREP_CONTEXTUAL_MAX_TOKENS', CONTEXTUAL_MAX_TOKENS_DEFAULT) * labelBatchSize();
}

/** The SMALLEST chunk size the deployment configures — the one whose budget
 * is the largest, and therefore the one a document-agnostic ceiling must be
 * derived from (see the header). Unknown extensions fall back to dataprep's
 * global default, so that default is part of the set. */
function smallestChunkSize() {
  const globalDefault = intEnv('DATAPREP_CHUNK_SIZE', CHUNK_SIZE_DEFAULT);
  let smallest = globalDefault;
  for (const [, envName] of CHUNK_SIZE_EXTENSIONS) {
    const size = intEnv(envName, globalDefault);
    if (size < smallest) smallest = size;
  }
  return smallest;
}

/** The serialized user turn of a batch of chunks — the EXACT shape dataprep
 * sends: json.dumps of [{"index": i, "text": t}] with python's DEFAULT
 * separators (", " between items, ": " after the keys) and ensure_ascii
 * escaping. Python's json.dumps is not JSON.stringify: the spaces are part
 * of the reservation, and a non-ASCII document expands every character to
 * a six-character escape (dataprep: _batch_user_turn_chars).
 *
 * @param {number} batchSize number of chunks in the batch
 * @param {number} chunkChars characters per chunk
 * @returns {number} the serialized length in characters
 */
function serializedBatchChars(batchSize, chunkChars) {
  const parts = [];
  for (let i = 0; i < batchSize; i += 1) {
    parts.push(`{"index": ${i}, "text": "${'x'.repeat(chunkChars)}"}`);
  }
  return parts.length ? `[${parts.join(', ')}]`.length : 0;
}

/** The prompt tokens reserved from the window: the per-chunk system prompt
 * (DATAPREP_CONTEXTUAL_RETRIEVAL_PROMPT when the deployment sets it, else
 * dataprep's default length). */
function promptTokens() {
  const override = process.env.DATAPREP_CONTEXTUAL_RETRIEVAL_PROMPT;
  const chars =
    override && String(override).trim() !== '' ? String(override).length : CONTEXTUAL_RETRIEVAL_PROMPT_DEFAULT_CHARS;
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

/** The scaffold tokens reserved from the window (filename + labels + header
 * + truncation marker) — the representative allowance (see the header). */
function scaffoldTokens() {
  const chars =
    REPRESENTATIVE_SCAFFOLD_PREFIX.length + 1 + DOC_CONTEXT_HEADER.length + DOC_CONTEXT_TRUNCATION_MARKER.length;
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

/**
 * The terms the derivation subtracts from the window.
 *
 * @returns {{prompt:number,batch:number,output:number,scaffold:number,total:number,chunkChars:number,batchSize:number}}
 */
function budgetTerms() {
  const batchSize = labelBatchSize();
  const chunkChars = smallestChunkSize();
  const prompt = promptTokens();
  const batch = Math.ceil(serializedBatchChars(batchSize, chunkChars) / CHARS_PER_TOKEN);
  const output = outputTokens();
  const scaffold = scaffoldTokens();
  return { prompt, batch, output, scaffold, total: prompt + batch + output + scaffold, chunkChars, batchSize };
}

/**
 * The concept-document ceiling implied by a serving-model window.
 *
 * Mirrors dataprep's `_resolve_doc_budget`: the usable window minus the
 * reservations, in tokens, converted to characters.
 *
 * @param {number} windowTokens the serving model's context window in tokens
 * @returns {{ceiling:number, usableTokens:number, terms:object, fits:boolean}}
 *   `fits` false = the window cannot even hold the reservations: dataprep
 *   skips contextualization there (raw chunks, no truncation), so there is
 *   NO ceiling to derive — the caller must fall back.
 */
function deriveCeiling(windowTokens) {
  const terms = budgetTerms();
  const usableTokens = Number(windowTokens) - terms.total;
  if (!Number.isFinite(usableTokens) || usableTokens <= 0) {
    return { ceiling: 0, usableTokens: 0, terms, fits: false };
  }
  return { ceiling: usableTokens * CHARS_PER_TOKEN, usableTokens, terms, fits: true };
}

module.exports = {
  CHARS_PER_TOKEN,
  CONTEXTUAL_MAX_TOKENS_DEFAULT,
  LABEL_LLM_BATCH_SIZE_DEFAULT,
  CHUNK_SIZE_DEFAULT,
  CHUNK_SIZE_EXTENSIONS,
  DOC_CONTEXT_HEADER,
  DOC_CONTEXT_TRUNCATION_MARKER,
  CONTEXTUAL_RETRIEVAL_PROMPT_DEFAULT_CHARS,
  REPRESENTATIVE_SCAFFOLD_PREFIX,
  budgetTerms,
  deriveCeiling,
  labelBatchSize,
  outputTokens,
  promptTokens,
  scaffoldTokens,
  serializedBatchChars,
  smallestChunkSize
};
