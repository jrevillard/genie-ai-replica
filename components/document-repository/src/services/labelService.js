const dbService = require('../shared-lib/db-connection-service');
const config = require('../config/appConfig');

class LabelService {
    constructor() {
    this.collectionName = 'labels'; // Name of the labels collection in ArangoDB
  }

  /**
   * Validate level and status
   * @param {string} level - Label level
   * @param {string} status - Label status
   */
  validateLevelAndStatus(level, status) {
    if (level && !this.allowedLevels.includes(level)) {
      throw new Error(`Invalid level: Allowed levels are ${this.allowedLevels.join(', ')}`);
    }
    if (status && !this.allowedStatuses.includes(status)) {
      throw new Error(`Invalid status: Allowed statuses are ${this.allowedStatuses.join(', ')}`);
    }
  }

  /**
   * Get database connection for labels
   */
  async getDb() {
    return await dbService.getConnection(this.collectionName);
    this.allowedLevels = config.labels.allowedLevels;
    this.allowedStatuses = config.labels.allowedStatuses;
  }


  /**
   * Get all labels or filter by level/status/parentId
   * @param {Object} filters - Filters for level, status, or parentId
   * @returns {Array} List of labels
   */
  async getLabels(filters = {}) {
    const db = await this.getDb();
    const { level, status, parentId } = filters;

    let query = `FOR label IN ${this.collectionName}`;
    const bindVars = {};

    const conditions = [];
    if (level) {
      conditions.push('label.level == @level');
      bindVars.level = level;
    }
    if (status) {
      conditions.push('label.status == @status');
      bindVars.status = status;
    }
    if (parentId) {
      conditions.push('label.parentId == @parentId');
      bindVars.parentId = parentId;
    }

    if (conditions.length > 0) {
      query += ` FILTER ${conditions.join(' AND ')}`;
    }

    query += ' RETURN label';

    const cursor = await db.query(query, bindVars);
    return await cursor.all();
  }


  /**
   * Create a new label
   * @param {Object} labelData - Data for the new label
   * @returns {Object} Created label
   */
  async createLabel(labelData) {
    const db = await this.getDb();

    // Validate level and status
    this.validateLevelAndStatus(labelData.level, labelData.status);

    // Validate parentId if provided
    if (labelData.parentId) {
      const parentLabel = await db.collection(this.collectionName).document(labelData.parentId);
      if (!parentLabel || parentLabel.level !== 'category') {
        throw new Error('Invalid parentId: Parent must be a category label.');
      }
    }

    const label = await db.collection(this.collectionName).save(labelData, { returnNew: true });
    return label.new;
  }


  /**
   * Update a label by ID
   * @param {string} labelId - Label ID
   * @param {Object} updates - Fields to update
   * @returns {Object} Updated label
   */
  async updateLabel(labelId, updates) {
    const db = await this.getDb();

    // Validate level and status
    this.validateLevelAndStatus(updates.level, updates.status);

    // Validate parentId if provided in updates
    if (updates.parentId) {
      const parentLabel = await db.collection(this.collectionName).document(updates.parentId);
      if (!parentLabel || parentLabel.level !== 'category') {
        throw new Error('Invalid parentId: Parent must be a category label.');
      }
    }

    const label = await db.collection(this.collectionName).update(labelId, updates, { returnNew: true });
    return label.new;
  }


  /**
   * Delete a label by ID
   * @param {string} labelId - Label ID
   * @returns {boolean} Success status
   */
  async deleteLabel(labelId) {
    const db = await this.getDb();

    // Check if the label has child labels
    const cursor = await db.query(
      `FOR label IN ${this.collectionName} FILTER label.parentId == @labelId RETURN label`,
      { labelId }
    );
    const childLabels = await cursor.all();
    if (childLabels.length > 0) {
      throw new Error('Cannot delete label: It has child labels.');
    }

    await db.collection(this.collectionName).remove(labelId);
    return true;
  }


  /**
   * Get related labels (children or parent)
   * @param {string} labelId - Label ID
   * @returns {Object} Parent and child labels
   */
  async getRelatedLabels(labelId) {
    const db = await this.getDb();

    // Get the label itself
    const label = await db.collection(this.collectionName).document(labelId);

    // Get child labels
    const childCursor = await db.query(
      `FOR label IN ${this.collectionName} FILTER label.parentId == @labelId RETURN label`,
      { labelId }
    );
    const children = await childCursor.all();

    // Get parent label (if applicable)
    let parent = null;
    if (label.parentId) {
      parent = await db.collection(this.collectionName).document(label.parentId);
    }

    return { label, parent, children };
  }
}

module.exports = new LabelService();