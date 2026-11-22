const express = require('express');
const router = express.Router();
const axios = require('axios');
const http = require('http');
const https = require('https');
const { trace } = require('@opentelemetry/api');
const { keycloakAuthMiddleware } = require('../middleware/keycloak-auth-middleware');
const { logger, spanAttrs, tracingBaggage } = require('../shared-lib');
const translationService = require('../services/translation-service');
const { createStreamUnitRelay } = require('../services/translation/stream-unit-relay');
const { languageForLog } = require('../services/translation/language-log');
const { isUnsupportedLanguage, unsupportedLanguageBody } = require('../services/translation/unsupported-language');
const { isAgentPathEnabled } = require('../services/agent-routing');
const { proxyAgentRun } = require('../services/agent-frame-writer');
const {
  normalizeRequestedLanguage,
  wantsTranslation,
  streamingTranslationEnabled
} = require('../services/translation/language-request');
const { writeSSEFrame } = require('../services/sse-frame');
const { parsePositiveInt } = require('../shared-lib');

/**
 * @description The language the caller asked for, normalized.
 *
 * The language travels in the request body, so it is caller-controlled: it is
 * normalized once, here, by the shared helper (the same one the query
 * service uses when it forwards the language to OPEA), and the translator
 * checks it against the language map before it is used for anything. An empty
 * result means "no language asked for".
 *
 * @param {object} queryData - The parsed request body.
 * @returns {string} The normalized language code, or '' when none was asked for.
 */
function requestedTargetLanguage(queryData) {
  return normalizeRequestedLanguage(queryData?.context?.language);
}

/**
 * Resolves the language a request asked for — once.
 *
 * The language travels in the request body, so it is caller-controlled. The
 * language map is the contract: a language the map does not carry cannot be
 * answered in, and answering in another language — one the caller cannot see —
 * is what this boundary exists to prevent. The request is therefore refused
 * before anything is generated and before a stream is opened, with the same
 * 400 the translate routes answer.
 *
 * The same resolution serves the translation itself. A streamed answer is
 * translated unit by unit, and the languages cannot change between two units
 * of one request: one resolution therefore answers both questions — may this
 * request proceed, and in which language is it answered.
 *
 * The refusal is about the language, not about the translator. When the
 * translation service is not ready the check cannot run at all: the request
 * goes through, and the answer is delivered in English with the failure
 * reported on `done` — a broken translator is not the caller's mistake.
 *
 * @param {string} targetLanguage - The normalized language the caller asked for.
 * @returns {Promise<{refusal: object|null, translator: object|null}>} The
 *   refusal to answer with (null when the request may proceed) and, when the
 *   language was accepted, a translator bound to the resolved pair (null when
 *   there is nothing to translate, or when no translator could be prepared).
 */
async function resolveRequestLanguage(targetLanguage) {
  if (!wantsTranslation(targetLanguage)) {
    // English is the language the answer is written in: there is no
    // translation to make, and nothing to refuse.
    return { refusal: null, translator: null };
  }
  try {
    await translationService.init();
    return { refusal: null, translator: translationService.createMarkdownTranslator('en', targetLanguage) };
  } catch (error) {
    return { refusal: languageRefusalOrNull(error, targetLanguage), translator: null };
  }
}

/**
 * The refusal a failed language check answers with, or null when the request
 * may proceed.
 *
 * A language the map does not carry is the caller's mistake and is refused.
 * A translation service that is not ready is not: the check could not run,
 * so the request goes through and the answer is delivered in English with
 * the failure reported on `done`.
 *
 * @param {Error} error - The failure the language check raised.
 * @param {string} targetLanguage - The normalized language the caller asked for.
 * @returns {object|null} The body to refuse with, or null when the request
 *   may proceed.
 */
function languageRefusalOrNull(error, targetLanguage) {
  if (!isUnsupportedLanguage(error)) {
    logger.warn(`QueryService.language_check_failed: ${error.message}`);
    return null;
  }
  logger.warn(`QueryService.unsupported_language: (lang=${languageForLog(targetLanguage)})`);
  // The body is the one every refusal is answered with: it names the
  // refused side, never the value the caller sent (a value that came back
  // in the answer could be handed on to a model).
  return unsupportedLanguageBody(error);
}

/**
 * Refuses a request for a language the deployment cannot answer in — without
 * preparing a translator.
 *
 * This is the check of the paths that do not translate in this service: the
 * answer of a non-streamed request is translated by the chatqna service, so
 * the backend only has to answer "may this request proceed". Preparing a
 * translator here would build one the path never uses.
 *
 * @param {string} targetLanguage - The normalized language the caller asked for.
 * @returns {Promise<object|null>} The body to refuse with, or null when the
 *   request may proceed.
 */
async function refuseUnsupportedLanguage(targetLanguage) {
  if (!wantsTranslation(targetLanguage)) {
    return null;
  }
  try {
    await translationService.init();
    // The language is resolved, not translated: the resolution is what
    // refuses a language the map does not carry.
    translationService.resolveLanguagePair('en', targetLanguage);
    return null;
  } catch (error) {
    return languageRefusalOrNull(error, targetLanguage);
  }
}

// Metadata persisted when chatqna never sent a metadata event (stream error,
// or the answer ended before the envelope). One factory, so the two call sites
// cannot drift into storing different key sets for the same kind of query.
//
// "Not recorded" is encoded per field, following the parser convention in
// query-service.js (parseChatQnASSELine):
// - Presence-keyed fields (self_confidence, query_translation_status) stay
//   ABSENT. The Inspector renders the self-confidence block on
//   hasOwnProperty, so an explicit null here would claim "feature was on,
//   no sentinel" on a turn chatqna never answered; absence reads as
//   "never reported" — the same meaning absence carries on the streamed
//   path. "chatqna never answered" itself is what `abstained: null` below
//   marks: no streamed path ever sets it to null.
// - Value-keyed fields carry the explicit null (or the value default) the
//   parser normalizes them to: `abstained` is null here, not false — false
//   would mean "chatqna answered and chose not to abstain" (a clean
//   low-confidence miss), this is "we never got an answer", and a post-hoc
//   AQL counting abstentions has to be able to tell them.
const emptyStreamMetadata = () => ({
  source_documents: [],
  confidence_score: 0,
  is_grounded: false,
  retrieval_confidence_score: null,
  abstained: null,
  abstention_reason: null,
  // No metadata event means the turn never reported a scope — null (the
  // Inspector's "not recorded" dash), not an empty list, which would claim
  // the query ran unfiltered.
  filter_labels: null
});

module.exports = (queryService) => {
  // Apply authentication middleware to all routes
  router.use(keycloakAuthMiddleware.authenticate);

  /**
   * @swagger
   * "/api/queries/{queryId}/responsetime":
   *   patch:
   *     summary: Update query response time
   *     description: Updates the response time of a specific query.
   *     tags: [Queries]
   *     security:
   *       - KeycloakOAuth2: ['openid']
   *     parameters:
   *       - in: path
   *         name: queryId
   *         required: true
   *         schema:
   *           type: string
   *         description: ID of the query to update.
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - responseTime
   *             properties:
   *               responseTime:
   *                 type: integer
   *                 description: Response time in milliseconds.
   *           example:
   *             responseTime: 250
   *     responses:
   *       200:
   *         description: Query response time updated successfully.
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 _id:
   *                   type: string
   *                 _key:
   *                   type: string
   *                 responseTime:
   *                   type: integer
   *                 updatedAt:
   *                   type: string
   *       400:
   *         description: Response time is required.
   *       401:
   *         description: Unauthorized - Invalid or missing authentication token.
   *       404:
   *         description: Query not found.
   *       500:
   *         description: Server error.
   */
  router.patch('/:queryId/responsetime', async (req, res, next) => {
    try {
      const { queryId } = req.params;
      const { responseTime } = req.body;

      if (!responseTime && responseTime !== 0) {
        return res.status(400).json({ message: 'Response time is required' });
      }

      const updatedQuery = await queryService.updateQueryResponseTime(queryId, responseTime);

      res.json(updatedQuery);
    } catch (error) {
      logger.error(`Error updating response time for query ${req.params.queryId}: ${error.message}`, {
        stack: error.stack
      });
      next(error);
    }
  });

  /**
   * @swagger
   * "/api/queries/stream":
   *   post:
   *     summary: Stream a query response via SSE
   *     description: |
   *       Creates a query and streams the LLM response as SSE events.
   *       Events: chunk, metadata, translation, done, error.
   *     tags: [Queries]
   *     security:
   *       - KeycloakOAuth2: ['openid']
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - sessionId
   *             properties:
   *               sessionId:
   *                 type: string
   *               messages:
   *                 type: array
   *                 items:
   *                   type: object
   *                   properties:
   *                     role:
   *                       type: string
   *                     content:
   *                       type: string
   *               context:
   *                 $ref: '#/components/schemas/QueryContext'
   *     responses:
   *       200:
   *         description: SSE stream of response chunks
   *         content:
   *           text/event-stream:
   *             schema:
   *               type: string
   *       400:
   *         description: |
   *           The requested language is not one the deployment can serve.
   *           The request is refused before anything is generated: the answer
   *           is never returned in another language than the one asked for.
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: UNSUPPORTED_LANGUAGE
   *                 message:
   *                   type: string
   *                   example: Unsupported target language
   *       501:
   *         description: Streaming is disabled
   */
  router.post('/stream', async (req, res) => {
    // True end-to-end latency: measured from ROUTE ENTRY (request receipt) to
    // stream completion — including fan-out posture resolution, embedding,
    // retrieval, rerank and queueing. It was previously set after chatqna's
    // response headers arrived, which reported only the token-stream tail and
    // under-reported a 97s request as ~5s (live-caught 2026-10-06).
    const streamStartTime = Date.now();
    const streamingEnabled = process.env.OPEA_STREAMING !== 'false';
    if (!streamingEnabled) {
      return res.status(501).json({
        error: 'STREAMING_DISABLED',
        message: 'SSE streaming is disabled. Set OPEA_STREAMING=true to enable.'
      });
    }

    const userId = req.user?.iss_sub;
    if (!userId) {
      return res.status(401).json({ error: 'UNAUTHENTICATED', message: 'User not authenticated' });
    }

    const queryData = { ...req.body, userId };
    let opeaController = null;
    let keepalive = null;

    // The language the client asked for, resolved once: the same resolution
    // decides whether the request is refused and translates the answer.
    const targetLanguage = requestedTargetLanguage(queryData);
    const { refusal, translator } = await resolveRequestLanguage(targetLanguage);
    if (refusal) {
      return res.status(400).json(refusal);
    }

    try {
      // Story 2.4 — the agentic entry resolves the fan-out posture ONCE, in
      // the frame writer (the CallerContext assembly): initStreamQuery skips
      // the carrier there, so the posture is never read twice for one
      // request. The legacy entry keeps the carrier attach, unchanged.
      const agenticBranch = isAgentPathEnabled();
      const { queryId, opeaUrl, opeaPayload, authHeaders } = await queryService.initStreamQuery(
        queryData,
        { authorization: req.headers.authorization },
        agenticBranch ? { skipFanoutCarrier: true } : undefined
      );

      // Story 2.4 — the guarded agentic branch. The shared routing helper is
      // the ONLY way the agentic endpoint is exposed (AD-9): when the flag is
      // off, the legacy chatqna relay below serves byte-identically. The
      // branch sits AFTER initStreamQuery — the `queries` doc exists with the
      // legacy shape and the same queryId completes it at finalize (queryId
      // continuity) — and BEFORE any SSE byte: the frame writer answers a
      // saturated lane (429) or an unconfigured run surface (503) as plain
      // JSON. handleStreamDone below is REUSED verbatim as the agentic
      // terminal, so the terminal order is preserved by construction.
      if (agenticBranch) {
        await proxyAgentRun({
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
        });
        return;
      }

      // Stream state the disconnect listener reads — declared BEFORE the
      // listener registration and before the chatqna await: a client that
      // leaves during the connect / time-to-first-byte window must find the
      // listener already armed, with no temporal-dead-zone bindings behind it.
      const doneState = { handled: false };
      let fullResponseText = '';
      // Metadata emitted by chatqna in-stream (reranker-grounded source docs + is_grounded),
      // forwarded to the client instead of running a separate backend-side retrieval.
      let capturedMetadata = null;
      opeaController = new AbortController();

      // Client disconnect. `req.on('close')` does not fire here — express.json()
      // consumes the request body before the route handler runs, so `req` has
      // already emitted 'close' by the time the first `await` resolves; the
      // signal is `res.on('close')`. The dead `req` listener this replaces
      // carried exactly the cleanup below (story 2.4 put it on the living
      // object, armed BEFORE the upstream call so the connect window is
      // covered); `close` fires on EVERY response end, so the
      // `doneState.handled` guard keeps a normally completed stream from being
      // re-finalized as a partial save, and the stream-error branch marks
      // itself handled to keep the error contract (error frame then end — no
      // metadata, no done).
      res.on('close', () => {
        cleanupKeepalive();
        if (doneState.handled) return;
        doneState.handled = true;
        if (opeaController && !opeaController.signal.aborted) {
          opeaController.abort();
          logger.info('QueryService.stream_client_disconnected', { queryId });
          if (fullResponseText) {
            // The partial save carries the `answer_interrupted` honesty
            // marker (ADR agentic-003) — the same marker the agentic
            // disconnect path writes: one finalize, one honesty contract,
            // both paths.
            const partialMetadata = { ...(capturedMetadata || emptyStreamMetadata()), answer_interrupted: true };
            queryService
              .finalizeStreamQuery(queryId, fullResponseText, Date.now() - streamStartTime, partialMetadata)
              .catch((err) => logger.error('QueryService.partial_save_failed', { queryId, error: err.message }));
          }
        }
      });

      // SSE response headers
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no'
      });

      const streamTimeout = parseInt(process.env.CHATQNA_STREAM_TIMEOUT, 10) || 3600000;

      // Stamp the correlation id on the span covering THIS handler — the server
      // span for the incoming request — so a trace whose chatqna side never got
      // far enough to stamp anything is still joinable to the stored query.
      // getActiveSpan() is the right handle: the Express span is active for the
      // whole handler. When queryId is absent nothing is written; an absent
      // correlation id stays distinguishable from an empty one.
      if (queryId) {
        const activeSpan = trace.getActiveSpan();
        if (activeSpan && activeSpan.isRecording()) {
          activeSpan.setAttribute(spanAttrs.QUERY_ID_KEY, queryId);
        }
      }

      // One options object for both branches below. Duplicating it made the two
      // paths able to drift apart silently — the same request would carry
      // different headers depending on whether a query id happened to exist.
      const opeaRequestOptions = {
        headers: {
          'Content-Type': 'application/json',
          ...(authHeaders?.authorization && {
            Authorization: authHeaders.authorization
          })
        },
        responseType: 'stream',
        timeout: streamTimeout,
        signal: opeaController.signal,
        httpAgent: new http.Agent({ keepAlive: true }),
        httpsAgent: new https.Agent({ keepAlive: true })
      };

      // Carry the query id into the trace so a trace joins to the stored query
      // document. When queryId is absent the request simply carries no baggage
      // and every service leaves the attribute unset — never a placeholder.
      //
      // The OPEA upstream is deployment configuration (OPEA_HOST/OPEA_PORT), never
      // request data. The SSRF rule cannot see that: the taint reaches opeaUrl
      // through initStreamQuery's return object, whose sibling field opeaPayload
      // IS request-derived, and a tainted call result is tracked whole. The
      // invariant is pinned by a test in __tests__/services/query-service.test.js.
      const opeaResponse = queryId
        ? await tracingBaggage.withBaggage(spanAttrs.QUERY_ID_KEY, queryId, () =>
            // nosemgrep: nodejs_scan.javascript-ssrf-rule-node_ssrf
            axios.post(opeaUrl, opeaPayload, opeaRequestOptions)
          )
        : await axios.post(opeaUrl, opeaPayload, opeaRequestOptions); // nosemgrep: nodejs_scan.javascript-ssrf-rule-node_ssrf

      const stream = opeaResponse.data;
      let buffer = '';

      function cleanupKeepalive() {
        if (keepalive !== null) {
          clearInterval(keepalive);
          keepalive = null;
        }
      }

      // Streaming translation (issue #829): when enabled and the UI language is not
      // English, buffer the EN answer and stream-translate complete units (sentence/
      // paragraph boundaries) so the user sees the target language WHILE streaming,
      // instead of an English stream that flips at the end. The unit machinery
      // (buffer, ordered chain, failure latch) lives in the shared relay module
      // — one home, consumed by this path and by the agentic frame writer.
      // The language was resolved above, before the stream opened: the
      // translator behind it works in the language the caller asked for.
      const useStreamingTranslation = streamingTranslationEnabled() && wantsTranslation(targetLanguage);
      const streamRelay = useStreamingTranslation
        ? createStreamUnitRelay({ res, translator, targetLanguage, queryId })
        : null;

      const doHandleStreamDone = async () => {
        if (doneState.handled || res.writableEnded) return;
        doneState.handled = true;
        try {
          if (streamRelay) {
            // Degraded or not: flush() orders every queued unit BEFORE the
            // terminal and returns the failure latch AFTER the flush — the
            // value `alreadyFailedTranslation` rides on `done` with.
            const alreadyFailedTranslation = await streamRelay.flush();
            await handleStreamDone(queryId, fullResponseText, streamStartTime, res, capturedMetadata, {
              targetLanguage,
              translator,
              skipPostStreamTranslation: true,
              alreadyFailedTranslation
            });
          } else {
            // The post-stream translation runs here, and the client may be
            // gone by the time it answers.
            await handleStreamDone(queryId, fullResponseText, streamStartTime, res, capturedMetadata, {
              targetLanguage,
              translator
            });
          }
        } catch (error) {
          // The promise is not left dangling: a rejection nobody handles takes
          // the process down, and the answer the client has is already
          // complete.
          logger.error('QueryService.stream_done_failed', { queryId, error: error.message });
        }
      };

      stream.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;

          const dataContent = trimmed.slice(6);
          const parsed = queryService.parseChatQnASSELine(dataContent);

          if (parsed.type === 'chunk') {
            fullResponseText += parsed.content;
            if (streamRelay) {
              // Buffer EN; commit complete units to the translator at
              // boundaries (the relay owns the buffer, the ordered chain and
              // the failure latch).
              streamRelay.onChunk(parsed.content);
            } else {
              writeSSEFrame(res, { type: 'chunk', content: parsed.content });
            }
          } else if (parsed.type === 'metadata') {
            // Forward the parser's object whole (minus the event discriminator).
            // parseChatQnASSELine owns normalisation and defaulting; restating
            // the field list here meant a diagnostic field chatqna added would
            // be parsed and then silently dropped at this line — which is how
            // retrieval_confidence_score and self_confidence were lost.
            // self_confidence in particular is presence-keyed, and spreading
            // preserves that: absent when LLM_SELF_CONFIDENCE_ENABLED is off,
            // null when the feature is on but the sentinel was malformed.
            const metadata = { ...parsed };
            delete metadata.type;
            capturedMetadata = metadata;
          } else if (parsed.type === 'done') {
            doHandleStreamDone();
          } else if (parsed.type === 'error') {
            logger.warn('QueryService.sse_parse_error', { raw: parsed.raw });
          }
        }
      });

      stream.on('error', (error) => {
        cleanupKeepalive();
        logger.error('QueryService.opea_stream_error', { error: error.message, queryId });
        if (!res.headersSent) {
          res.status(502).json({ error: 'CHATQNA_STREAM_ERROR', message: error.message });
        } else {
          // Marked handled: the error frame IS the terminal (error frame then
          // end — no metadata, no done), and the `res.on('close')` listener
          // above must not turn the already-errored stream into a partial
          // save.
          doneState.handled = true;
          res.write(
            `data: ${JSON.stringify({ type: 'error', message: error.message, code: 'CHATQNA_STREAM_ERROR' })}\n\n`
          );
          res.end();
        }
      });

      stream.on('end', () => {
        if (fullResponseText && res.writableEnded === false) {
          // The stream ended without a `done` frame (a truncated upstream —
          // generator abort, proxy trim): this finalize is a partial save and
          // carries the same `answer_interrupted` honesty marker as the
          // close paths (ADR agentic-003). A `done` frame already handled
          // leaves the metadata untouched — the marker must never leak into
          // a normally completed answer.
          if (!doneState.handled) {
            capturedMetadata = { ...(capturedMetadata || emptyStreamMetadata()), answer_interrupted: true };
          }
          doHandleStreamDone();
        }
      });

      keepalive = setInterval(() => {
        if (res.writableEnded) {
          cleanupKeepalive();
          return;
        }
        res.write(': keepalive\n\n');
      }, 15000);
    } catch (error) {
      if (keepalive !== null) clearInterval(keepalive);
      logger.error('QueryService.stream_setup_error', { error: error.message });
      if (res.writableEnded || res.destroyed) {
        // The client is already gone (e.g. it disconnected during the chatqna
        // connect window and the close listener aborted the leg): the answer
        // would be written to a destroyed socket — an error nobody reads.
        return;
      }
      if (!res.headersSent) {
        if (error.statusCode === 401) {
          // Story 1.1: an expired/invalid bearer caught during fan-out
          // resolution propagates as 401 — never silently degraded to the
          // legacy path (the request itself is invalid).
          res.status(401).json({ error: 'UNAUTHENTICATED', message: error.message });
        } else if (error.statusCode && error.code) {
          // Typed-error passthrough, the repo's general contract: the error
          // declares its own status and machine-readable code, so an
          // intentional, named state never renders as the 500
          // unexpected-fault class below.
          res.status(error.statusCode).json({ error: error.code, message: error.message });
        } else if (error.code === 'ECONNABORTED' || error.code === 'ERR_CANCELED') {
          res.status(504).json({ error: 'CHATQNA_UNAVAILABLE', message: 'ChatQnA service unavailable or timed out' });
        } else {
          res.status(500).json({ error: 'STREAM_ERROR', message: error.message });
        }
      } else {
        res.write(`data: ${JSON.stringify({ type: 'error', message: error.message, code: 'STREAM_ERROR' })}\n\n`);
        res.end();
      }
    }
  });

  async function handleStreamDone(
    queryId,
    fullResponseText,
    startTime,
    res,
    capturedMetadata,
    { targetLanguage = '', translator = null, skipPostStreamTranslation = false, alreadyFailedTranslation = false } = {}
  ) {
    if (res.writableEnded || res.destroyed) return;

    // Set by whichever translation path ran: a per-unit failure upstream, or the
    // post-stream attempt below. Either way the answer the client receives is
    // the English original and it is told so on `done`.
    let translationFailed = alreadyFailedTranslation;

    const responseTime = Date.now() - startTime;
    // Source documents + grounding come from chatqna's in-stream metadata event
    // (reranker verdict + is_grounded), not from a backend-side retrieval.
    const metadata = capturedMetadata || emptyStreamMetadata();

    res.write(`data: ${JSON.stringify({ type: 'metadata', ...metadata, responseTime })}\n\n`);

    // A translation was asked for and the answer was not already delivered in
    // the target language: the whole answer is translated here. The translator
    // is the one the request resolved — the languages cannot change between
    // the start of a request and the end of its answer.
    const translationExpected = wantsTranslation(targetLanguage);
    if (!skipPostStreamTranslation && translationExpected && fullResponseText) {
      try {
        if (!translator) {
          throw new Error('no translator was prepared for the requested language');
        }
        const translated = await translator.translate(fullResponseText);
        if (!translated || !translated.trim()) {
          // The model returned nothing. The answer the client already has is
          // the English one; writing an empty translation frame would replace
          // it with nothing. The failure travels on `done` instead.
          logger.warn(
            `QueryService.stream_translation_empty: (lang=${languageForLog(targetLanguage)}, answerLen=${fullResponseText.length})`,
            { queryId }
          );
          translationFailed = true;
        } else if (!res.writableEnded && !res.destroyed) {
          // The client may have gone while the translation ran: a frame
          // written to a response that is over is an error nobody reads.
          res.write(`data: ${JSON.stringify({ type: 'translation', content: translated })}\n\n`);
        }
      } catch (error) {
        // Not an `error` frame. The client treats that as terminal and stops
        // reading, and reports the whole system as down — neither is true when
        // only the translator failed and the answer is complete in English.
        // The outcome travels on `done` instead, where the client already
        // expects the stream to end.
        logger.warn('QueryService.stream_translation_failed', { queryId, error: error.message });
        translationFailed = true;
      }
    }

    try {
      await queryService.finalizeStreamQuery(queryId, fullResponseText, responseTime, metadata);
    } catch (error) {
      logger.error('QueryService.stream_finalize_failed', { queryId, error: error.message });
    }

    if (res.writableEnded || res.destroyed) {
      // The response is over — the client gave up while the answer was being
      // translated. Nothing is left to write, and writing anyway is an error
      // nobody reads.
      logger.info('QueryService.stream_client_gone', { queryId });
      return;
    }

    res.write(`data: ${JSON.stringify({ type: 'done', queryId, translationFailed })}\n\n`);
    res.end();
    logger.info('QueryService.stream_complete', { queryId, responseTime });
  }

  /**
   * @swagger
   * "/api/queries":
   *   post:
   *     summary: Create a new query
   *     description: Creates a new query and records it in analytics. Supports single-message or full conversation modes.
   *     tags: [Queries]
   *     security:
   *       - KeycloakOAuth2: ['openid']
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - sessionId
   *             properties:
   *               sessionId:
   *                 type: string
   *                 description: ID of the current session
   *               text:
   *                 type: string
   *                 description: The query text (required for single-message mode)
   *               messages:
   *                 type: array
   *                 items:
   *                   type: object
   *                   properties:
   *                     role:
   *                       type: string
   *                       enum: [user, assistant]
   *                     content:
   *                       type: string
   *                 description: Full conversation history (required for conversation mode)
   *               context:
   *                 $ref: '#/components/schemas/QueryContext'
   *               contextOption:
   *                 type: string
   *                 enum: [single-message, conversation-with-context-labels]
   *                 default: single-message
   *                 description: Query mode (defaults to env or single-message)
   *               categoryId:
   *                 type: string
   *                 description: Category ID for the query
   *               serviceId:
   *                 type: string
   *                 description: Service ID for the query
   *               timestamp:
   *                 type: string
   *                 format: date-time
   *                 description: Timestamp for the query (defaults to now)
   *     responses:
   *       201:
   *         description: Query created successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 _key:
   *                   type: string
   *                 userId:
   *                   type: string
   *                 sessionId:
   *                   type: string
   *                 timestamp:
   *                   type: string
   *                 isAnswered:
   *                   type: boolean
   *                 categoryId:
   *                   type: string
   *                 serviceId:
   *                   type: string
   *                 responseTime:
   *                   type: integer
   *                 contextOption:
   *                   type: string
   *                 text:
   *                   type: string
   *                 response:
   *                   type: string
   *       400:
   *         description: |
   *           Missing required fields, invalid contextOption, or a language
   *           the deployment cannot serve. A refused language stops the
   *           request before anything is generated: the answer is never
   *           returned in another language than the one asked for.
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: UNSUPPORTED_LANGUAGE
   *                 message:
   *                   type: string
   *                   example: Unsupported target language
   *       500:
   *         description: Server error
   */
  router.post('/', async (req, res) => {
    try {
      const userId = req.user?.iss_sub;
      if (!userId) {
        return res.status(401).json({ error: 'UNAUTHENTICATED', message: 'User not authenticated' });
      }
      const queryData = { ...req.body, userId };
      // The language the client asked for, checked before the query is
      // created: a language the deployment cannot serve is refused, not
      // answered in another language. The answer of this path is translated
      // by the chatqna service, so the backend only checks the language.
      const refusal = await refuseUnsupportedLanguage(requestedTargetLanguage(queryData));
      if (refusal) {
        return res.status(400).json(refusal);
      }
      logger.info(`Creating query for user ${userId}`);
      const query = await queryService.createQuery(queryData, { authorization: req.headers.authorization });
      res.status(201).json(query);
    } catch (error) {
      logger.error(`Error creating query: ${error.message}`, { stack: error.stack });
      // Review 2026-10-29 round 3: a bearer failure caught while resolving the
      // OKF fan-out posture (OkfAuthzUnauthorizedError, statusCode 401)
      // propagates — the same error already maps to 401 on the streaming path;
      // wrapping it in a 500 here mislabelled an invalid request as a server
      // fault.
      if (error.statusCode === 401) {
        return res.status(401).json({ error: 'UNAUTHENTICATED', message: error.message });
      }
      // Typed-error passthrough (the streaming path applies the same
      // mapping): the error declares its own status and machine-readable
      // code — the non-streaming agentic refusal declares
      // 503 + AGENTIC_PATH_NOT_SERVED — never the 500 "unexpected server
      // fault" class.
      if (error.statusCode && error.code) {
        return res.status(error.statusCode).json({ error: error.code, message: error.message });
      }
      res.status(500).json({ message: error.message });
    }
  });

  /**
   * @swagger
   * "/api/queries/{queryId}":
   *   get:
   *     summary: Get query by ID
   *     description: Retrieves a query by its unique identifier
   *     tags: [Queries]
   *     security:
   *       - KeycloakOAuth2: ['openid']
   *     parameters:
   *       - in: path
   *         name: queryId
   *         required: true
   *         schema:
   *           type: string
   *         description: Query ID
   *     responses:
   *       200:
   *         description: Query retrieved successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 _key:
   *                   type: string
   *                 userId:
   *                   type: string
   *                 sessionId:
   *                   type: string
   *                 timestamp:
   *                   type: string
   *                 isAnswered:
   *                   type: boolean
   *                 categoryId:
   *                   type: string
   *                 serviceId:
   *                   type: string
   *                 responseTime:
   *                   type: integer
   *                 contextOption:
   *                   type: string
   *                 text:
   *                   type: string
   *                 response:
   *                   type: string
   *       404:
   *         description: Query not found
   *       500:
   *         description: Server error
   */
  router.get('/:queryId', async (req, res) => {
    try {
      logger.info(`Fetching query with ID: ${req.params.queryId}`);
      const query = await queryService.getQuery(req.params.queryId);
      res.json(query);
    } catch (error) {
      logger.error(`Error getting query ${req.params.queryId}: ${error.message}`, { stack: error.stack });
      res.status(500).json({ message: error.message });
    }
  });

  /**
   * @swagger
   * "/api/queries/{queryId}/feedback":
   *   post:
   *     summary: Add feedback to a query
   *     description: Adds user feedback to a query and records it in analytics
   *     tags: [Queries]
   *     security:
   *       - KeycloakOAuth2: ['openid']
   *     parameters:
   *       - in: path
   *         name: queryId
   *         required: true
   *         schema:
   *           type: string
   *         description: Query ID
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - rating
   *             properties:
   *               rating:
   *                 type: number
   *                 minimum: 1
   *                 maximum: 5
   *                 description: Rating from 1 to 5
   *               comment:
   *                 type: string
   *                 description: Optional feedback comment
   *     responses:
   *       200:
   *         description: Feedback added successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 _key:
   *                   type: string
   *                 userId:
   *                   type: string
   *                 sessionId:
   *                   type: string
   *                 timestamp:
   *                   type: string
   *                 isAnswered:
   *                   type: boolean
   *                 categoryId:
   *                   type: string
   *                 serviceId:
   *                   type: string
   *                 responseTime:
   *                   type: integer
   *                 contextOption:
   *                   type: string
   *                 text:
   *                   type: string
   *                 response:
   *                   type: string
   *                 feedback:
   *                   type: object
   *                   properties:
   *                     rating:
   *                       type: number
   *                     comment:
   *                       type: string
   *       400:
   *         description: Missing required fields
   *       404:
   *         description: Query not found
   *       500:
   *         description: Server error
   */
  router.post('/:queryId/feedback', async (req, res, next) => {
    try {
      logger.info(`Adding feedback to query ${req.params.queryId}`);
      const query = await queryService.addFeedback(req.params.queryId, req.body);
      res.json(query);
    } catch (error) {
      logger.error(`Error adding feedback to query ${req.params.queryId}: ${error.message}`, { stack: error.stack });
      next(error);
    }
  });

  /**
   * @swagger
   * "/api/queries/{queryId}/answered":
   *   patch:
   *     summary: Mark query as answered
   *     description: Marks a query as answered and updates response time
   *     tags: [Queries]
   *     security:
   *       - KeycloakOAuth2: ['openid']
   *     parameters:
   *       - in: path
   *         name: queryId
   *         required: true
   *         schema:
   *           type: string
   *         description: ID of the query to update.
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - responseTime
   *             properties:
   *               responseTime:
   *                 type: integer
   *                 description: Response time in milliseconds.
   *           example:
   *             responseTime: 250
   *     responses:
   *       200:
   *         description: Query marked as answered successfully.
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 _key:
   *                   type: string
   *                 isAnswered:
   *                   type: boolean
   *                 responseTime:
   *                   type: integer
   *       400:
   *         description: Response time is required.
   *       404:
   *         description: Query not found.
   *       500:
   *         description: Server error.
   */
  router.patch('/:queryId/answered', async (req, res, next) => {
    try {
      const { queryId } = req.params;
      const { responseTime } = req.body;

      if (!responseTime && responseTime !== 0) {
        return res.status(400).json({ message: 'Response time is required' });
      }

      const updatedQuery = await queryService.markQueryAsAnswered(queryId, responseTime);

      res.json(updatedQuery);
    } catch (error) {
      logger.error(`Error marking query ${req.params.queryId} as answered: ${error.message}`, { stack: error.stack });
      next(error);
    }
  });

  /**
   * @swagger
   * "/api/queries":
   *   get:
   *     summary: Search queries
   *     description: Searches queries based on various criteria with pagination
   *     tags: [Queries]
   *     security:
   *       - KeycloakOAuth2: ['openid']
   *     parameters:
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *           default: 20
   *         description: Number of queries per page
   *       - in: query
   *         name: offset
   *         schema:
   *           type: integer
   *           default: 0
   *         description: Offset for pagination
   *       - in: query
   *         name: sessionId
   *         schema:
   *           type: string
   *         description: Filter by session ID
   *       - in: query
   *         name: text
   *         schema:
   *           type: string
   *         description: Filter by text content
   *       - in: query
   *         name: categoryId
   *         schema:
   *           type: string
   *         description: Filter by category ID
   *       - in: query
   *         name: serviceId
   *         schema:
   *           type: string
   *         description: Filter by service ID
   *       - in: query
   *         name: isAnswered
   *         schema:
   *           type: boolean
   *         description: Filter by answered status
   *       - in: query
   *         name: startDate
   *         schema:
   *           type: string
   *           format: date-time
   *         description: Filter by start date
   *       - in: query
   *         name: endDate
   *         schema:
   *           type: string
   *           format: date-time
   *         description: Filter by end date
   *     responses:
   *       200:
   *         description: Search results with pagination
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 queries:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       _key:
   *                         type: string
   *                       userId:
   *                         type: string
   *                       sessionId:
   *                         type: string
   *                       timestamp:
   *                         type: string
   *                       isAnswered:
   *                         type: boolean
   *                       categoryId:
   *                         type: string
   *                       serviceId:
   *                         type: string
   *                       responseTime:
   *                         type: integer
   *                       contextOption:
   *                         type: string
   *                       text:
   *                         type: string
   *                       response:
   *                         type: string
   *                 pagination:
   *                   type: object
   *                   properties:
   *                     total:
   *                       type: integer
   *                     limit:
   *                       type: integer
   *                     offset:
   *                       type: integer
   *                     pages:
   *                       type: integer
   *                     currentPage:
   *                       type: integer
   *       500:
   *         description: Server error
   */
  router.get('/', async (req, res) => {
    try {
      const userId = req.user?.iss_sub;
      if (!userId) {
        return res.status(401).json({ error: 'UNAUTHENTICATED', message: 'User not authenticated' });
      }
      const { limit, offset, ...criteria } = req.query;
      criteria.userId = userId;
      const parsedLimit = parsePositiveInt(limit, 20, { min: 1, max: 100 });
      const parsedOffset = parsePositiveInt(offset, 0, { min: 0 });
      logger.info(`Searching queries for user ${userId}, limit: ${parsedLimit}, offset: ${parsedOffset}`);
      const results = await queryService.searchQueries(criteria, parsedLimit, parsedOffset);
      res.json(results);
    } catch (error) {
      logger.error(`Error searching queries: ${error.message}`, { stack: error.stack });
      res.status(500).json({ message: error.message });
    }
  });

  /**
   * @swagger
   * "/api/queries/{queryId}/conversations":
   *   get:
   *     summary: Get conversations for a query
   *     description: Retrieves all conversations associated with a specific query
   *     tags: [Queries]
   *     security:
   *       - KeycloakOAuth2: ['openid']
   *     parameters:
   *       - in: path
   *         name: queryId
   *         required: true
   *         schema:
   *           type: string
   *         description: Query ID
   *     responses:
   *       200:
   *         description: Conversations associated with the query
   *         content:
   *           application/json:
   *             schema:
   *               type: array
   *               items:
   *                 type: object
   *       404:
   *         description: Query not found
   *       500:
   *         description: Server error
   */
  router.get('/:queryId/conversations', async (req, res, next) => {
    try {
      logger.info(`Getting conversations for query ${req.params.queryId}`);
      const userId = req.user?.iss_sub;
      if (!userId) {
        return res.status(400).json({
          success: false,
          message: 'User ID is required'
        });
      }
      const conversations = await queryService.getConversationsForQuery(req.params.queryId, userId);
      res.json(conversations);
    } catch (error) {
      if (error.message === 'Access denied') {
        return res.status(403).json({ success: false, message: 'Access denied' });
      }
      logger.error(`Error getting conversations for query ${req.params.queryId}: ${error.message}`, {
        stack: error.stack
      });
      next(error);
    }
  });

  /**
   * @swagger
   * "/api/queries/{queryId}/conversation":
   *   post:
   *     summary: Create conversation from query
   *     description: Creates a new conversation based on an existing query
   *     tags: [Queries]
   *     security:
   *       - KeycloakOAuth2: ['openid']
   *     parameters:
   *       - in: path
   *         name: queryId
   *         required: true
   *         schema:
   *           type: string
   *         description: Query ID
   *     requestBody:
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               title:
   *                 type: string
   *                 description: Optional title for the conversation
   *               responseText:
   *                 type: string
   *                 description: Optional response text to include
   *               tags:
   *                 type: array
   *                 items:
   *                   type: string
   *                 description: Optional tags for the conversation
   *     responses:
   *       201:
   *         description: Conversation created successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 conversation:
   *                   type: object
   *       404:
   *         description: Query not found
   *       500:
   *         description: Server error
   */
  router.post('/:queryId/conversation', async (req, res, next) => {
    try {
      const { queryId } = req.params;
      const options = req.body;

      logger.info(`Creating conversation from query ${queryId} with options: ${JSON.stringify(options)}`);

      const result = await queryService.createConversationFromQuery(queryId, options);
      res.status(201).json(result);
    } catch (error) {
      logger.error(`Error creating conversation from query ${req.params.queryId}: ${error.message}`, {
        stack: error.stack
      });
      next(error);
    }
  });

  /**
   * @swagger
   * "/api/queries/{queryId}/link/{messageId}":
   *   post:
   *     summary: Link query to message
   *     description: Creates a link between a query and an existing message
   *     tags: [Queries]
   *     security:
   *       - KeycloakOAuth2: ['openid']
   *     parameters:
   *       - in: path
   *         name: queryId
   *         required: true
   *         schema:
   *           type: string
   *         description: Query ID
   *       - in: path
   *         name: messageId
   *         required: true
   *         schema:
   *           type: string
   *         description: Message ID
   *     requestBody:
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               responseType:
   *                 type: string
   *                 default: primary
   *                 description: Type of response (primary, followup, etc.)
   *               confidenceScore:
   *                 type: number
   *                 default: 1.0
   *                 description: Confidence score for the relationship
   *     responses:
   *       200:
   *         description: Link created successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *       404:
   *         description: Query or message not found
   *       500:
   *         description: Server error
   */
  router.post('/:queryId/link/:messageId', async (req, res, next) => {
    try {
      const { queryId, messageId } = req.params;
      const options = req.body;

      logger.info(`Linking query ${queryId} to message ${messageId} with options: ${JSON.stringify(options)}`);

      const result = await queryService.linkQueryToMessage(queryId, messageId, options);
      res.json(result);
    } catch (error) {
      logger.error(`Error linking query ${req.params.queryId} to message ${req.params.messageId}: ${error.message}`, {
        stack: error.stack
      });
      next(error);
    }
  });

  return router;
};
