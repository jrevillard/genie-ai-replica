import httpService from './httpService';

/**
 * Service for managing chat history and conversations.
 * User identity is resolved server-side from the JWT — no userId params needed.
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

      const response = await httpService.get('/chat/conversations', { params });
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
      const response = await httpService.get(`/chat/conversations/${conversationId}`);
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
      if (!conversationData.title && !conversationData.initialMessage) {
        throw new Error('Title or initial message is required');
      }

      const response = await httpService.post('/chat/conversations', conversationData);
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
   * @param {String} updateData.categoryId - Optional category ID
   * @param {String} updateData.category - Optional category name
   * @param {Array} updateData.tags - Optional tags for the conversation
   * @param {Boolean} updateData.isStarred - Starred status
   * @param {Boolean} updateData.isArchived - Archived status
   * @returns {Promise} Updated conversation data
   */
  async updateConversation(conversationId, updateData) {
    try {
      if (!conversationId) {
        throw new Error('Conversation ID is required');
      }

      const response = await httpService.patch(`/chat/conversations/${conversationId}`, updateData);
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
      if (!conversationId) {
        throw new Error('Conversation ID is required');
      }

      const response = await httpService.delete(`/chat/conversations/${conversationId}`);
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

      const response = await httpService.get(`/chat/conversations/${conversationId}/messages`, { params });
      return response.data;
    } catch (error) {
      console.error(`Error fetching messages for conversation ${conversationId}:`, error);
      throw error;
    }
  }

  /**
   * Add a new message to a conversation
   * @param {Object} messageData - Message data
   * @param {String} messageData.conversationId - ID of the conversation
   * @param {String} messageData.content - Message content
   * @param {String} messageData.sender - Sender ('user' or 'assistant')
   * @param {String} messageData.queryId - Optional query ID for assistant messages
   * @param {Object} messageData.metadata - Optional additional metadata
   * @returns {Promise} Created message data
   */
  async addMessage(messageData) {
    try {
      if (!messageData.conversationId) {
        throw new Error('Conversation ID is required');
      }

      const response = await httpService.post(
        `/chat/conversations/${messageData.conversationId}/messages`,
        messageData
      );
      return response.data;
    } catch (error) {
      console.error(`Error adding message to conversation ${messageData.conversationId}:`, error);
      throw error;
    }
  }

  /**
   * Get all folders for the authenticated user
   * @param {Object} options - Filter options
   * @param {Boolean} options.includeArchived - Whether to include archived folders
   * @param {String} options.parentFolderId - ID of parent folder to get subfolders (null for root folders)
   * @returns {Promise} Folders list
   */
  async getUserFolders(options = {}) {
    try {
      const params = {};

      if ('includeArchived' in options) {
        params.includeArchived = options.includeArchived;
      }
      if ('parentFolderId' in options && options.parentFolderId !== undefined) {
        params.parentFolderId = options.parentFolderId;
      }

      const response = await httpService.get('/chat/folders', { params });
      return response.data;
    } catch (error) {
      console.error('Error fetching user folders:', error);
      throw error;
    }
  }

  /**
   * Get a specific folder with its details
   * @param {String} folderId - ID of the folder to retrieve
   * @returns {Promise} Folder details with conversations
   */
  async getFolder(folderId) {
    try {
      const response = await httpService.get(`/chat/folders/${folderId}`);
      return response.data;
    } catch (error) {
      console.error(`Error fetching folder ${folderId}:`, error);
      throw error;
    }
  }

  /**
   * Create a new folder
   * @param {Object} folderData - Data for the new folder
   * @param {String} folderData.name - Name of the folder (required)
   * @param {String} folderData.description - Optional description
   * @param {String} folderData.parentFolderId - Optional parent folder ID
   * @param {String} folderData.color - Optional color code
   * @param {String} folderData.icon - Optional icon name
   * @returns {Promise} Created folder data
   */
  async createFolder(folderData) {
    try {
      if (!folderData.name) {
        throw new Error('Folder name is required');
      }

      const response = await httpService.post('/chat/folders', folderData);
      return response.data;
    } catch (error) {
      console.error('Error creating folder:', error);
      throw error;
    }
  }

  /**
   * Update an existing folder
   * @param {String} folderId - ID of the folder to update
   * @param {Object} updateData - Data to update
   * @param {String} updateData.name - New name for the folder
   * @param {String} updateData.description - New description
   * @param {Boolean} updateData.isArchived - Archive status
   * @param {String} updateData.color - Color code
   * @param {String} updateData.icon - Icon name
   * @param {String} updateData.parentFolderId - Parent folder ID
   * @returns {Promise} Updated folder data
   */
  async updateFolder(folderId, updateData) {
    try {
      const response = await httpService.patch(`/chat/folders/${folderId}`, updateData);
      return response.data;
    } catch (error) {
      console.error(`Error updating folder ${folderId}:`, error);
      throw error;
    }
  }

  /**
   * Delete a folder
   * @param {String} folderId - ID of the folder to delete
   * @param {Boolean} deleteContents - Whether to delete contained conversations and subfolders
   * @returns {Promise} Result of the deletion
   */
  async deleteFolder(folderId, deleteContents = false) {
    try {
      const response = await httpService.delete(`/chat/folders/${folderId}`, {
        params: { deleteContents }
      });

      return response.data;
    } catch (error) {
      console.error(`Error deleting folder ${folderId}:`, error);
      throw error;
    }
  }

  /**

  /**
   * Add a conversation to a folder
   * @param {String} folderId - Folder ID
   * @param {String} conversationId - Conversation ID
   * @returns {Promise} Result of the operation
   */
  async addConversationToFolder(folderId, conversationId) {
    try {
      const response = await httpService.post(`/chat/folders/${folderId}/conversations/${conversationId}`);
      return response.data;
    } catch (error) {
      console.error(`Error adding conversation ${conversationId} to folder ${folderId}:`, error);
      throw error;
    }
  }

  /**
   * Get the folder containing a conversation
   * @param {String} conversationId - Conversation ID
   * @returns {Promise} Folder information or null if not in a folder
   */
  async getConversationFolder(conversationId) {
    try {
      const response = await httpService.get(`/chat/conversations/${conversationId}/folder`);
      return response.data;
    } catch (error) {
      if (error.response && error.response.status === 404) {
        return { inFolder: false, folder: null };
      }
      console.error(`Error finding folder for conversation ${conversationId}:`, error);
      throw error;
    }
  }

  /**
   * Move a conversation between folders
   * @param {String} conversationId - Conversation ID
   * @param {String} sourceFolderId - Source folder ID (null for root)
   * @param {String} targetFolderId - Target folder ID (null for root)
   * @returns {Promise} Result of the operation
   */
  async moveConversation(conversationId, sourceFolderId, targetFolderId) {
    try {
      const response = await httpService.post(`/chat/conversations/${conversationId}/move`, {
        sourceFolderId,
        targetFolderId
      });

      return response.data;
    } catch (error) {
      console.error(`Error moving conversation ${conversationId}:`, error);
      throw error;
    }
  }

  /**
   * Remove a conversation from a folder
   * @param {String} conversationId - Conversation ID
   * @param {String} currentFolderId - Current folder ID
   * @returns {Promise} Result of the operation
   */
  async removeConversationFromFolder(conversationId, currentFolderId) {
    try {
      const response = await httpService.delete(`/chat/folders/${currentFolderId}/conversations/${conversationId}`);
      return response.data;
    } catch (error) {
      console.error(`Error removing conversation ${conversationId} from folder ${currentFolderId}:`, error);
      throw error;
    }
  }
}

export default new ChatHistoryService();
