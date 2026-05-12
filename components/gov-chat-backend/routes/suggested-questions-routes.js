const express = require('express');
const authMiddleware = require('../middleware/auth-middleware');
const { SUGGESTED_QUESTIONS } = require('../constants/suggested-questions');

/**
 * Curated chat-landing suggested questions, served behind auth.
 * The same list is also exposed without auth at /api/public/suggested-questions
 * for shareable guest links.
 */
module.exports = () => {
  const router = express.Router();
  router.use(authMiddleware.authenticate);

  /**
   * @swagger
   * /suggested-questions:
   *   get:
   *     summary: List curated chat-landing suggested questions
   *     description: >-
   *       Returns the curated list ordered by importance (lower `order` first).
   *       English-only for now.
   *     tags: [Suggested Questions]
   *     security: [ { bearerAuth: [] } ]
   *     responses:
   *       200:
   *         description: Suggested questions
   *         content:
   *           application/json:
   *             schema:
   *               type: array
   *               items:
   *                 type: object
   *                 properties:
   *                   order:    { type: integer, example: 1 }
   *                   category: { type: string,  example: Hypertension }
   *                   content:  { type: string,  example: "How do I know if my blood pressure is too high?" }
   */
  router.get('/', (req, res) => {
    // Match the per-twin default-enabled cap (3) so chat-landing surfaces
    // are consistent regardless of which endpoint the client reads from.
    res.json(SUGGESTED_QUESTIONS.slice(0, 3));
  });

  return router;
};
