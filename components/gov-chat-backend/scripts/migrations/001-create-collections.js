'use strict';

/**
 * 001-create-collections.js
 *
 * Creates all ArangoDB collections used by GENIE.AI services.
 * Idempotent — safe to run multiple times.
 */

module.exports = {
  async up(db) {
    const collections = [
      // Auth & user management
      { name: 'users', type: 2 },
      { name: 'sessions', type: 2 },
      { name: 'sessionQueries', type: 2 },
      { name: 'userSessions', type: 3 },

      // Chat & conversations
      { name: 'conversations', type: 2 },
      { name: 'messages', type: 2 },
      { name: 'userConversations', type: 3 },
      { name: 'conversationCategories', type: 3 },
      { name: 'queryMessages', type: 2 },
      { name: 'conversationFiles', type: 2 },

      // Knowledge & categories
      { name: 'queries', type: 2 },
      { name: 'serviceCategories', type: 2 },
      { name: 'services', type: 2 },
      { name: 'queryCategories', type: 3 },
      { name: 'categoryServices', type: 3 },
      { name: 'serviceCategoryTranslations', type: 2 },
      { name: 'serviceTranslations', type: 2 },

      // Folders
      { name: 'folders', type: 2 },
      { name: 'userFolders', type: 3 },
      { name: 'folderConversations', type: 3 },

      // Analytics
      { name: 'analytics', type: 2 },
      { name: 'events', type: 2 },

      // Document ingestion
      { name: 'ingestion_log', type: 2 },

      // Translation edges (link categories/services to their translations)
      { name: 'serviceCategoryTranslationsEdge', type: 3 },
      { name: 'serviceTranslationsEdge', type: 3 },

      // Weather
      { name: 'weatherRequests', type: 2 },
    ];

    for (const col of collections) {
      try {
        const exists = await db.collection(col.name).exists();
        if (!exists) {
          await db.createCollection(col.name, { type: col.type });
          console.log(`  Created collection: ${col.name} (${col.type === 3 ? 'edge' : 'document'})`);
        } else {
          console.log(`  Collection already exists: ${col.name}`);
        }
      } catch (err) {
        console.error(`  Error creating collection ${col.name}: ${err.message}`);
        throw err;
      }
    }
  }
};
