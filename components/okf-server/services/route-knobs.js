// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
//
// route-knobs — the ONE loader for the routing knobs the Lab and the
// retriever share (#2061 phase 1b).
//
// These knobs used to be captured at MODULE LOAD in three places:
//   - services/head-test-service.js (ROUTE_* constants)
//   - services/head-suite-service.js (the GATE_* aliases — a second copy of
//     three of them)
//   - genie-ai-overlay/retriever/config.py (the PRODUCTION authority)
//
// A retune plus a single-service restart therefore left the Lab and
// production on different thresholds — both green, neither honest — and the
// effective values never reached the run record, so a stored run could not
// say which thresholds produced it.
//
// This module reads the environment PER RUN. A retune takes effect on the
// next run without a restart, and the resolved values are what the run
// record carries.
//
// THE PYTHON SIDE IS THE AUTHORITY. The defaults below mirror
// genie-ai-overlay/retriever/config.py:171-223 exactly; the parity is
// enforced by the config-validator suite (tests/config-validator), which
// fails loud when the two drift apart. Change one, change both.
//
// EVERY route knob the retriever defines is modelled here, not only the
// numeric thresholds: ROUTE_ENABLED, ROUTE_HEADS_SUPERSEDE and
// ROUTE_HEAD_WEIGHT change the routing OUTCOME, so a Lab that ignored
// them would report a gated verdict for a deployment that does not gate.
// routeParity() says when the Lab's verdict does not stand for production.

'use strict';

const { logger } = require('../shared-lib/logger');

/**
 * The effective defaults — the retriever's config.py values. Kept as data
 * (not re-derived) so the run record can state the DEFAULTS it would have
 * used, and so the parity test has a single table to compare against.
 *
 * The boolean knobs are the retriever's `os.getenv(X, "true").lower() ==
 * "true"` form: anything but "true" is false there, so a garbled value is
 * a WARNING here (it falls back to the default) rather than a silent
 * posture flip — the divergence is loud, not silent.
 */
const ROUTE_KNOB_DEFAULTS = {
  ROUTE_ENABLED: true,
  ROUTE_TOP_K: 40,
  ROUTE_MIN_CHUNKS: 3,
  ROUTE_PROBE_TIMEOUT_MS: 2000,
  ROUTE_RETRY: 1,
  ROUTE_HEAD_WEIGHT: 1.0,
  ROUTE_HEAD_MARGIN: 0.01,
  ROUTE_HEAD_FLOOR: 0.55,
  ROUTE_FORBIDDEN_TAG_MAX: 0.55,
  ROUTE_HEADS_SUPERSEDE: true
};

/** The env var each knob is read from (the same names config.py reads). */
const ROUTE_KNOB_ENV = {
  ROUTE_ENABLED: 'RETRIEVER_ROUTE_ENABLED',
  ROUTE_TOP_K: 'RETRIEVER_ROUTE_TOP_K',
  ROUTE_MIN_CHUNKS: 'RETRIEVER_ROUTE_MIN_CHUNKS',
  ROUTE_PROBE_TIMEOUT_MS: 'RETRIEVER_ROUTE_PROBE_TIMEOUT_MS',
  ROUTE_RETRY: 'RETRIEVER_ROUTE_RETRY',
  ROUTE_HEAD_WEIGHT: 'RETRIEVER_ROUTE_HEAD_WEIGHT',
  ROUTE_HEAD_MARGIN: 'RETRIEVER_ROUTE_HEAD_MARGIN',
  ROUTE_HEAD_FLOOR: 'RETRIEVER_ROUTE_HEAD_FLOOR',
  ROUTE_FORBIDDEN_TAG_MAX: 'RETRIEVER_ROUTE_FORBIDDEN_TAG_MAX',
  ROUTE_HEADS_SUPERSEDE: 'RETRIEVER_ROUTE_HEADS_SUPERSEDE'
};

/**
 * How each knob is parsed — DECLARED, not inferred.
 *
 * The default alone cannot say: `1.0` is the number 1 in JavaScript, so
 * `Number.isInteger(1.0)` is true and a float knob would be read with
 * parseInt — "2.5" would become 2. The retriever's config.py says which
 * is which (`int(...)` / `float(...)` / `== "true"`), and so does this.
 */
const ROUTE_KNOB_TYPES = {
  ROUTE_ENABLED: 'boolean',
  ROUTE_TOP_K: 'int',
  ROUTE_MIN_CHUNKS: 'int',
  ROUTE_PROBE_TIMEOUT_MS: 'int',
  ROUTE_RETRY: 'int',
  ROUTE_HEAD_WEIGHT: 'float',
  ROUTE_HEAD_MARGIN: 'float',
  ROUTE_HEAD_FLOOR: 'float',
  ROUTE_FORBIDDEN_TAG_MAX: 'float',
  ROUTE_HEADS_SUPERSEDE: 'boolean'
};

/**
 * The knobs already warned about, so a garbled value speaks ONCE per
 * process instead of once per query (the loader is called per row — a
 * 200-row suite would otherwise log 200 identical warnings and the signal
 * the warning exists to create would drown in its own repetitions).
 */
const warned = new Set();

/**
 * Warn once per knob per process.
 *
 * @param {string} event - The log event name
 * @param {string} knob - The knob name
 * @param {string} env - The env var name
 * @param {*} using - The value used instead
 * @returns {void}
 */
function warnOnce(event, knob, env, using) {
  if (warned.has(knob)) return;
  warned.add(knob);
  logger.warn(event, { knob, env, using_default: using });
}

/**
 * Parse an integer env value, degrading to the default on garbage.
 *
 * @param {string} raw - The raw env value
 * @param {number} fallback - The default
 * @returns {number} The parsed value
 */
function intEnv(raw, fallback) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Parse a float env value, degrading to the default on garbage.
 *
 * @param {string} raw - The raw env value
 * @param {number} fallback - The default
 * @returns {number} The parsed value
 */
function floatEnv(raw, fallback) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Parse a boolean env value, degrading to the default on garbage.
 *
 * The retriever reads these as `os.getenv(X, "true").lower() == "true"`,
 * so only "true" is true there. A value that is neither "true" nor
 * "false" is garbage in BOTH places — the retriever would silently flip
 * the posture, so the Lab warns loudly and keeps the default.
 *
 * @param {string} raw - The raw env value
 * @param {boolean} fallback - The default
 * @returns {boolean} The parsed value
 */
function boolEnv(raw, fallback) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
  const v = String(raw).trim().toLowerCase();
  if (v === 'true') return true;
  if (v === 'false') return false;
  return fallback;
}

/**
 * Resolve the effective knobs from the CURRENT environment.
 *
 * A garbled value degrades to the default and is logged ONCE: a gate
 * compared against NaN is always false, so the claim check would silently
 * INVERT, and a garbled boolean would silently flip a routing posture.
 * A garbled knob must never reach a comparison, and never flip a posture
 * without a word about it.
 *
 * @returns {object} The effective knobs
 */
function routeKnobs() {
  const out = {};
  for (const [knob, envName] of Object.entries(ROUTE_KNOB_ENV)) {
    const fallback = ROUTE_KNOB_DEFAULTS[knob];
    const raw = process.env[envName];
    const type = ROUTE_KNOB_TYPES[knob];
    const isBool = type === 'boolean';
    const isInt = type === 'int';
    let value;
    if (isBool) {
      value = boolEnv(raw, fallback);
      if (raw !== undefined && String(raw).trim() !== '') {
        const v = String(raw).trim().toLowerCase();
        if (v !== 'true' && v !== 'false') {
          warnOnce('route_knob.unparseable', knob, envName, fallback);
        }
      }
    } else {
      value = isInt ? intEnv(raw, fallback) : floatEnv(raw, fallback);
      if (raw !== undefined && String(raw).trim() !== '') {
        const parsed = isInt ? parseInt(raw, 10) : parseFloat(raw);
        if (!Number.isFinite(parsed)) {
          warnOnce('route_knob.unparseable', knob, envName, fallback);
        }
      }
    }
    out[knob] = value;
  }
  return out;
}

/**
 * Does the Lab's verdict STAND FOR PRODUCTION under these knobs?
 *
 * The Lab replays the head gate. Three of the retriever's route knobs
 * change the routing OUTCOME rather than a threshold:
 *
 *   ROUTE_ENABLED=false        → the retriever does not route at all; the
 *                                gate does not decide anything.
 *   ROUTE_HEADS_SUPERSEDE=false → the chunk competition decides routing, so
 *                                a vetoed head can still be routed and the
 *                                Lab's gate verdict says nothing about it.
 *   ROUTE_HEAD_WEIGHT !== 1     → the head pseudo-row competes in the chunk
 *                                pool with a different weight; the Lab
 *                                replays the competition without that row.
 *
 * When any of them is off, the Lab's numbers describe the Lab, not the
 * deployment — and the run record must SAY so rather than certify a
 * parity that does not hold.
 *
 * The reasons are CODES, not sentences: the sentence that explains one to
 * a human is UI copy, and UI copy is translated.
 *
 * @param {object} knobs - The effective knobs
 * @returns {{production_equivalent: boolean, reasons: string[]}} The parity statement
 */
function routeParity(knobs = {}) {
  const reasons = [];
  if (knobs.ROUTE_ENABLED !== true) {
    reasons.push('routing_disabled');
  }
  if (knobs.ROUTE_HEADS_SUPERSEDE !== true) {
    reasons.push('heads_not_supersede');
  }
  if (knobs.ROUTE_HEAD_WEIGHT !== 1) {
    reasons.push('head_weight');
  }
  return { production_equivalent: reasons.length === 0, reasons };
}

module.exports = { routeKnobs, routeParity, ROUTE_KNOB_DEFAULTS, ROUTE_KNOB_ENV, ROUTE_KNOB_TYPES };
