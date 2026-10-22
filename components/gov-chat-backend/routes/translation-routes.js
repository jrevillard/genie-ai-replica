const express = require('express');
const router = express.Router();
const { keycloakAuthMiddleware } = require('../middleware/keycloak-auth-middleware');
const { logger } = require('../shared-lib');
const { isUnsupportedLanguage } = require('../services/translation/unsupported-language');

/**
 * Answers a refused language with the 400 it is.
 *
 * The language travels in the request body, so an unsupported one is a bad
 * request, not a server error. The status code comes from the error itself
 * (the refusal is a validation error), and the response names the refused
 * side only — the caller's value is never echoed back.
 *
 * @param {Error} error - The refusal the translation service raised.
 * @param {object} res - The Express response.
 * @returns {object} The response the route returns.
 */
function respondWithUnsupportedLanguage(error, res) {
  logger.warn(`[TRANSLATION-ROUTES] Rejected request: ${error.message}`);
  // The status code comes from the error (the refusal is a validation
  // error); a refusal that crossed a module boundary without one is still a
  // bad request. The code tells the client the request was refused — not that
  // it failed — without it having to read the message.
  return res.status(error.statusCode || 400).json({ message: error.message, code: error.code });
}

/**
 * @swagger
 * tags:
 * - name: Translation
 *   description: On-the-fly text translation endpoints
 */
module.exports = (translationService) => {
  logger.info('[TRANSLATION-ROUTES] Initializing translation routes');
  if (!translationService || typeof translationService.translate !== 'function') {
    logger.error('[TRANSLATION-ROUTES] Invalid translationService provided to translation-routes');
    throw new Error('translationService is required with a translate method');
  }
  logger.debug('[TRANSLATION-ROUTES] translation-routes initialized with translationService');

  // Secure all translation routes with authentication middleware
  router.use(keycloakAuthMiddleware.authenticate);

  /**
   * @swagger
   * "/api/translate":
   *   post:
   *     summary: Translate text content
   *     description: Translates an array of text strings from a specified source language to a specified target language.
   *     tags: [Translation]
   *     security:
   *       - KeycloakOAuth2: ['openid']
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - texts
   *               - source_lang
   *               - target_lang
   *             properties:
   *               texts:
   *                 type: array
   *                 items:
   *                   type: string
   *                 description: An array of text strings to be translated.
   *               source_lang:
   *                 type: string
   *                 description: The source language code (e.g., 'en', 'fr').
   *               target_lang:
   *                 type: string
   *                 description: The target language code (e.g., 'fr', 'de', 'zh').
   *     responses:
   *       '200':
   *         description: Translation successful.
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 translated_texts:
   *                   type: array
   *                   items:
   *                     type: string
   *       '400':
   *         description: Bad Request - Missing parameters or unsupported language.
   *       '401':
   *         description: Unauthorized - Authentication required.
   *       '500':
   *         description: Server error during translation.
   */
  router.post('/', async (req, res, next) => {
    logger.info(`[TRANSLATION-ROUTES] Request received: ${req.method} ${req.originalUrl}`);
    const { texts, source_lang, target_lang } = req.body;

    if (!texts || !Array.isArray(texts) || !source_lang || !target_lang) {
      logger.warn(
        '[TRANSLATION-ROUTES] Bad request: Missing or invalid "texts" array, "source_lang", or "target_lang".'
      );
      return res.status(400).json({
        message: 'Request body must include a "texts" array, a "source_lang" string, and a "target_lang" string.'
      });
    }

    try {
      const translatedTexts = await translationService.translate(texts, source_lang, target_lang);
      res.json({ translated_texts: translatedTexts });
      logger.info(`[TRANSLATION-ROUTES] Successfully sent ${translatedTexts.length} translated texts to client.`);
    } catch (error) {
      // An unsupported language is a bad request, not a server error: the
      // language comes from the request body and the translator refuses the
      // ones its language map does not know. The response names the refused
      // side only — the caller's value is never echoed back.
      if (isUnsupportedLanguage(error)) {
        return respondWithUnsupportedLanguage(error, res);
      }
      logger.error(`[TRANSLATION-ROUTES] Error translating content: ${error.message}`, { stack: error.stack });
      next(error); // Pass to the global error handler
    }
  });

  /**
   * @swagger
   * "/api/translate/markdown":
   *   post:
   *     summary: Translate markdown content
   *     description: Translates the text content within a markdown string from a specified source language to a specified target language, preserving the markdown structure.
   *     tags: [Translation]
   *     security:
   *       - KeycloakOAuth2: ['openid']
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - markdown
   *               - source_lang
   *               - target_lang
   *             properties:
   *               markdown:
   *                 type: string
   *                 description: The markdown content to be translated.
   *               source_lang:
   *                 type: string
   *                 description: The source language code (e.g., 'en', 'fr').
   *               target_lang:
   *                 type: string
   *                 description: The target language code (e.g., 'fr', 'de', 'zh').
   *     responses:
   *       '200':
   *         description: Translation successful.
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 translated_markdown:
   *                   type: string
   *       '400':
   *         description: Bad Request - Missing parameters or unsupported language.
   *       '401':
   *         description: Unauthorized - Authentication required.
   *       '500':
   *         description: Server error during translation.
   */
  router.post('/markdown', async (req, res, next) => {
    logger.info(`[TRANSLATION-ROUTES] Request received: ${req.method} ${req.originalUrl}`);
    const { markdown, source_lang, target_lang } = req.body;

    if (!markdown || typeof markdown !== 'string' || !source_lang || !target_lang) {
      logger.warn(
        '[TRANSLATION-ROUTES] Bad request: Missing or invalid "markdown" string, "source_lang", or "target_lang".'
      );
      return res.status(400).json({
        message: 'Request body must include a "markdown" string, a "source_lang" string, and a "target_lang" string.'
      });
    }

    try {
      const translatedMarkdown = await translationService.translateMarkdown(markdown, source_lang, target_lang);
      res.json({ translated_markdown: translatedMarkdown });
      logger.info('[TRANSLATION-ROUTES] Successfully sent translated markdown to client.');
    } catch (error) {
      // An unsupported language is a bad request, not a server error.
      if (isUnsupportedLanguage(error)) {
        return respondWithUnsupportedLanguage(error, res);
      }
      logger.error(`[TRANSLATION-ROUTES] Error translating markdown: ${error.message}`, { stack: error.stack });
      next(error); // Pass to the global error handler
    }
  });

  return router;
};
