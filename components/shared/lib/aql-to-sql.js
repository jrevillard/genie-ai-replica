const { logger } = require('./logger');

/**
 * AqlToSqlTranslator Class
 *
 * This class is responsible for translating ArangoDB Query Language (AQL)
 * and arangojs driver method calls into ArcadeDB-compatible SQL.
 */
class AqlToSqlTranslator {
  constructor() {
    logger.info('AqlToSqlTranslator initialized.');
  }

  /**
   * Translates a simple AQL query string into SQL.
   * @param {string} aqlQuery The AQL query string.
   * @param {object} bindVars The bind variables for the query.
   * @returns {{sql: string, params: object}} The translated SQL and parameters.
   */
  translateQuery(aqlQuery, bindVars = {}) {
    logger.debug(`[AQL_TRANSLATE] Original AQL Query: ${aqlQuery}`);
    let sql = aqlQuery;
    let params = { ...bindVars };

    // CRITICAL FIX: Handle health check query and alias the result
    if (aqlQuery.trim().toUpperCase() === 'RETURN 1') {
      sql = 'SELECT 1 as health_check';
      logger.debug(`[AQL_TRANSLATE] Translated to health check SQL: ${sql}`);
      return { sql, params: {} };
    }

    // Naive translations for common AQL patterns.
    sql = sql.replace(/FOR\s+(\w+)\s+IN\s+(\w+)/i, 'SELECT FROM $2');
    sql = sql.replace(/RETURN\s+(\w+)/i, '');
    sql = sql.replace(/FILTER/gi, 'WHERE');
    sql = sql.replace(/@(\w+)/g, ':$1');
    sql = sql.replace(/\s+/g, ' ').trim();

    logger.debug(`[AQL_TRANSLATE] Translated SQL Query: ${sql}`);
    return { sql, params };
  }

  /**
   * Translates a document insertion operation.
   * @param {string} collectionName The name of the collection.
   * @param {object} doc The document to insert.
   * @param {object} options Arangojs options like returnNew.
   * @returns {{sql: string, params: object}} The translated SQL and parameters.
   */
  translateInsert(collectionName, doc, options = {}) {
    logger.debug(`[AQL_TRANSLATE] Translating INSERT for collection: ${collectionName}`);
    const params = { doc };
    let sql = `INSERT INTO ${collectionName} CONTENT :doc`;

    if (options.returnNew) {
      sql += ' RETURN @this';
    }

    logger.debug(`[AQL_TRANSLATE] Translated INSERT SQL: ${sql}`);
    return { sql, params };
  }

  /**
   * Translates a document retrieval operation (by key).
   * @param {string} collectionName The name of the collection.
   * @param {string} key The _key of the document.
   * @returns {{sql: string, params: object}} The translated SQL and parameters.
   */
  translateGet(collectionName, key) {
    logger.debug(`[AQL_TRANSLATE] Translating GET for collection: ${collectionName}, key: ${key}`);
    const params = { key };
    const sql = `SELECT FROM ${collectionName} WHERE _key = :key LIMIT 1`;
    
    logger.debug(`[AQL_TRANSLATE] Translated GET SQL: ${sql}`);
    return { sql, params };
  }

  /**
   * Translates a document update operation.
   * @param {string} collectionName The name of the collection.
   * @param {string} key The _key of the document to update.
   * @param {object} newData The new data to merge into the document.
   * @param {object} options Arangojs options like returnNew, keepNull.
   * @returns {{sql: string, params: object}} The translated SQL and parameters.
   */
  translateUpdate(collectionName, key, newData, options = {}) {
    logger.debug(`[AQL_TRANSLATE] Translating UPDATE for collection: ${collectionName}, key: ${key}`);
    const params = { key, newData };
    let sql = `UPDATE ${collectionName} MERGE :newData WHERE _key = :key`;

    if (options.returnNew) {
      sql += ' RETURN AFTER';
    } else if (options.returnOld) {
      sql += ' RETURN BEFORE';
    }

    logger.debug(`[AQL_TRANSLATE] Translated UPDATE SQL: ${sql}`);
    return { sql, params };
  }

  /**
   * Translates a document replacement operation.
   * @param {string} collectionName The name of the collection.
   * @param {string} key The _key of the document to replace.
   * @param {object} newData The new document content.
   * @param {object} options Arangojs options like returnNew.
   * @returns {{sql: string, params: object}} The translated SQL and parameters.
   */
  translateReplace(collectionName, key, newData, options = {}) {
    logger.debug(`[AQL_TRANSLATE] Translating REPLACE for collection: ${collectionName}, key: ${key}`);
    const params = { key, newData };
    let sql = `UPDATE ${collectionName} CONTENT :newData WHERE _key = :key`;

    if (options.returnNew) {
      sql += ' RETURN AFTER';
    } else if (options.returnOld) {
      sql += ' RETURN BEFORE';
    }

    logger.debug(`[AQL_TRANSLATE] Translated REPLACE SQL: ${sql}`);
    return { sql, params };
  }

  /**
   * Translates a document removal operation.
   * @param {string} collectionName The name of the collection.
   * @param {string} key The _key of the document to remove.
   * @param {object} options Arangojs options like returnOld.
   * @returns {{sql: string, params: object}} The translated SQL and parameters.
   */
  translateRemove(collectionName, key, options = {}) {
    logger.debug(`[AQL_TRANSLATE] Translating REMOVE for collection: ${collectionName}, key: ${key}`);
    const params = { key };
    let sql = `DELETE FROM ${collectionName} WHERE _key = :key`;

    if (options.returnOld) {
      sql += ' RETURN BEFORE';
    }

    logger.debug(`[AQL_TRANSLATE] Translated REMOVE SQL: ${sql}`);
    return { sql, params };
  }
}

module.exports = { AqlToSqlTranslator };
