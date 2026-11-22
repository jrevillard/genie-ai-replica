'use strict';

const axios = require('axios');
const { logger } = require('../shared-lib');
const { agentServiceUrl } = require('./agent-routing');
const { parseAgentSeamLine } = require('./agent-seam-parser');
const {
  resolveUpstreamTimeoutMs,
  deriveDeadlineMs,
  assembleAgentMetadata,
  readUpstreamBody,
  passthroughBody,
  agentHttpAgent,
  agentHttpsAgent
} = require('./agent-run-contract');
const { wantsTranslation } = require('./translation/language-request');
const { translateWholeAnswer } = require('./translation/whole-answer');

// Story 2.4b — the non-streaming JSON consumer of the agent-service seam.
// The streaming entry (agent-frame-writer.js) projects the seam onto client
// frames; THIS module aggregates the same stream into the legacy JSON result
// one `POST /api/queries` request returns: posture resolution → CallerContext
// → POST /v1/runs → seam aggregation (text / verdict / usage record) →
// whole-answer translation (the `handleStreamDone` non-relay branch's
// semantics) → the assembled metadata + the V05-derived abstention overlay.
//
// Insufficiency is NOT an error here: a verdict-bearing run that required the
// insufficiency response answers the SUCCESS contract (201, the
// INSUFFICIENCY text as the response, `abstained: true` + `abstention_reason`
// in the metadata) — the same V05 §3 vocabulary the legacy metadata carries.
// Only genuine failures (upstream errors, authorization failures, timeouts,
// a mid-run `run_error`) surface as the JSON error contract, thrown as typed
// errors the route's existing mapping renders (`statusCode` + `body`).

/**
 * A typed agent-turn failure: the route's catch reads `statusCode` + `body`
 * and answers them verbatim (plus `headers`, for the 429's `Retry-After`
 * passthrough). Legacy errors never carry a `body`, so the mapping is
 * additive — the flag-off contract is untouched.
 */
class AgentJsonTurnError extends Error {
  /**
   * @param {number} statusCode - The HTTP status the route answers.
   * @param {Object} body - The JSON body the route answers.
   * @param {Object} [headers] - Extra response headers (name → value).
   */
  constructor(statusCode, body, headers) {
    super((body && body.message) || body?.error || 'agent turn failed');
    this.name = 'AgentJsonTurnError';
    this.statusCode = statusCode;
    this.body = body;
    this.headers = headers;
  }
}

/**
 * The V05-derived abstention overlay — a small pure function over the
 * verdict, so a later story that surfaces abstention on the streaming path
 * reuses this mapping instead of inventing a second one (the verdict frame
 * carries `insufficient_evidence` verbatim; the JSON metadata carries the
 * V05 vocabulary):
 *   - a verdict-bearing run sets `abstained` from
 *     `insufficient_evidence.required` — false = answered, chose not to
 *     abstain (V05 §3 semantics);
 *   - when the run required the insufficiency response, `abstention_reason`
 *     carries the mechanical reasons (`insufficient_evidence.reasons`,
 *     comma-joined — the V05 field is one machine-readable string; the
 *     Inspector renders unknown codes generically);
 *   - NO verdict → the overlay does not run: `abstained` stays `null`
 *     ("decision never reported" — the base shape's meaning).
 *
 * @param {Object} metadata - The assembled metadata (mutated in place).
 * @param {Object|null} verdict - The captured verdict payload.
 * @returns {Object} The same metadata object.
 */
function applyAbstentionOverlay(metadata, verdict) {
  if (!verdict) {
    return metadata;
  }
  const insufficient = verdict.insufficient_evidence;
  if (!insufficient || typeof insufficient !== 'object' || Array.isArray(insufficient)) {
    // A verdict whose decision field is missing or malformed is not a
    // "not required" answer — it is a decision never reported. The overlay
    // does not run: the base nulls stay.
    return metadata;
  }
  if (typeof insufficient.required !== 'boolean') {
    // Same rule one level deeper: an object with no boolean `required`
    // reported no decision — never "answered, chose not to abstain".
    return metadata;
  }
  const required = insufficient.required;
  metadata.abstained = required;
  if (required) {
    const reasons = Array.isArray(insufficient.reasons) ? insufficient.reasons : [];
    metadata.abstention_reason = reasons.length > 0 ? reasons.join(',') : null;
  }
  return metadata;
}

// The pre-run refusals that pass the upstream answer through: the status →
// the documented fallback body name (when the upstream body does not parse)
// and the log event. The 429 additionally carries the lane's Retry-After.
const RUN_REFUSALS = {
  429: { fallback: 'admission_refused', event: 'AgentJsonResult.admission_refused' },
  503: { fallback: 'budget_configuration_missing', event: 'AgentJsonResult.run_surface_unconfigured' },
  422: { fallback: 'invalid_run_request', event: 'AgentJsonResult.run_request_invalid' }
};

/**
 * Run one agentic turn for the non-streaming entry and aggregate its result.
 *
 * Mirrors the frame writer's upstream idiom (the shared contract module's
 * helpers, the same status mapping) minus every client-frame concern: no SSE
 * headers, no keepalive, no per-chunk writes — the aggregated answer is the
 * JSON body. No disconnect detection either: the legacy JSON contract has
 * none, and the upstream timeout bounds the leg.
 *
 * @param {Object} params
 * @param {Object} params.queryService - The injected query service (posture
 *   resolution + CallerContext builder + pickUserText).
 * @param {Object} params.queryData - The request body (+ userId).
 * @param {string} params.queryId - The `queries` doc key createQuery minted.
 * @param {Object|null} params.headers - `{authorization}` for the agent leg
 *   and the posture resolution.
 * @param {string} params.targetLanguage - The normalized requested language.
 * @param {Object|null} params.translator - The request-resolved translator.
 * @param {number} params.turnStartTime - The turn's start timestamp (ms) —
 *   AFTER the doc mint, so the persisted responseTime means the same thing
 *   as the legacy branch's worker-leg time.
 * @returns {Promise<{response: string, metadata: Object, responseTime: number,
 *   translationFailed?: true}>} `response` is the text the client receives —
 *   the translation when whole-answer translation succeeded, the English
 *   source otherwise; `translationFailed` rides only on a failed translation
 *   (absent otherwise — the additive sibling of `done.translationFailed`).
 * @throws {Error} The posture resolution's 401 propagates unchanged.
 * @throws {AgentJsonTurnError} Every other genuine failure, typed with the
 *   status + body the route answers.
 */
async function runAgentJsonTurn({
  queryService,
  queryData,
  queryId,
  headers,
  targetLanguage,
  translator,
  turnStartTime
}) {
  // The EFFECTIVE timeout — resolved once, so the deadline derivation and the
  // wire-level timeout (and the wall-clock bound below) all read the SAME
  // value: an under-sized configuration is absorbed at this one point, never
  // partially (the shared pair derivation).
  const effectiveTimeoutMs = resolveUpstreamTimeoutMs();
  const controller = new AbortController();
  const bearer = headers?.authorization || null;

  // The shared posture resolution (one home with the fan-out carrier — no
  // double upstream calls, no drift). Fail-closed, DELIBERATELY stricter
  // than the legacy carrier: any resolver problem except a 401 (the request
  // itself is invalid — it propagates) builds an empty CallerContext, whose
  // search_knowledge raises AuthorizationError — the run ends in the
  // insufficiency answer, the epic's own fail-closed direction for degraded
  // retrieval. (The legacy carrier's degrade instead keeps the
  // byte-identical legacy-corpus payload — same trigger, intended
  // different outcome.)
  let callerContext;
  try {
    const posture = await queryService.resolveFanoutPosture(headers, {
      queryId,
      sessionId: queryData.sessionId ?? null
    });
    callerContext = queryService.buildAgentCallerContext(queryData, posture);
  } catch (error) {
    if (error?.statusCode === 401) {
      throw error;
    }
    logger.error('AgentJsonResult.caller_context_failed_fail_closed', { queryId, error: error?.message });
    callerContext = queryService.buildAgentCallerContext(queryData, null);
  }

  const runBody = {
    question: queryService.pickUserText(queryData.messages, queryData.userQuestion),
    deadline_ms: deriveDeadlineMs(effectiveTimeoutMs),
    context: callerContext,
    // The named-locale display hint the preparation module consumes (beats
    // detection); null when this request is answered in English — the agent
    // always ANSWERS English, the run body never carries a language the run
    // should answer IN. Same field the streaming frame writer sends.
    language: wantsTranslation(targetLanguage) ? targetLanguage : null,
    bearer
  };

  // ── the upstream call: admission (429), configuration (503) and validation
  // (422) surface as client JSON through the typed error — before any work —
  // so the doc stays unanswered (createQuery's tail never runs on a throw).
  let response;
  try {
    response = await axios.post(agentServiceUrl(), runBody, {
      headers: {
        'Content-Type': 'application/json'
      },
      responseType: 'stream',
      timeout: effectiveTimeoutMs,
      signal: controller.signal,
      httpAgent: agentHttpAgent,
      httpsAgent: agentHttpsAgent,
      // The status is inspected here (429/503/422 passthrough) instead of thrown.
      validateStatus: () => true
    });
  } catch (error) {
    if (error?.code === 'ECONNABORTED' || error?.code === 'ERR_CANCELED') {
      throw new AgentJsonTurnError(504, {
        error: 'AGENT_SERVICE_UNAVAILABLE',
        message: 'Agent service unavailable or timed out'
      });
    }
    logger.error('AgentJsonResult.upstream_request_failed', { queryId, error: error?.message });
    throw new AgentJsonTurnError(502, { error: 'AGENT_SERVICE_UNAVAILABLE', message: error?.message });
  }

  // The wall-clock bound arms HERE — before the status ladder: the axios
  // timeout covers time-to-headers only, and a trickling non-2xx body would
  // otherwise hold the request (and its admission slot) forever. Each
  // refusal path clears it after its body read; a deadline fire aborts the
  // leg, the stream settles, and the refusal answers with the fallback body
  // — bounded and honest.
  let deadline = null;
  const clearDeadline = () => {
    if (deadline !== null) {
      clearTimeout(deadline);
      deadline = null;
    }
  };
  deadline = setTimeout(() => {
    deadline = null;
    logger.warn('AgentJsonResult.upstream_deadline_exceeded', { queryId, timeoutMs: effectiveTimeoutMs });
    controller.abort();
  }, effectiveTimeoutMs);

  const status = response.status;
  // ── the upstream refusals (429 / 503 / 422): the upstream's JSON answer
  // passes through verbatim; a body that did not parse (or is not an object)
  // falls back to the documented error name. A malformed run request is a
  // request problem, not an outage; the 429's lane hint rides the
  // Retry-After header (the caller retries on it).
  const refusal = RUN_REFUSALS[status];
  if (refusal) {
    const { parsed } = await readUpstreamBody(response.data, status);
    clearDeadline();
    logger.warn(refusal.event, { queryId, body: parsed });
    const headersOut = {};
    if (status === 429 && response.headers?.['retry-after'] !== undefined) {
      headersOut['Retry-After'] = String(response.headers['retry-after']);
    }
    throw new AgentJsonTurnError(status, passthroughBody(parsed) || { error: refusal.fallback }, headersOut);
  }
  if (status !== 200 || !response.data) {
    const { parsed } = await readUpstreamBody(response.data, status);
    clearDeadline();
    logger.error('AgentJsonResult.upstream_status_error', { queryId, status });
    throw new AgentJsonTurnError(502, {
      error: 'AGENT_SERVICE_UNAVAILABLE',
      message: parsed?.message || `agent service answered ${status}`
    });
  }

  // ── seam aggregation. The stream is finished from the BFF's perspective
  // once a terminal state is captured; every path below funnels through the
  // one `failure` slot, so nothing throws INSIDE a stream handler (a throw
  // there would be an uncaught exception, not a rejection).
  const stream = response.data;
  let buffer = '';
  let fullResponseText = '';
  let runId = null;
  let capturedVerdict = null;
  let usageRecord = null;
  let failure = null;

  stream.setEncoding('utf8');

  // One seam data line → aggregation state or the failure slot. Shared by the
  // chunk handler and the end-of-stream remainder flush (the frame writer's
  // same idiom: a trailing line that never got its newline is still a frame).
  const handleSeamDataLine = (dataContent) => {
    const parsed = parseAgentSeamLine(dataContent);
    if (parsed.type === 'event') {
      const event = parsed.event;
      runId = event.run_id;
      switch (event.kind) {
        case 'run_started':
        case 'text_message_started':
        case 'text_message_finished':
        case 'run_finished':
          // Run lifecycle and the text-message envelope are seam-internal.
          break;
        case 'text_message_content': {
          const text = event.payload?.text;
          if (typeof text !== 'string') {
            logger.warn('AgentJsonResult.seam_text_event_malformed', { queryId, seq: event.seq });
            break;
          }
          fullResponseText += text;
          break;
        }
        case 'verdict':
          capturedVerdict = event.payload;
          break;
        case 'run_error': {
          // The typed 502: the doc stays unanswered, the leg must not keep
          // working behind a dead consumer. Throwing here would be an
          // uncaught exception — the failure slot owns the terminal state.
          const message =
            typeof event.payload?.message === 'string' && event.payload.message
              ? event.payload.message
              : 'the agent run failed';
          failure = new AgentJsonTurnError(502, { error: 'AGENT_RUN_ERROR', message });
          clearDeadline();
          // Idempotent: the leg must not keep working behind a dead consumer.
          controller.abort();
          break;
        }
        default:
          // A seam kind this BFF does not know: ignored — a newer agent
          // service must not break an older BFF (the envelope is additive).
          logger.debug('AgentJsonResult.seam_kind_unrecognized', { queryId, kind: event.kind, seq: event.seq });
      }
    } else if (parsed.type === 'usage_record') {
      usageRecord = parsed.record;
    } else {
      logger.warn('AgentJsonResult.seam_parse_error', {
        queryId,
        // Bounded: a misbehaving upstream must not flood the log pipeline
        // with unbounded raw lines.
        raw: parsed.raw.slice(0, 200),
        rawLength: parsed.raw.length
      });
    }
  };

  stream.on('data', (chunk) => {
    if (failure) {
      // The run already failed (run_error): the rest of the stream — the
      // terminal usage record included — is ignored (the doc stays
      // unanswered).
      return;
    }
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data: ')) continue;

      handleSeamDataLine(trimmed.slice(6));
    }
  });

  stream.on('error', (error) => {
    clearDeadline();
    if (failure) {
      // E.g. the run_error abort — the typed 502 already owns the terminal.
      return;
    }
    logger.error('AgentJsonResult.agent_stream_error', { error: error.message, queryId });
    failure = new AgentJsonTurnError(504, {
      error: 'AGENT_SERVICE_UNAVAILABLE',
      message: error.message
    });
  });

  // Multi-byte UTF-8 characters can split across chunk boundaries — decode on
  // the stream, never per chunk (setEncoding above). The settle point covers
  // every termination: 'end' (fully consumed), 'error' (the leg failed or the
  // wall-clock abort destroyed it) — 'close' rides along for a destroyed
  // stream that reports neither. resolve is idempotent: the first wins, the
  // rest are no-ops.
  await new Promise((resolve) => {
    stream.on('end', resolve);
    stream.on('error', resolve);
    stream.on('close', resolve);
  });
  clearDeadline();
  if (!failure && buffer.trim()) {
    // The trailing line that never got its newline is still a frame — flush
    // the remainder through the parser before the terminal (the frame
    // writer's same idiom): a lost usage_record or verdict must not be
    // silent. The chunk handler's guard applies: only a `data: ` line
    // reaches the parser — a trailing SSE comment is dropped, never a
    // spurious seam_parse_error.
    const remainder = buffer.trim();
    if (remainder.startsWith('data: ')) {
      handleSeamDataLine(remainder.slice(6));
    }
    buffer = '';
  }
  if (failure) {
    throw failure;
  }
  if (controller.signal.aborted) {
    // A wall-clock abort whose stream terminated without an 'error' event
    // (destroyed, 'close' only) is still a BFF-attributed timeout — never a
    // truncated-but-complete answer.
    throw new AgentJsonTurnError(504, {
      error: 'AGENT_SERVICE_UNAVAILABLE',
      message: 'Agent service unavailable or timed out'
    });
  }

  // ── whole-answer translation: the `handleStreamDone` non-relay branch's
  // semantics (post-run, request-resolved translator, fail-soft — the shared
  // whole-answer core). The agent always answers English (the run body's
  // `language` is the preparation hint, not an answer-language request); a
  // translator that is missing or fails never drops the answer — the English
  // text stands and the failure travels as the additive latch.
  let deliveredText = fullResponseText;
  let translationFailed = false;
  if (wantsTranslation(targetLanguage) && fullResponseText) {
    const result = await translateWholeAnswer(translator, fullResponseText);
    if (result.failed) {
      if (result.error) {
        logger.warn('AgentJsonResult.translation_failed', { queryId, error: result.error.message });
      } else {
        // The model returned nothing — replacing the answer with nothing is
        // not a translation. The English original stands.
        logger.warn('AgentJsonResult.translation_empty', {
          queryId,
          targetLanguage,
          answerLen: fullResponseText.length
        });
      }
      translationFailed = true;
    } else {
      deliveredText = result.text;
    }
  }

  // The assembled metadata — the same home the streaming terminal uses —
  // plus THIS story's own derivation: the V05 abstention vocabulary, mapped
  // from the verdict (no verdict → `abstained` stays null).
  const metadata = applyAbstentionOverlay(
    assembleAgentMetadata({ verdict: capturedVerdict, runId, usageRecord }),
    capturedVerdict
  );

  const result = {
    response: deliveredText,
    metadata,
    responseTime: Date.now() - turnStartTime
  };
  if (translationFailed) {
    result.translationFailed = true;
  }
  return result;
}

module.exports = { runAgentJsonTurn, applyAbstentionOverlay, AgentJsonTurnError };
