'use strict';

const { logger } = require('../../shared-lib');
const { extractCommittableUnit } = require('./stream-boundary');
const { languageForLog } = require('./language-log');

// The streaming-translation unit relay (issue #829), extracted from the
// query-routes streaming handler (story 2.4). ONE home, consumed by both
// paths — the legacy chatqna relay and the agentic frame writer — so the
// translation behaves as today on both: complete units (sentence/paragraph
// boundaries) are committed to the translator while the stream runs, and a
// failed unit latches the relay so the answer stays in English for its
// remainder with the failure reported on `done`.
//
// The relay owns the state the legacy handler kept inline: the EN buffer
// (`pendingEn`), the ordered translation chain, and the failure latch. The
// extraction is verbatim — the legacy SSE translation suite
// (__tests__/routes/query-routes.test.js "SSE translation") pins equivalence.

/**
 * Build a unit relay for one streaming response.
 *
 * @param {Object} params
 * @param {Object} params.res - The Express response the chunks are written to.
 * @param {Object|null} params.translator - The translator the request resolved
 *   (a markdown translator bound to `en → targetLanguage`), or null when the
 *   translation service was not ready. Null starts the relay FAILED: the
 *   answer stays in English and the failure is reported on `done`.
 * @param {string} params.targetLanguage - The normalized requested language
 *   (log-facing only; the value is caller-controlled and never logged raw).
 * @param {string} params.queryId - Log correlation.
 * @returns {Object} `{ onChunk, flush }`.
 */
function createStreamUnitRelay({ res, translator, targetLanguage, queryId }) {
  let pendingEn = '';
  let translationChain = Promise.resolve();
  // A language that was accepted but has no translator behind it — the
  // translation service was not ready when the request arrived — cannot be
  // translated at all: the answer stays in English for its whole length,
  // and the failure is reported on `done` like any other one.
  let failed = !translator;
  let loggedActive = false;

  const writeChunk = (content) => {
    if (!res.writableEnded) {
      // An SSE frame, never an HTML document: JSON.stringify escapes
      // quotes and newlines, so a value cannot terminate the `data:`
      // frame or inject a second event. The client renders message
      // content through DOMPurify (ChatBotComponent.vue).
      // nosemgrep: nodejs_scan.javascript-xss-rule-express_xss
      res.write(`data: ${JSON.stringify({ type: 'chunk', content })}\n\n`);
    }
  };

  // Translate one COMPLETE unit (see services/translation/stream-boundary.js)
  // using the AST-based markdown translator the request resolved. The
  // translator parses the unit as markdown, translates ONLY the text leaf
  // nodes, and reassembles the AST — so structure WITHIN the unit (bold,
  // lists, inner paragraphs) is preserved by the skeleton, never left to the
  // model. `separator` is the exact trailing whitespace that followed the
  // unit in the source; we pass it through verbatim, so structure BETWEEN
  // units (the "\n\n" paragraph breaks, line breaks) survives too. This is
  // what keeps formatting intact during streaming translation (issue #829).
  const scheduleUnitTranslation = (content, separator) => {
    translationChain = translationChain.then(async () => {
      if (res.writableEnded) return;
      if (failed) {
        // The translation failed for an earlier unit: the answer stays in
        // English for the remainder, so the unit goes out as it is. The
        // translator is not asked again — from here on the answer is the
        // English stream, and a unit that came back translated would
        // disagree with the ones around it.
        writeChunk(`${content}${separator}`);
        return;
      }
      try {
        const translated = await translator.translate(content);
        // An empty translation is a failed translation: the answer stays
        // in English, and the client is told so on `done`. Handing back the
        // English unit as if it were the translation would present an
        // untranslated answer as a translated one — the failure the flag
        // exists for. From here on the answer is the English stream: the
        // units that were translated keep their translation, and the ones
        // that follow stay in English.
        const empty = !translated || !translated.trim();
        if (empty) {
          logger.warn(
            `QueryService.stream_translation_empty: (lang=${languageForLog(targetLanguage)}, unitLen=${content.length})`,
            { queryId }
          );
          failed = true;
        }
        const body = empty ? `${content}${separator}` : `${translated.trim()}${separator}`;
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
        writeChunk(body);
      } catch (error) {
        // The language is caller-controlled: the log carries a bounded,
        // printable form of it, never the raw value.
        logger.warn(
          `QueryService.stream_translation_unit_failed: ${error.message} (lang=${languageForLog(targetLanguage)}, unitLen=${content.length}, unitPreview=${content.slice(0, 80)})`,
          { queryId }
        );
        writeChunk(`${content}${separator}`);
        failed = true;
      }
    });
  };

  return {
    /**
     * Feed one EN chunk. Buffers it and commits every COMPLETE unit to the
     * translation chain. Once the relay has failed, the buffered EN (which is
     * OLDER than this chunk) goes out first, then the chunk untranslated —
     * flushed at the end of the stream it would land after the chunks that
     * follow it, and the answer would read out of order.
     * @param {string} content
     */
    onChunk(content) {
      if (!failed) {
        if (!loggedActive) {
          loggedActive = true;
          // Debug: confirms the streaming-translation path is active for
          // this request (absent => flag/path not triggering).
          logger.debug(`[STREAM-TRANSLATE] active lang=${languageForLog(targetLanguage)}`, { queryId });
        }
        pendingEn += content;
        let extracted = extractCommittableUnit(pendingEn);
        while (extracted) {
          pendingEn = extracted.remainder;
          scheduleUnitTranslation(extracted.content, extracted.separator);
          extracted = extractCommittableUnit(pendingEn);
        }
      } else {
        if (pendingEn) {
          writeChunk(pendingEn);
          pendingEn = '';
        }
        writeChunk(content);
      }
    },

    /**
     * Flush at end-of-stream (the `done` path). When the relay failed, the
     * queued units are awaited first (they emit in the order they were
     * committed) and the buffered English remainder goes out directly. When
     * it did not, the remainder is committed as one final unit and the chain
     * is awaited — each scheduled unit swallows its own errors, so awaiting
     * just orders completion before `done`.
     *
     * @returns {Promise<boolean>} The failure latch AFTER the flush — the
     *   value `alreadyFailedTranslation` rides on `done` with.
     */
    async flush() {
      if (failed) {
        await translationChain;
        if (pendingEn && !res.writableEnded) {
          writeChunk(pendingEn);
          pendingEn = '';
        }
      } else {
        if (pendingEn.trim()) {
          scheduleUnitTranslation(pendingEn, '');
          pendingEn = '';
        }
        await translationChain;
      }
      return failed;
    }
  };
}

module.exports = { createStreamUnitRelay };
