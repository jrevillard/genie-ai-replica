require('dotenv').config();
const { aql } = require('arangojs');
const { logger, dbService } = require('../shared-lib');
const { NotFoundError, ForbiddenError } = require('../middleware/errors');

//const initDB = dbService.getConnection();

class ChatHistoryService {
  constructor() {
    if (ChatHistoryService.instance) {
      return ChatHistoryService.instance;
    }
    this.dbService = dbService; // Store the service reference instead of the promise
    this.analyticsService = null; // Will be set via dependency injection
    this.initialized = false;
    logger.info('ChatHistoryService constructor called');
    ChatHistoryService.instance = this;
    return this;
  }

  static getInstance() {
    if (!ChatHistoryService.instance) {
      ChatHistoryService.instance = new ChatHistoryService();
    }
    return ChatHistoryService.instance;
  }

  async init() {
    if (this.initialized) {
      logger.debug('ChatHistoryService already initialized, skipping');
      return;
    }
    try {
      this.db = await this.dbService.getConnection();

      this.conversations = this.db.collection('conversations');
      this.messages = this.db.collection('messages');
      this.userConversations = this.db.collection('userConversations');
      this.conversationCategories = this.db.collection('conversationCategories');
      this.queryMessages = this.db.collection('queryMessages');
      this.conversationFiles = this.db.collection('conversationFiles');
      this.folders = this.db.collection('folders');
      this.userFolders = this.db.collection('userFolders');
      this.folderConversations = this.db.collection('folderConversations');

      this.initialized = true;
      logger.info('ChatHistoryService initialized successfully');
    } catch (error) {
      logger.error(`Error initializing ChatHistoryService: ${error.message}`, { stack: error.stack });
      throw error;
    }
  }

  /**
   * Set the analytics service
   * @param {Object} analyticsService - Analytics service instance
   */
  setAnalyticsService(analyticsService) {
    this.analyticsService = analyticsService;
    logger.info('Analytics service set for ChatHistoryService');
  }

  /**
   * Create a new conversation
   * @param {Object} conversationData - Conversation data
   * @returns {Promise<Object>} The created conversation
   */
  async createConversation(conversationData) {
    try {
      logger.info('Creating new conversation with data:', conversationData);

      // Ensure minimum required data
      if (!conversationData.userId) {
        logger.warn('Missing required user ID');
        throw new Error('User ID is required');
      }

      // Fetch category name if categoryId is provided
      let categoryName = '';
      if (conversationData.categoryId) {
        const categoryQuery = await this.db.query(aql`
          FOR cat IN serviceCategories
            FILTER cat._key == ${conversationData.categoryId}
            RETURN cat.nameEN
        `);
        categoryName = (await categoryQuery.next()) || '';
        logger.info(`Resolved categoryId ${conversationData.categoryId} to name: ${categoryName}`);
      }

      // Generate _key in a format similar to existing documents (numeric string)
      const timestamp = Date.now().toString();
      const randomSuffix = Math.floor(Math.random() * 10000)
        .toString()
        .padStart(4, '0');
      const generatedKey = `${timestamp}${randomSuffix}`; // e.g., "1747653190597"

      // Compute messageCount by counting existing messages for this conversation
      const messageCountQuery = await this.db.query(aql`
        FOR msg IN messages
          FILTER msg.conversationId == ${generatedKey}
          RETURN msg
      `);
      const messages = await messageCountQuery.all();
      const messageCount = messages.length;
      logger.info(`Computed messageCount for conversation ${generatedKey}: ${messageCount}`);

      // Prepare conversation document
      const conversationDoc = {
        _key: generatedKey,
        title: conversationData.title || 'New Conversation',
        lastMessage: conversationData.initialMessage || '',
        created: conversationData.created || new Date().toISOString(),
        updated: conversationData.updated || new Date().toISOString(),
        messageCount: messageCount, // Use computed value
        isStarred: Boolean(conversationData.isStarred) || false,
        isArchived: Boolean(conversationData.isArchived) || false,
        category: categoryName || '',
        tags: Array.isArray(conversationData.tags) ? conversationData.tags : []
      };

      logger.info('Document to save:', JSON.stringify(conversationDoc, null, 2));

      // Create conversation
      const conversation = await this.conversations.save(conversationDoc);
      logger.info(`Conversation created with key: ${conversation._key}`);

      // Link user to conversation
      await this.userConversations.save({
        _from: `users/${conversationData.userKey}`,
        _to: `conversations/${conversation._key}`,
        role: conversationData.role || 'owner',
        lastViewedAt: new Date().toISOString()
      });
      logger.info(`User ${conversationData.userId} linked to conversation ${conversation._key}`);

      // Link conversation to category if provided
      if (conversationData.categoryId) {
        await this.conversationCategories.save({
          _from: `conversations/${conversation._key}`,
          _to: `serviceCategories/${conversationData.categoryId}`,
          relevanceScore: conversationData.relevanceScore || 1.0
        });
        logger.info(`Conversation ${conversation._key} linked to category ${conversationData.categoryId}`);
      }

      return { ...conversation, ...conversationDoc };
    } catch (error) {
      logger.error('Error creating conversation:', error);
      throw error;
    }
  }

  /**
   * Add a message to a conversation
   * @param {Object} messageData - Message data
   * @returns {Promise<Object>} The created message
   */
  async addMessage(messageData) {
    try {
      logger.info(`Adding message to conversation ${messageData.conversationId}`);

      if (!messageData.conversationId || !messageData.content || !messageData.sender) {
        logger.warn('Missing required message data');
        throw new Error('conversationId, content, and sender are required');
      }

      // Get the latest sequence number for this conversation
      const sequenceCursor = await this.db.query(aql`
        FOR msg IN messages
          FILTER msg.conversationId == ${messageData.conversationId}
          SORT msg.sequence DESC
          LIMIT 1
          RETURN msg.sequence
      `);

      const latestSequence = (await sequenceCursor.next()) || 0;
      const newSequence = latestSequence + 1;

      // Prepare message document
      const messageDoc = {
        conversationId: messageData.conversationId,
        content: messageData.content,
        timestamp: messageData.timestamp || new Date().toISOString(),
        sender: messageData.sender,
        sequence: newSequence,
        readStatus: messageData.readStatus !== undefined ? messageData.readStatus : true,
        metadata: messageData.metadata || {}
      };

      const message = await this.messages.save(messageDoc);
      logger.info(`Message created with key: ${message._key}`);

      // ---------------------------------------------------------
      // NEW: Link Reference Documents (Document Collection Compatible)
      // ---------------------------------------------------------
      if (messageData.metadata && Array.isArray(messageData.metadata.source_documents)) {
        const docs = messageData.metadata.source_documents;

        // Clean the ID just in case
        const convKey = messageData.conversationId.includes('/')
          ? messageData.conversationId.split('/').pop()
          : messageData.conversationId;

        for (const doc of docs) {
          const rawId = doc.document_id || doc.id;
          if (rawId) {
            const fileId = rawId.includes('/') ? rawId : `files/${rawId}`;

            try {
              // FIX: Save as standard fields since this is a Document collection
              await this.conversationFiles.save({
                conversationId: convKey, // Standard field link
                fileId: fileId, // Standard field link
                messageId: message._key,

                // SNAPSHOT: Store display info directly to prevent "Unknown Document"
                documentName: doc.document_name || doc.title || 'Unknown Document',
                fileName: doc.file_name || doc.document_name || 'Unknown File',
                url: doc.url || null,

                labels: doc.serviceLabels || doc.labels || [],
                categoryLabel: doc.categoryLabel || '',
                confidenceScore: doc.score || 0,
                createdAt: new Date().toISOString()
              });
              logger.info(`[DEBUG] Saved file mapping: conversation ${convKey} -> file ${fileId}`);
            } catch (saveError) {
              logger.warn(`Failed to save conversationFile mapping for ${fileId}: ${saveError.message}`);
            }
          }
        }
        if (docs.length > 0) {
          logger.info(`Linked ${docs.length} reference documents to conversation ${messageData.conversationId}`);
        }
      }
      // ---------------------------------------------------------

      // Link to originating query if provided
      if (messageData.queryId) {
        const edgeDoc = {
          _from: `queries/${messageData.queryId}`,
          _to: `messages/${message._key}`,
          responseType: messageData.responseType || 'primary',
          createdAt: new Date().toISOString().split('.')[0] + 'Z'
        };

        if (messageData.confidenceScore !== undefined) edgeDoc.confidenceScore = Number(messageData.confidenceScore);
        if (messageData.userId) edgeDoc.userId = messageData.userId;

        try {
          await this.queryMessages.save(edgeDoc);
        } catch (error) {
          logger.error(`Failed to create queryMessages edge:`, error);
          throw error;
        }
      }

      // Update conversation stats
      const snippet =
        messageData.content.length > 100 ? `${messageData.content.substring(0, 97)}...` : messageData.content;

      const updateStatsQuery = aql`
        FOR doc IN conversations
          FILTER doc._key == ${messageData.conversationId}
          UPDATE doc WITH {
            messageCount: doc.messageCount + 1,
            lastMessage: ${snippet},
            updated: ${new Date().toISOString()}
          } IN conversations
      `;

      this.db.query(updateStatsQuery).catch((err) => logger.warn(`Background stats update failed: ${err.message}`));

      return { ...message, ...messageDoc };
    } catch (error) {
      logger.error(`Error adding message to conversation ${messageData.conversationId}:`, error);
      throw error;
    }
  }

  /**
   * Get a conversation by ID
   * @param {String} conversationId - Conversation ID
   * @returns {Promise<Object>} Conversation details with messages
   */
  async getConversation(conversationId) {
    try {
      logger.info(`Getting conversation with ID: ${conversationId}`);

      const convKey = conversationId.includes('/') ? conversationId.split('/').pop() : conversationId;
      const conversationIdFull = `conversations/${convKey}`;

      // Get conversation main document
      const conversation = await this.conversations.document(convKey);

      // OPTIMIZATION: Run independent queries in PARALLEL
      const [messages, categories, owners, files] = await Promise.all([
        // 1. Get Messages
        this.db
          .query(
            aql`
          FOR msg IN messages
            FILTER msg.conversationId == ${convKey}
            SORT msg.sequence ASC
            LET queryLink = (
              FOR edge IN queryMessages
                FILTER edge._to == CONCAT('messages/', msg._key)
                FOR q IN queries
                  FILTER q._id == edge._from
                  RETURN q._key
            )[0]
            RETURN MERGE(msg, { queryId: queryLink })
        `
          )
          .then((cursor) => cursor.all()),

        // 2. Get Categories
        this.db
          .query(
            aql`
          FOR edge IN conversationCategories
            FILTER edge._from == ${conversationIdFull}
            FOR cat IN serviceCategories
              FILTER cat._id == edge._to
              RETURN {
                _id: cat._id,
                _key: cat._key,
                nameEN: cat.nameEN,
                nameFR: cat.nameFR,
                nameSW: cat.nameSW,
                relevanceScore: edge.relevanceScore
              }
        `
          )
          .then((cursor) => cursor.all()),

        // 3. Get Owners
        this.db
          .query(
            aql`
          FOR edge IN userConversations
            FILTER edge._to == ${conversationIdFull}
            FOR user IN users
              FILTER user._id == edge._from
              RETURN {
                _id: user._id,
                _key: user._key,
                role: edge.role,
                lastViewedAt: edge.lastViewedAt
              }
        `
          )
          .then((cursor) => cursor.all()),

        // 4. NEW: Get Linked Files (Standard Document Query with Schema Fix)
        this.db
          .query(
            aql`
          FOR doc IN conversationFiles
            FILTER doc.conversationId == ${convKey}
            SORT doc.createdAt DESC
            
            // Safe lookup of the file document
            LET fileDoc = DOCUMENT(doc.fileId) || {}
            
            RETURN {
              id: PARSE_IDENTIFIER(doc.fileId).key, 
              labels: doc.labels,
              categoryLabel: doc.categoryLabel,
              score: doc.confidenceScore,
              createdAt: doc.createdAt,
              
              // SCHEMA FIX: Map 'file_name' from files collection to 'documentName' for UI
              // Priority: 1. Snapshot name, 2. file_name (DB schema), 3. name (fallback), 4. default
              documentName: doc.documentName || fileDoc.file_name || fileDoc.name || "Unknown Document",
              fileName: doc.fileName || fileDoc.file_name || fileDoc.name || "Unknown File",
              
              // SCHEMA FIX: Map 'source_url' from files collection
              url: doc.url || fileDoc.source_url || fileDoc.url || null
            }
        `
          )
          .then((cursor) => cursor.all())
      ]);

      logger.info(`Found ${messages.length} messages and ${files.length} files for conversation ${conversationId}`);

      return {
        ...conversation,
        messages,
        categories,
        owners,
        files
      };
    } catch (error) {
      logger.error(`Error getting conversation ${conversationId}:`, error);
      throw error;
    }
  }

  /**
   * Get all conversations for a user
   * @param {String} userId - User ID
   * @param {Object} options - Query options (limit, offset, filters)
   * @returns {Promise<Object>} Conversations with pagination
   */
  async getUserConversations(userId, options = {}) {
    try {
      logger.info(`Getting conversations for user ${userId}`);

      // Use userKey for edge operations (ArangoDB document key)
      const userKey = options.userKey;
      const userIdWithPrefix = `users/${userKey}`;
      logger.info(`Using complete user path: ${userIdWithPrefix}`);

      // Parse options
      const limit = options.limit || 20;
      const offset = options.offset || 0;
      const includeArchived = options.includeArchived || false;
      const filterStarred = options.filterStarred || false;
      const searchTerm = options.searchTerm || '';

      // Build query with conditional search filter — cannot use ternary with aql
      // templates because a falsy '' value becomes a bind var that breaks AQL syntax
      let query;
      if (searchTerm) {
        query = aql`
          FOR edge IN userConversations
            FILTER edge._from == ${userIdWithPrefix}
            LET conversation = DOCUMENT(edge._to)
            FILTER ${includeArchived} ? true : conversation.isArchived == false
            FILTER ${filterStarred} ? conversation.isStarred == true : true
            FILTER (
              LIKE(LOWER(conversation.title), CONCAT("%", LOWER(${searchTerm}), "%")) OR
              LIKE(LOWER(conversation.lastMessage), CONCAT("%", LOWER(${searchTerm}), "%")) OR
              LIKE(LOWER(conversation.category), CONCAT("%", LOWER(${searchTerm}), "%"))
            )
            SORT conversation.updated DESC
            LIMIT ${offset}, ${limit}
            LET messagePreview = (
              FOR msg IN messages
                FILTER msg.conversationId == PARSE_IDENTIFIER(conversation._id).key
                SORT msg.sequence DESC
                LIMIT 1
                RETURN msg
            )[0]
            RETURN {
              _id: conversation._id,
              _key: conversation._key,
              title: conversation.title,
              lastMessage: conversation.lastMessage,
              created: conversation.created,
              updated: conversation.updated,
              messageCount: conversation.messageCount,
              isStarred: conversation.isStarred,
              isArchived: conversation.isArchived,
              category: conversation.category,
              tags: conversation.tags,
              userRole: edge.role,
              lastViewedAt: edge.lastViewedAt,
              lastMessagePreview: messagePreview
            }
        `;
      } else {
        query = aql`
          FOR edge IN userConversations
            FILTER edge._from == ${userIdWithPrefix}
            LET conversation = DOCUMENT(edge._to)
            FILTER ${includeArchived} ? true : conversation.isArchived == false
            FILTER ${filterStarred} ? conversation.isStarred == true : true
            SORT conversation.updated DESC
            LIMIT ${offset}, ${limit}
            LET messagePreview = (
              FOR msg IN messages
                FILTER msg.conversationId == PARSE_IDENTIFIER(conversation._id).key
                SORT msg.sequence DESC
                LIMIT 1
                RETURN msg
            )[0]
            RETURN {
              _id: conversation._id,
              _key: conversation._key,
              title: conversation.title,
              lastMessage: conversation.lastMessage,
              created: conversation.created,
              updated: conversation.updated,
              messageCount: conversation.messageCount,
              isStarred: conversation.isStarred,
              isArchived: conversation.isArchived,
              category: conversation.category,
              tags: conversation.tags,
              userRole: edge.role,
              lastViewedAt: edge.lastViewedAt,
              lastMessagePreview: messagePreview
            }
        `;
      }

      // Log and execute the query
      logger.info(`Executing simplified query for user path: ${userIdWithPrefix}`);
      const cursor = await this.db.query(query);
      const conversations = await cursor.all();
      logger.info(`Found ${conversations.length} conversations for user ${userIdWithPrefix}`);

      // Simplified count query (same conditional approach)
      let countQuery;
      if (searchTerm) {
        countQuery = aql`
          RETURN LENGTH(
            FOR edge IN userConversations
              FILTER edge._from == ${userIdWithPrefix}
              LET conversation = DOCUMENT(edge._to)
              FILTER ${includeArchived} ? true : conversation.isArchived == false
              FILTER ${filterStarred} ? conversation.isStarred == true : true
              FILTER (
                LIKE(LOWER(conversation.title), CONCAT("%", LOWER(${searchTerm}), "%")) OR
                LIKE(LOWER(conversation.lastMessage), CONCAT("%", LOWER(${searchTerm}), "%")) OR
                LIKE(LOWER(conversation.category), CONCAT("%", LOWER(${searchTerm}), "%"))
              )
              RETURN 1
          )
        `;
      } else {
        countQuery = aql`
          RETURN LENGTH(
            FOR edge IN userConversations
              FILTER edge._from == ${userIdWithPrefix}
              LET conversation = DOCUMENT(edge._to)
              FILTER ${includeArchived} ? true : conversation.isArchived == false
              FILTER ${filterStarred} ? conversation.isStarred == true : true
              RETURN 1
          )
        `;
      }

      const countCursor = await this.db.query(countQuery);
      const totalCount = (await countCursor.next()) || 0;

      return {
        conversations,
        pagination: {
          total: totalCount,
          limit,
          offset,
          pages: Math.ceil(totalCount / limit),
          currentPage: Math.floor(offset / limit) + 1
        }
      };
    } catch (error) {
      logger.error(`Error getting conversations for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Update the response time of a query
   * @param {String} queryId - The ID of the query to update
   * @param {Number} responseTime - The response time in milliseconds
   * @returns {Promise<Object>} The updated query document
   */
  async updateQueryResponseTime(queryId, responseTime) {
    try {
      logger.info(`Updating response time for query ${queryId} to ${responseTime}ms`);

      if (!queryId || (!responseTime && responseTime !== 0)) {
        throw new Error('queryId and responseTime are required');
      }

      const updatedQuery = await this.db.collection('queries').update(
        queryId,
        {
          responseTime: Number(responseTime),
          updatedAt: new Date().toISOString()
        },
        { returnNew: true }
      );

      logger.info(`Successfully updated response time for query ${queryId}`);
      return updatedQuery.new;
    } catch (error) {
      logger.error(`Error updating response time for query ${queryId}:`, error);
      throw error;
    }
  }

  /**
   * Get conversation messages
   * @param {String} conversationId - Conversation ID
   * @param {Object} options - Query options (limit, offset)
   * @returns {Promise<Object>} Messages with pagination
   */
  async getConversationMessages(conversationId, options = {}) {
    try {
      logger.info(`Getting messages for conversation ${conversationId}`);

      const limit = options.limit || 50;
      const offset = options.offset || 0;

      // SORT direction must be a literal — ArangoDB does not accept bind vars in SORT
      let messageQuery;
      if (options.newestFirst) {
        messageQuery = aql`
          FOR msg IN messages
            FILTER msg.conversationId == ${conversationId}
            SORT msg.sequence DESC
            LIMIT ${offset}, ${limit}
            LET queryInfo = (
              FOR edge IN queryMessages
                FILTER edge._to == CONCAT('messages/', msg._key)
                FOR q IN queries
                  FILTER q._id == edge._from
                  RETURN {
                    _id: q._id,
                    _key: q._key,
                    text: q.text,
                    responseType: edge.responseType,
                    confidenceScore: edge.confidenceScore
                  }
            )[0]
            RETURN MERGE(msg, { queryInfo: queryInfo })
        `;
      } else {
        messageQuery = aql`
          FOR msg IN messages
            FILTER msg.conversationId == ${conversationId}
            SORT msg.sequence ASC
            LIMIT ${offset}, ${limit}
            LET queryInfo = (
              FOR edge IN queryMessages
                FILTER edge._to == CONCAT('messages/', msg._key)
                FOR q IN queries
                  FILTER q._id == edge._from
                  RETURN {
                    _id: q._id,
                    _key: q._key,
                    text: q.text,
                    responseType: edge.responseType,
                    confidenceScore: edge.confidenceScore
                  }
            )[0]
            RETURN MERGE(msg, { queryInfo: queryInfo })
        `;
      }

      const messageCursor = await this.db.query(messageQuery);
      const messages = await messageCursor.all();

      // Count total messages
      const countQuery = aql`
        FOR msg IN messages
          FILTER msg.conversationId == ${conversationId}
          COLLECT WITH COUNT INTO total
          RETURN total
      `;

      const countCursor = await this.db.query(countQuery);
      const totalCount = (await countCursor.next()) || 0;

      logger.info(`Found ${messages.length} messages for conversation ${conversationId}`);

      return {
        messages,
        pagination: {
          total: totalCount,
          limit,
          offset,
          pages: Math.ceil(totalCount / limit),
          currentPage: Math.floor(offset / limit) + 1
        }
      };
    } catch (error) {
      logger.error(`Error getting messages for conversation ${conversationId}:`, error);
      throw error;
    }
  }

  /**
   * Update conversation properties
   * @param {String} conversationId - Conversation ID
   * @param {Object} updateData - Properties to update
   * @returns {Promise<Object>} Updated conversation
   */
  async updateConversation(conversationId, updateData) {
    try {
      logger.info(`Updating conversation ${conversationId} with data:`, updateData);

      const allowedFields = ['title', 'isStarred', 'isArchived', 'tags', 'category'];

      // Filter out non-allowed fields
      const filteredData = {};
      for (const field of allowedFields) {
        if (updateData[field] !== undefined) {
          filteredData[field] = updateData[field];
        }
      }

      // Always update the 'updated' timestamp
      filteredData.updated = new Date().toISOString();

      if (Object.keys(filteredData).length === 0) {
        logger.warn('No valid fields to update');
        throw new Error('No valid fields to update');
      }

      // Update the conversation
      const updatedConv = await this.conversations.update(conversationId, filteredData, { returnNew: true });
      logger.info(`Conversation ${conversationId} updated successfully`);

      // If category changed and categoryId is provided, update the relationship
      if (updateData.categoryId) {
        // First, remove any existing category relationships
        await this.db.query(aql`
          FOR edge IN conversationCategories
            FILTER edge._from == ${'conversations/' + conversationId}
            REMOVE edge IN conversationCategories
        `);

        // Then create new relationship
        await this.conversationCategories.save({
          _from: `conversations/${conversationId}`,
          _to: `serviceCategories/${updateData.categoryId}`,
          relevanceScore: updateData.relevanceScore || 1.0
        });

        logger.info(`Conversation ${conversationId} category updated to ${updateData.categoryId}`);
      }

      return updatedConv.new;
    } catch (error) {
      logger.error(`Error updating conversation ${conversationId}:`, error);
      throw error;
    }
  }

  /**
   * Mark messages as read
   * @param {String} conversationId - Conversation ID
   * @param {Array<String>} messageIds - Optional array of message IDs to mark (if empty, mark all)
   * @returns {Promise<Object>} Result with count of updated messages
   */
  async markMessagesAsRead(conversationId, messageIds = []) {
    try {
      logger.info(`Marking messages as read for conversation ${conversationId}`);

      let result;

      // If specific message IDs are provided
      if (messageIds && messageIds.length > 0) {
        logger.info(`Marking ${messageIds.length} specific messages as read`);

        // Update only the specified messages
        const updateQuery = aql`
          FOR msgId IN ${messageIds}
            UPDATE { _key: msgId, readStatus: true } IN messages
            FILTER OLD.conversationId == ${conversationId} AND OLD.readStatus == false
            RETURN NEW
        `;

        const updateCursor = await this.db.query(updateQuery);
        const updatedMessages = await updateCursor.all();
        result = { count: updatedMessages.length, ids: updatedMessages.map((msg) => msg._key) };
      } else {
        // Update all unread messages in the conversation
        logger.info(`Marking all unread messages as read in conversation ${conversationId}`);

        const updateQuery = aql`
          FOR msg IN messages
            FILTER msg.conversationId == ${conversationId} AND msg.readStatus == false
            UPDATE msg WITH { readStatus: true } IN messages
            RETURN NEW
        `;

        const updateCursor = await this.db.query(updateQuery);
        const updatedMessages = await updateCursor.all();
        result = { count: updatedMessages.length, ids: updatedMessages.map((msg) => msg._key) };
      }

      // OPTIMIZATION: Fire and Forget Timestamp Update
      // We do not await this. It happens in background to speed up response.
      if (result.count > 0) {
        this.getConversationOwnerId(conversationId)
          .then((ownerKey) => {
            if (ownerKey) {
              const currentTime = new Date().toISOString();
              const updateViewedQuery = aql`
              FOR edge IN userConversations
                FILTER edge._from == ${'users/' + ownerKey} AND edge._to == ${'conversations/' + conversationId}
                UPDATE edge WITH { lastViewedAt: ${currentTime} } IN userConversations
            `;
              return this.db.query(updateViewedQuery);
            }
          })
          .then(() => {
            logger.info(`Updated lastViewedAt for conversation ${conversationId} (background)`);
          })
          .catch((err) => {
            logger.warn(`Background Task Failed: Could not update lastViewedAt for ${conversationId}: ${err.message}`);
          });
      }

      logger.info(`Marked ${result.count} messages as read in conversation ${conversationId}`);
      return result;
    } catch (error) {
      logger.error(`Error marking messages as read in conversation ${conversationId}:`, error);
      throw error;
    }
  }

  /**
   * Get the owner ID of a conversation
   * @param {String} conversationId - Conversation ID
   * @returns {Promise<String|null>} User ID or null if not found
   * @private
   */
  async getConversationOwnerId(conversationId) {
    try {
      const cursor = await this.db.query(aql`
        FOR edge IN userConversations
          FILTER edge._to == ${'conversations/' + conversationId} AND edge.role == 'owner'
          RETURN SUBSTRING(edge._from, 6)
      `);

      return (await cursor.next()) || null;
    } catch (error) {
      logger.error(`Error getting owner ID for conversation ${conversationId}:`, error);
      return null;
    }
  }

  /**
   * Delete a conversation and all related messages
   * @param {String} conversationId - Conversation ID
   * @param {String} userId - User ID requesting the deletion (for validation)
   * @returns {Promise<Object>} Result with deleted counts
   */
  async deleteConversation(conversationId, userId, userKey) {
    try {
      logger.info(`Deleting conversation ${conversationId} for user ${userId}`);

      const convKey = conversationId.includes('/') ? conversationId.split('/').pop() : conversationId;
      const conversationIdFull = `conversations/${convKey}`;

      // Verify permission
      const permissionQuery = aql`
        FOR edge IN userConversations
          FILTER edge._to == ${conversationIdFull} AND edge._from == ${'users/' + userKey}
          RETURN edge
      `;
      const permissionCursor = await this.db.query(permissionQuery);
      const permission = await permissionCursor.next();

      if (!permission) {
        throw new ForbiddenError('You do not have permission to delete this conversation');
      }

      // Get messages
      const messageQuery = aql`
        FOR msg IN messages
          FILTER msg.conversationId == ${convKey}
          RETURN msg._id
      `;
      const messageCursor = await this.db.query(messageQuery);
      const messageIds = await messageCursor.all();

      const trx = await this.db.beginTransaction({
        write: [
          'messages',
          'queryMessages',
          'userConversations',
          'conversationCategories',
          'conversations',
          'conversationFiles'
        ]
      });

      try {
        // Delete message-query edges
        for (const messageId of messageIds) {
          await trx.step(() => {
            const deleteEdgeQuery = aql`
              FOR edge IN queryMessages
                FILTER edge._to == ${messageId}
                REMOVE edge IN queryMessages
            `;
            return this.db.query(deleteEdgeQuery);
          });
        }

        // Delete messages
        const deleteMessageQuery = aql`
          FOR msg IN messages
            FILTER msg.conversationId == ${convKey}
            REMOVE msg IN messages
            RETURN OLD
        `;
        const deleteMessageResult = await trx.step(() => this.db.query(deleteMessageQuery));
        const messagesDeleted = await deleteMessageResult.all();

        // Delete user links
        const deleteUserEdgeQuery = aql`
          FOR edge IN userConversations
            FILTER edge._to == ${conversationIdFull}
            REMOVE edge IN userConversations
        `;
        await trx.step(() => this.db.query(deleteUserEdgeQuery));

        // Delete category links
        const deleteCategoryEdgeQuery = aql`
          FOR edge IN conversationCategories
            FILTER edge._from == ${conversationIdFull}
            REMOVE edge IN conversationCategories
        `;
        await trx.step(() => this.db.query(deleteCategoryEdgeQuery));

        // NEW: Delete file mappings (Standard Document Delete)
        // Note: Using 'doc.conversationId' instead of '_from'
        const deleteFileDocQuery = aql`
          FOR doc IN conversationFiles
            FILTER doc.conversationId == ${convKey}
            REMOVE doc IN conversationFiles
        `;
        await trx.step(() => this.db.query(deleteFileDocQuery));

        // Delete conversation
        await trx.step(() => this.conversations.remove(convKey));

        await trx.commit();
        return { conversationId, messagesDeleted: messagesDeleted.length, success: true };
      } catch (error) {
        await trx.abort();
        throw error;
      }
    } catch (error) {
      logger.error(`Error deleting conversation ${conversationId}:`, error);
      throw error;
    }
  }

  /**
   * Find messages related to a specific query
   * @param {String} queryId - Query ID
   * @returns {Promise<Array>} Related messages with conversation info
   */
  async findMessagesForQuery(queryId) {
    try {
      logger.info(`Finding messages related to query ${queryId}`);

      const query = aql`
        FOR edge IN queryMessages
          FILTER edge._from == ${'queries/' + queryId}

          FOR msg IN messages
            FILTER msg._id == edge._to

            LET conversation = (
              FOR conv IN conversations
                FILTER conv._key == msg.conversationId
                RETURN conv
            )[0]

            RETURN {
              message: msg,
              conversation: conversation,
              relationship: {
                responseType: edge.responseType,
                confidenceScore: edge.confidenceScore,
                createdAt: edge.createdAt
              }
            }
      `;

      const cursor = await this.db.query(query);
      const relatedMessages = await cursor.all();
      logger.info(`Found ${relatedMessages.length} messages related to query ${queryId}`);

      return relatedMessages;
    } catch (error) {
      logger.error(`Error finding messages for query ${queryId}:`, error);
      throw error;
    }
  }

  /**
   * Find the originating query for a message
   * @param {String} messageId - Message ID
   * @returns {Promise<Object|null>} Query information or null if not found
   */
  async findOriginatingQuery(messageId) {
    try {
      logger.info(`Finding originating query for message ${messageId}`);

      const cursor = await this.db.query(aql`
        FOR edge IN queryMessages
          FILTER edge._to == ${'messages/' + messageId}
          
          FOR q IN queries
            FILTER q._id == edge._from
            
            RETURN {
              query: q,
              relationship: {
                responseType: edge.responseType,
                confidenceScore: edge.confidenceScore,
                createdAt: edge.createdAt
              }
            }
      `);

      const result = await cursor.next();

      if (result) {
        logger.info(`Found originating query ${result.query._key} for message ${messageId}`);
      } else {
        logger.info(`No originating query found for message ${messageId}`);
      }

      return result || null;
    } catch (error) {
      logger.error(`Error finding originating query for message ${messageId}:`, error);
      return null;
    }
  }

  /**
   * Link a query to a conversation
   * @param {String} queryId - Query ID
   * @param {String} conversationId - Conversation ID
   * @param {String} messageId - Message ID responding to the query
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} Created relationship
   */
  async linkQueryToConversation(queryId, conversationId, messageId, options = {}) {
    try {
      logger.info(`Linking query ${queryId} to conversation ${conversationId} via message ${messageId}`);

      // Ensure all IDs exist
      const query = await this.db.collection('queries').document(queryId);
      await this.conversations.document(conversationId);
      const message = await this.messages.document(messageId);

      // Check if message belongs to conversation
      if (message.conversationId !== conversationId) {
        logger.warn(`Message ${messageId} does not belong to conversation ${conversationId}`);
        throw new Error('Message does not belong to the specified conversation');
      }

      // Check if the link already exists
      const existingCursor = await this.db.query(aql`
        FOR edge IN queryMessages
          FILTER edge._from == ${'queries/' + queryId} AND edge._to == ${'messages/' + messageId}
          RETURN edge
      `);

      const existingLink = await existingCursor.next();

      if (existingLink) {
        logger.info(`Link between query ${queryId} and message ${messageId} already exists`);
        return existingLink;
      }

      // Create the edge
      const edge = await this.queryMessages.save({
        _from: `queries/${queryId}`,
        _to: `messages/${messageId}`,
        responseType: options.responseType || 'primary',
        confidenceScore: options.confidenceScore || 1.0,
        createdAt: new Date().toISOString()
      });

      logger.info(`Created link between query ${queryId} and message ${messageId}`);

      // If there's a category on the query, update the conversation category
      if (query.categoryId) {
        // Check if conversation already has this category
        const categoryExistsCursor = await this.db.query(aql`
          FOR edge IN conversationCategories
            FILTER edge._from == ${'conversations/' + conversationId} AND edge._to == ${'serviceCategories/' + query.categoryId}
            RETURN edge
        `);

        const categoryExists = await categoryExistsCursor.next();

        if (!categoryExists) {
          // Get category name for the conversation category field
          const categoryCursor = await this.db.query(aql`
            FOR cat IN serviceCategories
              FILTER cat._key == ${query.categoryId}
              RETURN cat.nameEN
          `);

          const categoryName = await categoryCursor.next();

          // Update the conversation with the category name
          if (categoryName) {
            await this.conversations.update(conversationId, {
              category: categoryName
            });
          }

          // Create the category relationship
          await this.conversationCategories.save({
            _from: `conversations/${conversationId}`,
            _to: `serviceCategories/${query.categoryId}`,
            relevanceScore: 1.0
          });

          logger.info(`Updated conversation ${conversationId} with category from query: ${query.categoryId}`);
        }
      }

      return edge;
    } catch (error) {
      logger.error(`Error linking query ${queryId} to conversation ${conversationId}:`, error);
      throw error;
    }
  }

  /**
   * Search for conversations by text
   * @param {String} userId - User ID
   * @param {String} searchTerm - Text to search for
   * @param {Object} options - Search options
   * @returns {Promise<Array>} Matching conversations
   */
  async searchConversations(userId, searchTerm, options = {}) {
    try {
      logger.info(`Searching conversations for user ${userId} with term: "${searchTerm}"`);

      const limit = options.limit || 20;
      const offset = options.offset || 0;
      const includeArchived = options.includeArchived || false;
      const userKey = options.userKey;

      const query = aql`
        FOR edge IN userConversations
          FILTER edge._from == ${'users/' + userKey}

          FOR conv IN conversations
            FILTER conv._id == edge._to
            FILTER ${includeArchived} OR conv.isArchived == false

            FILTER (
              LIKE(LOWER(conv.title), CONCAT("%", LOWER(${searchTerm}), "%")) OR
              LIKE(LOWER(conv.lastMessage), CONCAT("%", LOWER(${searchTerm}), "%")) OR
              LIKE(LOWER(conv.category), CONCAT("%", LOWER(${searchTerm}), "%")) OR
              ${searchTerm} IN conv.tags
            )

            // Also search in messages content
            LET matchingMessages = (
              FOR msg IN messages
                FILTER msg.conversationId == conv._key
                FILTER LIKE(LOWER(msg.content), CONCAT("%", LOWER(${searchTerm}), "%"))
                SORT msg.timestamp DESC
                LIMIT 3
                RETURN msg
            )

            SORT LENGTH(matchingMessages) > 0 ? 1 : 0 DESC, // Prioritize conversations with matching messages
                 conv.updated DESC

            LIMIT ${offset}, ${limit}

            RETURN {
              conversation: conv,
              matchingMessages: matchingMessages,
              role: edge.role
            }
      `;

      const cursor = await this.db.query(query);
      const results = await cursor.all();

      logger.info(`Found ${results.length} conversations matching term "${searchTerm}" for user ${userId}`);

      return results;
    } catch (error) {
      logger.error(`Error searching conversations for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Get conversation statistics for a user
   * @param {String} userId - User ID
   * @returns {Promise<Object>} Conversation statistics
   */
  async getUserConversationStats(userId, userKey) {
    try {
      logger.info(`Getting conversation statistics for user ${userId}`);

      const query = aql`
        LET userConvs = (
          FOR edge IN userConversations
            FILTER edge._from == ${'users/' + userKey}
            FOR conv IN conversations
              FILTER conv._id == edge._to
              RETURN conv
        )

        LET totalCount = LENGTH(userConvs)
        LET activeCount = LENGTH(FOR c IN userConvs FILTER c.isArchived == false RETURN c)
        LET archivedCount = LENGTH(FOR c IN userConvs FILTER c.isArchived == true RETURN c)
        LET starredCount = LENGTH(FOR c IN userConvs FILTER c.isStarred == true RETURN c)

        LET messageCount = (
          FOR conv IN userConvs
            FOR msg IN messages
              FILTER msg.conversationId == conv._key
              COLLECT WITH COUNT INTO count
              RETURN count
        )[0] OR 0

        LET categoryDistribution = (
          FOR conv IN userConvs
            COLLECT category = conv.category WITH COUNT INTO count
            FILTER category != null AND category != ""
            SORT count DESC
            RETURN {
              category: category,
              count: count
            }
        )

        LET timeDistribution = (
          FOR conv IN userConvs
            LET hour = DATE_HOUR(DATE_ISO8601(conv.created))
            COLLECT timeSlot = hour WITH COUNT INTO count
            SORT timeSlot ASC
            RETURN {
              hour: timeSlot,
              count: count
            }
        )

        RETURN {
          total: totalCount,
          active: activeCount,
          archived: archivedCount,
          starred: starredCount,
          messageCount: messageCount,
          avgMessagesPerConversation: totalCount > 0 ? messageCount / totalCount : 0,
          categoryDistribution: categoryDistribution,
          timeDistribution: timeDistribution,
          lastUpdated: DATE_ISO8601(DATE_NOW())
        }
      `;

      const cursor = await this.db.query(query);
      const stats = await cursor.next();
      logger.info(`Retrieved conversation statistics for user ${userId}`);

      return (
        stats || {
          total: 0,
          active: 0,
          archived: 0,
          starred: 0,
          messageCount: 0,
          avgMessagesPerConversation: 0,
          categoryDistribution: [],
          timeDistribution: [],
          lastUpdated: new Date().toISOString()
        }
      );
    } catch (error) {
      logger.error(`Error getting conversation statistics for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Create a conversation from a query
   * @param {String} queryId - Query ID
   * @param {String} userId - User ID
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} The created conversation and message
   */
  async createConversationFromQuery(queryId, userId, options = {}) {
    try {
      logger.info(`Creating conversation from query ${queryId} for user ${userId}`);

      // Get the query
      const query = await this.db.collection('queries').document(queryId);

      if (!query) {
        logger.warn(`Query ${queryId} not found`);
        throw new NotFoundError('Query not found');
      }

      // Extract conversationTitle from options or use the query text (truncated if needed)
      const conversationTitle =
        options.title || (query.text.length > 50 ? `${query.text.substring(0, 47)}...` : query.text);

      // Create conversation
      const conversationData = {
        userId: userId,
        userKey: options.userKey,
        title: conversationTitle,
        lastMessage: query.text,
        categoryId: query.categoryId,
        created: query.timestamp,
        updated: new Date().toISOString(),
        messageCount: 0,
        isStarred: false,
        isArchived: false,
        category: options.category || '',
        tags: options.tags || []
      };

      const conversation = await this.createConversation(conversationData);

      // Add the user query as the first message
      const userMessage = await this.addMessage({
        conversationId: conversation._key,
        content: query.text,
        timestamp: query.timestamp,
        sender: 'user',
        readStatus: true,
        userId: userId
      });

      // If there's a response in options, add it as the assistant's message
      if (options.responseText) {
        const assistantMessage = await this.addMessage({
          conversationId: conversation._key,
          content: options.responseText,
          timestamp: new Date().toISOString(),
          sender: 'assistant',
          readStatus: false,
          queryId: queryId,
          userId: userId,
          responseType: 'primary'
        });

        // Link query to the assistant's message
        await this.linkQueryToConversation(queryId, conversation._key, assistantMessage._key, {
          responseType: 'primary'
        });

        logger.info(`Created conversation ${conversation._key} from query ${queryId} with response`);

        return {
          conversation,
          userMessage,
          assistantMessage
        };
      } else {
        logger.info(`Created conversation ${conversation._key} from query ${queryId} without response`);

        return {
          conversation,
          userMessage
        };
      }
    } catch (error) {
      logger.error(`Error creating conversation from query ${queryId}:`, error);
      throw error;
    }
  }

  /**
   * Get recent conversations
   * @param {String} userId - User ID
   * @param {Number} limit - Maximum number of conversations to return
   * @returns {Promise<Array>} Recent conversations
   */
  async getRecentConversations(userId, limit = 5, userKey) {
    try {
      logger.info(`Getting ${limit} recent conversations for user ${userId}`);

      const cursor = await this.db.query(aql`
        FOR edge IN userConversations
          FILTER edge._from == ${'users/' + userKey}
          
          FOR conv IN conversations
            FILTER conv._id == edge._to
            FILTER conv.isArchived == false
            
            SORT conv.updated DESC
            LIMIT ${limit}
            
            LET lastMessage = (
              FOR msg IN messages
                FILTER msg.conversationId == conv._key
                SORT msg.sequence DESC
                LIMIT 1
                RETURN msg
            )[0]
            
            RETURN {
              _id: conv._id,
              _key: conv._key,
              title: conv.title,
              lastMessage: conv.lastMessage,
              updated: conv.updated,
              messageCount: conv.messageCount,
              isStarred: conv.isStarred,
              category: conv.category,
              lastMessageDetails: lastMessage
            }
      `);

      const conversations = await cursor.all();
      logger.info(`Found ${conversations.length} recent conversations for user ${userId}`);

      return conversations;
    } catch (error) {
      logger.error(`Error getting recent conversations for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Create a new folder
   * @param {Object} folderData - Folder data
   * @returns {Promise<Object>} The created folder
   */
  async createFolder(folderData) {
    try {
      logger.info('Creating new folder with data:', folderData);

      // Ensure minimum required data
      if (!folderData.userId) {
        logger.warn('Missing required user ID');
        throw new Error('User ID is required');
      }

      // Use userKey for edge operations (ArangoDB document key)
      const userKey = folderData.userKey;

      // Create a folder document following the schema exactly
      const folderDoc = {
        _key: Date.now().toString(),
        userId: folderData.userId,
        name: folderData.name || 'New Folder'
      };

      // Add order if provided
      if (folderData.order !== undefined) {
        folderDoc.order = Number(folderData.order);
      }

      // Create folder
      const folder = await this.db.collection('folders').save(folderDoc);
      logger.info(`Folder created with key: ${folder._key}`);

      // Link user to folder - use "users/" prefix for the edge
      const userFolderEdge = {
        _from: `users/${userKey}`,
        _to: `folders/${folder._key}`,
        role: folderData.role || 'owner',
        lastAccessedAt: new Date().toISOString()
      };

      await this.db.collection('userFolders').save(userFolderEdge);
      logger.info(`User ${folderData.userId} linked to folder ${folder._key}`);

      return { ...folder, ...folderDoc };
    } catch (error) {
      logger.error('Error creating folder:', error);
      throw error;
    }
  }

  /**
   * Get a folder by ID
   * @param {String} folderId - Folder ID
   * @returns {Promise<Object>} Folder details with conversations
   */
  async getFolder(folderId) {
    try {
      logger.info(`Getting folder with ID: ${folderId}`);

      // Get folder main document first
      const folder = await this.db.collection('folders').document(folderId);

      // OPTIMIZATION: Run independent queries in PARALLEL
      const [conversations, owners, childFolders] = await Promise.all([
        // 1. Get conversations
        this.db
          .query(
            aql`
          FOR edge IN folderConversations
            FILTER edge._from == ${'folders/' + folderId}
            FOR conv IN conversations
              FILTER conv._id == edge._to
              SORT conv.updated DESC
              RETURN conv
        `
          )
          .then((c) => c.all()),

        // 2. Get owners
        this.db
          .query(
            aql`
          FOR edge IN userFolders
            FILTER edge._to == ${'folders/' + folderId}
            FOR user IN users
              FILTER user._id == edge._from
              RETURN {
                _id: user._id,
                _key: user._key,
                iss_sub: user.iss_sub,
                role: edge.role,
                lastAccessedAt: edge.lastAccessedAt
              }
        `
          )
          .then((c) => c.all()),

        // 3. Get child folders
        this.db
          .query(
            aql`
          FOR folder IN folders
            FILTER folder.parentFolderId == ${folderId}
            SORT folder.order ASC, folder.created ASC
            RETURN folder
        `
          )
          .then((c) => c.all())
      ]);

      logger.info(`Found ${conversations.length} conversations for folder ${folderId}`);

      return {
        ...folder,
        conversations,
        owners,
        childFolders
      };
    } catch (error) {
      logger.error(`Error getting folder ${folderId}:`, error);
      throw error;
    }
  }

  /**
   * Get all folders for a user
   * @param {String} userId - User ID
   * @param {Object} options - Query options (includeArchived, etc.)
   * @returns {Promise<Array>} User's folders
   */
  async getUserFolders(userId, options = {}) {
    try {
      logger.info(`Getting folders for user ${userId}`);

      // Use userKey for edge operations (ArangoDB document key)
      const userKey = options.userKey;
      const userIdWithPrefix = `users/${userKey}`;

      // Log collection name and the key format being used
      logger.info(`DEBUG - Collection: userFolders | Searching with _from key: '${userIdWithPrefix}'`);

      // Parse options
      const includeArchived = options.includeArchived || false;
      const parentFolderId = options.parentFolderId || null;

      // Create the base query to check what's available
      const baseQuery = aql`
      FOR edge IN userFolders
        FILTER edge._from == ${userIdWithPrefix}
        LET folder = DOCUMENT(edge._to)
        RETURN {
          _id: folder._id,
          _key: folder._key,
          _from: edge._from,
          _to: edge._to,
          collection: "folders"
        }
      `;

      // Execute the base query to see what edge relationships exist
      logger.info(`DEBUG - Executing base query to check edges: ${baseQuery}`);
      const baseCursor = await this.db.query(baseQuery);
      const edges = await baseCursor.all();
      logger.info(`DEBUG - Found ${edges.length} edges in userFolders where _from='${userIdWithPrefix}'`);

      // Log details about each edge relationship
      if (edges.length > 0) {
        edges.forEach((edge, index) => {
          logger.info(`DEBUG - Edge ${index + 1} details: _from='${edge._from}', _to='${edge._to}'`);
        });

        // Now fetch the actual folder documents to check their properties
        const folderIds = edges.map((edge) => edge._to);
        const folderKeysQuery = aql`
        FOR folder IN folders
          FILTER folder._id IN ${folderIds}
          RETURN {
            _id: folder._id,
            _key: folder._key,
            name: folder.name,
            isArchived: folder.isArchived,
            parentFolderId: folder.parentFolderId,
            properties: ATTRIBUTES(folder)
          }
        `;

        logger.info(`DEBUG - Checking folder properties with query: ${folderKeysQuery}`);
        const folderCursor = await this.db.query(folderKeysQuery);
        const folders = await folderCursor.all();

        folders.forEach((folder, index) => {
          logger.info(`DEBUG - Folder ${index + 1} document details:`);
          logger.info(`  _id: ${folder._id}`);
          logger.info(`  _key: ${folder._key}`);
          logger.info(`  name: ${folder.name}`);
          logger.info(`  isArchived: ${folder.isArchived} (${typeof folder.isArchived})`);
          logger.info(`  parentFolderId: ${folder.parentFolderId} (${typeof folder.parentFolderId})`);
          logger.info(`  All properties: ${JSON.stringify(folder.properties)}`);
        });
      }

      // Create the actual query with filters and verbose debug information
      logger.info(
        `DEBUG - Using filters: includeArchived=${includeArchived}, parentFolderId=${parentFolderId || 'null'}`
      );

      const query = aql`
      FOR edge IN userFolders
        FILTER edge._from == ${userIdWithPrefix}

        LET folder = DOCUMENT(edge._to)

        // Debug information about each folder and filter conditions
        LET archiveCondition = ${includeArchived} ? true : (folder.isArchived == false || folder.isArchived == null)
        LET parentCondition = ${parentFolderId} != null ? folder.parentFolderId == ${parentFolderId} : (folder.parentFolderId == null || !HAS(folder, "parentFolderId"))

        // Filter based on conditions
        FILTER archiveCondition
        FILTER parentCondition

        // Count conversations in each folder
        LET conversationCount = LENGTH(
          FOR convEdge IN folderConversations
            FILTER convEdge._from == folder._id
            RETURN 1
        )

        // Get child folders count
        LET childFolderCount = LENGTH(
          FOR childFolder IN folders
            FILTER childFolder.parentFolderId == PARSE_IDENTIFIER(folder._id).key
            FILTER ${includeArchived} ? true : (childFolder.isArchived == false || childFolder.isArchived == null)
            RETURN 1
        )

        SORT folder.order ASC, folder.name ASC

        RETURN {
          _id: folder._id,
          _key: folder._key,
          name: folder.name,
          description: folder.description || "",
          created: folder.created || null,
          updated: folder.updated || null,
          isArchived: folder.isArchived || false,
          color: folder.color || "#808080",
          icon: folder.icon || "folder",
          parentFolderId: folder.parentFolderId || null,
          order: folder.order || 0,
          conversationCount: conversationCount,
          childFolderCount: childFolderCount,
          userRole: edge.role || "owner",
          lastAccessedAt: edge.lastAccessedAt || null
        }
      `;

      logger.info(`Executing query for user path: ${userId}`);
      const cursor = await this.db.query(query);
      const folders = await cursor.all();
      logger.info(`Found ${folders.length} folders for user ${userId}`);

      // Log the final results
      if (folders.length > 0) {
        logger.info(`DEBUG - Final result folders:`);
        folders.forEach((folder, index) => {
          logger.info(`  Folder ${index + 1}: ${folder._id} (${folder.name})`);
        });
      } else {
        logger.info(`DEBUG - No folders passed the filter conditions`);
      }

      return folders;
    } catch (error) {
      logger.error(`Error getting folders for user ${userId}:`, error);
      logger.error(`DEBUG - Stack trace: ${error.stack}`);
      throw error;
    }
  }

  /**
   * Update folder properties
   * @param {String} folderId - Folder ID
   * @param {Object} updateData - Properties to update
   * @returns {Promise<Object>} Updated folder
   */
  async updateFolder(folderId, updateData) {
    try {
      logger.info(`Updating folder ${folderId} with data:`, updateData);

      const allowedFields = ['name', 'description', 'isArchived', 'color', 'icon', 'parentFolderId', 'order'];

      // Filter out non-allowed fields
      const filteredData = {};
      for (const field of allowedFields) {
        if (updateData[field] !== undefined) {
          filteredData[field] = updateData[field];
        }
      }

      // Always update the 'updated' timestamp
      filteredData.updated = new Date().toISOString();

      if (Object.keys(filteredData).length === 0) {
        logger.warn('No valid fields to update');
        throw new Error('No valid fields to update');
      }

      // Update the folder
      const updatedFolder = await this.db.collection('folders').update(folderId, filteredData, { returnNew: true });
      logger.info(`Folder ${folderId} updated successfully`);

      return updatedFolder.new;
    } catch (error) {
      logger.error(`Error updating folder ${folderId}:`, error);
      throw error;
    }
  }

  /**
   * Delete a folder and all related links
   * @param {String} folderId - Folder ID
   * @param {String} userId - User ID requesting the deletion (for validation)
   * @param {Boolean} deleteContents - Whether to delete conversations in the folder
   * @returns {Promise<Object>} Result with deleted counts
   */
  async deleteFolder(folderId, userId, deleteContents = false, userKey) {
    try {
      logger.info(`Deleting folder ${folderId} for user ${userId}, deleteContents: ${deleteContents}`);

      // Verify the user has permission to delete this folder
      const permissionQuery = aql`
      FOR edge IN userFolders
        FILTER edge._to == ${'folders/' + folderId} AND edge._from == ${'users/' + userKey}
        RETURN edge
    `;

      const permissionCursor = await this.db.query(permissionQuery);
      const permission = await permissionCursor.next();

      if (!permission) {
        logger.warn(`User ${userId} does not have permission to delete folder ${folderId}`);
        throw new ForbiddenError('You do not have permission to delete this folder');
      }

      // Get all conversation links for this folder
      const conversationLinkQuery = aql`
      FOR edge IN folderConversations
        FILTER edge._from == ${'folders/' + folderId}
        RETURN edge
    `;

      const conversationLinkCursor = await this.db.query(conversationLinkQuery);
      const conversationLinks = await conversationLinkCursor.all();

      // Start a transaction to ensure atomicity
      const trx = await this.db.beginTransaction({
        write: ['folders', 'userFolders', 'folderConversations']
      });

      try {
        // Delete conversation links
        for (const link of conversationLinks) {
          await trx.step(() => {
            return this.db.collection('folderConversations').remove(link._key);
          });
        }

        // If deleteContents is true and we're not at the root folder, delete conversations too
        if (deleteContents) {
          for (const link of conversationLinks) {
            const conversationId = link._to.split('/')[1];
            try {
              // Only try to delete if the conversation exists
              await this.getConversation(conversationId);
              await this.deleteConversation(conversationId, userId);
            } catch (error) {
              // If conversation not found or deletion fails, continue with other deletions
              logger.warn(`Error deleting conversation ${conversationId}: ${error.message}`);
            }
          }
        }

        // Delete user-folder edges
        const deleteUserEdgeQuery = aql`
        FOR edge IN userFolders
          FILTER edge._to == ${'folders/' + folderId}
          REMOVE edge IN userFolders
      `;

        await trx.step(() => this.db.query(deleteUserEdgeQuery));

        // Check if there are child folders
        const childFoldersQuery = aql`
        FOR folder IN folders
          FILTER folder.parentFolderId == ${folderId}
          RETURN folder._key
      `;

        const childFoldersCursor = await this.db.query(childFoldersQuery);
        const childFolders = await childFoldersCursor.all();

        // Delete or reassign child folders
        for (const childKey of childFolders) {
          if (deleteContents) {
            // Recursively delete child folders
            try {
              await this.deleteFolder(childKey, userId, deleteContents);
            } catch (error) {
              logger.warn(`Error deleting child folder ${childKey}: ${error.message}`);
            }
          } else {
            // Move child folders to root (null parentFolderId)
            await trx.step(() => {
              return this.db.collection('folders').update(childKey, { parentFolderId: null });
            });
          }
        }

        // Delete the folder
        await trx.step(() => this.db.collection('folders').remove(folderId));

        // Commit the transaction
        await trx.commit();

        logger.info(`Folder ${folderId} deleted with ${conversationLinks.length} conversation links`);

        return {
          folderId,
          conversationLinksDeleted: conversationLinks.length,
          childFoldersAffected: childFolders.length,
          success: true
        };
      } catch (error) {
        // Abort the transaction on error
        await trx.abort();
        throw error;
      }
    } catch (error) {
      logger.error(`Error deleting folder ${folderId}:`, error);
      throw error;
    }
  }

  /**
   * Add a conversation to a folder
   * @param {String} folderId - Folder ID
   * @param {String} conversationId - Conversation ID
   * @param {String} userId - User ID making the request (for validation)
   * @returns {Promise<Object>} Created relationship
   */
  async addConversationToFolder(folderId, conversationId, userId, userKey) {
    try {
      logger.info(`Adding conversation ${conversationId} to folder ${folderId}`);

      // Verify the user has permission to access both folder and conversation
      const folderPermissionQuery = aql`
      FOR edge IN userFolders
        FILTER edge._to == ${'folders/' + folderId} AND edge._from == ${'users/' + userKey}
        RETURN edge
    `;

      const convPermissionQuery = aql`
      FOR edge IN userConversations
        FILTER edge._to == ${'conversations/' + conversationId} AND edge._from == ${'users/' + userKey}
        RETURN edge
    `;

      const folderPermissionCursor = await this.db.query(folderPermissionQuery);
      const conversationPermissionCursor = await this.db.query(convPermissionQuery);

      const folderPermission = await folderPermissionCursor.next();
      const conversationPermission = await conversationPermissionCursor.next();

      if (!folderPermission) {
        logger.warn(`User ${userId} does not have permission to access folder ${folderId}`);
        throw new ForbiddenError('You do not have permission to access this folder');
      }

      if (!conversationPermission) {
        logger.warn(`User ${userId} does not have permission to access conversation ${conversationId}`);
        throw new ForbiddenError('You do not have permission to access this conversation');
      }

      // Check if the conversation already exists in any folder
      const existingLinkQuery = aql`
      FOR edge IN folderConversations
        FILTER edge._to == ${'conversations/' + conversationId}
        RETURN edge
    `;

      const existingLinkCursor = await this.db.query(existingLinkQuery);
      const existingLink = await existingLinkCursor.next();

      // If the conversation is already in a folder, move it
      if (existingLink) {
        // If it's already in the same folder, just return the existing link
        if (existingLink._from === `folders/${folderId}`) {
          logger.info(`Conversation ${conversationId} is already in folder ${folderId}`);
          return existingLink;
        }

        // Otherwise, remove from the old folder
        await this.db.collection('folderConversations').remove(existingLink._key);
        logger.info(`Conversation ${conversationId} removed from folder ${existingLink._from.split('/')[1]}`);
      }

      // Create the new folder-conversation edge
      const edge = await this.db.collection('folderConversations').save({
        _from: `folders/${folderId}`,
        _to: `conversations/${conversationId}`,
        addedAt: new Date().toISOString(),
        addedBy: userId
      });

      logger.info(`Conversation ${conversationId} added to folder ${folderId}`);

      return edge;
    } catch (error) {
      logger.error(`Error adding conversation ${conversationId} to folder ${folderId}:`, error);
      throw error;
    }
  }

  /**
   * Remove a conversation from a folder
   * @param {String} folderId - Folder ID
   * @param {String} conversationId - Conversation ID
   * @param {String} userId - User ID making the request (for validation)
   * @returns {Promise<Object>} Result of the operation
   */
  async removeConversationFromFolder(folderId, conversationId, userId, userKey) {
    try {
      logger.info(`Removing conversation ${conversationId} from folder ${folderId}`);

      // Verify the user has permission to access the folder
      const permissionQuery = aql`
      FOR edge IN userFolders
        FILTER edge._to == ${'folders/' + folderId} AND edge._from == ${'users/' + userKey}
        RETURN edge
    `;

      const permissionCursor = await this.db.query(permissionQuery);
      const permission = await permissionCursor.next();

      if (!permission) {
        logger.warn(`User ${userId} does not have permission to access folder ${folderId}`);
        throw new ForbiddenError('You do not have permission to access this folder');
      }

      // Find the folder-conversation edge
      const linkQuery = aql`
      FOR edge IN folderConversations
        FILTER edge._from == ${'folders/' + folderId} AND edge._to == ${'conversations/' + conversationId}
        RETURN edge
    `;

      const linkCursor = await this.db.query(linkQuery);
      const link = await linkCursor.next();

      if (!link) {
        logger.warn(`Conversation ${conversationId} not found in folder ${folderId}`);
        throw new NotFoundError('Conversation not found in this folder');
      }

      // Delete the edge
      await this.db.collection('folderConversations').remove(link._key);
      logger.info(`Conversation ${conversationId} removed from folder ${folderId}`);

      return {
        folderId,
        conversationId,
        success: true
      };
    } catch (error) {
      logger.error(`Error removing conversation ${conversationId} from folder ${folderId}:`, error);
      throw error;
    }
  }

  /**
   * Search for folders by name
   * @param {String} userId - User ID
   * @param {String} searchTerm - Text to search for
   * @param {Object} options - Search options
   * @returns {Promise<Array>} Matching folders
   */
  async searchFolders(userId, searchTerm, options = {}) {
    try {
      logger.info(`Searching folders for user ${userId} with term: "${searchTerm}"`);

      const includeArchived = options.includeArchived || false;
      const userKey = options.userKey;

      const query = aql`
      FOR edge IN userFolders
        FILTER edge._from == ${'users/' + userKey}

        FOR folder IN folders
          FILTER folder._id == edge._to
          FILTER ${includeArchived} OR folder.isArchived == false

          FILTER (
            LIKE(LOWER(folder.name), CONCAT("%", LOWER(${searchTerm}), "%")) OR
            LIKE(LOWER(folder.description), CONCAT("%", LOWER(${searchTerm}), "%"))
          )

          LET conversationCount = LENGTH(
            FOR convEdge IN folderConversations
              FILTER convEdge._from == folder._id
              RETURN 1
          )

          LET childFolderCount = LENGTH(
            FOR childFolder IN folders
              FILTER childFolder.parentFolderId == PARSE_IDENTIFIER(folder._id).key
              RETURN 1
          )

          SORT folder.name ASC

          RETURN {
            folder: folder,
            conversationCount: conversationCount,
            childFolderCount: childFolderCount,
            role: edge.role
          }
    `;

      const cursor = await this.db.query(query);
      const results = await cursor.all();

      logger.info(`Found ${results.length} folders matching term "${searchTerm}" for user ${userId}`);

      return results;
    } catch (error) {
      logger.error(`Error searching folders for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Move a conversation between folders
   * @param {String} conversationId - Conversation ID
   * @param {String} sourceFolderId - Source folder ID (null for root)
   * @param {String} targetFolderId - Target folder ID (null for root)
   * @param {String} userId - User iss_sub making the request
   * @param {String} userKey - ArangoDB _key for edge operations
   * @returns {Promise<Object>} Result of the operation
   */
  async moveConversation(conversationId, sourceFolderId, targetFolderId, userId, userKey) {
    try {
      logger.info(
        `Moving conversation ${conversationId} from folder ${sourceFolderId || 'root'} to ${targetFolderId || 'root'}`
      );

      const convPermissionQuery = aql`
        FOR edge IN userConversations
          FILTER edge._to == ${`conversations/${conversationId}`} AND edge._from == ${`users/${userKey}`}
          RETURN edge
      `;
      const convPermissionCursor = await this.db.query(convPermissionQuery);
      const convPermission = await convPermissionCursor.next();

      if (!convPermission) {
        logger.warn(`User ${userId} does not have permission to access conversation ${conversationId}`);
        throw new ForbiddenError('You do not have permission to access this conversation');
      }

      if (targetFolderId) {
        const folderPermissionQuery = aql`
          FOR edge IN userFolders
            FILTER edge._to == ${`folders/${targetFolderId}`} AND edge._from == ${`users/${userKey}`}
            RETURN edge
        `;
        const folderPermissionCursor = await this.db.query(folderPermissionQuery);
        const folderPermission = await folderPermissionCursor.next();

        if (!folderPermission) {
          logger.warn(`User ${userId} does not have permission to access folder ${targetFolderId}`);
          throw new ForbiddenError('You do not have permission to access the target folder');
        }
      }

      const trx = await this.db.beginTransaction({
        write: ['folderConversations']
      });

      try {
        const existingLinkQuery = aql`
          FOR edge IN folderConversations
            FILTER edge._to == ${`conversations/${conversationId}`}
            RETURN edge
        `;
        const existingLinkCursor = await this.db.query(existingLinkQuery);
        const existingLink = await existingLinkCursor.next();

        if (existingLink) {
          if (!targetFolderId) {
            await trx.step(() => this.db.collection('folderConversations').remove(existingLink._key));
            logger.info(`Conversation ${conversationId} removed from folder and moved to root`);
          } else if (existingLink._from === `folders/${targetFolderId}`) {
            logger.info(`Conversation ${conversationId} is already in folder ${targetFolderId}`);
            await trx.commit();
            return {
              conversationId,
              sourceFolderId,
              targetFolderId,
              success: true,
              noChangesNeeded: true
            };
          } else {
            await trx.step(() => this.db.collection('folderConversations').remove(existingLink._key));
            await trx.step(() =>
              this.db.collection('folderConversations').save({
                _from: `folders/${targetFolderId}`,
                _to: `conversations/${conversationId}`,
                addedAt: new Date().toISOString(),
                addedBy: userId
              })
            );
            logger.info(
              `Conversation ${conversationId} moved from folder ${existingLink._from.split('/')[1]} to ${targetFolderId}`
            );
          }
        } else if (targetFolderId) {
          await trx.step(() =>
            this.db.collection('folderConversations').save({
              _from: `folders/${targetFolderId}`,
              _to: `conversations/${conversationId}`,
              addedAt: new Date().toISOString(),
              addedBy: userId
            })
          );
          logger.info(`Conversation ${conversationId} moved from root to folder ${targetFolderId}`);
        } else {
          logger.info(`Conversation ${conversationId} is already in root, no change needed`);
          await trx.commit();
          return {
            conversationId,
            sourceFolderId,
            targetFolderId,
            success: true,
            noChangesNeeded: true
          };
        }

        await trx.commit();

        // Temporarily skip analytics tracking to focus on the core issue
        logger.info(`Skipping analytics tracking for conversation move`);

        return {
          conversationId,
          sourceFolderId: existingLink ? existingLink._from.split('/')[1] : null,
          targetFolderId,
          success: true
        };
      } catch (error) {
        await trx.abort();
        logger.error(`Transaction error moving conversation ${conversationId}:`, error);
        throw error;
      }
    } catch (error) {
      logger.error(`Error moving conversation ${conversationId}:`, error.stack || error);
      throw error;
    }
  }

  /**
   * Find the folder containing a conversation
   * @param {String} conversationId - Conversation ID
   * @returns {Promise<Object|null>} Folder information or null if not in a folder
   */
  async findConversationFolder(conversationId) {
    try {
      logger.info(`Finding folder for conversation ${conversationId}`);

      const query = aql`
      FOR edge IN folderConversations
        FILTER edge._to == ${'conversations/' + conversationId}

        LET folder = DOCUMENT(edge._from)

        RETURN {
          _id: folder._id,
          _key: folder._key,
          name: folder.name,
          parentFolderId: folder.parentFolderId,
          relationship: {
            addedAt: edge.addedAt,
            addedBy: edge.addedBy
          }
        }
    `;

      const cursor = await this.db.query(query);
      const result = await cursor.next();

      if (result) {
        logger.info(`Found folder ${result._key} containing conversation ${conversationId}`);
      } else {
        logger.info(`Conversation ${conversationId} is not in any folder`);
      }

      return result || null;
    } catch (error) {
      logger.error(`Error finding folder for conversation ${conversationId}:`, error);
      return null;
    }
  }

  /**
   * Get folder path (breadcrumbs)
   * @param {String} folderId - Folder ID
   * @returns {Promise<Array>} Array of folders representing the path, starting from root
   */
  async getFolderPath(folderId) {
    try {
      logger.info(`Getting path for folder ${folderId}`);

      const path = [];
      let currentId = folderId;

      // Loop to find all ancestors
      while (currentId) {
        // Get current folder
        const folder = await this.db.collection('folders').document(currentId);
        path.unshift(folder); // Add to beginning of array

        // Move up to parent
        currentId = folder.parentFolderId;
      }

      logger.info(`Found path with ${path.length} folders for folder ${folderId}`);
      return path;
    } catch (error) {
      logger.error(`Error getting path for folder ${folderId}:`, error);
      throw error;
    }
  }

  /**
   * Reorder folders
   * @param {String} userId - User ID
   * @param {Array} folderOrders - Array of {folderId, order} objects
   * @param {String} parentFolderId - Parent folder ID (null for root folders)
   * @returns {Promise<Object>} Result of the operation
   */
  async reorderFolders(userId, folderOrders, parentFolderId = null, userKey) {
    try {
      logger.info(`Reordering folders for user ${userId} under parent ${parentFolderId || 'root'}`);

      if (!Array.isArray(folderOrders) || folderOrders.length === 0) {
        throw new Error('Invalid folder orders array');
      }

      // Verify user has permission for each folder
      for (const item of folderOrders) {
        const permissionQuery = aql`
        FOR edge IN userFolders
          FILTER edge._to == ${'folders/' + item.folderId} AND edge._from == ${'users/' + userKey}
          RETURN edge
      `;

        const permissionCursor = await this.db.query(permissionQuery);
        const permission = await permissionCursor.next();

        if (!permission) {
          logger.warn(`User ${userId} does not have permission to access folder ${item.folderId}`);
          throw new ForbiddenError(`You do not have permission to access folder ${item.folderId}`);
        }

        // Verify folder belongs to correct parent
        const folderQuery = aql`
        FOR folder IN folders
          FILTER folder._key == ${item.folderId}
          RETURN folder.parentFolderId
      `;

        const folderCursor = await this.db.query(folderQuery);
        const folderParentId = await folderCursor.next();

        // Convert null/undefined to null string for comparison
        const currentParentId = folderParentId || null;
        const targetParentId = parentFolderId || null;

        if (currentParentId !== targetParentId) {
          logger.warn(`Folder ${item.folderId} does not belong to parent ${parentFolderId || 'root'}`);
          throw new Error(`Folder ${item.folderId} does not belong to the specified parent folder`);
        }
      }

      // Update order for each folder
      const trx = await this.db.beginTransaction({
        write: ['folders']
      });

      try {
        for (const item of folderOrders) {
          await trx.step(() => {
            return this.db.collection('folders').update(item.folderId, { order: item.order });
          });
        }

        await trx.commit();
        logger.info(`Successfully reordered ${folderOrders.length} folders`);

        return {
          updatedFolders: folderOrders.length,
          success: true
        };
      } catch (error) {
        await trx.abort();
        throw error;
      }
    } catch (error) {
      logger.error(`Error reordering folders for user ${userId}:`, error);
      throw error;
    }
  }
}
const chatHistoryService = ChatHistoryService.getInstance();
module.exports = chatHistoryService;
