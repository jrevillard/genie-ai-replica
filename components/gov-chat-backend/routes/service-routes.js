const express = require('express');
const router = express.Router();
const { keycloakAuthMiddleware } = require('../middleware/keycloak-auth-middleware');

const CANONICAL_PREFIX = '/api/service-categories';

module.exports = () => {
  router.use(keycloakAuthMiddleware.authenticate);

  /**
   * @swagger
   * "/api/services/categories":
   *   get:
   *     summary: Get all categories with services
   *     description: Retrieves all service categories with their associated services
   *     tags: [Services]
   *     security:
   *       - KeycloakOAuth2: ['openid']
   *     parameters:
   *       - in: query
   *         name: locale
   *         schema:
   *           type: string
   *           default: en
   *         description: Language locale for category and service names
   *     responses:
   *       200:
   *         description: List of categories with services
   *         content:
   *           application/json:
   *             schema:
   *               type: array
   *               items:
   *                 $ref: '#/components/schemas/CategoryTree'
   *       500:
   *         description: Server error
   */
  /**
   * @swagger
   * "/api/services/categories/{categoryId}":
   *   get:
   *     summary: Get category with services
   *     description: Retrieves a specific service category with its associated services
   *     tags: [Services]
   *     security:
   *       - KeycloakOAuth2: ['openid']
   *     parameters:
   *       - in: path
   *         name: categoryId
   *         required: true
   *         schema:
   *           type: string
   *         description: Category ID
   *       - in: query
   *         name: locale
   *         schema:
   *           type: string
   *           default: en
   *         description: Language locale for category and service names
   *     responses:
   *       200:
   *         description: Category with services
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 _key:
   *                   type: string
   *                 nameEN:
   *                   type: string
   *                 descriptionEN:
   *                   type: string
   *                 icon:
   *                   type: string
   *                 services:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       _key:
   *                         type: string
   *                       nameEN:
   *                         type: string
   *                       descriptionEN:
   *                         type: string
   *                       requirements:
   *                           type: string
   *                       process:
   *                           type: string
   *       404:
   *         description: Category not found
   *       500:
   *         description: Server error
   */
  /**
   * @swagger
   * "/api/services/search":
   *   get:
   *     summary: Search categories and services
   *     description: Searches for categories and services based on a query string
   *     tags: [Services]
   *     security:
   *       - KeycloakOAuth2: ['openid']
   *     parameters:
   *       - in: query
   *         name: query
   *         required: true
   *         schema:
   *           type: string
   *         description: Search query
   *       - in: query
   *         name: locale
   *         schema:
   *           type: string
   *           default: en
   *         description: Language locale for search results
   *     responses:
   *       200:
   *         description: Search results
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 categories:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       _key:
   *                         type: string
   *                       nameEN:
   *                         type: string
   *                       descriptionEN:
   *                         type: string
   *                       relevance:
   *                         type: number
   *                 services:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       _key:
   *                         type: string
   *                       nameEN:
   *                         type: string
   *                       descriptionEN:
   *                         type: string
   *                       categoryId:
   *                         type: string
   *                       relevance:
   *                         type: number
   *       400:
   *         description: Missing search query
   *       500:
   *         description: Server error
   */

  // Deprecated duplicates (#442): these three GET routes used to carry their
  // own handlers; the canonical implementations live under
  // /api/service-categories (service-category-routes.js) and are what the
  // frontend calls. The routes stay as 301 redirects so existing clients —
  // and the Kong /api/services route — keep working. req.url is the
  // mount-relative path (query string included), so the target is the
  // canonical path with the same query. The @swagger annotations above stay
  // so the OpenAPI spec (and the generated mobile client) keep declaring
  // these paths.
  router.get(['/categories', '/categories/:categoryId', '/search'], (req, res) => {
    res.redirect(301, CANONICAL_PREFIX + req.url);
  });

  return router;
};
