'use strict';

const { createMockUser } = require('./users');

function createMockReq(overrides = {}) {
  return {
    user: createMockUser(),
    params: {},
    query: {},
    body: {},
    headers: {},
    method: 'GET',
    path: '/',
    ...overrides
  };
}

function createMockRes() {
  const res = {
    json: jest.fn(),
    status: jest.fn().mockReturnThis(),
    send: jest.fn(),
    set: jest.fn().mockReturnThis(),
    setHeader: jest.fn().mockReturnThis(),
    getHeader: jest.fn()
  };
  return res;
}

function createMockNext() {
  return jest.fn();
}

module.exports = { createMockReq, createMockRes, createMockNext };
