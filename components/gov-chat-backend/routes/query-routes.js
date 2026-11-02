const express = require('express');
const router = express.Router();
const { logger } = require('../shared-lib');

// chatqna's token stream wraps every chunk in a Python bytes repr (`data: b'…'`).
// repr() escapes real content (newlines, quotes, non-ASCII as \xHH hex), so the
// wrapper must be fully DECODED — slicing off the b'…' shell leaks literal
// escape text into chat bubbles (and JSON-parsing the token drops numeric
// chunks entirely). Unknown escape shapes fall back to the legacy slice path.
function isBytesRepr(raw) {
  return (
    raw.length >= 3 &&
    raw[0] === 'b' &&
    ((raw[1] === "'" && raw.endsWith("'")) || (raw[1] === '"' && raw.endsWith('"')))
  );
}

function decodeBytesRepr(raw) {
  const body = raw.slice(2, -1);
  const bytes = [];
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch !== '\\') {
      bytes.push(body.charCodeAt(i));
      continue;
    }
    const esc = body[++i];
    switch (esc) {
      case 'n': bytes.push(10); break;
      case 'r': bytes.push(13); break;
      case 't': bytes.push(9); break;
      case 'a': bytes.push(7); break;
      case 'b': bytes.push(8); break;
      case 'f': bytes.push(12); break;
      case 'v': bytes.push(11); break;
      case '\\': bytes.push(92); break;
      case "'": bytes.push(39); break;
      case '"': bytes.push(34); break;
      case 'x': {
        const hex = body.slice(i + 1, i + 3);
        if (!/^[0-9a-fA-F]{2}$/.test(hex)) return null;
        bytes.push(parseInt(hex, 16));
        i += 2;
        break;
      }
      default:
        return null; // not a repr shape we produced — caller falls back
    }
  }
  return new TextDecoder('utf-8').decode(Uint8Array.from(bytes));
}

module.exports = (queryService) => {
  // Apply authentication middleware to all routes

  // Object-level authorization helper — authenticate only proves WHO the
  // caller is; every route touching a user-scoped resource must also prove
  // the caller owns it (or carries the fresh 'admin' realm role, mirroring
  // requireAdmin's claim source).
  const isAdminReq = (req) => {
    const roles = req.claims && req.claims.realm_access && req.claims.realm_access.roles;
    return Array.isArray(roles) && roles.includes('admin');
  };

  /**
   * @swagger
   * /queries/{queryId}/responsetime:
   *   patch:
   *     summary: Update query response time
   *     description: Updates the response time of a specific query.
   *     tags: [Queries]
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
  router.patch('/:queryId/responsetime', async (req, res) => {
    try {
      const { queryId } = req.params;
      const { responseTime } = req.body;

      if (!responseTime && responseTime !== 0) {
        return res.status(400).json({ message: 'Response time is required' });
      }

      const updatedQuery = await queryService.updateQueryResponseTime(queryId, responseTime);

      res.json(updatedQuery);
    } catch (error) {
      logger.error(`Error updating response time for query ${req.params.queryId}: ${error.message}`, { stack: error.stack });
      if (error.message.includes('not found')) {
        return res.status(404).json({ message: 'Query not found' });
      }
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  /**
   * @swagger
   * /queries:
   *   post:
   *     summary: Create a new query
   *     description: Creates a new query and records it in analytics. Supports single-message or full conversation modes.
   *     tags: [Queries]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - userId
   *               - sessionId
   *             properties:
   *               userId:
   *                 type: string
   *                 description: ID of the user making the query
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
      // Attribution is server-side truth — never trust client-supplied userId.
      req.body.userId = req.user?._key || req.body.userId;
      logger.info(`Creating query for user ${req.body.userId}`);
      const query = await queryService.createQuery(req.body, req.headers.authorization);
      res.status(201).json(query);
    } catch (error) {
      logger.error(`Error creating query: ${error.message}`, { stack: error.stack });
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  // SSE streaming chat protocol: {queryId}, {delta}*, optional {error}
  // (upstream non-200, upstream timeout, or an empty/whitespace-only 200
  // stream — never a silent empty bubble), then {done, queryId, metadata}.
  // If chatqna answers without streaming (mock/off), the full text arrives as
  // a single delta — one consumption path for the frontend either way.
  router.post('/stream', async (req, res) => {
    const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
    let queryId;
    let payload;
    const startTime = Date.now();
    try {
      // Attribution is server-side truth — never trust client-supplied userId.
      req.body.userId = req.user?._key || req.body.userId;
      payload = queryService.buildOpeaPayload(req.body, process.env.CONTEXT_OPTION || 'single-message', true);
      queryId = await queryService.createStreamedQuery(req.body);
    } catch (error) {
      return res.status(400).json({ message: error.message });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    send({ queryId });

    // RAG silence (embed → retrieve → rerank before the first token) can
    // outlast mobile-proxy idle timeouts — SSE comments keep the connection
    // warm and are ignored by every SSE parser (and by our own loop above).
    const heartbeat = setInterval(() => {
      if (!res.writableEnded && !res.destroyed) res.write(': ping\n\n');
    }, 15000);
    res.on('close', () => clearInterval(heartbeat));

    // Stop consuming chatqna if the client disconnects mid-stream.
    // (res 'close' + writableEnded: req 'close' fires as soon as the request
    // body is consumed, which would abort every stream immediately.)
    const abort = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) abort.abort();
    });

    const opeaHost = process.env.OPEA_HOST || 'chatqna-xeon-backend-server';
    const opeaPort = process.env.OPEA_PORT || '8888';
    // A stalled 200 stream (headers or body never arriving) must not hang the
    // client forever. Test/slow-box knob; 120s covers slow first tokens.
    const upstreamTimeoutMs = Number(process.env.STREAM_UPSTREAM_TIMEOUT_MS) || 120000;

    let fullText = '';
    let streamMetadata = null;
    let errored = false;
    let upstreamStatus = 0;
    let upstreamContentType = '';
    try {
      // I.4: forward the caller's Bearer — chatqna needs it for doc-repo metadata
      // fetches (source_documents/confidence die without it). Absent header → no key.
      const upstreamHeaders = { 'Content-Type': 'application/json' };
      if (req.headers.authorization) {
        upstreamHeaders['Authorization'] = req.headers.authorization;
      }
      const upstream = await fetch(`http://${opeaHost}:${opeaPort}/v1/chatqna`, {
        method: 'POST',
        headers: upstreamHeaders,
        body: JSON.stringify(payload),
        // Aborts on client disconnect OR the upstream timeout (AbortSignal.any
        // passes the source signal's reason through — a TimeoutError).
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(upstreamTimeoutMs)])
      });
      upstreamStatus = upstream.status;
      const contentType = upstream.headers.get('content-type') || '';
      upstreamContentType = contentType;

      if (upstream.ok && contentType.includes('text/event-stream')) {
        // Re-emit upstream SSE data lines as our delta events
        const reader = upstream.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let idx;
          while ((idx = buffer.indexOf('\n')) !== -1) {
            const line = buffer.slice(0, idx).trim();
            buffer = buffer.slice(idx + 1);
            if (!line.startsWith('data:')) continue;
            let raw = line.slice(5).trim();
            if (raw === '[DONE]') continue;
            // chatqna wraps upstream tokens as Python bytes-repr (b'…' / b"…"):
            // decode fully — repr escapes ARE content (newlines, quotes,
            // non-ASCII), and the token itself is never JSON.
            if (isBytesRepr(raw)) {
              const text = decodeBytesRepr(raw);
              if (text !== null) {
                if (text) { fullText += text; send({ delta: text }); }
                continue;
              }
              raw = raw.slice(2, -1); // legacy fallback for unexpected shapes
            }
            try {
              const evt = JSON.parse(raw);
              if (evt.type === 'metadata') { streamMetadata = evt; continue; }
              // End-of-stream translation (F4): the final translated answer
              // REPLACES the streamed English preview in the bubble AND as the
              // persisted response — the user-facing text is the source of truth.
              if (evt.type === 'translated_answer' && evt.text) {
                fullText = evt.text;
                send({ translation: evt.text });
                continue;
              }
              // Translation failed upstream — the English answer stands and the
              // client shows a muted notice. Never an error event.
              if (evt.type === 'translation_unavailable') { send({ translationNotice: true }); continue; }
              const c0 = evt.choices?.[0];
              const text = evt.delta ?? evt.text
                ?? c0?.delta?.content ?? c0?.message?.content
                ?? (typeof evt === 'string' ? evt : '');
              if (text) { fullText += text; send({ delta: text }); }
            } catch {
              // b'...'-wrapped tokens are bare text, not JSON
              if (raw) { fullText += raw; send({ delta: raw }); }
            }
          }
        }
      } else if (upstream.ok) {
        const data = await upstream.json();
        const text = data.choices?.[0]?.message?.content ?? data.response ?? data.text ?? '';
        fullText = text;
        if (text) send({ delta: text });
      } else {
        errored = true;
        logger.error(`stream query upstream non-200: chatqna returned ${upstream.status} (content-type: ${upstreamContentType || 'none'})`);
        send({ error: `chatqna returned ${upstream.status}` });
      }
    } catch (error) {
      if (abort.signal.aborted) {
        // client hung up mid-stream — quiet by design (also covers the
        // AbortError the disconnect causes; NOT the upstream timeout)
      } else {
        errored = true;
        const timedOut = error.name === 'TimeoutError';
        logger.error(`stream query upstream ${timedOut ? 'timeout' : 'failure'}: ${error.message}`);
        send({ error: timedOut ? 'upstream timeout' : 'Internal server error' });
      }
    }

    // A 200 stream whose deltas amount to nothing (empty OR whitespace-only)
    // is a failure class of its own (e.g. model-id mismatch upstream):
    // surface it, never a silent empty bubble. Client-aborted streams (no
    // deltas by definition) stay quiet.
    if (!fullText.trim() && !errored && !abort.signal.aborted) {
      logger.error(`stream query empty response from pipeline: upstream ${upstreamStatus} (${upstreamContentType || 'no content-type'}) yielded zero content deltas`);
      send({ error: 'empty response from pipeline' });
    }

    // done is sent BEFORE persistence — an Arango hiccup must not hang the
    // client spinner after the full answer has already streamed.
    clearInterval(heartbeat);
    send({ done: true, queryId, metadata: streamMetadata });
    res.end();
    try {
      await queryService.completeStreamedQuery(queryId, {
        response: fullText,
        responseTime: Date.now() - startTime,
        metadata: streamMetadata,
        ragPayload: payload
      });
    } catch (error) {
      logger.error(`stream query persistence failure: ${error.message}`);
    }
  });

  /**
   * @swagger
   * /queries/{queryId}:
   *   get:
   *     summary: Get query by ID
   *     description: Retrieves a query by its unique identifier
   *     tags: [Queries]
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
      const query = await queryService.getQuery(req.params.queryId);
      // Non-owners get 404, not 403 — no existence oracle for other users' queries.
      if (!isAdminReq(req) && query?.userId !== req.user?._key) {
        return res.status(404).json({ message: 'Query not found' });
      }
      logger.info(`Fetching query with ID: ${req.params.queryId}`);
      res.json(query);
    } catch (error) {
      logger.error(`Error getting query ${req.params.queryId}: ${error.message}`, { stack: error.stack });
      if (error.message.includes('not found')) {
        return res.status(404).json({ message: 'Query not found' });
      }
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  /**
   * @swagger
   * /queries/{queryId}/feedback:
   *   post:
   *     summary: Add feedback to a query
   *     description: Adds user feedback to a query and records it in analytics
   *     tags: [Queries]
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
  router.post('/:queryId/feedback', async (req, res) => {
    try {
      logger.info(`Adding feedback to query ${req.params.queryId} with body: ${JSON.stringify(req.body)}`);
      const query = await queryService.addFeedback(req.params.queryId, req.body);
      res.json(query);
    } catch (error) {
      logger.error(`Error adding feedback to query ${req.params.queryId}: ${error.message}`, { stack: error.stack });
      if (error.message.includes('not found')) {
        return res.status(404).json({ message: 'Query not found' });
      }
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  /**
   * @swagger
   * /queries/{queryId}/answered:
   *   patch:
   *     summary: Mark query as answered
   *     description: Marks a query as answered and updates response time
   *     tags: [Queries]
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
  router.patch('/:queryId/answered', async (req, res) => {
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
      if (error.message.includes('not found')) {
        return res.status(404).json({ message: 'Query not found' });
      }
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  /**
   * @swagger
   * /queries:
   *   get:
   *     summary: Search queries
   *     description: Searches queries based on various criteria with pagination
   *     tags: [Queries]
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
   *         name: userId
   *         schema:
   *           type: string
   *         description: Filter by user ID
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
      const { limit = 20, offset = 0, ...criteria } = req.query;
      // Users only ever see their own queries; admins may filter explicitly.
      if (!isAdminReq(req)) criteria.userId = req.user?._key;
      logger.info(`Searching queries for ${isAdminReq(req) ? 'admin' : req.user?._key} (criteria keys: ${Object.keys(criteria).join(',') || 'none'})`);
      const results = await queryService.searchQueries(criteria, parseInt(limit), parseInt(offset));
      res.json(results);
    } catch (error) {
      logger.error(`Error searching queries: ${error.message}`, { stack: error.stack });
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  /**
   * @swagger
   * /queries/{queryId}/conversations:
   *   get:
   *     summary: Get conversations for a query
   *     description: Retrieves all conversations associated with a specific query
   *     tags: [Queries]
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
  router.get('/:queryId/conversations', async (req, res) => {
    try {
      logger.info(`Getting conversations for query ${req.params.queryId}`);
      const conversations = await queryService.getConversationsForQuery(req.params.queryId);
      res.json(conversations);
    } catch (error) {
      logger.error(`Error getting conversations for query ${req.params.queryId}: ${error.message}`, { stack: error.stack });
      
      if (error.message.includes('not found')) {
        return res.status(404).json({ message: 'Query not found' });
      }
      
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  /**
   * @swagger
   * /queries/{queryId}/conversation:
   *   post:
   *     summary: Create conversation from query
   *     description: Creates a new conversation based on an existing query
   *     tags: [Queries]
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
  router.post('/:queryId/conversation', async (req, res) => {
    try {
      const { queryId } = req.params;
      const options = req.body;
      
      logger.info(`Creating conversation from query ${queryId} with options: ${JSON.stringify(options)}`);
      
      const result = await queryService.createConversationFromQuery(queryId, options);
      res.status(201).json(result);
    } catch (error) {
      logger.error(`Error creating conversation from query ${req.params.queryId}: ${error.message}`, { stack: error.stack });
      
      if (error.message.includes('not found')) {
        return res.status(404).json({ message: 'Query not found' });
      }
      
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  /**
   * @swagger
   * /queries/{queryId}/link/{messageId}:
   *   post:
   *     summary: Link query to message
   *     description: Creates a link between a query and an existing message
   *     tags: [Queries]
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
  router.post('/:queryId/link/:messageId', async (req, res) => {
    try {
      const { queryId, messageId } = req.params;
      const options = req.body;
      
      logger.info(`Linking query ${queryId} to message ${messageId} with options: ${JSON.stringify(options)}`);
      
      const result = await queryService.linkQueryToMessage(queryId, messageId, options);
      res.json(result);
    } catch (error) {
      logger.error(`Error linking query ${req.params.queryId} to message ${req.params.messageId}: ${error.message}`, { stack: error.stack });
      
      if (error.message.includes('not found')) {
        return res.status(404).json({ message: error.message });
      }
      
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  return router;
};