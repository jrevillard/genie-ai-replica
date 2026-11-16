// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
//
// ceiling-controller — the READOUT of the concept-document ceiling in
// effect right now (#1205).
//
// Since the ceiling is DERIVED (services/concept-ceiling.js), the number is
// no longer a constant an operator can read in a config file and compare
// with a doc. This readout answers the two questions that follow from that:
// "what is the ceiling right now?" and "WHY is it that number?" — the
// source (operator pin / discovered window / last-known / static default),
// the window it was derived from, and the terms of the derivation.
//
// It is also what the smoke harness asserts against (#1205 story 3): the
// LIVE effective ceiling, read from the LIVE server — not a second
// derivation in the smoke (which would be the drift the spec forbids).

const { effectiveCeiling } = require('../services/concept-ceiling');
const llmWindow = require('../services/llm-window');
const { budgetTerms, deriveCeiling, CHARS_PER_TOKEN } = require('../services/contextual-budget-mirror');

/**
 * GET /api/okf/admin/ceiling — the effective ceiling and its provenance.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {Function} next
 */
async function getCeiling(req, res, next) {
  try {
    const effective = effectiveCeiling();
    const window = llmWindow.currentWindow();
    const terms = budgetTerms();
    const derived = window.window ? deriveCeiling(window.window) : null;

    res.status(200).json({
      ceiling: effective.ceiling,
      source: effective.source,
      window_tokens: effective.window,
      window_source: window.source,
      terms: {
        prompt_tokens: terms.prompt,
        batch_tokens: terms.batch,
        output_tokens: terms.output,
        scaffold_tokens: terms.scaffold,
        reserved_tokens: terms.total,
        chunk_chars: terms.chunkChars,
        batch_size: terms.batchSize,
        chars_per_token: CHARS_PER_TOKEN
      },
      derived_ceiling: derived ? derived.ceiling : null,
      derived_fits: derived ? derived.fits : null
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { getCeiling };
