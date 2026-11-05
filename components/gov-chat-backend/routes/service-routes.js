const express = require('express');
const router = express.Router();
const { keycloakAuthMiddleware } = require('../middleware/keycloak-auth-middleware');

const CANONICAL_PREFIX = '/api/service-categories';

module.exports = () => {
  router.use(keycloakAuthMiddleware.authenticate);

  // Deprecated duplicates (#442): these three GET routes used to carry their
  // own handlers; the canonical implementations live under
  // /api/service-categories (service-category-routes.js) and are what the
  // frontend calls. The routes stay as 301 redirects so existing clients —
  // and the Kong /api/services route — keep working. The query string is
  // preserved because req.originalUrl carries it.
  router.get(['/categories', '/categories/:categoryId', '/search'], (req, res) => {
    res.redirect(301, req.originalUrl.replace(/^\/api\/services/, CANONICAL_PREFIX));
  });

  return router;
};
