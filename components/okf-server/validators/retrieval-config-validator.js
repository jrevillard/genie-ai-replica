// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Story 1.7 (ADR-okf-039 D3) — validation policy for the retrieval governance
// config. SINGLE SOURCE for the mode enum, the cap limits, and the safe
// defaults — consumed by the retrieval-config service (env-default + stored-
// doc sanitizing) and by the PUT path (joi). No imports beyond joi, so the
// service can require this freely (no require cycles).

const Joi = require('joi');

const MODES = ['legacy', 'okf_only', 'hybrid'];

// Validation limits (ADR-039 D3: "mode enum, caps ≥1, ≤ sane maxima").
const LIMITS = {
  max_fanout_graphs: { min: 1, max: 20 },
  spine_max_hops: { min: 1, max: 3 },
  extracted_hop_cap: { min: 1, max: 3 },
  candidate_cap_per_graph: { min: 1, max: 200 },
  candidate_cap_global: { min: 1, max: 1000 }
};

// The floor when even the ENV value is garbage (mirrors config.js comments;
// 'legacy' is deliberately the safe default — the fan-out never engages on a
// misconfigured deployment).
const DEFAULTS = {
  mode: 'legacy',
  max_fanout_graphs: 5,
  spine_max_hops: 2,
  extracted_hop_cap: 1,
  candidate_cap_per_graph: 50,
  candidate_cap_global: 200
};

// Per-field read-path sanitizer: an invalid value from ANY source (a garbled
// env var, a hand-edited stored doc) falls back to the safe default instead of
// flowing into the read-model. `mode !== 'legacy'` style engagement logic is
// therefore safe: only a KNOWN non-legacy mode can ever reach the gate.
const FIELD_SANITIZERS = {
  mode: (v) => (MODES.includes(v) ? v : DEFAULTS.mode)
};
for (const [key, { min, max }] of Object.entries(LIMITS)) {
  FIELD_SANITIZERS[key] = (v) => (Number.isInteger(v) && v >= min && v <= max ? v : DEFAULTS[key]);
}

/**
 * Sanitize a raw config-ish object field-by-field (unknown fields dropped,
 * invalid values → safe defaults). Used for BOTH sources: env boot defaults
 * and the stored governance doc.
 * @param {object|null} raw
 */
function sanitizeConfigShape(raw) {
  const out = {};
  for (const [key, sanitize] of Object.entries(FIELD_SANITIZERS)) {
    out[key] = sanitize(raw ? raw[key] : undefined);
  }
  return out;
}

// PUT schema — the ONLY write path into the governed row. Unknown fields are
// REJECTED here (unlike the read-path sanitizer, a PUT typo should fail loudly,
// not silently vanish): the operator must see that `repo_id` (say) is not
// configurable.
const retrievalConfigPatchSchema = Joi
  .object({
    mode: Joi.string().valid(...MODES),
    max_fanout_graphs: Joi.number().integer().min(LIMITS.max_fanout_graphs.min).max(LIMITS.max_fanout_graphs.max),
    spine_max_hops: Joi.number().integer().min(LIMITS.spine_max_hops.min).max(LIMITS.spine_max_hops.max),
    extracted_hop_cap: Joi.number().integer().min(LIMITS.extracted_hop_cap.min).max(LIMITS.extracted_hop_cap.max),
    candidate_cap_per_graph: Joi.number()
      .integer()
      .min(LIMITS.candidate_cap_per_graph.min)
      .max(LIMITS.candidate_cap_per_graph.max),
    candidate_cap_global: Joi.number().integer().min(LIMITS.candidate_cap_global.min).max(LIMITS.candidate_cap_global.max)
  })
  .min(1) // an empty/fieldless PUT is meaningless — reject, don't no-op
  .unknown(false)
  .required();

/**
 * Validate a PUT payload. Throws a VALIDATION_ERROR Error (with .code/.status,
 * house error shape) carrying the joi message list.
 * @returns {object} the sanitized patch
 */
function validateRetrievalConfigPatch(body) {
  const { value, error } = retrievalConfigPatchSchema.validate(body, { abortEarly: false });
  if (error) {
    throw Object.assign(new Error('Request validation failed'), {
      code: 'VALIDATION_ERROR',
      status: 400,
      details: error.details.map((d) => d.message)
    });
  }
  return value;
}

module.exports = {
  MODES,
  LIMITS,
  DEFAULTS,
  sanitizeConfigShape,
  validateRetrievalConfigPatch,
  retrievalConfigPatchSchema
};
