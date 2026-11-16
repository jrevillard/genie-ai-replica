// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
//
// llm-window — the serving-model CONTEXT WINDOW the concept-document
// ceiling is derived from (#1205, closes #1588).
//
// The window is the ONE number dataprep reads at runtime to size a
// document context, and the ceiling must be derived from the SAME number:
// dataprep discovers it from the deployment's LLM endpoint (/v1/models),
// with the operator's DATAPREP_MAX_MODEL_LEN as the explicit override — the
// only lever on a strict OpenAI-compatible provider that serves
// /v1/models without max_model_len (dataprep: _serving_model_window).
//
// THE THREE TIERS, MIRRORED FROM DATAPREP:
//   1. operator-stated — DATAPREP_MAX_MODEL_LEN > 0. No request at all.
//   2. discovered      — the endpoint's /v1/models answers with the served
//                        window. TTL-cached (MODEL_DETECT_TTL — the same
//                        knob dataprep's python twin reads, so one .env
//                        line tunes both worlds) and stale-served on a
//                        failed probe.
//   3. unknown         — the endpoint is down or does not expose the
//                        field. NOT dataprep's fail-closed 2048 guess: that
//                        guess is right for SIZING A REQUEST (a budget that
//                        fits nowhere fails visibly) and wrong for a WRITE
//                        CEILING (a guess-derived ceiling would refuse
//                        nearly every import during an endpoint blip).
//                        The ceiling's own ladder owns what an unknown
//                        window means (services/concept-ceiling.js).
//
// NEVER ON THE WRITE PATH. The discovery probe is network I/O; the ceiling
// is read on every import, editor save and publish gate. So the window is
// resolved ASYNCHRONOUSLY (boot + a refresh interval) and read
// SYNCHRONOUSLY from the last-known state. A cold cache answers "unknown",
// and the ceiling falls back — a boot that cannot reach the endpoint
// degrades to the static default instead of blocking the first import.

const {
  getServedWindow,
  deploymentVllmBase,
  credentialForBase,
  MAX_SANE_MODEL_WINDOW_TOKENS
} = require('./vllm-model-cache');
const { logger } = require('../shared-lib/logger');

/** The window sources the ceiling's ladder can see. */
const WINDOW_SOURCES = {
  OPERATOR_STATED: 'operator-stated',
  DISCOVERED: 'discovered',
  STALE: 'stale',
  UNKNOWN: 'unknown'
};

/** The last resolved window — the synchronous view the ceiling reads. */
const state = {
  window: null,
  source: WINDOW_SOURCES.UNKNOWN,
  ts: 0,
  error: null
};

/** The operator's explicit statement of the window the endpoint serves.
 *
 * dataprep's tier 1 (DATAPREP_MAX_MODEL_LEN): 0 = discover, >0 = stated.
 * The same sanitization, including the SANITY CEILING: dataprep's
 * _sanitize_window_override treats an absurd override (a typo, or a
 * chars-not-tokens value) as unset and discovers instead — an absurd
 * stated window here would derive a ceiling of hundreds of millions of
 * characters and silently disable the guard on every write path.
 *
 * @returns {number|null}
 */
function operatorStatedWindow() {
  const raw = process.env.DATAPREP_MAX_MODEL_LEN;
  if (raw === undefined || raw === null || String(raw).trim() === '') return null;
  const parsed = parseInt(String(raw).trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  if (parsed > MAX_SANE_MODEL_WINDOW_TOKENS) return null;
  return parsed;
}

/**
 * Resolve the window (async — network I/O; never on a write path).
 *
 * @param {{timeoutMs?:number}} [opts]
 * @returns {Promise<{window:number|null, source:string, error:Error|null}>}
 */
async function resolveWindow({ timeoutMs } = {}) {
  const stated = operatorStatedWindow();
  if (stated !== null) {
    applyWindow(stated, WINDOW_SOURCES.OPERATOR_STATED, null);
    return { window: stated, source: WINDOW_SOURCES.OPERATOR_STATED, error: null };
  }

  const base = deploymentVllmBase();
  if (!base) {
    applyWindow(null, WINDOW_SOURCES.UNKNOWN, null);
    return { window: null, source: WINDOW_SOURCES.UNKNOWN, error: null };
  }

  try {
    const result = await getServedWindow(base, {
      timeoutMs,
      apiKey: credentialForBase(base),
      quiet: true
    });
    if (result.window !== null && result.window !== undefined) {
      applyWindow(result.window, result.stale ? WINDOW_SOURCES.STALE : WINDOW_SOURCES.DISCOVERED, null);
      return {
        window: result.window,
        source: result.stale ? WINDOW_SOURCES.STALE : WINDOW_SOURCES.DISCOVERED,
        error: null
      };
    }
    applyWindow(null, WINDOW_SOURCES.UNKNOWN, result.error || null);
    return { window: null, source: WINDOW_SOURCES.UNKNOWN, error: result.error || null };
  } catch (e) {
    applyWindow(null, WINDOW_SOURCES.UNKNOWN, e);
    return { window: null, source: WINDOW_SOURCES.UNKNOWN, error: e };
  }
}

/** Record a resolved window and log the STATE CHANGE (not every poll). */
function applyWindow(window, source, error) {
  const changed = state.window !== window || state.source !== source;
  state.window = window;
  state.source = source;
  state.ts = Date.now();
  state.error = error || null;
  if (!changed) return;
  if (source === WINDOW_SOURCES.DISCOVERED) {
    logger.info('ceiling.window.discovered', { window_tokens: window, source });
  } else if (source === WINDOW_SOURCES.OPERATOR_STATED) {
    logger.info('ceiling.window.overridden', { window_tokens: window, source });
  } else if (source === WINDOW_SOURCES.STALE) {
    logger.warn('ceiling.window.stale', {
      window_tokens: window,
      source,
      note: 'the /v1/models probe failed — the last-known window is being served (stale beats broken)'
    });
  } else {
    logger.warn('ceiling.window.unavailable', {
      source,
      error: error ? error.message : undefined,
      note: 'no serving-model window known — the ceiling falls back (the static default, or the operator pin)'
    });
  }
}

/**
 * The window the ceiling should use RIGHT NOW (synchronous, never network).
 *
 * @returns {{window:number|null, source:string, ts:number}}
 */
function currentWindow() {
  // The operator's statement is read live: it costs nothing and it keeps
  // the synchronous view honest even before the first probe settles.
  const stated = operatorStatedWindow();
  if (stated !== null) {
    return { window: stated, source: WINDOW_SOURCES.OPERATOR_STATED, ts: state.ts };
  }
  return { window: state.window, source: state.source, ts: state.ts };
}

/** The refresh cadence: the cache's own TTL knob (MODEL_DETECT_TTL), so
 * one .env line tunes dataprep's probe, okf-server's model-id probe and
 * this refresh together. */
function refreshIntervalMs() {
  const raw = parseInt(process.env.MODEL_DETECT_TTL || '', 10);
  const seconds = Number.isFinite(raw) && raw > 0 ? raw : 60;
  return seconds * 1000;
}

/**
 * Start the background refresh: one probe now, then one per TTL.
 *
 * The first probe is AWAITED by the caller when it wants the window ready
 * before serving (the boot path does); the interval keeps it fresh.
 *
 * @returns {{stop:()=>void, ready:Promise<{window:number|null,source:string,error:Error|null}>}}
 */
function startWindowRefresh({ timeoutMs } = {}) {
  const ready = resolveWindow({ timeoutMs });
  const timer = setInterval(() => {
    resolveWindow({ timeoutMs }).catch(() => {
      /* resolveWindow never throws — it reports the failure in the state */
    });
  }, refreshIntervalMs());
  if (typeof timer.unref === 'function') timer.unref();
  return {
    ready,
    stop: () => clearInterval(timer)
  };
}

/** Test hook: forget the resolved window. */
function _resetForTesting() {
  state.window = null;
  state.source = WINDOW_SOURCES.UNKNOWN;
  state.ts = 0;
  state.error = null;
}

/** Test hook: pretend the discovery answered with this window (the tests
 * must not probe a network to exercise the ladder). */
function __setWindowForTesting(window, source) {
  state.window = window === undefined ? null : window;
  state.source = source || WINDOW_SOURCES.UNKNOWN;
  state.ts = Date.now();
  state.error = null;
}

module.exports = {
  WINDOW_SOURCES,
  currentWindow,
  operatorStatedWindow,
  refreshIntervalMs,
  resolveWindow,
  startWindowRefresh,
  _resetForTesting,
  __setWindowForTesting
};
