// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// The auth-claims boundary for the service roles, driven through the REAL
// keycloak-auth-middleware — only jose's JWT verification is stubbed; mapRole,
// authorizeRole and the rolePolicy lists are the code under test. Every other
// suite in the component mocks the whole middleware, which left the verbatim
// service-role mappings (okf-service, tools-admin) untested anywhere: the
// exact failure mode where mapRole falls through to the roles[0]-derived
// 'Default-roles-genie' scalar and every grant dies for real tokens.

'use strict';

jest.mock('../../__tests__/__mocks__/shared-lib', () => ({}), { virtual: true });
jest.mock(
  '../../../shared-lib',
  () => ({
    logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
    dbService: { getConnection: jest.fn() }
  }),
  { virtual: true }
);

// The claims the stubbed jwtVerify hands back — each test swaps them.
const mockClaimsHolder = { current: null };
jest.mock('jose', () => ({
  createRemoteJWKSet: jest.fn(() => ({ stub: 'jwks' })),
  jwtVerify: jest.fn(async () => ({ payload: mockClaimsHolder.current }))
}));

// The middleware derives the JWKS/issuer URLs from these at first use.
process.env.KEYCLOAK_URL = 'http://keycloak:8080';
process.env.KC_REALM = 'genie';

jest.mock('../../services/fileService', () => ({
  uploadFile: jest.fn(),
  uploadLink: jest.fn(),
  getFiles: jest.fn(),
  deleteFile: jest.fn(),
  searchFiles: jest.fn(),
  getFileStats: jest.fn(),
  getDb: jest.fn().mockResolvedValue({
    query: jest.fn().mockResolvedValue({
      next: jest.fn().mockResolvedValue({
        file_id: 'f1',
        author: 'tester',
        dataprep: { status: 'Pending', ingest_date: '', retract_date: '' }
      })
    })
  }),
  scheduleSiteCrawl: jest.fn(),
  getCrawlJobByFileId: jest.fn(),
  getCrawlMetrics: jest.fn(),
  getCrawlLogs: jest.fn(),
  killCrawlTask: jest.fn(),
  addIngestionLog: jest.fn(),
  getIngestionLogs: jest.fn()
}));

jest.mock('../../services/metadataService', () => ({
  addMetadata: jest.fn(),
  searchMetadata: jest.fn(),
  getMetadataById: jest.fn().mockResolvedValue({ file_id: 'f1', author: 'crawler' }),
  deleteMetadata: jest.fn(),
  updateMetadata: jest.fn().mockResolvedValue({ file_id: 'f1', dataprep: { status: 'Ingesting' } })
}));

jest.mock('../../services/securityService', () => ({
  initialize: jest.fn(),
  scanBuffer: jest.fn()
}));

const request = require('supertest');
const { DOCUMENT_LIFECYCLE } = require('../../config/rolePolicy');

// Realistic realm_access.roles shapes (the ones production tokens carry).
const ROLES = {
  // the okf-server orchestrator's service account
  okfService: ['offline_access', 'uma_authorization', 'okf-service'],
  // a tools-admin USER token (review 2026-10-29: tools-admin is NEVER roles[0])
  toolsAdmin: ['default-roles-genie', 'offline_access', 'uma_authorization', 'tools-admin'],
  // a plain citizen
  user: ['default-roles-genie', 'offline_access']
};

const claimsFor = (roles) => ({
  sub: '11111111-1111-1111-1111-111111111111',
  iss: 'http://keycloak:8080/realms/genie',
  exp: Math.floor(Date.now() / 1000) + 300,
  realm_access: { roles }
});

describe('role policy through the real auth middleware (mapRole → authorizeRole)', () => {
  let app;

  beforeAll(() => {
    app = require('../../app');
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('okf-service token → PATCH /:fileId passes DOCUMENT_LIFECYCLE (200)', async () => {
    mockClaimsHolder.current = claimsFor(ROLES.okfService);
    const res = await request(app)
      .patch('/api/files/f1')
      .set('Authorization', 'Bearer header.payload.signature')
      .send({ author: 'tester' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('tools-admin USER token (never roles[0]) → PATCH /:fileId/status passes SERVICE_CALLBACK (200)', async () => {
    // The bundle state-machine route — the surface the worker's mirror POSTs
    // drive. mapRole must pick 'tools-admin' out of the middle of the role
    // array; the roles[0] fall-through would yield 'Default-roles-genie' → 403.
    mockClaimsHolder.current = claimsFor(ROLES.toolsAdmin);
    const res = await request(app)
      .patch('/api/files/f1/status')
      .set('Authorization', 'Bearer header.payload.signature')
      .send({ dataprep: { status: 'Ingesting' } });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('okf-service token also drives the SERVICE_CALLBACK status route (200)', async () => {
    mockClaimsHolder.current = claimsFor(ROLES.okfService);
    const res = await request(app)
      .patch('/api/files/f1/status')
      .set('Authorization', 'Bearer header.payload.signature')
      .send({ dataprep: { status: 'Ingested', ingest_date: '2026-10-29T00:00:00.000Z' } });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('plain User token → PATCH /:fileId is 403 FORBIDDEN', async () => {
    mockClaimsHolder.current = claimsFor(ROLES.user);
    const res = await request(app)
      .patch('/api/files/f1')
      .set('Authorization', 'Bearer header.payload.signature')
      .send({ author: 'tester' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('FORBIDDEN');
  });

  test('plain User token is 403 on the SERVICE_CALLBACK status route too', async () => {
    mockClaimsHolder.current = claimsFor(ROLES.user);
    const res = await request(app)
      .patch('/api/files/f1/status')
      .set('Authorization', 'Bearer header.payload.signature')
      .send({ dataprep: { status: 'Ingesting' } });
    expect(res.status).toBe(403);
  });

  test('the lifecycle list itself admits okf-service and Admin only', () => {
    const { authorizeRole } = require('../../middlewares/keycloak-auth-middleware');
    const middleware = authorizeRole(DOCUMENT_LIFECYCLE);
    for (const role of ['okf-service', 'Admin']) {
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      middleware({ user: { role } }, res, jest.fn());
      expect(res.status).not.toHaveBeenCalled();
    }
    for (const role of ['User', 'dataprep-service', 'tools-admin']) {
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();
      middleware({ user: { role } }, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
    }
  });
});
