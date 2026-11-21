'use strict';

const axios = require('axios');
const http = require('http');
const https = require('https');
const { trace } = require('@opentelemetry/api');
const { logger, spanAttrs, parsePositiveInt } = require('../shared-lib');
const { agentServiceUrl } = require('./agent-routing');
const { parseAgentSeamLine } = require('./agent-seam-parser');
const { writeSSEFrame } = require('./sse-frame');
const { wantsTranslation, streamingTranslationEnabled } = require('./translation/language-request');
const { createStreamUnitRelay } = require('./translation/stream-unit-relay');

// Story 2.4 — the BFF frame writer. The BFF parses the agent-service SEAM
// stream (POST /v1/runs, the `{run_id, call_id, seq, kind, payload}` envelope
// over SSE plus the terminal usage record) and writes EVERY client frame
// itself — chunk relay, agent_activity, agent_verdict, metadata (+ the
// agent_run persistence), translation injection, done/error. The agent
// service never writes a client frame.
//
// Frame contract (pinned positions, epic 2):
//   - the five existing client types are byte-compatible with the legacy
//     dialect (chunk/metadata/translation/done/error, done always last);
//   - `agent_activity` (version 1) interleaves with the chunks — one frame
//     per tool-call lifecycle event (started/completed, operation name);
//   - `agent_verdict` (version 1) after the last chunk, before metadata;
//   - on a genuine failure the legacy error-frame contract applies: error
//     frame then end, no `done`, no metadata.
//
// Clients that ignore the two additive types behave exactly as today.

// ─── the deadline derivation (docs/agent-budget-deadline-pairs.md) ──────────
//
// The pair rule (`AGENT_UPSTREAM_TIMEOUT_MS >= deadline_ms + reserves`) holds
// by construction: the deadline the BFF communicates is the timeout MINUS the
// named reserves. The reserves are module constants, not knobs — 2.10
// revisits them when translation allowances land. The judge-overrun ceiling
// (AGENT_VERDICT_JUDGE_TIMEOUT_MS, story 2.6) is not part of this derivation
// yet: the run surface bounds its own wall clock and answers honestly, so a
// long run surfaces as the agent's own budget_exhausted/run_error, never as
// a BFF timeout.
const DEFAULT_UPSTREAM_TIMEOUT_MS = 3600000;
const TRANSLATION_RESERVE_MS = 30000; // the GPU translator's own hard timeout
const FINALIZATION_MARGIN_MS = 5000; // metadata persistence + frame write + SSE teardown
const DEADLINE_FLOOR_MS = 1000;

/**
 * The EFFECTIVE upstream timeout — the one value BOTH consumers of the pair
 * read (the deadline derivation and the axios `timeout` option). A configured
 * timeout that cannot cover the reserves plus the floor would break the pair
 * rule (`deadline_ms + reserves > timeout`) and turn a bounded run into a
 * BFF-attributed abort — the misattribution the pairs doc forbids — so it is
 * absorbed: one warning names the knob (configured vs applied) and the
 * default applies to everything downstream.
 * @returns {number}
 */
function resolveUpstreamTimeoutMs() {
  const configured = parsePositiveInt(process.env.AGENT_UPSTREAM_TIMEOUT_MS, DEFAULT_UPSTREAM_TIMEOUT_MS, { min: 1 });
  if (configured <= TRANSLATION_RESERVE_MS + FINALIZATION_MARGIN_MS + DEADLINE_FLOOR_MS) {
    logger.warn('AgentFrameWriter.upstream_timeout_below_reserves', {
      knob: 'AGENT_UPSTREAM_TIMEOUT_MS',
      configured,
      applied: DEFAULT_UPSTREAM_TIMEOUT_MS
    });
    return DEFAULT_UPSTREAM_TIMEOUT_MS;
  }
  return configured;
}

/**
 * The agent-phase deadline the run request communicates: the upstream timeout
 * minus the translation and finalization reserves. The caller passes the
 * EFFECTIVE timeout (`resolveUpstreamTimeoutMs()` — the absorption happens
 * there, once, so the deadline and the wire-level timeout can never read two
 * different values).
 * @param {number} timeoutMs - The effective upstream timeout.
 * @returns {number}
 */
function deriveDeadlineMs(timeoutMs) {
  return Math.max(DEADLINE_FLOOR_MS, timeoutMs - TRANSLATION_RESERVE_MS - FINALIZATION_MARGIN_MS);
}

// ─── verdict projection ─────────────────────────────────────────────────────
//
// The verdict payload is the verification pipeline's projection contract
// (agent/verification.py Verdict.payload()): grounding_status, is_grounded,
// translation_mode, policy, judge, citations, invalid_citations, marking. The
// frame carries it verbatim; the METADATA keeps its existing shape and takes
// only the additive fields the client metadata contract names:
// `grounding_status` (tri-state) + the derived `is_grounded`, plus the
// source_documents mapped from the citations into the deployed envelope
// variants.

/**
 * Map one verdict citation (`{provenance, text, score}`) to the deployed
 * source_documents row shape — the mapping noagent/pipeline.py's
 * `source_document_envelope` performs server-side for the no-agent path:
 * a legacy corpus source carries `document_id` and no source marker; an OKF
 * concept carries the `concept_id`/`repo_id`/`bundle_version` trio and
 * `source: 'okf-concept'`. Identity-derived names, empty url/labels — the
 * deployed shape, no per-answer metadata round-trip.
 * @param {Object} citation
 * @returns {Object|null} The source_documents row, or null for a citation
 *   whose provenance is not an object (nothing invented for it).
 */
function citationToSourceDocument(citation) {
  const provenance = citation && citation.provenance;
  if (!provenance || typeof provenance !== 'object' || Array.isArray(provenance)) {
    return null;
  }
  // The row fields both variants share; the variant adds its identity keys.
  const identity = provenance.source === 'okf-concept' ? provenance.concept_id : provenance.file_id;
  const entry = {
    document_id: identity,
    document_name: String(identity ?? '')
      .replace(/_/g, ' ')
      .trim(),
    url: '',
    categoryLabels: [],
    serviceLabels: [],
    score: typeof citation.score === 'number' ? citation.score : null
  };
  if (provenance.source === 'okf-concept') {
    entry.concept_id = provenance.concept_id;
    entry.source = 'okf-concept';
    if (provenance.repo_id) {
      entry.repo_id = provenance.repo_id;
    }
    if (provenance.bundle_version !== undefined && provenance.bundle_version !== null) {
      entry.bundle_version = provenance.bundle_version;
    }
  }
  return entry;
}

/**
 * Assemble the metadata object one agentic turn persists and streams.
 *
 * Base: the legacy empty-stream shape (`emptyStreamMetadata()` — abstained
 * null, filter_labels null), so an agentic doc is indistinguishable in shape
 * from a legacy one. The verdict overlays the additive grounding fields and
 * the citation set; a run WITHOUT a verdict event defaults to `unverified` —
 * never a confident default. The `agent_run` block (run_id + the terminal
 * usage record when one arrived) rides additively on the wire and into the
 * persisted doc — the version-record persistence of this story.
 *
 * @param {Object} params
 * @param {Function} params.emptyStreamMetadata - The route's metadata factory.
 * @param {Object|null} params.verdict - The captured verdict payload.
 * @param {string|null} params.runId - The seam run id.
 * @param {Object|null} params.usageRecord - The terminal usage record.
 * @returns {Object}
 */
function assembleAgentMetadata({ emptyStreamMetadata, verdict, runId, usageRecord }) {
  const metadata = emptyStreamMetadata();
  if (verdict) {
    metadata.grounding_status = verdict.grounding_status;
    metadata.is_grounded = verdict.is_grounded === true;
    metadata.source_documents = (Array.isArray(verdict.citations) ? verdict.citations : [])
      .map(citationToSourceDocument)
      .filter(Boolean);
  } else {
    metadata.grounding_status = 'unverified';
    metadata.is_grounded = false;
  }
  metadata.agent_run = { run_id: runId ?? null };
  if (usageRecord) {
    metadata.agent_run.usage_record = usageRecord;
  }
  return metadata;
}

/**
 * The upstream JSON body to forward to the client — only a real object passes
 * through; anything else (a string body, an array, garbage) falls back to the
 * documented error name at the caller.
 * @param {Object|null} parsed - The parsed upstream body.
 * @returns {Object|null}
 */
const passthroughBody = (parsed) => (parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null);

/**
 * Read an upstream non-2xx body (a stream under `responseType: 'stream'`) and
 * parse it as JSON, best-effort — the 429/503 answers are passed through to
 * the client verbatim when they parse, with a generic fallback when they do
 * not. A body beyond the 64 KiB cap stops buffering (the prefix still parses
 * when it can) and warns: an operator must know a real body was cut, not see
 * a silent degrade to the fallback.
 * @param {Object} data - The axios response data (a Node stream).
 * @param {number} [status] - The upstream status, for the truncation warning.
 * @returns {Promise<{text: string, parsed: Object|null}>}
 */
function readUpstreamBody(data, status) {
  return new Promise((resolve) => {
    if (!data || typeof data.on !== 'function') {
      resolve({ text: '', parsed: null });
      return;
    }
    const chunks = [];
    let size = 0;
    let truncated = false;
    data.on('data', (chunk) => {
      size += chunk.length;
      if (size <= 65536) {
        chunks.push(chunk);
      } else if (!truncated) {
        truncated = true;
        logger.warn('AgentFrameWriter.upstream_body_truncated', {
          status,
          bytes: size
        });
      }
    });
    data.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
      resolve({ text, parsed });
    });
    data.on('error', () => resolve({ text: '', parsed: null }));
  });
}

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
 * @param {Function} params.emptyStreamMetadata - The route's metadata factory.
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
  handleStreamDone,
  emptyStreamMetadata
}) {
  // The EFFECTIVE timeout — resolved once here, so the deadline derivation
  // and the wire-level timeout (and the stream wall-clock bound below) all
  // read the SAME value: an under-sized configuration is absorbed at this
  // one point, never partially.
  const effectiveTimeoutMs = resolveUpstreamTimeoutMs();
  const controller = new AbortController();
  const bearer = authHeaders?.authorization || null;

  // The streaming-translation relay: the SAME machinery the legacy path uses
  // (one home, translation behaves as today). No translation-backend
  // selection keyed on routing here — the request-resolved translator is the
  // one both paths use (story 2.10 revisits).
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
      if (!controller.signal.aborted) {
        controller.abort();
      }
    }, effectiveTimeoutMs);
  };

  const assembleMetadata = () =>
    assembleAgentMetadata({ emptyStreamMetadata, verdict: capturedVerdict, runId, usageRecord });

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
    // contract; a cancelled run emits no terminal event).
    if (fullResponseText) {
      const metadata = assembleMetadata();
      queryService
        .finalizeStreamQuery(queryId, fullResponseText, Date.now() - streamStartTime, metadata)
        .catch((err) => logger.error('QueryService.partial_save_failed', { queryId, error: err.message }));
    }
  });

  // The shared posture resolution (one home with the fan-out carrier — no
  // double upstream calls, no drift). Fail-closed: any resolver problem
  // except a 401 (the request itself is invalid — it propagates) degrades to
  // an empty authorized set, the same direction the carrier degrades to.
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
      httpAgent: new http.Agent({ keepAlive: true }),
      httpsAgent: new https.Agent({ keepAlive: true }),
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

  const status = response.status;
  if (status === 429) {
    const { parsed } = await readUpstreamBody(response.data, status);
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
    logger.warn('AgentFrameWriter.run_surface_unconfigured', { queryId, body: parsed });
    return res.status(503).json(passthroughBody(parsed) || { error: 'budget_configuration_missing' });
  }
  if (status === 422) {
    // A malformed run request is a request problem, not an outage — the
    // upstream's validation answer passes through (the fallback names it as
    // the BFF's own invalid request).
    const { parsed } = await readUpstreamBody(response.data, status);
    logger.warn('AgentFrameWriter.run_request_invalid', { queryId, body: parsed });
    return res.status(422).json(passthroughBody(parsed) || { error: 'invalid_run_request' });
  }
  if (status !== 200 || !response.data) {
    const { parsed } = await readUpstreamBody(response.data, status);
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

  const finishWithErrorFrame = (message, code) => {
    if (streamFinished || res.writableEnded) return;
    streamFinished = true;
    cleanupKeepalive();
    clearStreamDeadline();
    // The client was told the run failed: the agent leg must not keep making
    // model calls (and holding its admission slot) behind a dead response.
    if (!controller.signal.aborted) {
      controller.abort();
    }
    writeSSEFrame(res, { type: 'error', message, code });
    res.end();
  };

  const doAgentTerminal = async () => {
    if (streamFinished || res.writableEnded || res.destroyed) return;
    streamFinished = true;
    cleanupKeepalive();
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
        writeSSEFrame(res, { type: 'agent_verdict', version: 1, ...verdictProjection });
      }
      const metadata = assembleMetadata();
      await handleStreamDone(queryId, fullResponseText, streamStartTime, res, metadata, {
        targetLanguage,
        translator,
        skipPostStreamTranslation: Boolean(streamRelay),
        alreadyFailedTranslation
      });
    } catch (error) {
      logger.error('AgentFrameWriter.stream_done_failed', { queryId, error: error.message });
    }
  };

  const onSeamEvent = (event) => {
    if (streamFinished) {
      // The stream is over on our side (terminal, error, disconnect): any
      // frame written now would land after `end` — write-after-end.
      return;
    }
    runId = event.run_id;
    switch (event.kind) {
      case 'run_started':
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
      case 'run_error':
        // The legacy error contract: error frame then end — no metadata, no
        // done, nothing fabricated. The usage record that follows the seam
        // terminal is ignored (the run failed; the doc stays unanswered).
        finishWithErrorFrame(
          typeof event.payload?.message === 'string' && event.payload.message
            ? event.payload.message
            : 'the agent run failed',
          'AGENT_RUN_ERROR'
        );
        break;
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
      logger.warn('AgentFrameWriter.seam_parse_error', { queryId, raw: parsed.raw });
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
    finishWithErrorFrame(error.message, 'AGENT_STREAM_ERROR');
  });

  stream.on('end', () => {
    if (streamFinished) return;
    // A trailing data line that never got its newline is still a frame —
    // flush the remainder through the parser before the terminal.
    if (buffer.trim()) {
      handleSeamDataLine(buffer);
      buffer = '';
    }
    doAgentTerminal();
  });
}

module.exports = {
  proxyAgentRun,
  // Exposed for the tests that pin them — production code reads nothing here.
  _internals: {
    DEFAULT_UPSTREAM_TIMEOUT_MS,
    TRANSLATION_RESERVE_MS,
    FINALIZATION_MARGIN_MS,
    deriveDeadlineMs,
    resolveUpstreamTimeoutMs
  }
};
