'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const request = require('supertest');
const { uploadsGuard, isPrivateUploadPath } = require('../middleware/uploads-guard');

const FILES = ['call-recordings/101.wav', 'ai-twins/avatar.png', 'chat-audio/7-1700000000000.webm'];

describe('uploadsGuard on /Uploads', () => {
  let dir;
  let app;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uploads-guard-'));
    for (const rel of FILES) {
      fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), 'x');
    }
    // Same wiring as index.js
    app = express();
    app.use('/Uploads', uploadsGuard, express.static(dir));
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it.each([
    '/Uploads/call-recordings/101.wav',
    '/Uploads/call%2Drecordings/101.wav',
    '/Uploads//call-recordings/101.wav',
    '/Uploads/ai-twins%2F..%2Fcall-recordings/101.wav',
    '/Uploads/Call-Recordings/101.wav',
    '/uploads/call-recordings/101.wav',
    '/Uploads/'
  ])('GET %s returns 404', async (url) => {
    const res = await request(app).get(url);
    expect(res.status).toBe(404);
  });

  it.each(['/Uploads/ai-twins/avatar.png', '/Uploads/chat-audio/7-1700000000000.webm'])(
    'GET %s is still served',
    async (url) => {
      const res = await request(app).get(url);
      expect(res.status).toBe(200);
    }
  );
});

describe('isPrivateUploadPath', () => {
  // Plain dot segments are tested here, because the HTTP client resolves them before sending.
  it.each([
    ['/ai-twins/../call-recordings/101.wav', true],
    ['/%E0%A4%A', true],
    ['/ai-twins/avatar.png', false],
    ['/chat-audio/7-1700000000000.webm', false]
  ])('%s -> %s', (reqPath, expected) => {
    expect(isPrivateUploadPath(reqPath)).toBe(expected);
  });
});
