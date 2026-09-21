const express = require('express');
const { keycloakAuthMiddleware } = require('../middleware/keycloak-auth-middleware');
const { logger } = require('../shared-lib');

module.exports = (agriService) => {
  // Router created per mount so each factory call binds its own service
  const router = express.Router();
  router.use(keycloakAuthMiddleware.authenticate);

  /**
   * @swagger
   * /api/agri/crop-health:
   *   get:
   *     summary: Crop health (NDVI) per El Salvador department
   *     description: Dekadal NDVI with long-term-average baseline, trend and health bucket. Served from cache — never contacts upstream APIs on the request path.
   *     tags: [Agriculture]
   *     responses:
   *       200:
   *         description: Envelope with departments array and meta (source, coverage, caveats)
   *       401:
   *         description: Unauthorized
   */
  router.get('/crop-health', async (req, res) => {
    try {
      res.json(await agriService.getCropHealth());
    } catch (error) {
      logger.error(`agri crop-health failed: ${error.message}`);
      res.status(500).json({ message: error.message });
    }
  });

  /**
   * @swagger
   * /api/agri/pest-alerts:
   *   get:
   *     summary: Pest advisories, regional news and community sightings
   *     description: Three honest sections — curated seasonal advisories, OIRSA regional plant-health news, iNaturalist community sightings (last 90 days).
   *     tags: [Agriculture]
   *     responses:
   *       200:
   *         description: Envelope with advisories, regional, sightings arrays
   *       401:
   *         description: Unauthorized
   */
  router.get('/pest-alerts', async (req, res) => {
    try {
      res.json(await agriService.getPestAlerts());
    } catch (error) {
      logger.error(`agri pest-alerts failed: ${error.message}`);
      res.status(500).json({ message: error.message });
    }
  });

  /**
   * @swagger
   * /api/agri/market-prices/{category}:
   *   get:
   *     summary: Market price series for a commodity category
   *     description: Composite series with degradation order, CPI-estimated gap years (dashed in UI), regional-reference labels and structured caveats.
   *     tags: [Agriculture]
   *     parameters:
   *       - in: path
   *         name: category
   *         required: true
   *         schema:
   *           type: string
   *           enum: [maize, cropProtection, vegetables, livestock, fertilizer, apiary, aquaculture, harvestStorage]
   *     responses:
   *       200:
   *         description: Envelope with title, unit, series array, trend, latest
   *       400:
   *         description: Unknown category
   *       401:
   *         description: Unauthorized
   */
  router.get('/market-prices/:category', async (req, res) => {
    try {
      const { category } = req.params;
      const result = await agriService.getMarketPrices(category);
      if (!result) {
        return res.status(400).json({
          message: `Unknown category '${category}'`,
          validCategories: agriService.listCategories()
        });
      }
      res.json(result);
    } catch (error) {
      logger.error(`agri market-prices failed: ${error.message}`);
      res.status(500).json({ message: error.message });
    }
  });

  /**
   * @swagger
   * /api/agri/news:
   *   get:
   *     summary: Recent agriculture news for the prediction dialogs
   *     description: Headline picker feed. scope=global (GDELT, EN/ES) or local (MAG, Presidencia, CoLatino — ES). 48h window widened to 7d when quiet.
   *     tags: [Agriculture]
   *     parameters:
   *       - in: query
   *         name: scope
   *         schema: { type: string, enum: [global, local], default: global }
   *       - in: query
   *         name: lang
   *         schema: { type: string, enum: [en, es], default: es }
   *     responses:
   *       200:
   *         description: Envelope with items array (title, source, url, publishedAt, snippet?)
   *       401:
   *         description: Unauthorized
   */
  router.get('/news', async (req, res) => {
    try {
      const scope = req.query.scope === 'local' ? 'local' : 'global';
      const lang = req.query.lang === 'en' ? 'en' : 'es';
      res.json(await agriService.getNews(scope, lang));
    } catch (error) {
      logger.error(`agri news failed: ${error.message}`);
      res.status(500).json({ message: error.message });
    }
  });

  /**
   * @swagger
   * /api/agri/health:
   *   get:
   *     summary: Per-source adapter health
   *     description: Last fetch result, age and latest data date for every enabled source adapter.
   *     tags: [Agriculture]
   *     responses:
   *       200:
   *         description: Adapter health array
   *       401:
   *         description: Unauthorized
   */
  router.get('/health', async (req, res) => {
    try {
      res.json(await agriService.getHealth());
    } catch (error) {
      logger.error(`agri health failed: ${error.message}`);
      res.status(500).json({ message: error.message });
    }
  });

  return router;
};
