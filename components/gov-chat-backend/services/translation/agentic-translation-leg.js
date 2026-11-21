'use strict';

// The BFF's answer-translation leg for the agentic path (story 2.10, AD-14).
//
// The legacy path (translation-service.js + query-routes.js) keeps its
// deployed behavior untouched — this module is additive shared code that only
// the agentic route consumes. Three rules shape it:
//
// 1. GPU-only, keyed on the routing decision. The leg is constructed with
//    the routing decision as an explicit input and serves only the agentic
//    one; its backend is always its own GpuTranslateBackend — never the CPU
//    model, never the overlay's translation image, never a probe fallback. A GPU
//    that is unconfigured or fails at request time is a skip with the
//    recorded reason: the English answer stays.
// 2. Residual discipline. `planTranslation`
//    (services/agent-residual-budget.js, story 2.3) decides
//    translate-vs-skip from the run's usage record, the deployment's
//    allowances and the caller's remaining deadline. No call starts beyond
//    the remaining deadline (per-call `timeoutMs` = the time left at call
//    start); each call's `max_tokens` is the remaining allowance; the
//    disconnect `AbortSignal` is the caller's. The leg owns no clock: the
//    remaining-deadline value arrives per call, produced by the story-2.4
//    caller.
// 3. Skip is not failure. V05 ties `done.translationFailed` to
//    attempted-and-failed. A budget/config skip returns outcome `skipped`
//    (the caller keeps `translationFailed` false and the English answer);
//    only an attempted-and-failed translation returns outcome `failed` —
//    empty output, backend error, truncation, timeout. `cancelled` records a
//    caller abort, with no retry.
//
// The leg owns no frames, no agent-leg HTTP client and no disconnect
// detection: the caller (story 2.4) produces the AbortSignal and the
// remaining-deadline value and writes every client frame from the returned
// outcome. The accounting block the leg returns is the shape the caller
// persists into the `queries` metadata execution record:
//
//   { backend, decision, status, outcome, queryTranslationStatus,
//     usage, configError, mode }
//
// `status` carries only the frozen `SKIP_STATUSES` values (or null);
// `configError` carries a REQUIRED-knob name, a GPU-only selection reason, or
// `invalid_remaining_ms` (a remaining-deadline the caller's clock cannot have
// produced); `queryTranslationStatus` is the V05 vocabulary verbatim, never
// extended.
// The leg does not use the Redis translation cache: every call is
// budget-accounted, so iteration 1 answers by not caching.

const { logger, parsePositiveInt } = require('../../shared-lib');
const { planTranslation, SKIP_STATUSES } = require('../agent-residual-budget');
const GpuTranslateBackend = require('./gpu-translate-backend');
const { normalizeInlineSpacing } = require('./markdown-normalize');
const { splitEdges } = require('./text-edges');
const { normalizeRequestedLanguage } = require('./language-request');
const { languageForLog } = require('./language-log');

// The routing decision this leg serves. The backend selection is keyed on
// it: the leg never inspects TRANSLATION_BACKEND or probes anything, and
// handing it another value is a wiring defect at the call site, not a
// runtime condition.
const AGENTIC_ROUTING = 'agentic';

// The accounting block's backend name — the vLLM GPU backend, as distinct
// from the legacy path's selectable backends.
const BACKEND_NAME = 'gpu-vllm';

// The two REQUIRED knobs (documented in `env`, passed through by the compose
// backend block). Read fail-closed: a missing or unusable knob means
// translation cannot be bounded, so it never starts and the knob is named —
// no numeric default exists anywhere.
const KNOB_MAX_TOKENS = 'AGENT_TRANSLATION_MAX_TOKENS';
const KNOB_MAX_CALLS = 'AGENT_TRANSLATION_MAX_CALLS';

// Config-level skip reasons carried in the accounting block's `configError`
// field (alongside the two knob names). The GPU-only selection records WHY
// it skipped: a GPU API the deployment never named, or one that failed at
// request time. `invalid_remaining_ms` records a caller that passed a
// remaining-deadline no clock could have produced.
const GPU_NOT_CONFIGURED = 'gpu_not_configured';
const GPU_INIT_FAILED = 'gpu_init_failed';
const INVALID_REMAINING_MS = 'invalid_remaining_ms';

// The V05 `query_translation_status` vocabulary — reused verbatim, never
// extended (the frozen contract). Every outcome maps onto exactly one of
// these values.
const V05_STATUS = Object.freeze({
  TRANSLATED: 'translated',
  PASSTHROUGH_ENGLISH: 'passthrough_english',
  PASSTHROUGH_UNKNOWN_LANGUAGE: 'passthrough_unknown_language',
  FALLBACK_TIMEOUT: 'fallback_timeout',
  FALLBACK_ERROR: 'fallback_error'
});

// The execution modes. Streaming translation (the request's
// STREAMING_TRANSLATION_ENABLED discipline, owned by the caller) translates
// unit by unit; the post-stream path translates the whole answer once.
const MODE_UNIT = 'streaming-unit';
const MODE_FULL = 'full-answer';

/**
 * The value of one REQUIRED knob, or NaN when it is missing or unusable.
 * `parsePositiveInt` with a NaN default: unset, empty, non-numeric and
 * non-positive values all fail — a knob that cannot bound a translation is
 * no knob.
 * @param {string} name - The knob's env name
 * @returns {number}
 */
function readKnob(name) {
  return parsePositiveInt(process.env[name], NaN, { min: 1 });
}

/**
 * The REQUIRED knobs that are missing or unusable, in a fixed order.
 * @returns {string[]}
 */
function missingKnobs() {
  const missing = [];
  if (!Number.isFinite(readKnob(KNOB_MAX_TOKENS))) missing.push(KNOB_MAX_TOKENS);
  if (!Number.isFinite(readKnob(KNOB_MAX_CALLS))) missing.push(KNOB_MAX_CALLS);
  return missing;
}

/**
 * The deployment's translation-leg allowances, read from the knobs.
 * @returns {{maxTokens: number, maxCalls: number}}
 */
function allowances() {
  return { maxTokens: readKnob(KNOB_MAX_TOKENS), maxCalls: readKnob(KNOB_MAX_CALLS) };
}

/**
 * The accounting block — the shape the story-2.4 caller persists into the
 * `queries` metadata execution record. Unit-pinned by the leg's test suite.
 *
 * @param {Object} parts
 * @param {'translate'|'skip'} parts.decision
 * @param {string|null} [parts.status] - A frozen SKIP_STATUSES value, or null
 * @param {'translated'|'skipped'|'failed'|'cancelled'} parts.outcome
 * @param {string} parts.queryTranslationStatus - A V05 vocabulary value
 * @param {{prompt_tokens: number, completion_tokens: number, estimated: boolean}|null} [parts.usage]
 * @param {string|null} [parts.configError] - A knob name, a GPU-only reason, or `invalid_remaining_ms`
 * @param {'streaming-unit'|'full-answer'} parts.mode
 * @returns {Object}
 */
function accountingBlock({
  decision,
  status = null,
  outcome,
  queryTranslationStatus,
  usage = null,
  configError = null,
  mode
}) {
  return { backend: BACKEND_NAME, decision, status, outcome, queryTranslationStatus, usage, configError, mode };
}

/**
 * The accounting of a skip: no call was attempted, the English answer stays.
 * `translationFailed` stays false — a skip is not a failure (V05).
 * @param {string} mode
 * @param {Object} [overrides] - `{status, queryTranslationStatus, configError}`
 * @returns {Object}
 */
function skipAccounting(
  mode,
  { status = null, queryTranslationStatus = V05_STATUS.PASSTHROUGH_ENGLISH, configError = null } = {}
) {
  return accountingBlock({
    decision: 'skip',
    status,
    outcome: 'skipped',
    queryTranslationStatus,
    usage: null,
    configError,
    mode
  });
}

/**
 * Whether the run's terminal usage record can bound anything. The same
 * degradation rule `computeResidual` applies: a missing record, or one with
 * a non-finite token field or call-count field, bounds nothing — translation
 * is skipped, and the run's usage is never estimated up to the allowance.
 * The call counts are checked too: a string `model_calls` would poison the
 * call-allowance arithmetic (`NaN` remaining) and silently unbound it.
 * @param {Object|null} runUsage
 * @returns {boolean}
 */
function runUsageAvailable(runUsage) {
  return (
    runUsage !== null &&
    runUsage !== undefined &&
    Number.isFinite(runUsage.prompt_tokens) &&
    Number.isFinite(runUsage.completion_tokens) &&
    Number.isFinite(runUsage.model_calls) &&
    Number.isFinite(runUsage.aux_model_calls)
  );
}

/**
 * The usage the plan sees: the run's record plus what the leg itself has
 * spent so far (the leg's own calls are auxiliary model calls, and its
 * tokens are counted where the endpoint served them or estimated where it
 * discarded them — an estimate that accounts for SPENT work, never one that
 * inflates an allowance).
 * @param {Object|null} runUsage
 * @param {{promptTokens: number, completionTokens: number, calls: number}} spent
 * @returns {Object|null} null when the run's record is unavailable
 */
function mergedPlanUsage(runUsage, spent) {
  if (!runUsageAvailable(runUsage)) return null;
  return {
    prompt_tokens: runUsage.prompt_tokens + spent.promptTokens,
    completion_tokens: runUsage.completion_tokens + spent.completionTokens,
    model_calls: runUsage.model_calls,
    aux_model_calls: runUsage.aux_model_calls + spent.calls
  };
}

/**
 * Resolve the requested language against the leg's own backend map — the
 * pure helpers, the same canonical form the legacy routes resolve.
 *
 * English and `auto` need no translation (the legacy `wantsTranslation`
 * discipline); a language the map does not carry is recorded as an unknown
 * language, not refused here — the English answer stays either way.
 *
 * @param {GpuTranslateBackend} backend
 * @param {string} targetLanguage - The language as it arrived from the caller
 * @returns {{pair: {sourceLangCode: string, targetLangCode: string}|null, unknown: boolean}}
 */
function resolveLanguagePair(backend, targetLanguage) {
  const requested = normalizeRequestedLanguage(targetLanguage);
  if (!requested || requested === 'en' || requested === 'auto') {
    return { pair: null, unknown: false };
  }
  const sourceCode = backend.getLanguageCode('en');
  const targetCode = backend.getLanguageCode(requested);
  if (!sourceCode || !targetCode) {
    logger.warn(
      `[AGENTIC-TRANSLATION] Unsupported target language: ${languageForLog(requested)} — the answer stays English`
    );
    return { pair: null, unknown: true };
  }
  return { pair: { sourceLangCode: sourceCode, targetLangCode: targetCode }, unknown: false };
}

// The init race's loss sentinels. Distinct messages, because the accounting
// maps them to different outcomes than a probe failure: a lost budget is a
// `deadline_spent` skip, an abort is `cancelled`, a probe error is the
// `gpu_init_failed` skip.
const INIT_BUDGET_SPENT = 'translation init budget spent before the probes finished';
const INIT_ABORTED = 'translation init aborted by the caller';

/**
 * Race the backend's init probes against this request's two bounds — the
 * caller's remaining budget (a timer) and its abort signal. The probes run
 * on their own fixed budgets (health ~30s, models ~5s) and know nothing of
 * either: a GPU endpoint that accepts connections but never answers would
 * otherwise stall every agentic translation up to ~35s past the deadline,
 * and a disconnected client could not shorten the wait.
 *
 * The dangling probe on a race loss is harmless: the backend instance is
 * request-local and its own socket timeouts still bound it — only this
 * caller stops waiting. `healthCheck`/`fetchModelInfo` are untouched.
 *
 * @param {GpuTranslateBackend} backend
 * @param {Object} params - `{budgetMs, signal}`
 * @returns {Promise<undefined>} Resolves when init finished in time.
 * @throws {Error} The `INIT_BUDGET_SPENT` or `INIT_ABORTED` sentinel, or the
 *   probe's own failure.
 */
async function raceInit(backend, { budgetMs, signal }) {
  let timer = null;
  let onAbort = null;
  const budgetLoss = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(INIT_BUDGET_SPENT)), budgetMs);
  });
  const abortLoss = new Promise((_, reject) => {
    if (signal && signal.aborted) {
      reject(new Error(INIT_ABORTED));
      return;
    }
    if (signal) {
      onAbort = () => reject(new Error(INIT_ABORTED));
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
  try {
    // The no-op catch is belt-and-braces for the dangling-loss case:
    // Promise.race itself permanently attaches handlers to every input, so a
    // probe failing long after a lost race is already delivered to them and
    // handled (verified against Node directly). The explicit catch keeps
    // that guarantee true even if a future refactor stops racing the init
    // promise directly.
    const settled = backend.init();
    settled.catch(() => {});
    return await Promise.race([settled, budgetLoss, abortLoss]);
  } finally {
    clearTimeout(timer);
    if (onAbort && signal) signal.removeEventListener('abort', onAbort);
  }
}

/**
 * Create the answer-translation leg for one agentic request.
 *
 * One leg per request: its `spent` accumulation (usage returned or
 * estimated by the calls IT made) is request-local, so each unit's plan sees
 * the whole request's spend. The GPU backend instance is also request-local,
 * built lazily at the first execution that reaches the selection (config
 * skips never build one); the health and models probes run only for a
 * request whose plan and language resolution both proved a translation —
 * English and unknown-language requests never reach init — a GPU that
 * fails there is a skip with the recorded reason, never a crash and never
 * a fallback; the probes are raced against the request's remaining budget
 * and abort signal, so a hung endpoint cannot stall the pass past the
 * deadline, and the probes' wall time (on a won race) is part of the
 * translation budget: it is subtracted from the remaining deadline before
 * any call's timeout is computed, and an abort during the probes is a
 * `cancelled` outcome.
 *
 * @param {Object} params
 * @param {'agentic'} params.routingDecision - The routing decision, the
 *   explicit key of the backend selection. Only the agentic value is served.
 * @param {Object|null} params.runUsage - The completed agent run's terminal
 *   usage record (`{prompt_tokens, completion_tokens, model_calls,
 *   aux_model_calls, ...}`), or null when the run served none. Null skips
 *   every translation (`usage_unavailable`) — the run's usage is never
 *   estimated up to the allowance.
 * @param {string} params.targetLanguage - The requested UI language
 * @returns {Object} `{configError, translateFullAnswer, createStreamingTranslator}`
 * @throws {Error} when the routing decision is not the agentic one
 */
function createAgenticTranslationLeg({ routingDecision, runUsage = null, targetLanguage }) {
  if (routingDecision !== AGENTIC_ROUTING) {
    throw new Error(
      `createAgenticTranslationLeg serves only the '${AGENTIC_ROUTING}' routing decision (got: ${routingDecision})`
    );
  }

  // Fail-closed knobs, read once at construction. Every execution of a leg
  // with a missing knob answers skip with the knob named — logged once here
  // at ERROR (the operator's signal), recorded per execution in the
  // accounting.
  const missing = missingKnobs();
  for (const knob of missing) {
    logger.error(
      `[AGENTIC-TRANSLATION] Required knob ${knob} is missing or unusable — answer translation cannot be bounded and is skipped (the English answer stays)`
    );
  }
  const configError = missing.length > 0 ? missing[0] : null;

  // The leg's own GPU backend — never the legacy singleton, whose `auto`
  // probe may have chosen the CPU model (sharing it would couple the paths).
  let backend = null;
  let backendUnusable = false;
  const ensureBackend = () => {
    if (backend || backendUnusable) return backend;
    try {
      backend = new GpuTranslateBackend();
    } catch (error) {
      // A model with no language map cannot translate anything; the leg
      // records the reason instead of crashing the request.
      backendUnusable = true;
      logger.error(`[AGENTIC-TRANSLATION] GPU backend unusable: ${error.message}`);
    }
    return backend;
  };

  // "A GPU API is configured" — the same two independent signals the legacy
  // service reads: a remote GPU node host, or an explicit translation
  // endpoint. The in-cluster worker alone is compose's pass-through default,
  // not a configuration.
  const gpuConfigured = (b) => Boolean(process.env.GPU_NODE_HOST) || b.endpointExplicit;

  // The leg's own spend within this request: usage returned by the endpoint
  // or estimated where it discarded one. Accumulated across the request's
  // units so each plan bounds the whole request, not just one call.
  const spent = { promptTokens: 0, completionTokens: 0, calls: 0 };

  // The markdown tooling — loaded once per leg, on the first pass that needs
  // it (the same libraries the legacy translator uses). Lazy: nothing
  // translation-related loads until an agentic pass asks for it. require,
  // not import: the packages are ESM-only, and Node's require(esm) resolves
  // them on the image's Node 22 base while staying mockable under the CJS
  // test suite (the VM's dynamic import needs --experimental-vm-modules).
  let markdownLibs = null;
  const loadMarkdownLibs = () => {
    if (!markdownLibs) {
      const { unified } = require('unified');
      const remarkParse = require('remark-parse').default;
      const remarkStringify = require('remark-stringify').default;
      const { visit } = require('unist-util-visit');
      markdownLibs = { unified, remarkParse, remarkStringify, visit };
    }
    return markdownLibs;
  };

  /**
   * Execute one translation pass: plan → bounded, abortable call(s) →
   * accounting. One pass is one unit (streaming mode) or the whole answer
   * (post-stream mode); the markdown discipline inside is the legacy
   * translator's — parse, normalize, translate only the text-leaf cores,
   * reassemble the skeleton — so the delivered structure matches what the
   * legacy path delivers for the same text.
   *
   * @param {Object} params - `{markdownText, mode, remainingMs, signal}`
   * @returns {Promise<{outcome: 'translated'|'skipped'|'failed'|'cancelled', translated: string|null, accounting: Object}>}
   */
  async function execute({ markdownText, mode, remainingMs, signal }) {
    const aborted = () => Boolean(signal && signal.aborted);

    // The caller is already gone: nothing to translate for anyone.
    if (aborted()) {
      return {
        outcome: 'cancelled',
        translated: null,
        accounting: accountingBlock({
          decision: 'skip',
          outcome: 'cancelled',
          queryTranslationStatus: V05_STATUS.FALLBACK_ERROR,
          mode
        })
      };
    }

    // 1. Fail-closed knobs (named at construction; answered here forever).
    if (configError) {
      return { outcome: 'skipped', translated: null, accounting: skipAccounting(mode, { configError }) };
    }

    // 2. Routing-keyed GPU-only selection.
    const b = ensureBackend();
    if (!b) {
      return {
        outcome: 'skipped',
        translated: null,
        accounting: skipAccounting(mode, { configError: GPU_INIT_FAILED })
      };
    }
    if (!gpuConfigured(b)) {
      return {
        outcome: 'skipped',
        translated: null,
        accounting: skipAccounting(mode, { configError: GPU_NOT_CONFIGURED })
      };
    }

    // 3. Entry guard: a remaining-deadline no clock could have produced is a
    //    wiring defect — it is recorded, never a raw rejection past the
    //    accounting contract.
    if (!Number.isFinite(remainingMs)) {
      return {
        outcome: 'skipped',
        translated: null,
        accounting: skipAccounting(mode, { configError: INVALID_REMAINING_MS })
      };
    }

    // The pass's own accounting: everything from the first attempted call on
    // is recorded, whatever the outcome.
    const passUsage = { prompt_tokens: 0, completion_tokens: 0 };
    let passEstimated = false;
    let passCalls = 0;
    let anythingSpent = false;

    try {
      // 4. The residual plan.
      const plan = planTranslation({
        deadlineRemainingMs: remainingMs,
        usage: mergedPlanUsage(runUsage, spent),
        allowances: allowances()
      });
      if (plan.decision !== 'translate') {
        return { outcome: 'skipped', translated: null, accounting: skipAccounting(mode, { status: plan.status }) };
      }

      // 5. The language pair against the leg's own map — before init, so an
      //    English or unknown-language request never performs the health and
      //    models probes. `getLanguageCode` throws on a broken shipped map:
      //    inside this try, so the failure lands in the accounting, never
      //    as a raw rejection.
      const { pair, unknown } = resolveLanguagePair(b, targetLanguage);
      if (unknown) {
        return {
          outcome: 'skipped',
          translated: null,
          accounting: skipAccounting(mode, { queryTranslationStatus: V05_STATUS.PASSTHROUGH_UNKNOWN_LANGUAGE })
        };
      }
      if (!pair) {
        // English or auto: nothing to translate (the caller's
        // wantsTranslation discipline decides this before constructing work).
        return { outcome: 'skipped', translated: null, accounting: skipAccounting(mode) };
      }

      // 6. The health and models probes, raced against this request's two
      //    bounds — the caller's remaining budget and its abort signal —
      //    because the probes run on their own fixed budgets and would
      //    otherwise stall the pass past the deadline or outlive a
      //    disconnected client. A probe FAILURE is still a skip with the
      //    recorded reason.
      const initStartedAt = Date.now();
      try {
        await raceInit(b, { budgetMs: remainingMs, signal });
      } catch (error) {
        if (aborted()) {
          return {
            outcome: 'cancelled',
            translated: null,
            accounting: accountingBlock({
              decision: 'translate',
              outcome: 'cancelled',
              queryTranslationStatus: V05_STATUS.FALLBACK_ERROR,
              mode
            })
          };
        }
        if (error.message === INIT_BUDGET_SPENT) {
          return {
            outcome: 'skipped',
            translated: null,
            accounting: skipAccounting(mode, { status: SKIP_STATUSES.DEADLINE_SPENT })
          };
        }
        logger.warn(`[AGENTIC-TRANSLATION] GPU backend failed at request time: ${error.message}`);
        return {
          outcome: 'skipped',
          translated: null,
          accounting: skipAccounting(mode, { configError: GPU_INIT_FAILED })
        };
      }
      // Won race: init finished — its wall time is part of the translation
      // budget, subtracted below so no call's timeout can exceed the
      // caller's remaining deadline.
      const remainingAfterInit = remainingMs - (Date.now() - initStartedAt);
      if (aborted()) {
        return {
          outcome: 'cancelled',
          translated: null,
          accounting: accountingBlock({
            decision: 'translate',
            outcome: 'cancelled',
            queryTranslationStatus: V05_STATUS.FALLBACK_ERROR,
            mode
          })
        };
      }
      if (remainingAfterInit <= 0) {
        return {
          outcome: 'skipped',
          translated: null,
          accounting: skipAccounting(mode, { status: SKIP_STATUSES.DEADLINE_SPENT })
        };
      }

      // 7. The bounded pass. Budget stops mid-pass are timeout-classified:
      //    something was attempted, so the outcome is a failed translation,
      //    not a skip.
      const passDeadline = Date.now() + remainingAfterInit;
      const { unified, remarkParse, remarkStringify, visit } = loadMarkdownLibs();
      const tree = unified().use(remarkParse).parse(markdownText);

      // The legacy normalization: a space between run-in **bold** and the
      // word that follows, gated to word-spaced scripts.
      normalizeInlineSpacing(tree);

      const textNodes = [];
      visit(tree, 'text', (node) => textNodes.push(node));
      const edges = textNodes.map((node) => splitEdges(node.value));
      const cores = edges.map((e) => e.core);

      if (cores.length === 0) {
        // The legacy translator answers the original content when a text
        // carries no text node — a no-op translation, not a failure.
        return {
          outcome: 'translated',
          translated: markdownText,
          accounting: accountingBlock({
            decision: 'translate',
            outcome: 'translated',
            queryTranslationStatus: V05_STATUS.TRANSLATED,
            usage: null,
            mode
          })
        };
      }

      const translatedCores = [];
      for (let i = 0; i < cores.length; i++) {
        const core = cores[i];
        if (!core || !core.trim()) {
          // Empty cores never reach the model (the `translate` discipline).
          translatedCores.push('');
          continue;
        }

        // No call starts beyond the remaining deadline.
        const remainingHere = passDeadline - Date.now();
        if (remainingHere <= 0) {
          throw new Error('vLLM service request timeout: the remaining deadline was spent mid-pass');
        }
        // The call allowance bounds the pass's call count.
        if (passCalls >= plan.residual.remainingCalls) {
          throw new Error('vLLM service request timeout: the call allowance was spent mid-pass');
        }
        // The token bound rides the request: max_tokens = remaining
        // allowance. The plan already carries the run's spend and every
        // EARLIER unit's spend; the only part not yet subtracted is what
        // THIS pass has spent so far.
        const remainingAllowance = plan.maxTokens - (passUsage.prompt_tokens + passUsage.completion_tokens);
        if (remainingAllowance <= 0) {
          throw new Error('vLLM service request timeout: the token allowance was spent mid-pass');
        }

        const result = await b.translateWithUsage([core], pair.sourceLangCode, pair.targetLangCode, {
          maxTokens: remainingAllowance,
          timeoutMs: remainingHere,
          signal
        });

        passCalls += 1;
        spent.calls += 1;
        anythingSpent = true;
        // The usage is always served-or-estimated here: the backend returns
        // the endpoint's counts when the response carries them, its chars/4
        // estimate flagged `estimated` when it does not. The estimate
        // accounts for SPENT work — it never widens a bound.
        passUsage.prompt_tokens += result.usage.prompt_tokens;
        passUsage.completion_tokens += result.usage.completion_tokens;
        spent.promptTokens += result.usage.prompt_tokens;
        spent.completionTokens += result.usage.completion_tokens;
        if (result.estimated) {
          passEstimated = true;
        }
        translatedCores.push(result.translations[0]);
      }

      if (translatedCores.length !== cores.length) {
        throw new Error('Translation failed due to text count mismatch.');
      }

      // Reassemble: the original structural edges verbatim around the
      // translated cores (the legacy discipline keeps the structure in the
      // skeleton, never in the model's hands).
      textNodes.forEach((node, index) => {
        const e = edges[index];
        node.value = e.lead + (translatedCores[index] || '') + e.trail;
      });
      const translatedText = unified().use(remarkStringify).stringify(tree);

      if (!translatedText || !translatedText.trim()) {
        // An empty translation is a failed translation: handing back the
        // English answer as a translated one is the failure `translationFailed`
        // exists for, and blanking the paragraph is worse.
        throw new Error('vLLM returned an empty translation');
      }

      return {
        outcome: 'translated',
        translated: translatedText,
        accounting: accountingBlock({
          decision: 'translate',
          outcome: 'translated',
          queryTranslationStatus: V05_STATUS.TRANSLATED,
          usage: anythingSpent
            ? {
                prompt_tokens: passUsage.prompt_tokens,
                completion_tokens: passUsage.completion_tokens,
                estimated: passEstimated
              }
            : null,
          mode
        })
      };
    } catch (error) {
      // Cancelled takes precedence over every failure classification: the
      // caller is gone, the in-flight request was destroyed, no retry.
      if (aborted()) {
        return {
          outcome: 'cancelled',
          translated: null,
          accounting: accountingBlock({
            decision: 'translate',
            outcome: 'cancelled',
            queryTranslationStatus: V05_STATUS.FALLBACK_ERROR,
            usage: anythingSpent
              ? {
                  prompt_tokens: passUsage.prompt_tokens,
                  completion_tokens: passUsage.completion_tokens,
                  estimated: passEstimated
                }
              : null,
            mode
          })
        };
      }
      logger.warn(`[AGENTIC-TRANSLATION] Translation failed: ${error.message} (mode=${mode})`);
      return {
        outcome: 'failed',
        translated: null,
        accounting: accountingBlock({
          decision: 'translate',
          outcome: 'failed',
          queryTranslationStatus: /timeout/i.test(error.message)
            ? V05_STATUS.FALLBACK_TIMEOUT
            : V05_STATUS.FALLBACK_ERROR,
          usage: anythingSpent
            ? {
                prompt_tokens: passUsage.prompt_tokens,
                completion_tokens: passUsage.completion_tokens,
                estimated: passEstimated
              }
            : null,
          mode
        })
      };
    }
  }

  return {
    configError,

    /**
     * Translate a whole answer (the post-stream path). The caller writes the
     * `translation` frame from `translated` and reads `outcome` for the V05
     * `done.translationFailed` semantics (`failed` → true, every other
     * outcome → false).
     *
     * @param {Object} params - `{text, remainingMs, signal}`
     * @returns {Promise<{outcome: string, translated: string|null, accounting: Object}>}
     */
    translateFullAnswer({ text, remainingMs, signal }) {
      return execute({ markdownText: text, mode: MODE_FULL, remainingMs, signal });
    },

    /**
     * The streaming-unit translator: one plan → call → account cycle per
     * unit, the leg's spend accumulated across the request's units. Once a
     * unit fails, the V05 streaming discipline applies: the answer stays
     * English for the remainder and the model is not asked again (later
     * units answer skipped).
     *
     * @returns {{failed: boolean, translateUnit: (params: {content: string, remainingMs: number, signal: AbortSignal}) => Promise<{outcome: string, translated: string|null, accounting: Object}>}}
     */
    createStreamingTranslator() {
      let failed = false;
      return {
        get failed() {
          return failed;
        },
        async translateUnit({ content, remainingMs, signal }) {
          if (failed) {
            return { outcome: 'skipped', translated: null, accounting: skipAccounting(MODE_UNIT) };
          }
          const result = await execute({ markdownText: content, mode: MODE_UNIT, remainingMs, signal });
          if (result.outcome === 'failed') {
            failed = true;
          }
          return result;
        }
      };
    }
  };
}

module.exports = { createAgenticTranslationLeg };
