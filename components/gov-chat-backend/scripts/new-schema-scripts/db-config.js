const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../../.env') });

/**
 * Resolves the ArangoDB URL. If running on host but URL points to docker service, 
 * it falls back to 127.0.0.1.
 */
function resolveArangoUrl(url) {
  const targetUrl = url || "http://127.0.0.1:8529";
  if (targetUrl.includes('arango-vector-db')) {
    return targetUrl.replace('arango-vector-db', '127.0.0.1');
  }
  return targetUrl;
}

/**
 * Standardized database configuration loader.
 */
function getDbConfig() {
  return {
    url: resolveArangoUrl(process.env.ARANGO_URL),
    database: process.env.ARANGO_DATABASE || process.env.ARANGO_DB_NAME || "node-services",
    auth: {
      username: process.env.ARANGO_USER || process.env.ARANGO_USERNAME || "root",
      password: process.env.ARANGO_PASSWORD || "your-database-password"
    }
  };
}

module.exports = {
  getDbConfig,
  resolveArangoUrl
};
