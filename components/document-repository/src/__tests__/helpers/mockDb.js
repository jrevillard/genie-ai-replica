'use strict';

function createMockDb(overrides = {}) {
  const mockQuery = jest.fn();
  const mockSave = jest.fn();
  const mockRemove = jest.fn();
  const mockUpdate = jest.fn();
  const mockDocument = jest.fn();

  const mockCollection = {
    save: mockSave,
    remove: mockRemove,
    update: mockUpdate,
    document: mockDocument
  };

  const mockDb = {
    query: mockQuery,
    collection: jest.fn().mockReturnValue(mockCollection),
    ...overrides
  };

  return {
    mockDb,
    mockQuery,
    mockCollection,
    mockSave,
    mockRemove,
    mockUpdate,
    mockDocument
  };
}

function createMockCursor(data) {
  if (Array.isArray(data)) {
    return {
      all: jest.fn().mockResolvedValue(data),
      next: jest.fn().mockResolvedValue(data[0] || null)
    };
  }
  return {
    all: jest.fn().mockResolvedValue(data ? [data] : []),
    next: jest.fn().mockResolvedValue(data || null)
  };
}

function createMockReq(overrides = {}) {
  return {
    headers: {},
    params: {},
    query: {},
    body: {},
    user: undefined,
    ...overrides
  };
}

function createMockRes() {
  const res = {
    json: jest.fn().mockReturnThis(),
    status: jest.fn().mockReturnThis(),
    setHeader: jest.fn().mockReturnThis(),
    sendFile: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis()
  };
  return res;
}

module.exports = {
  createMockDb,
  createMockCursor,
  createMockReq,
  createMockRes
};
