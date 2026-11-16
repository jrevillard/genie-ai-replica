// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
//
// #1205 — the concept-document ceiling is DERIVED from the serving-model
// window the same endpoint dataprep reads (ruling 2026-11-15), closing the
// #1588 static-literal gap.
//
// The property under test is NOT "a big document is refused" (the existing
// guard suite owns that). It is: **the ceiling the write paths enforce is
// the number dataprep's own budget arithmetic implies for the window this
// deployment serves** — and when the window is unknown, the ceiling fails
// CONSERVATIVE-BUT-USABLE rather than fail-closed (a guess-derived write
// ceiling would refuse nearly every import during an endpoint blip).

jest.mock('../shared-lib/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

const {
  effectiveCeiling,
  maxConceptDocChars,
  conceptTooLargeError,
  CEILING_SOURCES
} = require('../services/concept-ceiling');
const llmWindow = require('../services/llm-window');
const mirror = require('../services/contextual-budget-mirror');

/** The deployment shape: a 65 536-token window with a batch of 16 chunks
 * of 500 chars (the local build's DATAPREP_LLM_LABEL_BATCH_SIZE). The
 * ceiling reserves the WORST-CASE script (ensure_ascii: every chunk char
 * as a 6-char escape): 254 prompt + 12104 batch + 8192 output + 27
 * scaffold tokens → 44959 usable → 179836 characters. */
const MEASURED_WINDOW = 65536;
const MEASURED_CEILING = 179836;

describe('#1205 — the derived ceiling', () => {
  const ORIGINALS = {
    OKF_MAX_CONCEPT_DOC_CHARS: process.env.OKF_MAX_CONCEPT_DOC_CHARS,
    DATAPREP_MAX_MODEL_LEN: process.env.DATAPREP_MAX_MODEL_LEN,
    DATAPREP_LLM_LABEL_BATCH_SIZE: process.env.DATAPREP_LLM_LABEL_BATCH_SIZE,
    DATAPREP_CONTEXTUAL_MAX_TOKENS: process.env.DATAPREP_CONTEXTUAL_MAX_TOKENS,
    DATAPREP_CHUNK_SIZE: process.env.DATAPREP_CHUNK_SIZE,
    DATAPREP_CHUNK_SIZE_MD: process.env.DATAPREP_CHUNK_SIZE_MD
  };

  beforeEach(() => {
    // NO jest.resetModules(): the ceiling and the window are singletons the
    // write paths share, and the ladder's state (the last-known derived
    // value) must be the SAME instance the assertions read. Both modules
    // read their env at CALL time, so the env cleanup below is enough.
    delete process.env.OKF_MAX_CONCEPT_DOC_CHARS;
    delete process.env.DATAPREP_MAX_MODEL_LEN;
    delete process.env.DATAPREP_CONTEXTUAL_MAX_TOKENS;
    delete process.env.DATAPREP_CHUNK_SIZE;
    delete process.env.DATAPREP_CHUNK_SIZE_MD;
    // The MEASURED deployment's batch size (the local build runs
    // DATAPREP_LLM_LABEL_BATCH_SIZE=16 — the label batch, not the code
    // default of 4). The measurement the ceiling must reproduce was taken
    // with it.
    process.env.DATAPREP_LLM_LABEL_BATCH_SIZE = '16';
    llmWindow._resetForTesting();
    require('../services/concept-ceiling')._resetForTesting();
  });

  afterAll(() => {
    for (const [key, value] of Object.entries(ORIGINALS)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  /** Pretend the discovery answered with this window. */
  function windowIs(tokens, source = 'discovered') {
    llmWindow.__setWindowForTesting(tokens, source);
  }

  test('the mirror derives the WORST-CASE budget exactly (every script safe)', () => {
    // The recorded 2026-11-06 measurement (~219 700 on this window) was
    // dataprep's own per-document number for an ASCII corpus. A POLICY
    // ceiling has no document, so it reserves python's ensure_ascii WORST
    // case (every chunk char as a 6-char \uXXXX escape) — the guarantee
    // "over the ceiling ⇒ truncated" must hold for the multilingual
    // corpora this deployment serves, not just ASCII ones.
    const terms = mirror.budgetTerms();
    expect(terms.prompt).toBe(254); // the recorded prompt reservation
    // 16 items × (24 JSON-scaffolding + 500×6 escaped chars) + 15×2 separators
    expect(terms.batch).toBe(12104);
    expect(terms.output).toBe(8192); // the recorded output reservation
    expect(terms.chunkChars).toBe(500);

    const derived = mirror.deriveCeiling(MEASURED_WINDOW);
    expect(derived.fits).toBe(true);
    expect(derived.ceiling).toBe(MEASURED_CEILING);
  });

  test('an ASCII-only reservation would derive ~219 700 — the recorded measurement, as documentation', () => {
    //dataprep's own number for its ASCII corpus: batch of 16 × 500 ASCII
    // chars + the JSON scaffolding, serialized with spaces and no escapes.
    const ascii = [];
    for (let i = 0; i < 16; i += 1) ascii.push(`{"index": ${i}, "text": "${'x'.repeat(500)}"}`);
    const asciiChars = `[${ascii.join(', ')}]`.length;
    const asciiTokens = Math.ceil(asciiChars / 4);
    // 2106 tokens — the recorded batch reservation.
    expect(asciiTokens).toBe(2106);
    const usable = 65536 - 254 - asciiTokens - 8192 - 27;
    expect(usable * 4).toBe(219828); // the recorded ~219 700, exact
  });

  test('the DEFAULT batch (4) derives the static-literal neighborhood — where 250 000 came from', () => {
    // Honest detail: the 250 000 literal was not arbitrary — with the code
    // default batch of 4 the ASCII derivation lands at 250 724 on the same
    // window. The static literal was right for THAT deployment and wrong
    // for the measured one (batch 16) — exactly the drift #1588 describes.
    delete process.env.DATAPREP_LLM_LABEL_BATCH_SIZE;
    expect(mirror.budgetTerms().output).toBe(512 * 4);
    // worst case, batch 4: 254 + 3026 + 2048 + 27 reserved → 60181 usable
    expect(mirror.deriveCeiling(MEASURED_WINDOW).ceiling).toBe(240724);
  });

  test('a discovered window DERIVES the ceiling (and names the source)', () => {
    windowIs(MEASURED_WINDOW);
    const effective = effectiveCeiling();
    expect(effective.source).toBe(CEILING_SOURCES.DERIVED);
    expect(effective.ceiling).toBe(MEASURED_CEILING);
    expect(effective.window).toBe(MEASURED_WINDOW);
    expect(maxConceptDocChars()).toBe(MEASURED_CEILING);
  });

  test('a SMALLER window derives a SMALLER ceiling (the #1588 drift, closed)', () => {
    windowIs(MEASURED_WINDOW);
    const big = maxConceptDocChars();
    windowIs(32768);
    const small = maxConceptDocChars();
    expect(small).toBeLessThan(big);
    expect(small).toBeGreaterThan(0);
  });

  test('the operator PIN wins at ANY window, uncapped', () => {
    windowIs(MEASURED_WINDOW);
    process.env.OKF_MAX_CONCEPT_DOC_CHARS = '1234';
    const effective = effectiveCeiling();
    expect(effective.ceiling).toBe(1234);
    expect(effective.source).toBe(CEILING_SOURCES.OPERATOR_PIN);
  });

  test('the operator pin wins even when the window would derive a SMALLER number', () => {
    // A pin is a deliberate statement — the derivation never overrules it
    // (dataprep's own rule for an explicit budget).
    windowIs(8192);
    process.env.OKF_MAX_CONCEPT_DOC_CHARS = '400000';
    expect(effectiveCeiling().ceiling).toBe(400000);
  });

  test('an unknown window falls back to the STATIC default (never a guess)', () => {
    windowIs(null, 'unknown');
    const effective = effectiveCeiling();
    expect(effective.source).toBe(CEILING_SOURCES.STATIC_DEFAULT);
    expect(effective.ceiling).toBe(250000);
  });

  test('an endpoint failure serves the LAST-KNOWN derived ceiling (stale beats broken)', () => {
    windowIs(MEASURED_WINDOW);
    expect(effectiveCeiling().source).toBe(CEILING_SOURCES.DERIVED);
    // The endpoint goes away — the window is unknown again.
    windowIs(null, 'unknown');
    const effective = effectiveCeiling();
    expect(effective.source).toBe(CEILING_SOURCES.LAST_KNOWN);
    expect(effective.ceiling).toBe(MEASURED_CEILING);
  });

  test('a window too small to hold the reservations falls back (no budget there)', () => {
    // 2048 tokens cannot hold 254 + 2106 + 8192 + scaffold — dataprep serves
    // RAW chunks there (no contextualization, so no truncation), so there is
    // no ceiling to derive.
    windowIs(2048);
    const effective = effectiveCeiling();
    expect(effective.source).toBe(CEILING_SOURCES.STATIC_DEFAULT);
    expect(effective.ceiling).toBe(250000);
  });

  test('the refusal names the ceiling SOURCE (which lever moves the number)', () => {
    windowIs(MEASURED_WINDOW);
    const err = conceptTooLargeError({ label: 'concept "x"', chars: 300, ceiling: 100 });
    expect(err.details.ceiling_source).toBe(CEILING_SOURCES.DERIVED);
    expect(err.message).toMatch(/discovered-from-window/);
    // The shared vocabulary is unchanged: the code, the status, the facts.
    expect(err.code).toBe('CONCEPT_TOO_LARGE');
    expect(err.status).toBe(409);
    expect(err.details).toMatchObject({ concept_id: 'concept "x"', chars: 300, ceiling: 100 });
  });
});

describe('#1205 — the mirror reads the DEPLOYMENT knobs', () => {
  const ORIGINALS = {
    DATAPREP_LLM_LABEL_BATCH_SIZE: process.env.DATAPREP_LLM_LABEL_BATCH_SIZE,
    DATAPREP_CHUNK_SIZE: process.env.DATAPREP_CHUNK_SIZE,
    DATAPREP_CHUNK_SIZE_MD: process.env.DATAPREP_CHUNK_SIZE_MD,
    DATAPREP_CHUNK_SIZE_PDF: process.env.DATAPREP_CHUNK_SIZE_PDF,
    DATAPREP_CONTEXTUAL_MAX_TOKENS: process.env.DATAPREP_CONTEXTUAL_MAX_TOKENS
  };

  beforeEach(() => {
    jest.resetModules();
    for (const key of Object.keys(ORIGINALS)) delete process.env[key];
  });

  afterAll(() => {
    for (const [key, value] of Object.entries(ORIGINALS)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  test('the batch size follows DATAPREP_LLM_LABEL_BATCH_SIZE', () => {
    expect(mirror.labelBatchSize()).toBe(4); // dataprep's default
    process.env.DATAPREP_LLM_LABEL_BATCH_SIZE = '16';
    expect(mirror.labelBatchSize()).toBe(16);
  });

  test('the output term SCALES with the batch (dataprep reserves per chunk)', () => {
    expect(mirror.outputTokens()).toBe(512 * 4);
    process.env.DATAPREP_CONTEXTUAL_MAX_TOKENS = '1024';
    process.env.DATAPREP_LLM_LABEL_BATCH_SIZE = '8';
    expect(mirror.outputTokens()).toBe(1024 * 8);
  });

  test('the chunk size is the SMALLEST configured one (the safe budget)', () => {
    // The default map: every extension falls back to the global default.
    expect(mirror.smallestChunkSize()).toBe(500);
    // A deployment that raises one extension's chunks does not move the
    // ceiling — the smallest chunk size still sets the largest budget.
    process.env.DATAPREP_CHUNK_SIZE_XLSX = '1500';
    expect(mirror.smallestChunkSize()).toBe(500);
    // A deployment that LOWERS one extension's chunks DOES move it: that
    // document type's budget is now the binding one.
    process.env.DATAPREP_CHUNK_SIZE_MD = '250';
    expect(mirror.smallestChunkSize()).toBe(250);
  });

  test('the serialized batch reserves python json.dumps at its WORST case', () => {
    // The reservation models ensure_ascii at its extreme: every chunk char
    // as a 6-character \uXXXX escape. The JSON scaffolding per item does
    // not escape, and python's ", " / ": " separators are part of it.
    expect(mirror.serializedBatchChars(1, 1)).toBe(24 + 6); // 1 item, no separator
    expect(mirror.serializedBatchChars(2, 0)).toBe(2 * 24 + 2); // two items, one ", " separator
    expect(mirror.serializedBatchChars(16, 500)).toBe(16 * (24 + 3000) + 15 * 2);
  });
});
