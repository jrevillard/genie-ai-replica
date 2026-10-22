const express = require('express');
const router = express.Router();
const axios = require('axios');
const http = require('http');
const https = require('https');
const { trace } = require('@opentelemetry/api');
const { keycloakAuthMiddleware } = require('../middleware/keycloak-auth-middleware');
const { logger, spanAttrs, tracingBaggage } = require('../shared-lib');
const translationService = require('../services/translation-service');
const { extractCommittableUnit } = require('../services/translation/stream-boundary');
const { languageForLog } = require('../services/translation/language-log');
const { isUnsupportedLanguage } = require('../services/translation/unsupported-language');
const { normalizeRequestedLanguage } = require('../services/translation/language-request');
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
 * The refusal a request that asks for a language the deployment cannot serve
 * gets.
 *
 * The language travels in the request body, so it is caller-controlled. The
 * language map is the contract: a language the map does not carry cannot be
 * answered in, and answering in another language — one the caller cannot see
 * — is what this boundary exists to prevent. The request is therefore refused
 * before anything is generated and before a stream is opened, with the same
 * 400 the translate routes answer.
 *
 * The refusal is about the language, not about the translator. When the
 * translation service is not ready the check cannot run at all: the request
 * goes through, and the answer is delivered in English with the failure
 * reported on `done` — a broken translator is not the caller's mistake.
 *
 * @param {string} targetLanguage - The normalized language the caller asked for.
 * @returns {Promise<object|null>} The refusal to answer with, or null when the
 *   request may proceed.
 */
async function refusalForUnsupportedLanguage(targetLanguage) {
  if (!targetLanguage || targetLanguage === 'en') {
    // English is the language the answer is written in: there is no
    // translation to make, and nothing to refuse.
    return null;
  }
  try {
    await translationService.init();
    translationService.resolveLanguagePair('en', targetLanguage);
    return null;
  } catch (error) {
    if (!isUnsupportedLanguage(error)) {
      logger.warn(`QueryService.language_check_failed: ${error.message}`);
      return null;
    }
    logger.warn(`QueryService.unsupported_language: (lang=${languageForLog(targetLanguage)})`);
    // The response names the refused side, never the value the caller sent:
    // a value that came back in the answer could be handed on to a model. The
    // code tells the client that the request was refused — not that the
    // request failed — so it can tell the two apart without reading the
    // message.
    return { message: error.message, code: error.code };
  }
}

// Metadata persisted when chatqna never sent a metadata event (stream error,
// or the answer ended before the envelope). One factory, so the two call sites
// cannot drift into storing different key sets for the same kind of query.
//
// `abstained` is null here, not false. false would mean "chatqna answered and
// chose not to abstain" — a clean low-confidence miss. This is "we never got an
// answer", and a post-hoc AQL counting abstentions has to be able to tell them.
const emptyStreamMetadata = () => ({
  source_documents: [],
  confidence_score: 0,
  is_grounded: false,
  retrieval_confidence_score: null,
  abstained: null,
  abstention_reason: null
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
   * "/queries/stream":
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
   *                 type: object
   *                 properties:
   *                   categoryLabel:
   *                     type: string
   *                   serviceLabels:
   *                     type: array
   *                     items:
   *                       type: string
   *                   language:
   *                     type: string
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
   *                 message:
   *                   type: string
   *                   example: Unsupported target language
   *                 code:
   *                   type: string
   *                   example: UNSUPPORTED_LANGUAGE
   *       501:
   *         description: Streaming is disabled
   */
  router.post('/stream', async (req, res) => {
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

    // The language the client asked for, checked before anything is
    // generated: a language the deployment cannot serve is refused, not
    // answered in another language.
    const refusal = await refusalForUnsupportedLanguage(requestedTargetLanguage(queryData));
    if (refusal) {
      return res.status(400).json(refusal);
    }

    try {
      const { queryId, opeaUrl, opeaPayload, authHeaders } = await queryService.initStreamQuery(queryData, {
        authorization: req.headers.authorization
      });

      // SSE response headers
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no'
      });

      const streamTimeout = parseInt(process.env.CHATQNA_STREAM_TIMEOUT, 10) || 3600000;
      opeaController = new AbortController();

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
      let fullResponseText = '';
      const startTime = Date.now();
      let buffer = '';
      const doneState = { handled: false };
      // Metadata emitted by chatqna in-stream (reranker-grounded source docs + is_grounded),
      // forwarded to the client instead of running a separate backend-side retrieval.
      let capturedMetadata = null;

      function cleanupKeepalive() {
        if (keepalive !== null) {
          clearInterval(keepalive);
          keepalive = null;
        }
      }

      // Streaming translation (issue #829): when enabled and the UI language is not
      // English, buffer the EN answer and stream-translate complete units (sentence/
      // paragraph boundaries) so the user sees the target language WHILE streaming,
      // instead of an English stream that flips at the end.
      const streamingTranslationEnabled = ['1', 'true'].includes(
        (process.env.STREAMING_TRANSLATION_ENABLED || '').toLowerCase()
      );
      // The language comes from the request body. It is normalized once, here,
      // and the translator validates it against the language map before it is
      // used for anything.
      const targetLanguage = requestedTargetLanguage(queryData);
      const useStreamingTranslation = streamingTranslationEnabled && targetLanguage && targetLanguage !== 'en';

      let pendingEn = '';
      let translationChain = Promise.resolve();
      let streamingTranslationFailed = false;
      let loggedStreamTranslateActive = false;

      // Translate one COMPLETE unit (see services/translation/stream-boundary.js)
      // using the AST-based translateMarkdown. translateMarkdown parses the unit
      // as markdown, translates ONLY the text leaf nodes, and reassembles the
      // AST — so structure WITHIN the unit (bold, lists, inner paragraphs) is
      // preserved by the skeleton, never left to the model. `separator` is the
      // exact trailing whitespace that followed the unit in the source; we pass
      // it through verbatim, so structure BETWEEN units (the "\n\n" paragraph
      // breaks, line breaks) survives too. This is what keeps formatting intact
      // during streaming translation (issue #829).
      const scheduleUnitTranslation = (content, separator) => {
        translationChain = translationChain.then(async () => {
          if (res.writableEnded) return;
          if (streamingTranslationFailed) {
            // The translation failed for an earlier unit: the answer stays in
            // English for the remainder, so the unit goes out as it is — and
            // it does not go to the translator again, or the user reads a
            // half-translated answer.
            if (!res.writableEnded) {
              res.write(`data: ${JSON.stringify({ type: 'chunk', content: `${content}${separator}` })}\n\n`);
            }
            return;
          }
          try {
            await translationService.init();
            const translated = await translationService.translateMarkdown(content, 'en', targetLanguage);
            const body =
              translated && translated.trim() ? `${translated.trim()}${separator}` : `${content}${separator}`;
            // Debug instrumentation for the streaming-translation path: the unit
            // content the real chatqna stream produced, its separator, and the
            // translator's output (head/tail). Emitted at debug level only —
            // silent in production (LOG_LEVEL=info), toggle debug to investigate
            // formatting/structure issues without a redeploy.
            logger.debug(
              `[STREAM-TRANSLATE] IN=${JSON.stringify(content)} sep=${JSON.stringify(separator)} OUT_head=${JSON.stringify(
                (translated || '').slice(0, 60)
              )} OUT_tail=${JSON.stringify((translated || '').slice(-60))}`,
              { queryId }
            );
            if (!res.writableEnded) {
              // An SSE frame, never an HTML document: JSON.stringify escapes
              // quotes and newlines, so a value cannot terminate the `data:`
              // frame or inject a second event. The client renders message
              // content through DOMPurify (ChatBotComponent.vue).
              // nosemgrep: nodejs_scan.javascript-xss-rule-express_xss
              res.write(`data: ${JSON.stringify({ type: 'chunk', content: body })}\n\n`);
            }
          } catch (error) {
            // The language is caller-controlled: the log carries a bounded,
            // printable form of it, never the raw value.
            logger.warn(
              `QueryService.stream_translation_unit_failed: ${error.message} (lang=${languageForLog(targetLanguage)}, unitLen=${content.length}, unitPreview=${content.slice(0, 80)})`,
              { queryId }
            );
            if (!res.writableEnded) {
              res.write(`data: ${JSON.stringify({ type: 'chunk', content: `${content}${separator}` })}\n\n`);
            }
            streamingTranslationFailed = true;
          }
        });
      };

      const doHandleStreamDone = async () => {
        if (doneState.handled || res.writableEnded) return;
        doneState.handled = true;
        if (useStreamingTranslation) {
          if (streamingTranslationFailed) {
            // Degraded: the units already queued are emitted first, in the
            // order they were committed, then the remaining English directly
            // (bypass translation). The chain is awaited before the flush: a
            // queued unit that has not run yet would otherwise write its
            // content after the remainder — and after the response ended, which
            // drops it.
            await translationChain;
            if (pendingEn && !res.writableEnded) {
              res.write(`data: ${JSON.stringify({ type: 'chunk', content: pendingEn })}\n\n`);
              pendingEn = '';
            }
          } else {
            if (pendingEn.trim()) {
              scheduleUnitTranslation(pendingEn, '');
              pendingEn = '';
            }
            // Each scheduled unit swallows its own errors (see scheduleUnitTranslation),
            // so the chain never rejects; awaiting it just orders completion before 'done'.
            await translationChain;
          }
          await handleStreamDone(
            queryId,
            fullResponseText,
            startTime,
            queryData,
            req,
            res,
            capturedMetadata,
            true,
            streamingTranslationFailed
          );
        } else {
          handleStreamDone(queryId, fullResponseText, startTime, queryData, req, res, capturedMetadata, false);
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
            if (useStreamingTranslation && !streamingTranslationFailed) {
              // Buffer EN; commit complete units to the translator at boundaries.
              // A language the models do not cover does NOT change this: the
              // units keep being committed and written in order (the chain
              // writes them in English), so the buffered tail stays in place
              // and cannot overtake the units that precede it.
              if (!loggedStreamTranslateActive) {
                loggedStreamTranslateActive = true;
                // Debug: confirms the streaming-translation path is active for
                // this request (absent => flag/path not triggering).
                logger.debug(`[STREAM-TRANSLATE] active lang=${languageForLog(targetLanguage)}`, { queryId });
              }
              pendingEn += parsed.content;
              let extracted = extractCommittableUnit(pendingEn);
              while (extracted) {
                pendingEn = extracted.remainder;
                scheduleUnitTranslation(extracted.content, extracted.separator);
                extracted = extractCommittableUnit(pendingEn);
              }
            } else {
              // The answer is English for the remainder (the translation
              // failed). The English that is already buffered is OLDER than
              // this chunk: it goes out first, because flushed at the end of
              // the stream it would land after the chunks that follow it, and
              // the answer would read out of order.
              if (pendingEn) {
                res.write(`data: ${JSON.stringify({ type: 'chunk', content: pendingEn })}\n\n`);
                pendingEn = '';
              }
              res.write(`data: ${JSON.stringify({ type: 'chunk', content: parsed.content })}\n\n`);
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
          res.write(
            `data: ${JSON.stringify({ type: 'error', message: error.message, code: 'CHATQNA_STREAM_ERROR' })}\n\n`
          );
          res.end();
        }
      });

      stream.on('end', () => {
        if (fullResponseText && res.writableEnded === false) {
          doHandleStreamDone();
        }
      });

      // NOTE: this listener does not fire. express.json() consumes the request body
      // before the route handler runs, so `req` has already emitted 'close' by
      // the time the first `await` resolves and this is registered. The
      // disconnect signal is `res.on('close')`. Tracked separately — nothing in
      // here runs today, so do not read the metadata handling below as the
      // client-disconnect path.
      req.on('close', () => {
        cleanupKeepalive();
        if (opeaController && !opeaController.signal.aborted) {
          opeaController.abort();
          logger.info('QueryService.stream_client_disconnected', { queryId });
          if (fullResponseText) {
            queryService
              .finalizeStreamQuery(
                queryId,
                fullResponseText,
                Date.now() - startTime,
                capturedMetadata || emptyStreamMetadata()
              )
              .catch((err) => logger.error('QueryService.partial_save_failed', { queryId, error: err.message }));
          }
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
      if (!res.headersSent) {
        if (error.code === 'ECONNABORTED' || error.code === 'ERR_CANCELED') {
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
    queryData,
    req,
    res,
    capturedMetadata,
    skipPostStreamTranslation = false,
    alreadyFailedTranslation = false
  ) {
    if (res.writableEnded) return;

    // Set by whichever translation path ran: a per-unit failure upstream, or the
    // post-stream attempt below. Either way the answer the client receives is
    // the English original and it is told so on `done`.
    let translationFailed = alreadyFailedTranslation;

    const responseTime = Date.now() - startTime;
    // Source documents + grounding come from chatqna's in-stream metadata event
    // (reranker verdict + is_grounded), not from a backend-side retrieval.
    const metadata = capturedMetadata || emptyStreamMetadata();

    res.write(`data: ${JSON.stringify({ type: 'metadata', ...metadata, responseTime })}\n\n`);

    const userLanguage = requestedTargetLanguage(queryData);
    if (!skipPostStreamTranslation && userLanguage && userLanguage !== 'en' && fullResponseText) {
      try {
        await translationService.init();
        const translated = await translationService.translateMarkdown(fullResponseText, 'en', userLanguage);
        res.write(`data: ${JSON.stringify({ type: 'translation', content: translated })}\n\n`);
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

    res.write(`data: ${JSON.stringify({ type: 'done', queryId, translationFailed })}\n\n`);
    res.end();
    logger.info('QueryService.stream_complete', { queryId, responseTime });
  }

  /**
   * @swagger
   * "/queries":
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
   *                 type: object
   *                 properties:
   *                   categoryLabel:
   *                     type: string
   *                   serviceLabels:
   *                     type: array
   *                     items:
   *                       type: string
   *                   language:
   *                     type: string
   *                     default: EN
   *                 description: Context labels (required for conversation mode)
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
   *                 message:
   *                   type: string
   *                   example: Unsupported target language
   *                 code:
   *                   type: string
   *                   example: UNSUPPORTED_LANGUAGE
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
      // answered in another language.
      const refusal = await refusalForUnsupportedLanguage(requestedTargetLanguage(queryData));
      if (refusal) {
        return res.status(400).json(refusal);
      }
      logger.info(`Creating query for user ${userId}`);
      const query = await queryService.createQuery(queryData, { authorization: req.headers.authorization });
      res.status(201).json(query);
    } catch (error) {
      logger.error(`Error creating query: ${error.message}`, { stack: error.stack });
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
