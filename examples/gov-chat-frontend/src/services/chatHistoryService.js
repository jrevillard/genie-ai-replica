// src/services/chatHistoryService.js - Connect Chat History components to backend
import httpService from './httpService';

/**
 * Service for managing chat history and conversations
 */
class ChatHistoryService {
  /**
   * Get all conversations for the authenticated user
   * @param {Object} options - Filter and pagination options
   * @param {Number} options.limit - Maximum conversations to return (default: 20)
   * @param {Number} options.offset - Number of records to skip (default: 0)
   * @param {Boolean} options.includeArchived - Whether to include archived conversations
   * @param {Boolean} options.filterStarred - Filter to show only starred conversations
   * @param {String} options.searchTerm - Text to search in conversation titles or messages
   * @returns {Promise} Conversations list with pagination details
   */
  async getUserConversations(options = {}) {
    try {
      const params = {
        limit: options.limit || 20,
        offset: options.offset || 0,
        includeArchived: options.includeArchived || false,
        filterStarred: options.filterStarred || false,
        searchTerm: options.searchTerm || ''
      };

      const response = await httpService.get('chat/conversations', params);
      return response.data;
    } catch (error) {
      console.error('Error fetching user conversations:', error);
      throw error;
    }
  }

  /**
   * Get a specific conversation with its details
   * @param {String} conversationId - ID of the conversation to retrieve
   * @returns {Promise} Conversation details
   */
  async getConversation(conversationId) {
    try {
      const response = await httpService.get(`chat/conversations/${conversationId}`);
      return response.data;
    } catch (error) {
      console.error(`Error fetching conversation ${conversationId}:`, error);
      throw error;
    }
  }

  /**
   * Create a new conversation
   * @param {Object} conversationData - Data for the new conversation
   * @param {String} conversationData.title - Title of the conversation
   * @param {String} conversationData.categoryId - Optional category ID
   * @param {String} conversationData.initialMessage - Optional initial message
   * @param {Array} conversationData.tags - Optional tags for the conversation
   * @returns {Promise} Created conversation data
   */
  async createConversation(conversationData) {
    try {
      const response = await httpService.post('chat/conversations', conversationData);
      return response.data;
    } catch (error) {
      console.error('Error creating conversation:', error);
      throw error;
    }
  }

  /**
   * Update an existing conversation
   * @param {String} conversationId - ID of the conversation to update
   * @param {Object} updateData - Data to update
   * @param {String} updateData.title - New title for the conversation
   * @param {Boolean} updateData.isStarred - Star status
   * @param {Boolean} updateData.isArchived - Archive status
   * @param {Array} updateData.tags - Tags for the conversation
   * @param {String} updateData.categoryId - ID of the service category
   * @returns {Promise} Updated conversation data
   */
  async updateConversation(conversationId, updateData) {
    try {
      const response = await httpService.patch(`chat/conversations/${conversationId}`, updateData);
      return response.data;
    } catch (error) {
      console.error(`Error updating conversation ${conversationId}:`, error);
      throw error;
    }
  }

  /**
   * Delete a conversation and all its messages
   * @param {String} conversationId - ID of the conversation to delete
   * @returns {Promise} Result of the deletion
   */
  async deleteConversation(conversationId) {
    try {
      const response = await httpService.delete(`chat/conversations/${conversationId}`);
      return response.data;
    } catch (error) {
      console.error(`Error deleting conversation ${conversationId}:`, error);
      throw error;
    }
  }

  /**
   * Get messages for a specific conversation
   * @param {String} conversationId - ID of the conversation
   * @param {Object} options - Pagination and sorting options
   * @param {Number} options.limit - Maximum messages to return (default: 50)
   * @param {Number} options.offset - Number of records to skip (default: 0)
   * @param {Boolean} options.newestFirst - Sort with newest messages first
   * @returns {Promise} Messages with pagination details
   */
  async getConversationMessages(conversationId, options = {}) {
    try {
      const params = {
        limit: options.limit || 50,
        offset: options.offset || 0,
        newestFirst: options.newestFirst || false
      };

      const response = await httpService.get(
        `chat/conversations/${conversationId}/messages`, 
        params
      );
      return response.data;
    } catch (error) {
      console.error(`Error fetching messages for conversation ${conversationId}:`, error);
      throw error;
    }
  }

  /**
   * Add a new message to a conversation
   * @param {String} conversationId - ID of the conversation
   * @param {Object} messageData - Message data
   * @param {String} messageData.content - Message content
   * @param {String} messageData.sender - Sender ('user' or 'assistant')
   * @param {String} messageData.queryId - Optional query ID for assistant messages
   * @param {Object} messageData.metadata - Optional additional metadata
   * @returns {Promise} Created message data
   */
  async addMessage(conversationId, messageData) {
    try {
      const response = await httpService.post(
        `chat/conversations/${conversationId}/messages`, 
        messageData
      );
      return response.data;
    } catch (error) {
      console.error(`Error adding message to conversation ${conversationId}:`, error);
      throw error;
    }
  }

  /**
   * Mark messages as read
   * @param {String} conversationId - ID of the conversation
   * @param {Array} messageIds - Optional specific message IDs to mark as read
   * @returns {Promise} Result of the operation
   */
  async markMessagesAsRead(conversationId, messageIds = []) {
    try {
      const response = await httpService.post(
        `chat/conversations/${conversationId}/messages/read`,
        { messageIds }
      );
      return response.data;
    } catch (error) {
      console.error(`Error marking messages as read in conversation ${conversationId}:`, error);
      throw error;
    }
  }

  /**
   * Find messages related to a specific query
   * @param {String} queryId - ID of the query
   * @returns {Promise} Messages related to the query
   */
  async findMessagesForQuery(queryId) {
    try {
      const response = await httpService.get(`chat/query/${queryId}/messages`);
      return response.data;
    } catch (error) {
      console.error(`Error finding messages for query ${queryId}:`, error);
      throw error;
    }
  }

  /**
   * Find the originating query for a message
   * @param {String} messageId - ID of the message
   * @returns {Promise} Query information
   */
  async findOriginatingQuery(messageId) {
    try {
      const response = await httpService.get(`chat/messages/${messageId}/query`);
      return response.data;
    } catch (error) {
      console.error(`Error finding originating query for message ${messageId}:`, error);
      throw error;
    }
  }

  /**
   * Create a new conversation from an existing query
   * @param {String} queryId - ID of the query
   * @param {Object} options - Conversation options
   * @param {String} options.title - Optional title for the conversation
   * @param {String} options.responseText - Optional response text to include
   * @param {Array} options.tags - Optional tags for the conversation
   * @returns {Promise} Created conversation data
   */
  async createConversationFromQuery(queryId, options = {}) {
    try {
      const response = await httpService.post(
        `chat/query/${queryId}/conversation`,
        options
      );
      return response.data;
    } catch (error) {
      console.error(`Error creating conversation from query ${queryId}:`, error);
      throw error;
    }
  }

  /**
   * Search conversations containing specific text
   * @param {String} searchTerm - Text to search for
   * @param {Object} options - Search options
   * @param {Number} options.limit - Maximum results to return (default: 20)
   * @param {Number} options.offset - Number of results to skip (default: 0)
   * @param {Boolean} options.includeArchived - Whether to include archived conversations
   * @returns {Promise} Search results with pagination
   */
  async searchConversations(searchTerm, options = {}) {
    try {
      const params = {
        q: searchTerm,
        limit: options.limit || 20,
        offset: options.offset || 0,
        includeArchived: options.includeArchived || false
      };

      const response = await httpService.get('chat/search', params);
      return response.data;
    } catch (error) {
      console.error(`Error searching conversations with term "${searchTerm}":`, error);
      throw error;
    }
  }

  /**
   * Get recent conversations for the user
   * @param {Number} limit - Maximum number of conversations to return
   * @returns {Promise} Recent conversations
   */
  async getRecentConversations(limit = 5) {
    try {
      const response = await httpService.get('chat/recent', { limit });
      return response.data;
    } catch (error) {
      console.error('Error fetching recent conversations:', error);
      throw error;
    }
  }

  /**
   * Get conversation statistics for the user
   * @returns {Promise} Conversation statistics
   */
  async getUserConversationStats() {
    try {
      const response = await httpService.get('chat/stats');
      return response.data;
    } catch (error) {
      console.error('Error fetching conversation statistics:', error);
      throw error;
    }
  }

  /**
   * Link a query to a conversation (for when a response is generated)
   * @param {String} queryId - ID of the query
   * @param {String} conversationId - ID of the conversation
   * @param {String} messageId - ID of the message
   * @param {Object} metadata - Additional metadata
   * @returns {Promise} Link result
   */
  async linkQueryToConversation(queryId, conversationId, messageId, metadata = {}) {
    try {
      // This is just to expose the internal function for components that might need it
      // The primary linking is done via addMessage with queryId parameter
      const response = await httpService.post(
        `chat/query/${queryId}/link`,
        {
          conversationId,
          messageId,
          metadata
        }
      );
      return response.data;
    } catch (error) {
      console.error(`Error linking query ${queryId} to conversation:`, error);
      throw error;
    }
  }

  /**
   * Export conversation to PDF or other format
   * @param {String} conversationId - ID of the conversation to export
   * @param {String} format - Export format (pdf, json, etc.)
   * @returns {Promise} Export data or download URL
   */
  async exportConversation(conversationId, format = 'pdf') {
    try {
      const response = await httpService.get(
        `chat/conversations/${conversationId}/export`,
        { format },
        { responseType: 'blob' }
      );
      return response.data;
    } catch (error) {
      console.error(`Error exporting conversation ${conversationId}:`, error);
      throw error;
    }
  }

  // Note: Folder management will be handled by the existing frontend code
  // and is not part of this service as it's managed in the application state
}

export default new ChatHistoryService();