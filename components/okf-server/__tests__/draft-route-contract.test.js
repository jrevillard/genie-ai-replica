// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// CROSS-BOUNDARY ROUTE CONTRACT (#1056).
//
// The frontend's studioService and the okf-server draft routes live in
// different packages, and each side's own suite pins its half exactly —
// the client URL in studioService.test.js, the server route in
// repos-routes.test.js — while nothing JOINS the two. A one-sided repoint
// (or a coordinated repoint of both sides to the same wrong path) passes
// both suites; that is how #1056 shipped. This test mounts the REAL
// okf-server Express app and replays every `/okf/` URL the frontend service
// builds — verb AND path, extracted from the httpService calls in the
// frontend SOURCE, never restated here, so the two sides cannot drift
// independently.
//
// Mapping: the frontend builds paths like `/okf/repos/:id/draft` against
// httpService's base URL (`/api`), so the server-side path is `/api` + the
// template. `${...}` interpolations are substituted with a concrete repo id.
// Only `httpService.<verb>(`...`)` call sites are extracted — comments may
// legitimately mention path shapes and must not enter the contract.
//
// An authenticated, scope-carrying caller is required for the assertion to
// be meaningful: the router-wide `requireScope('read')` gate runs BEFORE
// route matching, so an unmatched path only reaches the Express 404 when the
// caller's scope passes the gate. Any non-404 status (200 / 403 / 409 / …)
// proves the route is registered; a 404 proves it is not.

jest.mock('../shared-lib/keycloak-auth-service', () => ({ verifyToken: jest.fn() }));
jest.mock('../services/repository-service');
jest.mock('../services/audit-service', () => ({ writeAudit: jest.fn().mockResolvedValue(null) }));
jest.mock('../shared-lib/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }
}));
jest.mock('../shared-lib/db-connection-service', () => ({ getConnection: jest.fn() }));
jest.mock('../services/crawl-conversion-service');
jest.mock('../services/studio-draft-service');
jest.mock('../services/concept-meta-service');
jest.mock('../services/llm-curation-service');
jest.mock('../services/parser-service');
jest.mock('../services/pii-service');
jest.mock('../services/ingest-service', () => ({
  ingestRepoConcepts: jest.fn(),
  resplitRepo: jest.fn(),
  deleteConcept: jest.fn(),
  maxConceptsFromEnv: jest.fn(() => 200)
}));

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { createApp } = require('../index');
const keycloakAuthService = require('../shared-lib/keycloak-auth-service');
const draftService = require('../services/studio-draft-service');

const TOKEN = 'Bearer test-token';
const FRONTEND_STUDIO_SERVICE = path.join(__dirname, '../../gov-chat-frontend/src/services/studioService.js');

/** Configure the mocked token verifier to resolve a user with okf scopes. */
function authScoped(okfScopes) {
  keycloakAuthService.verifyToken.mockResolvedValue({
    sub: 'steward-1',
    preferred_username: 'steward',
    okf_scopes: okfScopes,
    realm_access: { roles: ['user'] }
  });
}

/**
 * Every `httpService.<verb>(`/okf/...`)` call the frontend studioService
 * makes: { verb, template }. Template literals only, call sites only.
 */
function frontendOkfCalls() {
  const src = fs.readFileSync(FRONTEND_STUDIO_SERVICE, 'utf8');
  const calls = [];
  const re = /httpService\.(get|post|put|delete|patch)\(`(\/okf\/[^`]*)`/g;
  let m;
  while ((m = re.exec(src)) !== null) calls.push({ verb: m[1], template: m[2] });
  return calls;
}

/** `${encodeURIComponent(repoId)}` → a concrete segment, for a real request. */
function concrete(template) {
  return template.replace(/\$\{[^}]*\}/g, 'r1');
}

beforeEach(() => jest.clearAllMocks());

describe('okf frontend↔server route contract (#1056)', () => {
  const calls = frontendOkfCalls();
  const draftCalls = calls.filter((c) => c.template.includes('/draft'));
  const producerJobTemplates = [
    ...new Set(calls.filter((c) => c.template.startsWith('/okf/jobs/')).map((c) => c.template))
  ];

  test('the frontend studioService builds the expected URL families', () => {
    // Anchors the extraction itself: if the frontend refactors its URLs, this
    // fails first and tells the reader the contract below must be re-checked,
    // rather than silently skipping it.
    expect(draftCalls.map((c) => c.verb).sort()).toEqual(['delete', 'get', 'put']);
    expect([...new Set(draftCalls.map((c) => c.template))]).toEqual(['/okf/repos/${encodeURIComponent(repoId)}/draft']);
    expect(producerJobTemplates.sort()).toEqual([
      '/okf/jobs/${encodeURIComponent(jobId)}',
      '/okf/jobs/${encodeURIComponent(jobId)}/kill'
    ]);
  });

  describe('the draft contract is served by the real app', () => {
    test.each(draftCalls.map((c) => [c.verb, c.template]))(
      '%s on the frontend-built draft path is NOT a 404',
      async (verb, template) => {
        // Read scope suffices to pass the router gate; for PUT/DELETE the
        // route's own admin gate answers 403 — which still proves the route
        // exists (an unmatched path would fall through to a bare 404).
        authScoped(['okf:t1:r1:read']);
        const res = await request(createApp())
          [verb]('/api' + concrete(template))
          .set('Authorization', TOKEN);
        expect(res.status).not.toBe(404);
      }
    );

    test('with an admin scope the draft verbs reach the draft service', async () => {
      authScoped(['okf:t1:r1:admin']);
      draftService.getDraft.mockResolvedValue({ repo_id: 'r1', draft: null });
      draftService.saveDraft.mockResolvedValue({ repo_id: 'r1', draft: {} });
      draftService.clearDraft.mockResolvedValue({ repo_id: 'r1', deleted: true });
      const serverPath = '/api' + concrete(draftCalls[0].template);
      const get = await request(createApp()).get(serverPath).set('Authorization', TOKEN);
      expect(get.status).toBe(200);
      expect(get.body).toEqual({ repo_id: 'r1', draft: null });
      const put = await request(createApp()).put(serverPath).set('Authorization', TOKEN).send({ studio_step: 3 });
      expect(put.status).toBe(200);
      const del = await request(createApp()).delete(serverPath).set('Authorization', TOKEN);
      expect(del.status).toBe(200);
      expect(draftService.getDraft).toHaveBeenCalledTimes(1);
      expect(draftService.saveDraft).toHaveBeenCalledTimes(1);
      expect(draftService.clearDraft).toHaveBeenCalledTimes(1);
    });
  });

  describe('the producer-job URLs are pinned NOT served (issue #1527)', () => {
    // studioService.fetchProducerJob / killProducerJob build these paths but
    // no okf-server version ever served `/api/okf/jobs/*` (the client methods
    // are dead placeholders — nothing calls them). Pinned here so the flip is
    // LOUD when the producer story lands: whoever implements the route must
    // turn these assertions over in the same commit.
    test.each(producerJobTemplates.map((t) => [t]))('%s IS a 404 today', async (template) => {
      authScoped(['okf:t1:r1:admin']);
      const serverPath = '/api' + concrete(template);
      const get = await request(createApp()).get(serverPath).set('Authorization', TOKEN);
      const post = await request(createApp()).post(serverPath).set('Authorization', TOKEN);
      expect(get.status).toBe(404);
      expect(post.status).toBe(404);
    });
  });
});
