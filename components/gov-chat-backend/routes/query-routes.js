const express = require('express');
const router = express.Router();
const axios = require('axios');
const http = require('http');
const https = require('https');
const { keycloakAuthMiddleware } = require('../middleware/keycloak-auth-middleware');
const { logger } = require('../shared-lib');
const translationService = require('../services/translation-service');
const { extractCommittableUnit } = require('../services/translation/stream-boundary');

module.exports = (queryService) => {
  // Apply authentication middleware to all routes
  router.use(keycloakAuthMiddleware.authenticate);

  /**
   * @swagger
   * /api/queries/{queryId}/responsetime:
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
   * /queries/stream:
   *   post:
   *     summary: Stream a query response via SSE
   *     description: Creates a query and streams the LLM response as SSE events.
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

      const opeaResponse = await axios.post(opeaUrl, opeaPayload, {
        headers: {
          'Content-Type': 'application/json',
          ...(authHeaders?.authorization && { Authorization: authHeaders.authorization })
        },
        responseType: 'stream',
        timeout: streamTimeout,
        signal: opeaController.signal,
        httpAgent: new http.Agent({ keepAlive: true }),
        httpsAgent: new https.Agent({ keepAlive: true })
      });

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
      const targetLanguage = queryData.context?.language;
      const useStreamingTranslation =
        streamingTranslationEnabled && targetLanguage && targetLanguage.toUpperCase() !== 'EN';

      let pendingEn = '';
      const contextWindow = [];
      let translationChain = Promise.resolve();
      const CONTEXT_WINDOW_SIZE = 3;

      const scheduleUnitTranslation = (unit) => {
        translationChain = translationChain.then(async () => {
          if (res.writableEnded) return;
          try {
            await translationService.init();
            const translated = await translationService.translateStream(
              unit,
              'en',
              targetLanguage,
              contextWindow,
              (delta) => {
                if (!res.writableEnded) {
                  res.write(`data: ${JSON.stringify({ type: 'chunk', content: delta })}\n\n`);
                }
              }
            );
            contextWindow.push({ source: unit, target: translated });
            if (contextWindow.length > CONTEXT_WINDOW_SIZE) contextWindow.shift();
          } catch (error) {
            logger.warn(
              `QueryService.stream_translation_unit_failed: ${error.message} (lang=${targetLanguage}, unitLen=${unit.length}, unitPreview=${unit.slice(0, 80)})`,
              { queryId }
            );
            // Fallback: emit the original EN unit so the user is not left waiting.
            if (!res.writableEnded) {
              res.write(`data: ${JSON.stringify({ type: 'chunk', content: unit })}\n\n`);
            }
          }
        });
      };

      const doHandleStreamDone = async () => {
        if (doneState.handled || res.writableEnded) return;
        doneState.handled = true;
        if (useStreamingTranslation) {
          if (pendingEn.trim()) {
            scheduleUnitTranslation(pendingEn);
            pendingEn = '';
          }
          // Each scheduled unit swallows its own errors (see scheduleUnitTranslation),
          // so the chain never rejects; awaiting it just orders completion before 'done'.
          await translationChain;
          await handleStreamDone(queryId, fullResponseText, startTime, queryData, req, res, capturedMetadata, true);
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
            if (useStreamingTranslation) {
              // Buffer EN; commit complete units to the translator at boundaries.
              pendingEn += parsed.content;
              let extracted = extractCommittableUnit(pendingEn);
              while (extracted) {
                pendingEn = extracted.remainder;
                scheduleUnitTranslation(extracted.unit);
                extracted = extractCommittableUnit(pendingEn);
              }
            } else {
              res.write(`data: ${JSON.stringify({ type: 'chunk', content: parsed.content })}\n\n`);
            }
          } else if (parsed.type === 'metadata') {
            // chatqna already computed reranker-grounded source docs + is_grounded; capture
            // them instead of re-running retrieval on the backend.
            capturedMetadata = {
              source_documents: parsed.source_documents,
              confidence_score: parsed.confidence_score,
              is_grounded: parsed.is_grounded
            };
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

      req.on('close', () => {
        cleanupKeepalive();
        if (opeaController && !opeaController.signal.aborted) {
          opeaController.abort();
          logger.info('QueryService.stream_client_disconnected', { queryId });
          if (fullResponseText) {
            queryService
              .finalizeStreamQuery(queryId, fullResponseText, Date.now() - startTime, {
                source_documents: [],
                confidence_score: 0
              })
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
    skipPostStreamTranslation = false
  ) {
    if (res.writableEnded) return;

    const responseTime = Date.now() - startTime;
    // Source documents + grounding come from chatqna's in-stream metadata event
    // (reranker verdict + is_grounded), not from a backend-side retrieval.
    const metadata = capturedMetadata || { source_documents: [], confidence_score: 0, is_grounded: false };

    res.write(`data: ${JSON.stringify({ type: 'metadata', ...metadata, responseTime })}\n\n`);

    const userLanguage = queryData.context?.language;
    if (!skipPostStreamTranslation && userLanguage && userLanguage.toUpperCase() !== 'EN' && fullResponseText) {
      try {
        await translationService.init();
        const translated = await translationService.translateMarkdown(
          fullResponseText,
          'en',
          userLanguage.toLowerCase()
        );
        res.write(`data: ${JSON.stringify({ type: 'translation', content: translated })}\n\n`);
      } catch (error) {
        logger.warn('QueryService.stream_translation_failed', { queryId, error: error.message });
        res.write(
          `data: ${JSON.stringify({ type: 'error', message: 'Translation failed', code: 'TRANSLATION_FAILED' })}\n\n`
        );
      }
    }

    try {
      await queryService.finalizeStreamQuery(queryId, fullResponseText, responseTime, metadata);
    } catch (error) {
      logger.error('QueryService.stream_finalize_failed', { queryId, error: error.message });
    }

    res.write(`data: ${JSON.stringify({ type: 'done', queryId })}\n\n`);
    res.end();
    logger.info('QueryService.stream_complete', { queryId, responseTime });
  }

  /**
   * @swagger
   * /queries:
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
   *         description: Missing required fields or invalid contextOption
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
   * /api/queries/{queryId}:
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
   * /api/queries/{queryId}/feedback:
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
      logger.info(`Adding feedback to query ${req.params.queryId} with body: ${JSON.stringify(req.body)}`);
      const query = await queryService.addFeedback(req.params.queryId, req.body);
      res.json(query);
    } catch (error) {
      logger.error(`Error adding feedback to query ${req.params.queryId}: ${error.message}`, { stack: error.stack });
      next(error);
    }
  });

  /**
   * @swagger
   * /api/queries/{queryId}/answered:
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
   * /api/queries:
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
      const { limit = 20, offset = 0, ...criteria } = req.query;
      criteria.userId = userId;
      logger.info(`Searching queries for user ${userId}, limit: ${limit}, offset: ${offset}`);
      const results = await queryService.searchQueries(criteria, parseInt(limit), parseInt(offset));
      res.json(results);
    } catch (error) {
      logger.error(`Error searching queries: ${error.message}`, { stack: error.stack });
      res.status(500).json({ message: error.message });
    }
  });

  /**
   * @swagger
   * /api/queries/{queryId}/conversations:
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
      const conversations = await queryService.getConversationsForQuery(req.params.queryId);
      res.json(conversations);
    } catch (error) {
      logger.error(`Error getting conversations for query ${req.params.queryId}: ${error.message}`, {
        stack: error.stack
      });
      next(error);
    }
  });

  /**
   * @swagger
   * /api/queries/{queryId}/conversation:
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
   * /api/queries/{queryId}/link/{messageId}:
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
