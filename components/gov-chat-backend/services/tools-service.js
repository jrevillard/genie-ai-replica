const { aql } = require('arangojs');
const { logger, dbService } = require('../shared-lib');

class ToolsService {
  constructor() {
    this.db = null;
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;
    try {
      this.db = await dbService.getConnection('default');
      // Ensure feeds collection exists
      const exists = await this.db.collection('feeds').exists();
      if (!exists) {
        await this.db.createCollection('feeds');
        const feedsCol = this.db.collection('feeds');
        await feedsCol.ensureIndex({
          type: 'persistent',
          fields: ['url'],
          unique: true,
          name: 'idx_feeds_url'
        });
      }
      this.initialized = true;
      logger.info('ToolsService initialized');
    } catch (error) {
      logger.error(`Error initializing ToolsService: ${error.message}`);
      throw error;
    }
  }

  async getFeeds() {
    try {
      const cursor = await this.db.query(aql`
        FOR f IN feeds
        RETURN f
      `);
      return await cursor.all();
    } catch (error) {
      logger.error(`Error getting feeds: ${error.message}`);
      throw error;
    }
  }

  async getFeedById(id) {
    try {
      const feed = await this.db.collection('feeds').document(id);
      return feed;
    } catch (error) {
      if (error.errorNum === 1202) return null; // Document not found
      logger.error(`Error getting feed ${id}: ${error.message}`);
      throw error;
    }
  }

  async createFeed(feedData) {
    try {
      const feed = {
        ...feedData,
        enabled: feedData.enabled !== undefined ? feedData.enabled : true,
        last_polled: 0,
        last_entry_date: 0,
        failures: 0,
        createdAt: Date.now()
      };

      const result = await this.db.collection('feeds').save(feed, { returnNew: true });
      return result.new;
    } catch (error) {
      logger.error(`Error creating feed: ${error.message}`);
      throw error;
    }
  }

  async updateFeed(id, updateData) {
    try {
      // Don't allow overwriting internal fields directly
      delete updateData._key;
      delete updateData._id;
      delete updateData._rev;

      const result = await this.db.collection('feeds').update(id, updateData, { returnNew: true });
      return result.new;
    } catch (error) {
      logger.error(`Error updating feed ${id}: ${error.message}`);
      throw error;
    }
  }

  async deleteFeed(id) {
    try {
      await this.db.collection('feeds').remove(id);
      return { success: true };
    } catch (error) {
      if (error.errorNum === 1202) return { success: false, message: 'Feed not found' };
      logger.error(`Error deleting feed ${id}: ${error.message}`);
      throw error;
    }
  }
}

const instance = new ToolsService();
module.exports = instance;
