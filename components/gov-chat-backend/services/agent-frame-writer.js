'use strict';

const axios = require('axios');
const { trace } = require('@opentelemetry/api');
const { logger, spanAttrs } = require('../shared-lib');
const { agentServiceUrl } = require('./agent-routing');
const { parseAgentSeamLine } = require('./agent-seam-parser');
const {
  resolveUpstreamTimeoutMs,
  deriveDeadlineMs,
  assembleAgentMetadata,
  captureRunStart,
  seamRunOutcome,
  createAgentRunAttribution,
  readUpstreamBody,
  passthroughBody,
  agentHttpAgent,
  agentHttpsAgent,
  _internals: contractInternals
} = require('./agent-run-contract');
const { writeSSEFrame } = require('./sse-frame');
// Cross-mode abstention parity: the completed terminal derives the same V05
// vocabulary the JSON consumer derives. Safe direction — agent-json-result
// requires the contract module, never this file.
const { applyAbstentionOverlay } = require('./agent-json-result');
const { wantsTranslation, streamingTranslationEnabled } = require('./translation/language-request');
const { createStreamUnitRelay } = require('./translation/stream-unit-relay');
const { createWholeAnswerTranslator } = require('./translation/agentic-translation-leg');

// The BFF frame writer. The BFF parses the agent-service SEAM
// stream (POST /v1/runs, the `{run_id, call_id, seq, kind, payload}` envelope
// over SSE plus the terminal usage record) and writes EVERY client frame
// itself — chunk relay, agent_activity, agent_verdict, metadata (+ the
// agent_run persistence), translation injection, done/error. The agent
// service never writes a client frame.
//
// Frame contract (pinned positions):
//   - the five existing client types are byte-compatible with the legacy
//     dialect (chunk/metadata/translation/done/error, done always last);
//   - `agent_activity` (version 1) interleaves with the chunks — one frame
//     per tool-call lifecycle event (started/completed, operation name);
//   - `agent_verdict` (version 1) after the last chunk, before metadata;
//   - on a genuine failure the legacy error-frame contract applies: error
//     frame then end, no `done`, no metadata.
//
// Clients that ignore the two additive types behave exactly as today.
//
// The deadline pair, the citation mapping, the metadata assembly and the
// upstream body reader are the SHARED contract module's (agent-run-contract.js)
// — this file is the streaming consumer; the non-streaming JSON
// consumer (agent-json-result.js) reads the same homes.

/**
 * Proxy one agentic streaming turn: POST /v1/runs, project the seam stream
 * onto client frames, detect the client disconnect on `res.on('close')` and
 * abort the upstream leg.
 *
 * Called by the streaming route INSTEAD of the chatqna relay, after
 * `initStreamQuery` (the `queries` doc exists; queryId continuity) and before
 * any SSE byte is written — a saturated lane (429) or an unconfigured run
 * surface (503) is answered as client JSON BEFORE the SSE headers.
 *
 * @param {Object} params
 * @param {Object} params.res - The Express response.
 * @param {Object} params.queryService - The injected query service (posture
 *   resolution + finalize/pickUserText).
 * @param {string} params.queryId - The `queries` doc key initStreamQuery minted.
 * @param {Object} params.queryData - The request body (+ userId).
 * @param {Object} params.authHeaders - `{authorization}` for the agent leg and
 *   the posture resolution.
 * @param {string} params.targetLanguage - The normalized requested language.
 * @param {Object|null} params.translator - The request-resolved translator.
 * @param {number} params.streamStartTime - Route-entry timestamp (ms).
 * @param {Function} params.handleStreamDone - The route's terminal writer
 *   (metadata frame → optional translation → finalize → done + end), REUSED
 *   verbatim so the terminal order is preserved by construction.
 */
async function proxyAgentRun({
  res,
  queryService,
  queryId,
  queryData,
  authHeaders,
  targetLanguage,
  translator,
  streamStartTime,
  handleStreamDone
}) {
  // The EFFECTIVE timeout — resolved once here, so the deadline derivation
  // and the wire-level timeout (and the stream wall-clock bound below) all
  // read the SAME value: an under-sized configuration is absorbed at this
  // one point, never partially.
  const effectiveTimeoutMs = resolveUpstreamTimeoutMs();
  const controller = new AbortController();
  const bearer = authHeaders?.authorization || null;

  // The streaming-translation relay: the SAME machinery the legacy path uses
  // (one home, translation behaves as today). The relay units run MID-STREAM
  // — before any terminal usage record exists — so the agentic translation
  // leg (whose residual plan reads that record) cannot serve them; the
  // request-resolved translator stays the streaming path's backend, and the
  // leg owns the POST-STREAM whole-answer translation
  // (streaming off, and the non-streaming JSON entry) where the terminal
  // record exists. Moving the usage record earlier in the seam is the
  // future decision that would let the leg bound the units too.
  const useStreamingTranslation = streamingTranslationEnabled() && wantsTranslation(targetLanguage);
  const streamRelay = useStreamingTranslation
    ? createStreamUnitRelay({ res, translator, targetLanguage, queryId })
    : null;

  // ── stream state ──
  let keepalive = null;
  let buffer = '';
  let fullResponseText = '';
  let runId = null;
  let capturedVerdict = null;
  let usageRecord = null;
  // The attribution state. `runStart` is what the
  // `run_started` payload carried (persisted AT START, so a run whose final
  // frame never arrives keeps its versions); the writer pair below owns the
  // fire-and-forget discipline and the one-honest-outcome latch (the first
  // terminal fact wins — a deadline fire keeps `timed_out` even when the
  // abort's stream teardown then reports an error). The shared home is
  // createAgentRunAttribution in agent-run-contract.js.
  let runStart = null;
  const attribution = createAgentRunAttribution({
    queryService,
    queryId,
    logPrefix: 'AgentFrameWriter',
    gate: () => res.headersSent
  });
  const persistRunOutcome = attribution.persistRunOutcome;
  // The stream is finished from the BFF's perspective (completed, errored or
  // disconnected): no further frames, no partial save. One flag owns the
  // terminal state — every terminal path sets it, every guard reads it.
  let streamFinished = false;
  const callNames = new Map(); // call_id → operation name (the finished event carries no name)

  const cleanupKeepalive = () => {
    if (keepalive !== null) {
      clearInterval(keepalive);
      keepalive = null;
    }
  };

  // The stream's wall-clock bound. Once the upstream response HEADERS have
  // arrived, the axios timeout degenerates to an inactivity bound — a
  // trickling upstream would hold the run (and its admission slot) forever.
  // The bound is the SAME effective timeout the leg was dialed with; on fire
  // the controller aborts and the stream's 'error' path ends the response
  // with the error contract.
  let streamDeadline = null;
  const clearStreamDeadline = () => {
    if (streamDeadline !== null) {
      clearTimeout(streamDeadline);
      streamDeadline = null;
    }
  };
  const armStreamDeadline = () => {
    clearStreamDeadline();
    streamDeadline = setTimeout(() => {
      streamDeadline = null;
      logger.warn('AgentFrameWriter.stream_deadline_exceeded', { queryId, timeoutMs: effectiveTimeoutMs });
      // The BFF-attributed deadline is an honest terminal fact:
      // the run's doc keeps its versions and reads `timed_out`. Latched —
      // the abort's stream teardown below must not overwrite it.
      persistRunOutcome('timed_out');
      if (!controller.signal.aborted) {
        controller.abort();
      }
    }, effectiveTimeoutMs);
  };

  const assembleMetadata = (outcome) =>
    assembleAgentMetadata({ verdict: capturedVerdict, runId, usageRecord, runStart, outcome });

  // The disconnect signal: `res.on('close')`. Registered before any await, so
  // a client that leaves during the posture resolution or the agent-leg wait
  // aborts the upstream call too. `close` fires on EVERY response end
  // including the normal one — the `streamFinished` guard keeps a completed
  // or errored stream from being re-finalized as a partial save.
  res.on('close', () => {
    cleanupKeepalive();
    clearStreamDeadline();
    if (streamFinished) return;
    streamFinished = true;
    if (!controller.signal.aborted) {
      controller.abort();
      logger.info('QueryService.stream_client_disconnected', { queryId });
    }
    // A partial answer already streamed is partial-saved like the legacy
    // close path does — the agent-service cancels its in-flight work (its
    // contract; a cancelled run emits no terminal event). The save carries
    // the `answer_interrupted` honesty marker: a truncated
    // answer must never persist indistinguishable from a complete one, and
    // `abstained` reads NULL — an interrupted turn's decision is not final
    // (the verdict was never terminaled; the `false` rationale covers
    // COMPLETED turns only, and `answer_interrupted` already distinguishes
    // interrupted-ness). A disconnect before any text chunk leaves the
    // at-start doc unanswered — nothing is fabricated. The `cancelled`
    // outcome rides exactly ONE write: with partial text, the
    // partial save's assembled metadata carries it (merging the run-start
    // block instead of clobbering it) and the standalone patch stays
    // latched OFF — a fire-and-forget patch racing the save would be a
    // second read-merge-write whose stale metadata could overwrite the
    // save's assembled block (losing `answer_interrupted`); the patch fires
    // only as the save's failure fallback. Without partial text, the patch
    // is the one write.
    if (fullResponseText) {
      const metadata = assembleMetadata('cancelled');
      metadata.answer_interrupted = true;
      metadata.abstained = null;
      queryService
        .finalizeStreamQuery(queryId, fullResponseText, Date.now() - streamStartTime, metadata, {
          // The agentic answer cannot name routed graphs — the sticky set is
          // left untouched (branch-driven skip).
          skipRoutedGraphs: true
        })
        .catch((err) => {
          logger.error('QueryService.partial_save_failed', { queryId, error: err.message });
          // The save failed: the standalone patch is still the doc's only
          // chance to carry the honest outcome.
          persistRunOutcome('cancelled');
        });
    } else {
      persistRunOutcome('cancelled');
    }
  });

  // The shared posture resolution (one home with the fan-out carrier — no
  // double upstream calls, no drift). Fail-closed, DELIBERATELY stricter
  // than the legacy carrier: any resolver problem except a 401 (the request
  // itself is invalid — it propagates) builds an empty CallerContext, whose
  // search_knowledge raises AuthorizationError — the run ends in the
  // insufficiency answer, the fail-closed direction for degraded
  // retrieval. (The legacy carrier's degrade instead keeps the
  // byte-identical legacy-corpus payload — same trigger, intended
  // different outcome.)
  let callerContext;
  try {
    const posture = await queryService.resolveFanoutPosture(authHeaders, {
      queryId,
      sessionId: queryData.sessionId ?? null
    });
    callerContext = queryService.buildAgentCallerContext(queryData, posture);
  } catch (error) {
    if (error?.statusCode === 401) {
      throw error;
    }
    logger.error('AgentFrameWriter.caller_context_failed_fail_closed', { queryId, error: error?.message });
    callerContext = queryService.buildAgentCallerContext(queryData, null);
  }

  const runBody = {
    question: queryService.pickUserText(queryData.messages, queryData.userQuestion),
    deadline_ms: deriveDeadlineMs(effectiveTimeoutMs),
    context: callerContext,
    // The named-locale display hint the preparation module consumes (beats
    // detection); null when this request is answered in English — the agent
    // always ANSWERS English, the run body never carries a language the run
    // should answer IN.
    language: wantsTranslation(targetLanguage) ? targetLanguage : null,
    bearer
  };

  // ── the upstream call: admission (429) and configuration (503) surface as
  // client JSON BEFORE any SSE byte ──
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
      // The status is inspected here (429/503 passthrough) instead of thrown.
      validateStatus: () => true
    });
  } catch (error) {
    if (res.writableEnded || res.destroyed) {
      return; // the client left during the wait; the close handler already ran
    }
    if (error?.code === 'ECONNABORTED' || error?.code === 'ERR_CANCELED') {
      res.status(504).json({ error: 'AGENT_SERVICE_UNAVAILABLE', message: 'Agent service unavailable or timed out' });
      return;
    }
    logger.error('AgentFrameWriter.upstream_request_failed', { queryId, error: error?.message });
    res.status(502).json({ error: 'AGENT_SERVICE_UNAVAILABLE', message: error?.message });
    return;
  }

  // The wall-clock bound arms HERE — before the status ladder: the axios
  // timeout covers time-to-headers only, and a trickling non-2xx body would
  // otherwise hold the request (and its admission slot) forever. Each
  // refusal path clears it after its body read; the success path re-arms
  // below (fresh window for the stream).
  armStreamDeadline();

  const status = response.status;
  if (status === 429) {
    const { parsed } = await readUpstreamBody(response.data, status);
    clearStreamDeadline();
    // The lane hint passes through (the caller retries on it); a body that
    // did not parse (or is not an object) falls back to the documented error
    // name.
    if (response.headers?.['retry-after'] !== undefined) {
      res.set('Retry-After', String(response.headers['retry-after']));
    }
    logger.warn('AgentFrameWriter.admission_refused', { queryId });
    return res.status(429).json(passthroughBody(parsed) || { error: 'admission_refused' });
  }
  if (status === 503) {
    const { parsed } = await readUpstreamBody(response.data, status);
    clearStreamDeadline();
    logger.warn('AgentFrameWriter.run_surface_unconfigured', { queryId, body: parsed });
    return res.status(503).json(passthroughBody(parsed) || { error: 'budget_configuration_missing' });
  }
  if (status === 422) {
    // A malformed run request is a request problem, not an outage — the
    // upstream's validation answer passes through (the fallback names it as
    // the BFF's own invalid request).
    const { parsed } = await readUpstreamBody(response.data, status);
    clearStreamDeadline();
    logger.warn('AgentFrameWriter.run_request_invalid', { queryId, body: parsed });
    return res.status(422).json(passthroughBody(parsed) || { error: 'invalid_run_request' });
  }
  if (status !== 200 || !response.data) {
    const { parsed } = await readUpstreamBody(response.data, status);
    clearStreamDeadline();
    logger.error('AgentFrameWriter.upstream_status_error', { queryId, status });
    return res
      .status(502)
      .json({ error: 'AGENT_SERVICE_UNAVAILABLE', message: parsed?.message || `agent service answered ${status}` });
  }

  const stream = response.data;

  // Stamp the correlation id on the handler span — the same join the legacy
  // path performs (see query-routes.js).
  if (queryId) {
    const activeSpan = trace.getActiveSpan();
    if (activeSpan && activeSpan.isRecording()) {
      activeSpan.setAttribute(spanAttrs.QUERY_ID_KEY, queryId);
    }
  }

  // SSE response headers — written only now: every pre-stream refusal above
  // is plain JSON, so the client never sees a 200 whose body is an error.
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  keepalive = setInterval(() => {
    if (res.writableEnded) {
      cleanupKeepalive();
      return;
    }
    res.write(': keepalive\n\n');
  }, 15000);

  const finishWithErrorFrame = (message, code, outcome) => {
    if (streamFinished || res.writableEnded) return;
    streamFinished = true;
    cleanupKeepalive();
    clearStreamDeadline();
    // The client was told the run failed: the agent leg must not keep making
    // model calls (and holding its admission slot) behind a dead response.
    if (!controller.signal.aborted) {
      controller.abort();
    }
    // The honest outcome rides the same terminal: the seam's
    // own outcome code for a run_error, `interrupted` for an upstream
    // stream that died before the final metadata. Latched — a deadline
    // fire's `timed_out` (written at the abort) is never overwritten by the
    // teardown it caused.
    persistRunOutcome(outcome);
    writeSSEFrame(res, { type: 'error', message, code });
    res.end();
  };

  const doAgentTerminal = async () => {
    if (streamFinished || res.writableEnded || res.destroyed) return;
    streamFinished = true;
    // The keepalive stays emitting THROUGH the terminal: the post-stream
    // whole-answer translation below is bounded by the translation reserve
    // (tens of seconds are legal), and a zero-byte wire in that window lets
    // an idle-timeout proxy sever the SSE before `done`. SSE comments cannot
    // move the pinned frame order — this is the legacy terminal's discipline
    // (its interval runs through handleStreamDone and self-retires on the
    // writableEnded guard). Retired below once the response has ended.
    clearStreamDeadline();
    try {
      let alreadyFailedTranslation = false;
      if (streamRelay) {
        // The queued translated units flush BEFORE the verdict frame: the
        // verdict is pinned after the LAST chunk on the wire, and a unit
        // still in the chain is a chunk the client has not seen yet.
        alreadyFailedTranslation = await streamRelay.flush();
      }
      if (capturedVerdict) {
        // The projection payload rides verbatim EXCEPT its own `type`/`version`
        // keys: a payload carrying them must not override the frame's
        // discriminator and version.
        const verdictProjection = { ...capturedVerdict };
        delete verdictProjection.type;
        delete verdictProjection.version;
        // The verdict certifies the SOURCE-LANGUAGE text; the client marks the
        // distinction on the answer. The agent service cannot know whether a
        // translation was delivered — the finalize-time payload always says
        // 'none' — so the frame writer, which owns the delivery, annotates the
        // one mode it can know here: translated units relayed on the wire.
        // The post-stream whole-answer mode (streaming translation off) is
        // unknowable at this point — its translation frame lands after this
        // frame, and the client reads the delivery from that frame itself.
        // A relay that delivered units and THEN failed keeps 'none': the
        // annotation keys on the post-flush failure latch, so a mixed run
        // understates rather than overstates what was verified — never the
        // other way round.
        if (streamRelay && !alreadyFailedTranslation && /\S/.test(fullResponseText)) {
          verdictProjection.translation_mode = 'streaming-units';
        }
        writeSSEFrame(res, { type: 'agent_verdict', version: 1, ...verdictProjection });
      }
      // CROSS-MODE ABSTENTION PARITY: the completed terminal derives the
      // V05 abstention vocabulary from the verdict — exactly what the JSON
      // consumer applies — so an insufficiency run persists
      // `abstained: true` + reason on BOTH entries, an answered run false,
      // and a stream with NO verdict restores null ("decision never
      // reported"; the base's null rides untouched). The assembled
      // metadata merges the run-start block + the `answered` outcome
      // — the finalize COMPLETES the start write, never
      // clobbers it.
      const metadata = applyAbstentionOverlay(assembleMetadata('answered'), capturedVerdict);
      // The post-stream whole-answer translation: the AGENTIC LEG owns it on
      // the non-relay terminal (GPU-only keyed on the routing decision,
      // bounded by the run's residual budget — the terminal usage record —
      // and the remaining end-to-end deadline, fail-closed on the REQUIRED
      // knobs). The relay path skips the post-stream translation entirely
      // (its units were the delivery) and never builds one. The writability
      // conditions are defense-in-depth — doAgentTerminal's entry guard
      // covers them (and construction is where a missing knob logs its
      // ERROR) — kept so the gate reads as one unit at the construction.
      let translateFullAnswer = null;
      if (
        !streamRelay &&
        wantsTranslation(targetLanguage) &&
        fullResponseText &&
        !res.writableEnded &&
        !res.destroyed
      ) {
        translateFullAnswer = createWholeAnswerTranslator({
          runUsage: usageRecord,
          targetLanguage,
          deadlineStartMs: streamStartTime,
          timeoutMs: effectiveTimeoutMs,
          signal: controller.signal
        });
      }
      await handleStreamDone(queryId, fullResponseText, streamStartTime, res, metadata, {
        targetLanguage,
        translator,
        skipPostStreamTranslation: Boolean(streamRelay),
        alreadyFailedTranslation,
        translateFullAnswer,
        // The agentic answer cannot name routed graphs — the sticky set is
        // left untouched (branch-driven skip).
        skipRoutedGraphs: true
      });
    } catch (error) {
      logger.error('AgentFrameWriter.stream_done_failed', { queryId, error: error.message });
    }
    // handleStreamDone ends the response (every path: done, client-gone early
    // return) — retire the interval deterministically; its writableEnded
    // self-guard covers anything that slips past this line.
    cleanupKeepalive();
  };

  const onSeamEvent = (event) => {
    if (streamFinished) {
      // The stream is over on our side (terminal, error, disconnect): any
      // frame written now would land after `end` — write-after-end.
      return;
    }
    runId = event.run_id;
    switch (event.kind) {
      case 'run_started': {
        // No client frame; the payload IS the run-start handshake:
        // the execution-version record is persisted AT START,
        // so a run whose final frame never arrives keeps its versions.
        // Fire-and-forget: an attribution write failure must never break
        // the answer path. (captureRunStart is the ONE shape home — the
        // success finalize later completes the same bytes.)
        runStart = captureRunStart(event);
        attribution.persistRunStart(runStart);
        break;
      }
      case 'text_message_started':
      case 'text_message_finished':
      case 'run_finished':
        // No client frame: run lifecycle and the text-message envelope are
        // seam-internal (the chunks themselves carry the answer).
        break;
      case 'text_message_content': {
        const text = event.payload?.text;
        if (typeof text !== 'string') {
          logger.warn('AgentFrameWriter.seam_text_event_malformed', { queryId, seq: event.seq });
          break;
        }
        fullResponseText += text;
        if (streamRelay) {
          streamRelay.onChunk(text);
        } else {
          writeSSEFrame(res, { type: 'chunk', content: text });
        }
        break;
      }
      case 'tool_call_started': {
        const name = typeof event.payload?.name === 'string' ? event.payload.name : null;
        if (event.call_id) {
          callNames.set(event.call_id, name);
        }
        writeSSEFrame(res, {
          type: 'agent_activity',
          version: 1,
          status: 'started',
          operation: name,
          callId: event.call_id
        });
        break;
      }
      case 'tool_call_finished': {
        // Auxiliary model calls (the grounding judge, preparation
        // translation) emit no agent_activity — only tool calls do.
        writeSSEFrame(res, {
          type: 'agent_activity',
          version: 1,
          status: 'completed',
          operation: event.call_id ? (callNames.get(event.call_id) ?? null) : null,
          callId: event.call_id
        });
        break;
      }
      case 'verdict':
        // Captured, not written: the frame goes out at the terminal, after
        // the last chunk flushes and before the metadata frame.
        capturedVerdict = event.payload;
        break;
      case 'run_error': {
        // The legacy error contract: error frame then end — no metadata, no
        // done, nothing fabricated. The outcome is the agent's own verdict:
        // the event's code — which the loop keeps identical
        // to the usage record's outcome that follows on the stream — so the
        // doc reads `error` / `budget_exhausted` verbatim. The usage record
        // itself is not persisted here (the run failed; the doc stays
        // unanswered — today's contract).
        finishWithErrorFrame(
          typeof event.payload?.message === 'string' && event.payload.message
            ? event.payload.message
            : 'the agent run failed',
          'AGENT_RUN_ERROR',
          seamRunOutcome(event, usageRecord)
        );
        break;
      }
      default:
        // A seam kind this BFF does not know: ignored — a newer agent service
        // must not break an older BFF (the envelope is additive by design).
        logger.debug('AgentFrameWriter.seam_kind_unrecognized', { queryId, kind: event.kind, seq: event.seq });
    }
  };

  // One seam data line → frame projection or state capture. Shared by the
  // chunk handler and the end-of-stream remainder flush.
  const handleSeamDataLine = (dataContent) => {
    const parsed = parseAgentSeamLine(dataContent);
    if (parsed.type === 'event') {
      onSeamEvent(parsed.event);
    } else if (parsed.type === 'usage_record') {
      usageRecord = parsed.record;
    } else {
      logger.warn('AgentFrameWriter.seam_parse_error', {
        queryId,
        // Bounded: a misbehaving upstream must not flood the log pipeline
        // with unbounded raw lines.
        raw: parsed.raw.slice(0, 200),
        rawLength: parsed.raw.length
      });
    }
  };

  // Multi-byte UTF-8 characters can split across chunk boundaries — decode on
  // the stream, never per chunk.
  stream.setEncoding('utf8');
  armStreamDeadline();
  stream.on('data', (chunk) => {
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
    cleanupKeepalive();
    if (streamFinished) {
      // E.g. the disconnect abort — already handled by the close handler.
      return;
    }
    logger.error('AgentFrameWriter.agent_stream_error', { error: error.message, queryId });
    finishWithErrorFrame(error.message, 'AGENT_STREAM_ERROR', 'interrupted');
  });

  stream.on('end', () => {
    if (streamFinished) return;
    // A trailing data line that never got its newline is still a frame —
    // flush the remainder through the parser before the terminal. The chunk
    // handler's guard applies: only a `data: ` line reaches the parser (a
    // trailing SSE comment is dropped, never a spurious seam_parse_error).
    const remainder = buffer.trim();
    if (remainder.startsWith('data: ')) {
      handleSeamDataLine(remainder.slice(6));
    }
    buffer = '';
    doAgentTerminal();
  });

  stream.on('close', () => {
    // A destroyed stream reporting 'close' ALONE never runs 'end' or
    // 'error': without this terminal the SSE response hangs on keepalives
    // forever and the admission slot stays held. The sibling discipline of
    // the JSON consumer — the error contract ends the response honestly.
    if (streamFinished) return;
    logger.error('AgentFrameWriter.agent_stream_close', { queryId });
    finishWithErrorFrame('the agent stream terminated', 'AGENT_STREAM_ERROR', 'interrupted');
  });
}

module.exports = {
  proxyAgentRun,
  // Exposed for the tests that pin them — production code reads nothing here.
  // The names are the shared contract module's (agent-run-contract.js, where
  // the definitions moved in 2.4b); the re-export keeps the frame-writer
  // suite's pin surface unchanged.
  _internals: contractInternals
};
