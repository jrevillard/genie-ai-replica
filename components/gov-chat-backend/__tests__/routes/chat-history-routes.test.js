'use strict';

require('../setup-env');

jest.mock('../../shared-lib', () => require('../mocks/shared-lib'), { virtual: true });

jest.mock('../../services/keycloak-auth-service', () => ({
  verifyToken: jest.fn(),
  checkUserStatusInKeycloak: jest.fn()
}));

jest.mock('../../services/user-provisioning-service', () => ({
  provisionUser: jest.fn(),
  initialize: jest.fn(),
  markUserAsDeleted: jest.fn()
}));

jest.mock('../../services/session-service', () => ({
  getUserSessions: jest.fn(),
  endSession: jest.fn(),
  createSession: jest.fn()
}));

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

jest.mock('../../services/query-service', () => ({}));

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

jest.mock('../../services/user-profile-service', () => ({}));
jest.mock('../../services/admin-dashboard-service', () => ({}));
jest.mock('../../services/analytics-service', () => ({}));
jest.mock('../../services/service-category-service', () => ({}));
jest.mock('../../services/logs-service', () => ({}));
jest.mock('../../services/database-operations-service', () => ({}));
jest.mock('../../services/weather-service', () => ({}));
jest.mock('../../services/security-scan-service', () => ({}));
jest.mock('../../services/translation-service', () => ({}));

jest.mock(
  '../../controllers/analyticsController',
  () =>
    function () {
      return {};
    }
);

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

const keycloakAuthService = require('../../services/keycloak-auth-service');
const userProvisioningService = require('../../services/user-provisioning-service');
const chatHistoryService = require('../../services/chat-history-service');

const mockUser = createMockUser();
const validToken = createValidToken();

let app;
beforeAll(() => {
  app = createApp({ services: { chatHistoryService } });
});

beforeEach(() => {
  jest.clearAllMocks();
  keycloakAuthService.verifyToken.mockResolvedValue({
    sub: 'user-123',
    iss: 'http://localhost:8080/realms/genie',
    iss_sub: 'http://localhost:8080/realms/genie#user-123',
    realm_access: { roles: ['user'] }
  });
  keycloakAuthService.checkUserStatusInKeycloak.mockResolvedValue(null);
  userProvisioningService.provisionUser.mockResolvedValue(mockUser);
});

function authGet(path) {
  return request(app).get(path).set('Authorization', `Bearer ${validToken}`);
}
function authPost(path, body) {
  return request(app).post(path).set('Authorization', `Bearer ${validToken}`).send(body);
}
function authPatch(path, body) {
  return request(app).patch(path).set('Authorization', `Bearer ${validToken}`).send(body);
}
function authDelete(path) {
  return request(app).delete(path).set('Authorization', `Bearer ${validToken}`);
}

// ============================================================
// PATCH /api/chat/conversations/:conversationId
// ============================================================
describe('PATCH /api/chat/conversations/:conversationId', () => {
  it('should update conversation and return 200', async () => {
    chatHistoryService.updateConversation.mockResolvedValue({
      _key: 'conv-1',
      title: 'Updated'
    });

    const response = await authPatch('/api/chat/conversations/conv-1', { title: 'Updated' });

    expect(response.status).toBe(200);
    expect(chatHistoryService.updateConversation).toHaveBeenCalledWith(
      'conv-1',
      expect.objectContaining({ title: 'Updated', userId: mockUser.iss_sub })
    );
  });

  it('should return 400 when userId is missing', async () => {
    userProvisioningService.provisionUser.mockResolvedValue({ ...mockUser, iss_sub: undefined });

    const response = await authPatch('/api/chat/conversations/conv-1', { title: 'X' });
    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toContain('User ID is required');
  });

  it('should pass next on service error', async () => {
    chatHistoryService.updateConversation.mockRejectedValue(new Error('DB error'));

    const response = await authPatch('/api/chat/conversations/conv-1', { title: 'X' });
    expect(response.status).toBe(500);
  });
});

// ============================================================
// DELETE /api/chat/conversations/:conversationId
// ============================================================
describe('DELETE /api/chat/conversations/:conversationId', () => {
  it('should delete conversation and return 200', async () => {
    chatHistoryService.deleteConversation.mockResolvedValue({ success: true });

    const response = await authDelete('/api/chat/conversations/conv-1');

    expect(response.status).toBe(200);
    expect(chatHistoryService.deleteConversation).toHaveBeenCalledWith('conv-1', mockUser.iss_sub, mockUser._key);
  });

  it('should return 400 when userId is missing', async () => {
    userProvisioningService.provisionUser.mockResolvedValue({ ...mockUser, iss_sub: undefined });

    const response = await authDelete('/api/chat/conversations/conv-1');
    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toContain('User ID is required');
  });
});

// ============================================================
// POST /api/chat/conversations/:conversationId/messages/read
// ============================================================
describe('POST /api/chat/conversations/:conversationId/messages/read', () => {
  it('should mark messages as read', async () => {
    chatHistoryService.markMessagesAsRead.mockResolvedValue({ count: 2 });

    const response = await authPost('/api/chat/conversations/conv-1/messages/read', {
      messageIds: ['msg-1', 'msg-2']
    });

    expect(response.status).toBe(200);
    expect(chatHistoryService.markMessagesAsRead).toHaveBeenCalledWith('conv-1', ['msg-1', 'msg-2']);
  });
});

// ============================================================
// GET /api/chat/folders
// ============================================================
describe('GET /api/chat/folders', () => {
  it('should return user folders', async () => {
    const folders = [{ _key: 'f-1', name: 'Docs' }];
    chatHistoryService.getUserFolders.mockResolvedValue(folders);

    const response = await authGet('/api/chat/folders');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(folders);
    expect(chatHistoryService.getUserFolders).toHaveBeenCalledWith(
      mockUser.iss_sub,
      expect.objectContaining({ includeArchived: false, parentFolderId: null, userKey: mockUser._key })
    );
  });

  it('should pass includeArchived and parentFolderId', async () => {
    chatHistoryService.getUserFolders.mockResolvedValue([]);

    await authGet('/api/chat/folders?includeArchived=true&parentFolderId=pf-1');

    expect(chatHistoryService.getUserFolders).toHaveBeenCalledWith(
      mockUser.iss_sub,
      expect.objectContaining({ includeArchived: true, parentFolderId: 'pf-1' })
    );
  });

  it('should return 400 when userId is missing', async () => {
    userProvisioningService.provisionUser.mockResolvedValue({ ...mockUser, iss_sub: undefined });

    const response = await authGet('/api/chat/folders');
    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toContain('User ID is required');
  });
});

// ============================================================
// POST /api/chat/folders
// ============================================================
describe('POST /api/chat/folders', () => {
  it('should create folder and return 201', async () => {
    chatHistoryService.getUserFolders.mockResolvedValue([]);
    chatHistoryService.createFolder.mockResolvedValue({ _key: 'f-1', name: 'New Folder' });

    const response = await authPost('/api/chat/folders', { name: 'New Folder' });

    expect(response.status).toBe(201);
    expect(chatHistoryService.createFolder).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: mockUser.iss_sub,
        name: 'New Folder'
      })
    );
  });

  it('should return 400 when name is missing', async () => {
    const response = await authPost('/api/chat/folders', {});
    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Folder name is required');
  });

  it('should return 403 when user lacks permission on parent folder', async () => {
    chatHistoryService.getFolder.mockResolvedValue({
      _key: 'pf-1',
      owners: [{ iss_sub: 'other-user' }]
    });

    const response = await authPost('/api/chat/folders', {
      name: 'Sub',
      parentFolderId: 'pf-1'
    });

    expect(response.status).toBe(403);
    expect(response.body.message).toContain('permission');
  });

  it('should return 404 when parent folder not found', async () => {
    chatHistoryService.getFolder.mockRejectedValue(new Error('Not found'));

    const response = await authPost('/api/chat/folders', {
      name: 'Sub',
      parentFolderId: 'missing'
    });

    expect(response.status).toBe(404);
    expect(response.body.message).toBe('Parent folder not found');
  });

  it('should return 400 when userId is missing', async () => {
    userProvisioningService.provisionUser.mockResolvedValue({ ...mockUser, iss_sub: undefined });

    const response = await authPost('/api/chat/folders', { name: 'Test' });
    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toContain('User ID is required');
  });
});

// ============================================================
// GET /api/chat/folders/:folderId
// ============================================================
describe('GET /api/chat/folders/:folderId', () => {
  it('should return folder details', async () => {
    chatHistoryService.getFolder.mockResolvedValue({ _key: 'f-1', name: 'Docs' });

    const response = await authGet('/api/chat/folders/f-1');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ _key: 'f-1', name: 'Docs' });
  });

  it('should return 404 when folder not found', async () => {
    chatHistoryService.getFolder.mockResolvedValue(null);

    const response = await authGet('/api/chat/folders/missing');
    expect(response.status).toBe(404);
    expect(response.body.message).toBe('Folder not found');
  });
});

// ============================================================
// PATCH /api/chat/folders/:folderId
// ============================================================
describe('PATCH /api/chat/folders/:folderId', () => {
  it('should update folder and return 200', async () => {
    chatHistoryService.updateFolder.mockResolvedValue({ _key: 'f-1', name: 'Updated' });

    const response = await authPatch('/api/chat/folders/f-1', { name: 'Updated' });

    expect(response.status).toBe(200);
    expect(chatHistoryService.updateFolder).toHaveBeenCalledWith(
      'f-1',
      expect.objectContaining({ name: 'Updated', userId: mockUser.iss_sub })
    );
  });

  it('should return 400 when folder is its own parent', async () => {
    const response = await authPatch('/api/chat/folders/f-1', { parentFolderId: 'f-1' });
    expect(response.status).toBe(400);
    expect(response.body.message).toBe('A folder cannot be its own parent');
  });

  it('should return 400 when creating circular parent reference', async () => {
    chatHistoryService.getFolderPath.mockResolvedValue([{ _key: 'f-1' }]);

    const response = await authPatch('/api/chat/folders/f-1', { parentFolderId: 'f-2' });
    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Cannot move a folder to its own subfolder');
  });

  it('should return 404 when target parent not found', async () => {
    chatHistoryService.getFolderPath.mockRejectedValue(new Error('Not found'));

    const response = await authPatch('/api/chat/folders/f-1', { parentFolderId: 'missing' });
    expect(response.status).toBe(404);
    expect(response.body.message).toBe('Target parent folder not found');
  });

  it('should return 400 when userId is missing', async () => {
    userProvisioningService.provisionUser.mockResolvedValue({ ...mockUser, iss_sub: undefined });

    const response = await authPatch('/api/chat/folders/f-1', { name: 'X' });
    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toContain('User ID is required');
  });
});

// ============================================================
// DELETE /api/chat/folders/:folderId
// ============================================================
describe('DELETE /api/chat/folders/:folderId', () => {
  it('should delete folder and return 200', async () => {
    chatHistoryService.deleteFolder.mockResolvedValue({ success: true });

    const response = await authDelete('/api/chat/folders/f-1');

    expect(response.status).toBe(200);
    expect(chatHistoryService.deleteFolder).toHaveBeenCalledWith('f-1', mockUser.iss_sub, false, mockUser._key);
  });

  it('should pass deleteContents=true', async () => {
    chatHistoryService.deleteFolder.mockResolvedValue({ success: true });

    await authDelete('/api/chat/folders/f-1?deleteContents=true');

    expect(chatHistoryService.deleteFolder).toHaveBeenCalledWith('f-1', mockUser.iss_sub, true, mockUser._key);
  });

  it('should return 400 when userId is missing', async () => {
    userProvisioningService.provisionUser.mockResolvedValue({ ...mockUser, iss_sub: undefined });

    const response = await authDelete('/api/chat/folders/f-1');
    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toContain('User ID is required');
  });
});

// ============================================================
// GET /api/chat/folders/search
// ============================================================
describe('GET /api/chat/folders/search', () => {
  it('should return search results', async () => {
    const results = [{ _key: 'f-1', name: 'Tax Docs' }];
    chatHistoryService.searchFolders.mockResolvedValue(results);

    const response = await authGet('/api/chat/folders/search?q=tax');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(results);
    expect(chatHistoryService.searchFolders).toHaveBeenCalledWith(
      mockUser.iss_sub,
      'tax',
      expect.objectContaining({ includeArchived: false, userKey: mockUser._key })
    );
  });

  it('should return 400 when search term is missing', async () => {
    const response = await authGet('/api/chat/folders/search');
    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Search term is required');
  });

  it('should return 400 when userId is missing', async () => {
    userProvisioningService.provisionUser.mockResolvedValue({ ...mockUser, iss_sub: undefined });

    const response = await authGet('/api/chat/folders/search?q=test');
    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toContain('User ID is required');
  });
});

// ============================================================
// POST /api/chat/folders/reorder
// ============================================================
describe('POST /api/chat/folders/reorder', () => {
  it('should reorder folders and return 200', async () => {
    chatHistoryService.reorderFolders.mockResolvedValue({ updatedFolders: 2, success: true });

    const response = await authPost('/api/chat/folders/reorder', {
      folderOrders: [
        { folderId: 'f-1', order: 1 },
        { folderId: 'f-2', order: 2 }
      ],
      parentFolderId: null
    });

    expect(response.status).toBe(200);
    expect(chatHistoryService.reorderFolders).toHaveBeenCalledWith(
      mockUser.iss_sub,
      [
        { folderId: 'f-1', order: 1 },
        { folderId: 'f-2', order: 2 }
      ],
      null,
      mockUser._key
    );
  });

  it('should return 400 when folderOrders is missing', async () => {
    const response = await authPost('/api/chat/folders/reorder', {});
    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Invalid folder orders data');
  });

  it('should return 400 when folderOrders is empty', async () => {
    const response = await authPost('/api/chat/folders/reorder', { folderOrders: [] });
    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Invalid folder orders data');
  });

  it('should return 400 when userId is missing', async () => {
    userProvisioningService.provisionUser.mockResolvedValue({ ...mockUser, iss_sub: undefined });

    const response = await authPost('/api/chat/folders/reorder', {
      folderOrders: [{ folderId: 'f-1', order: 1 }]
    });
    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toContain('User ID is required');
  });
});

// ============================================================
// GET /api/chat/folders/:folderId/path
// ============================================================
describe('GET /api/chat/folders/:folderId/path', () => {
  it('should return folder path', async () => {
    const path = [{ _key: 'root' }, { _key: 'f-1' }];
    chatHistoryService.getFolderPath.mockResolvedValue(path);

    const response = await authGet('/api/chat/folders/f-1/path');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(path);
  });

  it('should pass error to next on failure', async () => {
    chatHistoryService.getFolderPath.mockRejectedValue(new Error('Not found'));

    const response = await authGet('/api/chat/folders/missing/path');
    expect(response.status).toBe(500);
  });
});

// ============================================================
// POST /api/chat/folders/:folderId/conversations/:conversationId
// ============================================================
describe('POST /api/chat/folders/:folderId/conversations/:conversationId', () => {
  it('should add conversation to folder', async () => {
    chatHistoryService.addConversationToFolder.mockResolvedValue({ success: true });

    const response = await authPost('/api/chat/folders/f-1/conversations/conv-1');

    expect(response.status).toBe(200);
    expect(chatHistoryService.addConversationToFolder).toHaveBeenCalledWith(
      'f-1',
      'conv-1',
      mockUser.iss_sub,
      mockUser._key
    );
  });

  it('should return 400 when userId is missing', async () => {
    userProvisioningService.provisionUser.mockResolvedValue({ ...mockUser, iss_sub: undefined });

    const response = await authPost('/api/chat/folders/f-1/conversations/conv-1');
    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toContain('User ID is required');
  });
});

// ============================================================
// DELETE /api/chat/folders/:folderId/conversations/:conversationId
// ============================================================
describe('DELETE /api/chat/folders/:folderId/conversations/:conversationId', () => {
  it('should remove conversation from folder', async () => {
    chatHistoryService.removeConversationFromFolder.mockResolvedValue({ success: true });

    const response = await authDelete('/api/chat/folders/f-1/conversations/conv-1');

    expect(response.status).toBe(200);
    expect(chatHistoryService.removeConversationFromFolder).toHaveBeenCalledWith(
      'f-1',
      'conv-1',
      mockUser.iss_sub,
      mockUser._key
    );
  });

  it('should return 400 when userId is missing', async () => {
    userProvisioningService.provisionUser.mockResolvedValue({ ...mockUser, iss_sub: undefined });

    const response = await authDelete('/api/chat/folders/f-1/conversations/conv-1');
    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toContain('User ID is required');
  });
});

// ============================================================
// GET /api/chat/conversations/:conversationId/folder
// ============================================================
describe('GET /api/chat/conversations/:conversationId/folder', () => {
  it('should return folder info when conversation is in a folder', async () => {
    const folder = { _key: 'f-1', name: 'Docs' };
    chatHistoryService.findConversationFolder.mockResolvedValue(folder);

    const response = await authGet('/api/chat/conversations/conv-1/folder');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ folder, inFolder: true });
  });

  it('should return 404 when conversation not in any folder', async () => {
    chatHistoryService.findConversationFolder.mockResolvedValue(null);

    const response = await authGet('/api/chat/conversations/conv-1/folder');

    expect(response.status).toBe(404);
    expect(response.body.message).toBe('Conversation not found or not in any folder');
    expect(response.body.inFolder).toBe(false);
  });
});

// ============================================================
// POST /api/chat/conversations/:conversationId/move
// ============================================================
describe('POST /api/chat/conversations/:conversationId/move', () => {
  it('should move conversation between folders', async () => {
    chatHistoryService.moveConversation.mockResolvedValue({ success: true });

    const response = await authPost('/api/chat/conversations/conv-1/move', {
      sourceFolderId: 'f-1',
      targetFolderId: 'f-2'
    });

    expect(response.status).toBe(200);
    expect(chatHistoryService.moveConversation).toHaveBeenCalledWith(
      'conv-1',
      'f-1',
      'f-2',
      mockUser.iss_sub,
      mockUser._key
    );
  });

  it('should return 400 when userId is missing', async () => {
    userProvisioningService.provisionUser.mockResolvedValue({ ...mockUser, iss_sub: undefined });

    const response = await authPost('/api/chat/conversations/conv-1/move', {
      sourceFolderId: 'f-1',
      targetFolderId: 'f-2'
    });
    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toContain('User ID is required');
  });
});
