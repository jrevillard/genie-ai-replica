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
  coerceWindow,
  ttlSeconds
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
  source: WINDOW_SOURCES.UNKNOWN
};

/** The operator's explicit statement of the window the endpoint serves.
 *
 * dataprep's tier 1 (DATAPREP_MAX_MODEL_LEN): 0 = discover, >0 = stated.
 * The SAME sanitization the discovered tier uses (vllm-model-cache's
 * coerceWindow, one home for the window rule): non-positive, non-integral,
 * garbage, and the SANITY CEILING all answer null — dataprep's
 * _sanitize_window_override treats an absurd override (a typo, or a
 * chars-not-tokens value) as unset and discovers instead, and an absurd
 * stated window here would derive a ceiling of hundreds of millions of
 * characters and silently disable the guard on every write path.
 *
 * @returns {number|null}
 */
function operatorStatedWindow() {
  return coerceWindow(process.env.DATAPREP_MAX_MODEL_LEN);
}

/**
 * Resolve the window (async — network I/O; never on a write path).
 *
 * @returns {Promise<{window:number|null, source:string, error:Error|null}>}
 */
async function resolveWindow() {
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
    const result = await getServedWindow(base, { apiKey: credentialForBase(base) });
    if (result.window !== null && result.window !== undefined) {
      const source = result.stale ? WINDOW_SOURCES.STALE : WINDOW_SOURCES.DISCOVERED;
      applyWindow(result.window, source, null);
      return { window: result.window, source, error: null };
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
 * @returns {{window:number|null, source:string}}
 */
function currentWindow() {
  // The operator's statement is read live: it costs nothing and it keeps
  // the synchronous view honest even before the first probe settles.
  const stated = operatorStatedWindow();
  if (stated !== null) {
    return { window: stated, source: WINDOW_SOURCES.OPERATOR_STATED };
  }
  return { window: state.window, source: state.source };
}

/** The refresh cadence: the cache's own TTL knob (MODEL_DETECT_TTL), read
 * by the cache's own parser — one .env line and ONE parsing rule tune
 * dataprep's probe, okf-server's model-id probe and this refresh together.
 * A 0-second cache means "probe every call", never "poll every 0 ms", so
 * the interval floor stays at the house default. */
function refreshIntervalMs() {
  const seconds = ttlSeconds();
  return seconds > 0 ? seconds * 1000 : 60000;
}

/**
 * Start the background refresh: one probe now, then one per TTL.
 *
 * The first probe is AWAITED by the caller when it wants the window ready
 * before serving (the boot path does); the interval keeps it fresh. Once
 * the tier-1 answer (the operator's statement) is in, the interval stops:
 * env does not change under a running container, so every later tick is a
 * guaranteed no-op — a wake every TTL for the process lifetime buys
 * nothing.
 *
 * @returns {{stop:()=>void, ready:Promise<{window:number|null,source:string,error:Error|null}>}}
 */
function startWindowRefresh() {
  const ready = resolveWindow();
  const timer = setInterval(() => {
    resolveWindow()
      .then((resolved) => {
        if (resolved.source === WINDOW_SOURCES.OPERATOR_STATED) {
          clearInterval(timer);
        }
      })
      .catch(() => {
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
}

/** Test hook: pretend the discovery answered with this window (the tests
 * must not probe a network to exercise the ladder). */
function __setWindowForTesting(window, source) {
  state.window = window === undefined ? null : window;
  state.source = source || WINDOW_SOURCES.UNKNOWN;
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
