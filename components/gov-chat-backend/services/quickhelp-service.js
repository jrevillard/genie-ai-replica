'use strict';

/**
 * quickhelp-service.js — J.4 (DEC-28)
 *
 * CRUD over the quickhelpButtons collection: the admin-managed quick-help
 * button set for the chat landing page. Buttons carry bilingual stored text
 * ({en, st}; st optional, empty falls back to en client-side) and no
 * retrieval labels — post-DEC-27 they are conversation starters only.
 *
 * Pattern: lazy-init singleton mirroring service-category-service.js.
 * AQL tagged templates only (arangojs 8).
 */

const { aql } = require('arangojs');
const { logger, dbService } = require('../shared-lib');

const ICON_PREFIX = '/config/quickhelp/';
// The 17 SVGs baked into the frontend image (spec-j4 icon boundary). A
// prefix+suffix check alone would accept paths that 404 on the landing page.
const BAKED_ICONS = new Set([
  'just-chat.svg', 'crop-management.svg', 'soil-fertilizers.svg',
  'pest-control.svg', 'livestock.svg', 'weather-climate.svg',
  'market-prices.svg', 'water-management.svg', 'government-programs.svg',
  'business-trade.svg', 'education-learning.svg', 'employment-labor.svg',
  'healthcare-social.svg', 'housing-urban.svg', 'identity-civil.svg',
  'taxes-revenue.svg', 'transportation-mobility.svg',
]);

class QuickHelpService {
  constructor() {
    this.db = null;
    this.buttons = null;
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;
    try {
      this.db = await dbService.getConnection('default');
      this.buttons = this.db.collection('quickhelpButtons');
      this.initialized = true;
      logger.info('QuickHelpService initialized successfully');
    } catch (error) {
      logger.error(`Error initializing QuickHelpService: ${error.message}`, { stack: error.stack });
      throw error;
    }
  }

  /**
   * Validate + normalize a button payload. Returns { error } or { button }.
   * en title/prompt are required; st optional. Icon must be a baked
   * quickhelp path (frontend serves these files; anything else would 404).
   */
  _validate(payload) {
    if (!payload || typeof payload !== 'object') {
      return { error: 'Payload must be an object' };
    }
    const title = payload.title || {};
    const prompt = payload.prompt || {};
    if (!title.en || typeof title.en !== 'string' || !title.en.trim()) {
      return { error: 'English title (title.en) is required' };
    }
    if (!prompt.en || typeof prompt.en !== 'string' || !prompt.en.trim()) {
      return { error: 'English prompt (prompt.en) is required' };
    }
    const icon = payload.icon || '';
    if (
      typeof icon !== 'string' ||
      !icon.startsWith(ICON_PREFIX) ||
      !BAKED_ICONS.has(icon.slice(ICON_PREFIX.length))
    ) {
      return { error: `icon must be one of the baked ${ICON_PREFIX}*.svg files` };
    }
    // st stays null (not omitted) when empty: arangojs PATCH is a merge, so
    // an omitted key would never overwrite an existing st — clearing the
    // Sesotho text in the admin UI must actually clear it (keepNull:false
    // strips the null on write).
    const clean = (obj) => ({
      en: obj.en.trim(),
      st: typeof obj.st === 'string' && obj.st.trim() ? obj.st.trim() : null,
    });
    return {
      button: {
        title: clean(title),
        prompt: clean(prompt),
        icon,
        // Strict typing: Number(null)/Number('')/Number(false) are all 0 —
        // junk must take the 100 default, not jump to the front of the grid.
        order: typeof payload.order === 'number' && Number.isFinite(payload.order) ? payload.order : 100,
        enabled: payload.enabled === true,
        isJustChat: payload.isJustChat === true,
      },
    };
  }

  /**
   * List buttons. Admin view (?all=1) returns everything incl. disabled,
   * chat-page view returns enabled only. Sorted by order, then _key.
   */
  async list({ all = false } = {}) {
    await this.init();
    const filter = all ? aql`` : aql`FILTER b.enabled == true`;
    const cursor = await this.db.query(aql`
      FOR b IN quickhelpButtons
        ${filter}
        SORT b.order, b._key
        RETURN KEEP(b, '_key', 'order', 'enabled', 'isJustChat', 'title', 'prompt', 'icon')
    `);
    return cursor.all();
  }

  async create(payload) {
    await this.init();
    const { error, button } = this._validate(payload);
    if (error) return { error };
    // _key: slugify the EN title; append a suffix on collision.
    // NOTE: documentExists() is the arangojs-8 DOCUMENT check — exists() is
    // arity-0 (collection existence) and ignores its argument, which made
    // this loop hang forever once the collection existed (J.4 review F1).
    const base = button.title.en
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64) || 'button';
    let key = base;
    let n = 1;
    while (await this.buttons.documentExists(key)) {
      if (n > 50) return { error: 'Could not derive a unique key' };
      key = `${base}-${++n}`;
    }
    const doc = await this.buttons.save({ _key: key, ...button }, { returnNew: true });
    logger.info(`QuickHelp button created: ${key}`);
    return { button: doc.new };
  }

  async update(id, payload) {
    await this.init();
    if (!(await this.buttons.documentExists(id))) return { error: 'Button not found', status: 404 };
    const { error, button } = this._validate(payload);
    if (error) return { error };
    const doc = await this.buttons.update(id, button, { keepNull: false, returnNew: true });
    logger.info(`QuickHelp button updated: ${id}`);
    return { button: doc.new };
  }

  async remove(id) {
    await this.init();
    if (!(await this.buttons.documentExists(id))) return { error: 'Button not found', status: 404 };
    await this.buttons.remove(id);
    logger.info(`QuickHelp button deleted: ${id}`);
    return { deleted: id };
  }
}

// Singleton instance
const instance = new QuickHelpService();
module.exports = instance;
