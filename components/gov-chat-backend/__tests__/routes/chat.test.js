'use strict';

require('../setup-env');

// Mock shared-lib — virtual because it only exists after Docker packaging
jest.mock('../../shared-lib', () => require('../mocks/shared-lib'), { virtual: true });

// Mock keycloak-auth-service (used by middleware)
jest.mock('../../services/keycloak-auth-service', () => ({
  verifyToken: jest.fn(),
  checkUserStatusInKeycloak: jest.fn()
}));

// Mock user-provisioning-service (used by middleware)
jest.mock('../../services/user-provisioning-service', () => ({
  provisionUser: jest.fn(),
  initialize: jest.fn(),
  markUserAsDeleted: jest.fn()
}));

// Mock session-service singleton (loaded by index.js)
jest.mock('../../services/session-service', () => ({
  getUserSessions: jest.fn(),
  endSession: jest.fn(),
  createSession: jest.fn()
}));

// Mock chat-history-service — the core service under test
jest.mock('../../services/chat-history-service', () => {
  return {
    getUserConversations: jest.fn(),
    createConversation: jest.fn(),
    getConversation: jest.fn(),
    updateConversation: jest.fn(),
    deleteConversation: jest.fn(),
    getConversationMessages: jest.fn(),
    addMessage: jest.fn(),
    markMessagesAsRead: jest.fn(),
    findMessagesForQuery: jest.fn(),
    findOriginatingQuery: jest.fn(),
    linkQueryToConversation: jest.fn(),
    createConversationFromQuery: jest.fn(),
    searchConversations: jest.fn(),
    getRecentConversations: jest.fn(),
    getUserConversationStats: jest.fn(),
    getUserFolders: jest.fn(),
    createFolder: jest.fn(),
    getFolder: jest.fn(),
    updateFolder: jest.fn(),
    deleteFolder: jest.fn(),
    addConversationToFolder: jest.fn(),
    removeConversationFromFolder: jest.fn(),
    searchFolders: jest.fn(),
    reorderFolders: jest.fn(),
    getFolderPath: jest.fn(),
    moveConversation: jest.fn(),
    findConversationFolder: jest.fn(),
    db: { collection: jest.fn(() => ({ document: jest.fn() })) }
  };
});

// Mock query-service (loaded for route registration alongside chat-history-service)
jest.mock('../../services/query-service', () => ({}));

// Mock swagger dependencies
jest.mock(
  'swagger-jsdoc',
  () => () => ({
    openapi: '3.0.0',
    info: {},
    components: {},
    security: []
  }),
  { virtual: true }
);
jest.mock(
  'swagger-ui-express',
  () => ({
    serve: [],
    setup: () => (req, res, next) => next()
  }),
  { virtual: true }
);

// Mock all other services loaded by index.js
jest.mock('../../services/user-profile-service', () => ({}));
jest.mock('../../services/admin-dashboard-service', () => ({}));
jest.mock('../../services/analytics-service', () => ({}));
jest.mock('../../services/service-category-service', () => ({}));
jest.mock('../../services/logs-service', () => ({}));
jest.mock('../../services/database-operations-service', () => ({}));
jest.mock('../../services/weather-service', () => ({}));
jest.mock('../../services/security-scan-service', () => ({}));
jest.mock('../../services/translation-service', () => ({}));

// Mock analytics controller (required by analytics-routes factory)
jest.mock('../../controllers/analyticsController', () => {
  return function () {
    return {};
  };
});

// Prevent process.exit during tests
const originalExit = process.exit;
beforeAll(() => {
  process.exit = jest.fn();
});
afterAll(() => {
  process.exit = originalExit;
});

const { createApp } = require('../../index');
const request = require('supertest');
const { createValidToken } = require('../fixtures/tokens');
const { createMockUser } = require('../fixtures/users');

// Get references to mocked modules
const keycloakAuthService = require('../../services/keycloak-auth-service');
const userProvisioningService = require('../../services/user-provisioning-service');
const chatHistoryService = require('../../services/chat-history-service');

const mockUser = createMockUser();
const validToken = createValidToken();

// Sample fixtures
const sampleConversation = {
  _id: 'conversations/conv-1',
  _key: 'conv-1',
  title: 'Test Conversation',
  lastMessage: 'Hello',
  created: '2025-01-01T00:00:00.000Z',
  updated: '2025-01-01T00:00:00.000Z',
  messageCount: 1,
  isStarred: false,
  isArchived: false,
  category: null,
  tags: []
};

const sampleMessage = {
  _id: 'messages/msg-1',
  _key: 'msg-1',
  conversationId: 'conv-1',
  content: 'Hello world',
  sender: 'user',
  userId: mockUser.iss_sub,
  timestamp: '2025-01-01T00:00:00.000Z'
};

// Create app once for all tests — must pass chatHistoryService so routes are registered
let app;
beforeAll(() => {
  app = createApp({ services: { chatHistoryService } });
});

beforeEach(() => {
  jest.clearAllMocks();

  // Default: middleware passes through with valid user
  keycloakAuthService.verifyToken.mockResolvedValue({
    sub: 'user-123',
    iss: 'http://localhost:8080/realms/genie',
    iss_sub: 'http://localhost:8080/realms/genie#user-123',
    realm_access: { roles: ['user'] }
  });
  keycloakAuthService.checkUserStatusInKeycloak.mockResolvedValue(null);
  userProvisioningService.provisionUser.mockResolvedValue(mockUser);
});

// Helper to make authenticated requests
function authGet(path) {
  return request(app).get(path).set('Authorization', `Bearer ${validToken}`);
}
function authPost(path, body) {
  return request(app).post(path).set('Authorization', `Bearer ${validToken}`).send(body);
}

// ============================================================
// AC9: Auth guard — all chat routes require authentication
// ============================================================
describe('Auth guard (AC9)', () => {
  it('should return 401 on GET /api/chat/conversations without token', async () => {
    const response = await request(app).get('/api/chat/conversations');
    expect(response.status).toBe(401);
  });

  it('should return 401 on POST /api/chat/conversations without token', async () => {
    const response = await request(app).post('/api/chat/conversations').send({ title: 'test' });
    expect(response.status).toBe(401);
  });

  it('should return 401 on GET /api/chat/conversations/:id/messages without token', async () => {
    const response = await request(app).get('/api/chat/conversations/conv-1/messages');
    expect(response.status).toBe(401);
  });
});

// ============================================================
// AC1 & AC2: GET /api/chat/conversations
// ============================================================
describe('GET /api/chat/conversations (AC1, AC2)', () => {
  it('should return 200 with conversation list and pagination', async () => {
    const mockResult = {
      conversations: [sampleConversation],
      pagination: { total: 1, limit: 20, offset: 0, pages: 1, currentPage: 1 }
    };
    chatHistoryService.getUserConversations.mockResolvedValue(mockResult);

    const response = await authGet('/api/chat/conversations');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(mockResult);
    expect(chatHistoryService.getUserConversations).toHaveBeenCalledWith(
      mockUser.iss_sub,
      expect.objectContaining({
        limit: 20,
        offset: 0,
        includeArchived: false,
        filterStarred: false,
        searchTerm: '',
        userKey: mockUser._key
      })
    );
  });

  it('should forward query params to getUserConversations', async () => {
    chatHistoryService.getUserConversations.mockResolvedValue({
      conversations: [],
      pagination: { total: 0, limit: 10, offset: 5, pages: 0, currentPage: 1 }
    });

    await authGet('/api/chat/conversations?limit=10&offset=5&includeArchived=true&filterStarred=true&searchTerm=test');

    expect(chatHistoryService.getUserConversations).toHaveBeenCalledWith(
      mockUser.iss_sub,
      expect.objectContaining({
        limit: 10,
        offset: 5,
        includeArchived: true,
        filterStarred: true,
        searchTerm: 'test',
        userKey: mockUser._key
      })
    );
  });

  it('should return 400 when userId is missing from req.user', async () => {
    userProvisioningService.provisionUser.mockResolvedValue({
      ...mockUser,
      iss_sub: null
    });

    const response = await authGet('/api/chat/conversations');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      success: false,
      message: 'User ID is required but not found in request'
    });
  });
});

// ============================================================
// AC3: POST /api/chat/conversations
// ============================================================
describe('POST /api/chat/conversations (AC3)', () => {
  it('should return 201 and create a conversation', async () => {
    chatHistoryService.createConversation.mockResolvedValue(sampleConversation);

    const response = await authPost('/api/chat/conversations', { title: 'Test Conversation' });

    expect(response.status).toBe(201);
    expect(response.body).toEqual(sampleConversation);
    expect(chatHistoryService.createConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: mockUser.iss_sub,
        userKey: mockUser._key,
        title: 'Test Conversation'
      })
    );
    expect(chatHistoryService.addMessage).not.toHaveBeenCalled();
  });

  it('should call addMessage when initialMessage is provided', async () => {
    const convWithMsg = { ...sampleConversation, messageCount: 1 };
    chatHistoryService.createConversation.mockResolvedValue(convWithMsg);
    chatHistoryService.addMessage.mockResolvedValue(sampleMessage);

    const response = await authPost('/api/chat/conversations', {
      title: 'Test Conversation',
      initialMessage: 'Hello'
    });

    expect(response.status).toBe(201);
    expect(chatHistoryService.addMessage).toHaveBeenCalledWith({
      conversationId: 'conv-1',
      content: 'Hello',
      sender: 'user',
      userId: mockUser.iss_sub
    });
  });

  it('should return 400 when userId is missing', async () => {
    userProvisioningService.provisionUser.mockResolvedValue({
      ...mockUser,
      iss_sub: null
    });

    const response = await authPost('/api/chat/conversations', { title: 'Test' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      success: false,
      message: 'User ID is required but not found in request'
    });
  });
});

// ============================================================
// AC4 & AC5: GET /api/chat/conversations/:conversationId
// ============================================================
describe('GET /api/chat/conversations/:conversationId (AC4, AC5)', () => {
  it('should return 200 with conversation details', async () => {
    const convDetail = {
      ...sampleConversation,
      messages: [sampleMessage],
      categories: [],
      owners: [],
      files: []
    };
    chatHistoryService.getConversation.mockResolvedValue(convDetail);

    const response = await authGet('/api/chat/conversations/conv-1');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(convDetail);
    expect(chatHistoryService.getConversation).toHaveBeenCalledWith('conv-1');
  });

  it('should return 404 when conversation not found', async () => {
    chatHistoryService.getConversation.mockResolvedValue(null);

    const response = await authGet('/api/chat/conversations/nonexistent');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ message: 'Conversation not found' });
  });
});

// ============================================================
// AC6: GET /api/chat/conversations/:conversationId/messages
// ============================================================
describe('GET /api/chat/conversations/:conversationId/messages (AC6)', () => {
  it('should return 200 with messages and pagination', async () => {
    const mockResult = {
      messages: [sampleMessage],
      pagination: { total: 1, limit: 50, offset: 0 }
    };
    chatHistoryService.getConversationMessages.mockResolvedValue(mockResult);

    const response = await authGet('/api/chat/conversations/conv-1/messages?limit=10&offset=0&newestFirst=true');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(mockResult);
    expect(chatHistoryService.getConversationMessages).toHaveBeenCalledWith(
      'conv-1',
      expect.objectContaining({
        limit: 10,
        offset: 0,
        newestFirst: true
      })
    );
  });
});

// ============================================================
// AC7 & AC8: POST /api/chat/conversations/:conversationId/messages
// ============================================================
describe('POST /api/chat/conversations/:conversationId/messages (AC7, AC8)', () => {
  it('should return 201 and add a user message', async () => {
    chatHistoryService.addMessage.mockResolvedValue(sampleMessage);

    const response = await authPost('/api/chat/conversations/conv-1/messages', {
      content: 'Hello world',
      sender: 'user'
    });

    expect(response.status).toBe(201);
    expect(response.body).toEqual(sampleMessage);
    expect(chatHistoryService.addMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv-1',
        content: 'Hello world',
        sender: 'user',
        userId: mockUser.iss_sub
      })
    );
  });

  it('should return 201 for assistant message with query linking', async () => {
    const assistantMsg = { ...sampleMessage, sender: 'assistant', _key: 'msg-2' };
    chatHistoryService.addMessage.mockResolvedValue(assistantMsg);

    const mockDoc = jest.fn().mockResolvedValue({ _id: 'queries/q-1' });
    chatHistoryService.db.collection.mockReturnValue({ document: mockDoc });
    chatHistoryService.linkQueryToConversation.mockResolvedValue({});

    const response = await authPost('/api/chat/conversations/conv-1/messages', {
      content: 'Response text',
      sender: 'assistant',
      queryId: 'q-1'
    });

    expect(response.status).toBe(201);
    expect(chatHistoryService.db.collection).toHaveBeenCalledWith('queries');
    expect(mockDoc).toHaveBeenCalledWith('q-1');
    expect(chatHistoryService.linkQueryToConversation).toHaveBeenCalledWith('q-1', 'conv-1', 'msg-2', {
      responseType: 'primary'
    });
  });

  it('should skip query linking when queryId is invalid', async () => {
    const assistantMsg = { ...sampleMessage, sender: 'assistant', _key: 'msg-3' };
    chatHistoryService.addMessage.mockResolvedValue(assistantMsg);

    const mockDoc = jest.fn().mockRejectedValue(new Error('Not found'));
    chatHistoryService.db.collection.mockReturnValue({ document: mockDoc });

    const response = await authPost('/api/chat/conversations/conv-1/messages', {
      content: 'Response',
      sender: 'assistant',
      queryId: 'invalid-query'
    });

    expect(response.status).toBe(201);
    expect(chatHistoryService.linkQueryToConversation).not.toHaveBeenCalled();
  });

  it('should return 400 when request body is missing', async () => {
    const response = await request(app)
      .post('/api/chat/conversations/conv-1/messages')
      .set('Authorization', `Bearer ${validToken}`)
      .set('Content-Type', 'application/json');

    expect(response.status).toBe(400);
    // Express parses empty JSON body as {} — falls through to content check
    expect(response.body).toEqual({ message: 'Message content is required' });
  });

  it('should return 400 when content is missing', async () => {
    const response = await authPost('/api/chat/conversations/conv-1/messages', {
      sender: 'user'
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ message: 'Message content is required' });
  });

  it('should return 400 when sender is invalid', async () => {
    const response = await authPost('/api/chat/conversations/conv-1/messages', {
      content: 'Hello',
      sender: 'system'
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ message: 'Sender must be either "user" or "assistant"' });
  });

  it('should return 400 when sender is missing', async () => {
    const response = await authPost('/api/chat/conversations/conv-1/messages', {
      content: 'Hello'
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ message: 'Sender must be either "user" or "assistant"' });
  });
});

// ============================================================
// Utility routes: search, recent, stats
// ============================================================
describe('GET /api/chat/search', () => {
  it('should return 200 with search results', async () => {
    const searchResults = {
      conversations: [sampleConversation],
      pagination: { total: 1, limit: 20, offset: 0 }
    };
    chatHistoryService.searchConversations.mockResolvedValue(searchResults);

    const response = await authGet('/api/chat/search?q=test&limit=10&offset=0&includeArchived=true');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(searchResults);
    expect(chatHistoryService.searchConversations).toHaveBeenCalledWith(
      mockUser.iss_sub,
      'test',
      expect.objectContaining({
        limit: 10,
        offset: 0,
        includeArchived: true,
        userKey: mockUser._key
      })
    );
  });

  it('should return 400 when search term is missing', async () => {
    const response = await authGet('/api/chat/search');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ message: 'Search term is required' });
  });

  it('should return 400 when userId is missing', async () => {
    userProvisioningService.provisionUser.mockResolvedValue({
      ...mockUser,
      iss_sub: null
    });

    const response = await authGet('/api/chat/search?q=test');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      success: false,
      message: 'User ID is required but not found in request'
    });
  });
});

describe('GET /api/chat/recent', () => {
  it('should return 200 with recent conversations', async () => {
    const recentConversations = [sampleConversation];
    chatHistoryService.getRecentConversations.mockResolvedValue(recentConversations);

    const response = await authGet('/api/chat/recent?limit=3');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(recentConversations);
    expect(chatHistoryService.getRecentConversations).toHaveBeenCalledWith(mockUser.iss_sub, 3, mockUser._key);
  });

  it('should use default limit when not provided', async () => {
    chatHistoryService.getRecentConversations.mockResolvedValue([]);

    await authGet('/api/chat/recent');

    expect(chatHistoryService.getRecentConversations).toHaveBeenCalledWith(mockUser.iss_sub, 5, mockUser._key);
  });

  it('should return 400 when userId is missing', async () => {
    userProvisioningService.provisionUser.mockResolvedValue({
      ...mockUser,
      iss_sub: null
    });

    const response = await authGet('/api/chat/recent');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      success: false,
      message: 'User ID is required but not found in request'
    });
  });
});

describe('GET /api/chat/stats', () => {
  it('should return 200 with conversation statistics', async () => {
    const stats = {
      totalCount: 10,
      activeCount: 8,
      archivedCount: 2,
      starredCount: 3,
      messageCount: 45
    };
    chatHistoryService.getUserConversationStats.mockResolvedValue(stats);

    const response = await authGet('/api/chat/stats');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(stats);
    expect(chatHistoryService.getUserConversationStats).toHaveBeenCalledWith(mockUser.iss_sub, mockUser._key);
  });

  it('should return 400 when userId is missing', async () => {
    userProvisioningService.provisionUser.mockResolvedValue({
      ...mockUser,
      iss_sub: null
    });

    const response = await authGet('/api/chat/stats');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      success: false,
      message: 'User ID is required but not found in request'
    });
  });
});

// ============================================================
// Query linking routes
// ============================================================
describe('GET /api/chat/query/:queryId/messages', () => {
  it('should return 200 with messages for a query', async () => {
    const queryMessages = [{ message: sampleMessage, conversation: sampleConversation, responseType: 'primary' }];
    chatHistoryService.findMessagesForQuery.mockResolvedValue(queryMessages);

    const response = await authGet('/api/chat/query/q-1/messages');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(queryMessages);
    expect(chatHistoryService.findMessagesForQuery).toHaveBeenCalledWith('q-1', mockUser.iss_sub);
  });
});

describe('GET /api/chat/messages/:messageId/query', () => {
  it('should return 200 with originating query', async () => {
    const originQuery = { _id: 'queries/q-1', _key: 'q-1', text: 'What is AI?' };
    chatHistoryService.findOriginatingQuery.mockResolvedValue(originQuery);

    const response = await authGet('/api/chat/messages/msg-1/query');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(originQuery);
    expect(chatHistoryService.findOriginatingQuery).toHaveBeenCalledWith('msg-1');
  });

  it('should return 404 when no originating query found', async () => {
    chatHistoryService.findOriginatingQuery.mockResolvedValue(null);

    const response = await authGet('/api/chat/messages/msg-1/query');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ message: 'No originating query found for this message' });
  });
});

describe('POST /api/chat/query/:queryId/conversation', () => {
  it('should return 201 and create conversation from query', async () => {
    const newConversation = { ...sampleConversation, title: 'What is AI?' };
    chatHistoryService.createConversationFromQuery.mockResolvedValue(newConversation);

    const response = await authPost('/api/chat/query/q-1/conversation', {
      title: 'What is AI?',
      tags: ['ai']
    });

    expect(response.status).toBe(201);
    expect(response.body).toEqual(newConversation);
    expect(chatHistoryService.createConversationFromQuery).toHaveBeenCalledWith(
      'q-1',
      mockUser.iss_sub,
      expect.objectContaining({
        title: 'What is AI?',
        tags: ['ai'],
        userKey: mockUser._key
      })
    );
  });

  it('should return 400 when userId is missing', async () => {
    userProvisioningService.provisionUser.mockResolvedValue({
      ...mockUser,
      iss_sub: null
    });

    const response = await authPost('/api/chat/query/q-1/conversation', {});

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      success: false,
      message: 'User ID is required but not found in request'
    });
  });
});
