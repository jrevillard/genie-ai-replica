'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const request = require('supertest');

jest.mock('../shared-lib', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));

jest.mock('axios', () => ({ post: jest.fn() }));

// A valid session token sets req.user; any other token is rejected like the real middleware does.
jest.mock('../middleware/auth-middleware', () => ({
  authenticate: jest.fn((req, res, next) => {
    if (req.headers.authorization === 'Bearer valid-token') {
      req.user = { _key: 'user-1', role: 'User' };
      return next();
    }
    return res.status(401).json({ error: 'Unauthorized', message: 'Please log in again' });
  })
}));

jest.mock('../services/ai-twin-service', () => ({
  listTwins: jest.fn(),
  getTwinByKey: jest.fn(),
  getDefaultTwin: jest.fn(),
  getSuggestedQuestions: jest.fn()
}));

jest.mock('../services/chat-session-service', () => ({
  sessions: { document: jest.fn(), save: jest.fn() },
  sendMessage: jest.fn(),
  getRecentMessagesChronological: jest.fn(),
  searchMessages: jest.fn(),
  getMessage: jest.fn()
}));

jest.mock('../services/voice-token-service', () => ({ initialized: true, mintToken: jest.fn() }));
jest.mock('../services/voice-catalog-service', () => ({ getVoice: jest.fn() }));

const axios = require('axios');
const authMiddleware = require('../middleware/auth-middleware');
const aiTwinService = require('../services/ai-twin-service');
const chatSessionService = require('../services/chat-session-service');
const voiceTokenService = require('../services/voice-token-service');
const voiceCatalogService = require('../services/voice-catalog-service');

const ALLOWED = 'twin-allowed';
const SECOND = 'twin-second';
const OTHER = 'twin-other';
const DEFAULT = 'twin-default';
const SIGNED_IN = { Authorization: 'Bearer valid-token' };
// The session's public userId, and the separate secret its guest holds (X-Guest-Id).
const OWNER_USER_ID = 'guest:2b7c1f0e-5d3a-4c6b-9e8f-1a2b3c4d5e6f';
const OWNER = 'owner-secret-0123456789abcdefghijklmnopqrstuv';
const sha256 = (s) => require('crypto').createHash('sha256').update(s).digest('hex');

// Keep the router's voice-note directory out of the repository.
const savedEnv = { UPLOAD_DIR: process.env.UPLOAD_DIR, PUBLIC_TWIN_IDS: process.env.PUBLIC_TWIN_IDS };
const uploadRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'public-routes-'));
process.env.UPLOAD_DIR = path.relative(path.join(__dirname, '..'), uploadRoot);

const app = express();
app.use(express.json());
app.use('/api/public', require('../routes/public-routes'));

function twinDoc(key) {
  return { _key: key, name: `Name ${key}`, description: 'd', profilePicUrl: null, voiceId: 'voice-1' };
}

function guestSession(twinId) {
  return { _key: 'session-1', userId: OWNER_USER_ID, guestSecretHash: sha256(OWNER), twinId, type: 'chat' };
}

function expectNotAllowed(res) {
  expect(res.status).toBe(404);
  expect(res.body.code).toBe('GUEST_TWIN_NOT_ALLOWED');
}

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.PUBLIC_TWIN_IDS;
  aiTwinService.listTwins.mockResolvedValue({ twins: [twinDoc(ALLOWED)], total: 1 });
  aiTwinService.getTwinByKey.mockImplementation(async (key) => twinDoc(key));
  aiTwinService.getDefaultTwin.mockResolvedValue(twinDoc(DEFAULT));
  aiTwinService.getSuggestedQuestions.mockResolvedValue([{ order: 1, category: 'c', content: 'q' }]);
  chatSessionService.sessions.save.mockResolvedValue({ _key: 'session-new' });
  chatSessionService.sendMessage.mockResolvedValue({
    sessionId: 'session-1',
    userMessageId: 'm1',
    assistantMessageId: 'm2',
    response: 'reply'
  });
  chatSessionService.getRecentMessagesChronological.mockResolvedValue([]);
  chatSessionService.getMessage.mockResolvedValue({ _key: 'm2', role: 'assistant', content: 'reply' });
  voiceTokenService.mintToken.mockImplementation(async ({ twinId }) => ({ voiceToken: 't', twinId }));
  voiceCatalogService.getVoice.mockResolvedValue({ language: 'en', modelVoiceId: 'piper-en' });
  axios.post.mockResolvedValue({ data: Buffer.from([0, 0]), headers: { 'x-sample-rate': '16000' } });
});

afterAll(() => {
  fs.rmSync(uploadRoot, { recursive: true, force: true });
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('PUBLIC_TWIN_IDS set', () => {
  beforeEach(() => {
    process.env.PUBLIC_TWIN_IDS = ` ${ALLOWED}, ${SECOND} ,`;
  });

  describe('GET /ai-twins', () => {
    it('lists only the allowed twins for a guest', async () => {
      const res = await request(app).get('/api/public/ai-twins');
      expect(res.status).toBe(200);
      expect(aiTwinService.listTwins).toHaveBeenCalledWith(expect.objectContaining({ allowedIds: [ALLOWED, SECOND] }));
    });

    it('lists every twin for a signed-in user', async () => {
      const res = await request(app).get('/api/public/ai-twins').set(SIGNED_IN);
      expect(res.status).toBe(200);
      expect(aiTwinService.listTwins).toHaveBeenCalledWith(expect.objectContaining({ allowedIds: null }));
    });

    it('answers 401 to a token that does not verify, so the client refreshes it', async () => {
      const res = await request(app).get('/api/public/ai-twins').set({ Authorization: 'Bearer expired' });
      expect(res.status).toBe(401);
      expect(aiTwinService.listTwins).not.toHaveBeenCalled();
    });
  });

  describe('GET /ai-twins/:id', () => {
    it('serves an allowed twin to a guest', async () => {
      const res = await request(app).get(`/api/public/ai-twins/${ALLOWED}`);
      expect(res.status).toBe(200);
      expect(res.body._key).toBe(ALLOWED);
    });

    it('refuses any other twin to a guest without looking it up', async () => {
      const res = await request(app).get(`/api/public/ai-twins/${OTHER}`);
      expectNotAllowed(res);
      expect(aiTwinService.getTwinByKey).not.toHaveBeenCalled();
    });

    it('serves any twin to a signed-in user', async () => {
      const res = await request(app).get(`/api/public/ai-twins/${OTHER}`).set(SIGNED_IN);
      expect(res.status).toBe(200);
      expect(res.body._key).toBe(OTHER);
    });
  });

  describe('GET /ai-twins/:id/suggested-questions', () => {
    it('serves an allowed twin to a guest', async () => {
      const res = await request(app).get(`/api/public/ai-twins/${ALLOWED}/suggested-questions`);
      expect(res.status).toBe(200);
    });

    it('refuses any other twin to a guest', async () => {
      const res = await request(app).get(`/api/public/ai-twins/${OTHER}/suggested-questions`);
      expectNotAllowed(res);
      expect(aiTwinService.getSuggestedQuestions).not.toHaveBeenCalled();
    });

    it('serves any twin to a signed-in user', async () => {
      const res = await request(app).get(`/api/public/ai-twins/${OTHER}/suggested-questions`).set(SIGNED_IN);
      expect(res.status).toBe(200);
    });
  });

  describe('POST /chat-sessions', () => {
    it('creates a session for an allowed twin', async () => {
      const res = await request(app).post('/api/public/chat-sessions').send({ twinId: SECOND });
      expect(res.status).toBe(201);
      expect(res.body.twinId).toBe(SECOND);
    });

    it('refuses any other twin, even with a session token', async () => {
      const res = await request(app).post('/api/public/chat-sessions').set(SIGNED_IN).send({ twinId: OTHER });
      expectNotAllowed(res);
      expect(chatSessionService.sessions.save).not.toHaveBeenCalled();
    });

    it('uses the default twin when none is named and guests may use it', async () => {
      process.env.PUBLIC_TWIN_IDS = `${ALLOWED},${DEFAULT}`;
      const res = await request(app).post('/api/public/chat-sessions').send({});
      expect(res.status).toBe(201);
      expect(res.body.twinId).toBe(DEFAULT);
    });

    it('uses the first allowed twin when none is named and the default is not allowed', async () => {
      const res = await request(app).post('/api/public/chat-sessions').send({});
      expect(res.status).toBe(201);
      expect(res.body.twinId).toBe(ALLOWED);
      expect(chatSessionService.sessions.save).toHaveBeenCalledWith(expect.objectContaining({ twinId: ALLOWED }));
    });

    it('answers 503 when the first allowed twin does not exist', async () => {
      aiTwinService.getTwinByKey.mockRejectedValue(Object.assign(new Error('AI twin not found'), { statusCode: 404 }));
      const res = await request(app).post('/api/public/chat-sessions').send({});
      expect(res.status).toBe(503);
      expect(chatSessionService.sessions.save).not.toHaveBeenCalled();
    });
  });

  describe('POST /voice/token', () => {
    it('mints a token for an allowed twin', async () => {
      const res = await request(app).post('/api/public/voice/token').send({ twinId: ALLOWED });
      expect(res.status).toBe(200);
      expect(voiceTokenService.mintToken).toHaveBeenCalledWith(expect.objectContaining({ twinId: ALLOWED }));
    });

    it('refuses any other twin', async () => {
      const res = await request(app).post('/api/public/voice/token').send({ twinId: OTHER });
      expectNotAllowed(res);
      expect(voiceTokenService.mintToken).not.toHaveBeenCalled();
    });

    it('uses the first allowed twin when none is named and the default is not allowed', async () => {
      const res = await request(app).post('/api/public/voice/token').send({});
      expect(res.status).toBe(200);
      expect(voiceTokenService.mintToken).toHaveBeenCalledWith(expect.objectContaining({ twinId: ALLOWED }));
    });
  });

  describe('session routes', () => {
    it.each([
      ['POST', '/messages'],
      ['GET', '/messages'],
      ['GET', '/messages/m2/audio'],
      ['POST', '/voice-messages']
    ])('%s %s refuses a session whose twin is not allowed', async (method, suffix) => {
      chatSessionService.sessions.document.mockResolvedValue(guestSession(OTHER));
      const res = await send(method, suffix);
      expectNotAllowed(res);
      expect(chatSessionService.sendMessage).not.toHaveBeenCalled();
    });

    it.each([
      ['POST', '/messages'],
      ['GET', '/messages'],
      ['GET', '/messages/m2/audio'],
      ['POST', '/voice-messages']
    ])('%s %s serves a session whose twin is allowed', async (method, suffix) => {
      chatSessionService.sessions.document.mockResolvedValue(guestSession(ALLOWED));
      axios.post.mockImplementation(async (url) =>
        url.includes('/asr')
          ? { data: { text: 'hello' } }
          : { data: Buffer.from([0, 0]), headers: { 'x-sample-rate': '16000' } }
      );
      const res = await send(method, suffix);
      expect(res.status).toBe(200);
    });
  });
});

describe('PUBLIC_TWIN_IDS unset (no restriction)', () => {
  it('lists every twin and never checks the session token', async () => {
    const res = await request(app).get('/api/public/ai-twins').set({ Authorization: 'Bearer expired' });
    expect(res.status).toBe(200);
    expect(aiTwinService.listTwins).toHaveBeenCalledWith(expect.objectContaining({ allowedIds: null }));
    expect(authMiddleware.authenticate).not.toHaveBeenCalled();
  });

  it('serves any twin and its suggested questions to a guest', async () => {
    expect((await request(app).get(`/api/public/ai-twins/${OTHER}`)).status).toBe(200);
    expect((await request(app).get(`/api/public/ai-twins/${OTHER}/suggested-questions`)).status).toBe(200);
  });

  it('creates a session and mints a token for any twin', async () => {
    const created = await request(app).post('/api/public/chat-sessions').send({ twinId: OTHER });
    expect(created.status).toBe(201);
    expect(created.body.twinId).toBe(OTHER);
    const token = await request(app).post('/api/public/voice/token').send({ twinId: OTHER });
    expect(token.status).toBe(200);
  });

  it('falls back to the default twin when none is named', async () => {
    const created = await request(app).post('/api/public/chat-sessions').send({});
    expect(created.body.twinId).toBe(DEFAULT);
    await request(app).post('/api/public/voice/token').send({});
    expect(voiceTokenService.mintToken).toHaveBeenCalledWith(expect.objectContaining({ twinId: DEFAULT }));
  });

  it('serves a guest session for any twin', async () => {
    chatSessionService.sessions.document.mockResolvedValue(guestSession(OTHER));
    const res = await send('POST', '/messages');
    expect(res.status).toBe(200);
  });
});

describe('guest sessions are bound to their guest id', () => {
  const SESSION_ROUTES = [
    ['POST', '/messages'],
    ['GET', '/messages'],
    ['GET', '/messages/m2/audio'],
    ['POST', '/voice-messages']
  ];

  beforeEach(() => {
    chatSessionService.sessions.document.mockResolvedValue(guestSession(OTHER));
    axios.post.mockImplementation(async (url) =>
      url.includes('/asr') ? { data: { text: 'hello' } } : { data: Buffer.from([0, 0]), headers: {} }
    );
  });

  it.each(SESSION_ROUTES)('%s %s answers 404 without X-Guest-Id', async (method, suffix) => {
    const res = await send(method, suffix, null);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Chat session not found' });
    expect(chatSessionService.sendMessage).not.toHaveBeenCalled();
    expect(chatSessionService.getMessage).not.toHaveBeenCalled();
  });

  it.each(SESSION_ROUTES)('%s %s answers 404 to another guest id', async (method, suffix) => {
    const res = await send(method, suffix, 'guest:00000000-0000-4000-8000-000000000000');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Chat session not found' });
    expect(chatSessionService.sendMessage).not.toHaveBeenCalled();
    expect(chatSessionService.getRecentMessagesChronological).not.toHaveBeenCalled();
  });

  it.each(SESSION_ROUTES)('%s %s serves the guest who owns the session', async (method, suffix) => {
    const res = await send(method, suffix);
    expect(res.status).toBe(200);
  });

  it.each([`${OWNER}x`, OWNER.slice(0, -1), 'guest:', OWNER.toUpperCase(), sha256(OWNER)])(
    'refuses a near-miss id %s',
    async (guestId) => {
      const res = await send('GET', '/messages', guestId);
      expect(res.status).toBe(404);
    }
  );

  it('gives an unknown session the same answer as a wrong guest id', async () => {
    chatSessionService.sessions.document.mockRejectedValue(Object.assign(new Error('missing'), { errorNum: 1202 }));
    const unknown = await send('GET', '/messages');
    expect(unknown.status).toBe(404);
    expect(unknown.body).toEqual({ message: 'Chat session not found' });
  });

  it("never serves a signed-in user's session, even with its user id as X-Guest-Id", async () => {
    chatSessionService.sessions.document.mockResolvedValue({ _key: 'session-1', userId: 'user-1', twinId: OTHER });
    const res = await send('GET', '/messages', 'user-1');
    expect(res.status).toBe(404);
  });

  it('checks the guest id before the module, so a stranger learns nothing about the session', async () => {
    process.env.PUBLIC_TWIN_IDS = ALLOWED;
    const stranger = await send('GET', '/messages', 'guest:00000000-0000-4000-8000-000000000000');
    expect(stranger.body).toEqual({ message: 'Chat session not found' });
    const owner = await send('GET', '/messages');
    expectNotAllowed(owner);
  });

  it('accepts the guestId returned when the session was created', async () => {
    let saved;
    chatSessionService.sessions.save.mockImplementation(async (doc) => {
      saved = doc;
      return { _key: 'session-1' };
    });
    const created = await request(app).post('/api/public/chat-sessions').send({ twinId: OTHER });
    expect(created.status).toBe(201);
    // The secret is not the userId, and only its hash is stored.
    expect(saved.userId).toMatch(/^guest:/);
    expect(created.body.guestId).not.toBe(saved.userId);
    expect(saved.guestSecretHash).toBe(sha256(created.body.guestId));
    expect(JSON.stringify(saved)).not.toContain(created.body.guestId);
    chatSessionService.sessions.document.mockResolvedValue({ _key: 'session-1', ...saved });
    const res = await send('POST', '/messages', created.body.guestId);
    expect(res.status).toBe(200);
    expect(chatSessionService.sendMessage).toHaveBeenCalledWith(saved.userId, 'session-1', 'hi', {});
  });

  it("refuses the session's userId as X-Guest-Id (it shows in analytics and lists)", async () => {
    const res = await send('GET', '/messages', OWNER_USER_ID);
    expect(res.status).toBe(404);
  });

  it('never sends the secret hash to the browser', async () => {
    const res = await send('GET', '/messages');
    expect(res.status).toBe(200);
    expect(res.body.session).not.toHaveProperty('guestSecretHash');
    expect(res.body.session.userId).toBe(OWNER_USER_ID);
  });

  it('checks the guest before reading the upload', async () => {
    const audioDir = path.join(uploadRoot, 'chat-audio');
    const before = fs.readdirSync(audioDir);
    // A file multer would refuse (400) shows which check runs first.
    const res = await request(app)
      .post('/api/public/chat-sessions/session-1/voice-messages')
      .set({ 'X-Guest-Id': 'not-the-secret' })
      .attach('audio', Buffer.from('fake'), { filename: 'a.txt', contentType: 'text/plain' });
    expect(res.status).toBe(404);
    expect(fs.readdirSync(audioDir)).toEqual(before);
  });

  it('names the voice-note file from the checked session key, not the URL', async () => {
    const audioDir = path.join(uploadRoot, 'chat-audio');
    const before = new Set(fs.readdirSync(audioDir));
    const res = await request(app)
      .post('/api/public/chat-sessions/session-1%2F..%2F..%2Fescaped/voice-messages')
      .set({ 'X-Guest-Id': OWNER })
      .attach('audio', Buffer.from('fake'), { filename: 'a.webm', contentType: 'audio/webm' });
    expect(res.status).toBe(200);
    expect(fs.readdirSync(uploadRoot).filter((f) => f.startsWith('escaped'))).toEqual([]);
    const added = fs.readdirSync(audioDir).filter((f) => !before.has(f));
    expect(added).toHaveLength(1);
    expect(added[0]).toMatch(/^session-1-\d+\.webm$/);
  });
});

// Calls a session route as the session's guest; pass null to send no X-Guest-Id.
function send(method, suffix, guestId = OWNER) {
  const url = `/api/public/chat-sessions/session-1${suffix}`;
  const headers = guestId === null ? {} : { 'X-Guest-Id': guestId };
  if (method === 'GET') return request(app).get(url).set(headers);
  if (suffix === '/voice-messages') {
    return request(app)
      .post(url)
      .set(headers)
      .attach('audio', Buffer.from('fake'), { filename: 'a.webm', contentType: 'audio/webm' });
  }
  return request(app).post(url).set(headers).send({ text: 'hi' });
}
