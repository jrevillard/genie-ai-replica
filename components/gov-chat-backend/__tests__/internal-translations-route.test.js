'use strict';

jest.mock('../shared-lib', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));
jest.mock('../middleware/auth-middleware', () => ({
  authenticate: (req, res) => res.status(401).json({ message: 'unauthenticated' })
}));

const express = require('express');
const request = require('supertest');
const chatSessionRoutes = require('../routes/chat-session-routes');

const URL = '/api/chat-sessions/internal/message-translations';
const BODY = { translations: [{ _key: 'm1', contentEn: 'hello' }] };

describe(`POST ${URL}`, () => {
  let service;
  let app;

  beforeEach(() => {
    service = { createSession: jest.fn(), bulkSaveMessageTranslations: jest.fn().mockResolvedValue() };
    app = express();
    app.use(express.json());
    app.use('/api/chat-sessions', chatSessionRoutes(service));
  });

  it('saves translations sent directly from inside the stack', async () => {
    const res = await request(app).post(URL).send(BODY);
    expect(res.status).toBe(200);
    expect(service.bulkSaveMessageTranslations).toHaveBeenCalledWith(BODY.translations);
  });

  it.each(['X-Forwarded-For', 'X-Real-IP'])('refuses a request that came through the gateway (%s)', async (header) => {
    const res = await request(app).post(URL).set(header, '203.0.113.7').send(BODY);
    expect(res.status).toBe(404);
    expect(service.bulkSaveMessageTranslations).not.toHaveBeenCalled();
  });
});
