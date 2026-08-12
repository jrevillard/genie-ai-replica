// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Mock the shared OIDC verifier — health tests don't exercise auth, and this keeps
// jose (ESM-only, Node 22 require()-of-ESM at runtime) from loading under Jest's CJS system.
jest.mock('../shared-lib/keycloak-auth-service', () => ({ verifyToken: jest.fn() }));

const request = require('supertest');
const { createApp } = require('../index');

describe('OKF Server skeleton', () => {
  let app;

  beforeAll(() => {
    app = createApp();
  });

  test('GET /health returns 200 + ok status', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('okf-server');
  });

  test('GET /ready returns 200', async () => {
    const res = await request(app).get('/ready');
    expect(res.status).toBe(200);
  });

  test('createApp returns an Express app (function with use/listen)', () => {
    expect(typeof app).toBe('function');
    expect(typeof app.use).toBe('function');
    expect(typeof app.listen).toBe('function');
  });
});
