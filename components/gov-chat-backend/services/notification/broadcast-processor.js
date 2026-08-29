const { UnrecoverableError } = require('bullmq');
const { logger } = require('../../shared-lib');
const { notificationQueue, CHUNK_QUEUE } = require('./queue');

const CHUNK_SIZE = () => parseInt(process.env.NOTIFICATION_CHUNK_SIZE, 10) || 500;

/**
 * The two job handlers.
 *
 * Counters live in Redis (HINCRBY), not in an exclusively-locked ArangoDB
 * document: counting stays idempotent under retry (a replayed chunk
 * increments only for the tokens it actually re-sent), and the document is
 * written exactly twice — create and finalize.
 */
class BroadcastProcessor {
  constructor({ tokenRepository, broadcastRepository, fcmSender }) {
    this.tokens = tokenRepository;
    this.broadcasts = broadcastRepository;
    this.sender = fcmSender;
    this.queue = notificationQueue;
  }

  /**
   * Parent job: resolve the audience and fan out chunk jobs.
   * Streams the cursor — chunks are enqueued while the cursor is still open,
   * and peak memory is bounded by the cursor batchSize, not audience size.
   */
  async processBroadcast(job) {
    const { key, broadcastId, payload, audience } = job.data;
    await this.broadcasts.markResolving(key);

    const chunkSize = CHUNK_SIZE();
    let buffer = [];
    let matched = 0;
    let chunkIndex = 0;
    let pending = [];

    const flush = async (chunkTokens) => {
      pending.push({
        name: 'chunk',
        data: { key, broadcastId, chunkIndex, tokens: chunkTokens, payload },
        opts: {
          // Deterministic id: a broadcast-job retry re-enqueueing the same
          // chunk is deduplicated by BullMQ instead of double-sending.
          jobId: `${broadcastId}-${chunkIndex}`,
          attempts: parseInt(process.env.NOTIFICATION_JOB_ATTEMPTS, 10) || 5,
          backoff: { type: 'custom' },
          removeOnComplete: { age: 3600, count: 1000 },
          removeOnFail: { age: 86400 },
        },
      });
      chunkIndex += 1;
      if (pending.length >= 20) {
        await this.queue.chunkQueue.addBulk(pending);
        pending = [];
      }
    };

    for await (const batch of this.tokens.streamMatchingTokens(audience)) {
      matched += batch.length;
      buffer.push(...batch);
      while (buffer.length >= chunkSize) {
        await flush(buffer.splice(0, chunkSize));
      }
    }
    if (buffer.length > 0) await flush(buffer.splice(0));
    if (pending.length > 0) await this.queue.chunkQueue.addBulk(pending);

    if (matched === 0) {
      logger.warn('BroadcastProcessor.no_matching_tokens', { broadcastId, audience });
      await this.broadcasts.finalize(key, { matched: 0, chunksTotal: 0, chunksDone: 0, sent: 0, failed: 0, pruned: 0 }, {});
      return { matched: 0 };
    }

    await this.broadcasts.markSending(key, matched, chunkIndex);
    logger.info('BroadcastProcessor.fanout_enqueued', { broadcastId, matched, chunks: chunkIndex });

    // Covers the race where every chunk finished before markSending landed —
    // without this, no later chunk completion would trigger finalization.
    await this.finalizeIfComplete(key, broadcastId);
    return { matched, chunks: chunkIndex };
  }

  /** Chunk job: send ≤500 tokens, prune dead ones, count, retry the rest. */
  async processChunk(job) {
    const { key, broadcastId, chunkIndex, tokens, payload } = job.data;
    const redis = this.queue.connection;
    const sentSetKey = this.queue.sentSetKey(broadcastId, chunkIndex);
    const countersKey = this.queue.countersKey(broadcastId);
    const errorsKey = this.queue.errorsKey(broadcastId);

    // Crash-replay guard: if a previous attempt died after the FCM call but
    // before narrowing job.data, this filter stops the replay re-delivering.
    const alreadySent = new Set(await redis.smembers(sentSetKey));
    const todo = alreadySent.size ? tokens.filter((t) => !alreadySent.has(t)) : tokens;

    if (todo.length === 0) {
      await redis.hincrby(countersKey, 'chunksDone', 1);
      await this.queue.touchTransient(countersKey);
      await this.finalizeIfComplete(key, broadcastId);
      return { sent: 0, skipped: tokens.length };
    }

    const message = this.sender.buildMessage(payload);
    const result = await this.sender.sendChunk(todo, message);

    // Record deliveries FIRST — shrinks the duplicate window to one Redis RTT.
    if (result.sentTokens.length > 0) {
      await redis.sadd(sentSetKey, ...result.sentTokens);
    }

    const pipeline = redis.pipeline();
    if (result.sent) pipeline.hincrby(countersKey, 'sent', result.sent);
    if (result.failed) pipeline.hincrby(countersKey, 'failed', result.failed);
    for (const [code, count] of Object.entries(result.errorCounts)) {
      pipeline.hincrby(errorsKey, code, count);
    }
    await pipeline.exec();
    await this.queue.touchTransient(countersKey, errorsKey, sentSetKey);

    if (result.abort) {
      await this.broadcasts.markFailed(key, { code: 'app/invalid-credential', message: 'Firebase credentials rejected' });
      throw new UnrecoverableError('firebase_credentials_rejected');
    }

    if (result.pruneTokens.length > 0) {
      const pruned = await this.tokens.deactivateTokens(result.pruneTokens, 'fcm_unregistered', broadcastId);
      if (pruned) await redis.hincrby(countersKey, 'pruned', pruned);
    }

    if (result.payloadInvalid) {
      // The message itself is broken — a retry sends the same bytes. Count
      // the chunk as done (failures are recorded) and surface it loudly.
      await redis.hincrby(countersKey, 'chunksDone', 1);
      logger.error('BroadcastProcessor.payload_invalid', { broadcastId, chunkIndex, errorCounts: result.errorCounts });
      await this.finalizeIfComplete(key, broadcastId);
      return { sent: result.sent, failed: result.failed, payloadInvalid: true };
    }

    if (result.retryTokens.length > 0) {
      // Narrow BEFORE throwing: the retry must never re-send to devices that
      // already got the alert. One 503 on the last token of a 500-chunk must
      // not re-push 499 duplicates.
      await job.updateData({ ...job.data, tokens: result.retryTokens });
      throw new Error(`partial_chunk_failure:${result.retryTokens.length}`);
    }

    await redis.hincrby(countersKey, 'chunksDone', 1);
    await this.finalizeIfComplete(key, broadcastId);
    return { sent: result.sent, failed: result.failed, pruned: result.pruneTokens.length };
  }

  /**
   * Called by the worker's `failed` event when a chunk exhausts its
   * attempts: whatever is left in its (narrowed) token list is permanently
   * failed, and the chunk must still count toward completion.
   */
  async handleChunkExhausted(job) {
    const { key, broadcastId, chunkIndex, tokens } = job.data;
    const redis = this.queue.connection;
    const sentSetKey = this.queue.sentSetKey(broadcastId, chunkIndex);
    const countersKey = this.queue.countersKey(broadcastId);

    const alreadySent = new Set(await redis.smembers(sentSetKey));
    const remaining = tokens.filter((t) => !alreadySent.has(t)).length;

    const pipeline = redis.pipeline();
    if (remaining) pipeline.hincrby(countersKey, 'failed', remaining);
    pipeline.hincrby(countersKey, 'chunksDone', 1);
    await pipeline.exec();
    await this.queue.touchTransient(countersKey);

    logger.error('BroadcastProcessor.chunk_exhausted', { broadcastId, chunkIndex, remainingFailed: remaining });
    await this.finalizeIfComplete(key, broadcastId);
  }

  /** Idempotent: BroadcastRepository.finalize only matches non-terminal docs. */
  async finalizeIfComplete(key, broadcastId) {
    const doc = await this.broadcasts.getByKey(key);
    if (!doc || !['resolving', 'sending'].includes(doc.status)) return;
    if (!doc.counts.chunksTotal) return;

    const redis = this.queue.connection;
    const counters = await redis.hgetall(this.queue.countersKey(broadcastId));
    const chunksDone = parseInt(counters.chunksDone, 10) || 0;
    if (chunksDone < doc.counts.chunksTotal) return;

    const errorSummary = {};
    const rawErrors = await redis.hgetall(this.queue.errorsKey(broadcastId));
    for (const [code, count] of Object.entries(rawErrors)) {
      errorSummary[code] = parseInt(count, 10) || 0;
    }

    await this.broadcasts.finalize(key, {
      chunksDone,
      sent: parseInt(counters.sent, 10) || 0,
      failed: parseInt(counters.failed, 10) || 0,
      pruned: parseInt(counters.pruned, 10) || 0,
    }, errorSummary);
  }
}

module.exports = { BroadcastProcessor, CHUNK_QUEUE };
