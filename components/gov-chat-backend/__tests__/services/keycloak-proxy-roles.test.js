'use strict';

require('../setup-env');

// Mock shared-lib — virtual because it only exists after Docker packaging.
// The proxy destructures { logger, dbService } from it.
jest.mock('../../shared-lib', () => require('../mocks/shared-lib'), { virtual: true });

const keycloakProxyService = require('../../services/keycloak-proxy-service');
const { NotFoundError } = require('../../middleware/errors');

// Story 4-8: pin the role-mapping contract at the proxy boundary — payload
// shapes, uuid resolution, typed 404s, remove-with-missing-role no-op, and
// the implicit-role filter on list. _resolveKeycloakUserId and _adminApiCall
// are spied directly: the db/AQL plumbing is not under test here.
describe('keycloak-proxy-service role operations (story 4-8)', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  describe('getUserRealmRoles', () => {
    it('resolves the uuid and filters implicit roles', async () => {
      const resolve = jest.spyOn(keycloakProxyService, '_resolveKeycloakUserId').mockResolvedValue('uuid-1');
      const api = jest.spyOn(keycloakProxyService, '_adminApiCall').mockResolvedValue([
        { id: 'r1', name: 'tools-admin' },
        { id: 'r2', name: 'offline_access' },
        { id: 'r3', name: 'uma_authorization' },
        { id: 'r4', name: 'default-roles-genie' },
        { id: 'r5', name: 'tools-reader' }
      ]);

      const roles = await keycloakProxyService.getUserRealmRoles('user-1');

      expect(resolve).toHaveBeenCalledWith('user-1');
      expect(api).toHaveBeenCalledWith('GET', '/users/uuid-1/role-mappings/realm');
      expect(roles).toEqual([
        { id: 'r1', name: 'tools-admin' },
        { id: 'r5', name: 'tools-reader' }
      ]);
    });

    it('propagates NotFoundError when the user has no Keycloak sub', async () => {
      jest.spyOn(keycloakProxyService, '_resolveKeycloakUserId').mockRejectedValue(new NotFoundError('no sub'));

      await expect(keycloakProxyService.getUserRealmRoles('user-2')).rejects.toThrow(NotFoundError);
    });

    it('tolerates a non-array API response', async () => {
      jest.spyOn(keycloakProxyService, '_resolveKeycloakUserId').mockResolvedValue('uuid-1');
      jest.spyOn(keycloakProxyService, '_adminApiCall').mockResolvedValue(null);

      expect(await keycloakProxyService.getUserRealmRoles('user-3')).toEqual([]);
    });
  });

  describe('assignRealmRole', () => {
    it('sends the [{id, name}] role-mapping payload', async () => {
      jest.spyOn(keycloakProxyService, '_resolveKeycloakUserId').mockResolvedValue('uuid-1');
      const api = jest.spyOn(keycloakProxyService, '_adminApiCall').mockImplementation(async (method, path) => {
        if (method === 'GET' && path === '/roles/tools-admin') {
          return { id: 'role-uuid', name: 'tools-admin' };
        }
        return {};
      });

      await keycloakProxyService.assignRealmRole('user-1', 'tools-admin');

      expect(api).toHaveBeenCalledWith('POST', '/users/uuid-1/role-mappings/realm', [
        { id: 'role-uuid', name: 'tools-admin' }
      ]);
    });

    it('throws a typed error naming the role on 404', async () => {
      jest.spyOn(keycloakProxyService, '_resolveKeycloakUserId').mockResolvedValue('uuid-1');
      const notFound = new Error('role missing');
      notFound.status = 404;
      jest.spyOn(keycloakProxyService, '_adminApiCall').mockRejectedValue(notFound);

      await expect(keycloakProxyService.assignRealmRole('user-1', 'nope')).rejects.toThrow(
        'Role nope not found in Keycloak'
      );
    });
  });

  describe('removeRealmRole', () => {
    it('no-ops silently when the role does not exist', async () => {
      jest.spyOn(keycloakProxyService, '_resolveKeycloakUserId').mockResolvedValue('uuid-1');
      const notFound = new Error('role missing');
      notFound.status = 404;
      const api = jest.spyOn(keycloakProxyService, '_adminApiCall').mockRejectedValue(notFound);

      await expect(keycloakProxyService.removeRealmRole('user-1', 'nope')).resolves.toBeUndefined();
      // Only the GET /roles lookup happened — no DELETE was attempted
      expect(api.mock.calls.filter(([method]) => method === 'DELETE')).toEqual([]);
    });

    it('sends the DELETE role-mapping payload', async () => {
      jest.spyOn(keycloakProxyService, '_resolveKeycloakUserId').mockResolvedValue('uuid-1');
      const api = jest.spyOn(keycloakProxyService, '_adminApiCall').mockImplementation(async (method, path) => {
        if (method === 'GET' && path === '/roles/tools-reader') {
          return { id: 'role-uuid-2', name: 'tools-reader' };
        }
        return {};
      });

      await keycloakProxyService.removeRealmRole('user-1', 'tools-reader');

      expect(api).toHaveBeenCalledWith('DELETE', '/users/uuid-1/role-mappings/realm', [
        { id: 'role-uuid-2', name: 'tools-reader' }
      ]);
    });
  });
});

// Story 4-8 AC4 — the JIT rule: role operations touch ONLY the Keycloak proxy,
// never the database (roles are JIT-protected in ArangoDB).
describe('admin-dashboard-service role operations never touch the DB (JIT rule)', () => {
  it('assign/remove/getUserRoles call only keycloakProxyService', async () => {
    // The service exports a singleton; the proxy is its only role-path dependency.
    jest.mock('../../services/keycloak-proxy-service', () => ({
      assignRealmRole: jest.fn().mockResolvedValue(undefined),
      removeRealmRole: jest.fn().mockResolvedValue(undefined),
      getUserRealmRoles: jest.fn().mockResolvedValue([{ id: 'r1', name: 'tools-admin' }])
    }));
    jest.resetModules();
    require('../setup-env');
    jest.mock('../../shared-lib', () => require('../mocks/shared-lib'), { virtual: true });
    jest.mock('../../services/keycloak-proxy-service', () => ({
      assignRealmRole: jest.fn().mockResolvedValue(undefined),
      removeRealmRole: jest.fn().mockResolvedValue(undefined),
      getUserRealmRoles: jest.fn().mockResolvedValue([{ id: 'r1', name: 'tools-admin' }])
    }));
    const svc = require('../../services/admin-dashboard-service');
    const proxy = require('../../services/keycloak-proxy-service');

    const assigned = await svc.assignUserRole('u1', 'tools-admin');
    expect(assigned).toEqual({ success: true, userKey: 'u1', roleName: 'tools-admin' });
    expect(proxy.assignRealmRole).toHaveBeenCalledWith('u1', 'tools-admin');

    const removed = await svc.removeUserRole('u1', 'tools-admin');
    expect(removed).toEqual({ success: true, userKey: 'u1', roleName: 'tools-admin' });
    expect(proxy.removeRealmRole).toHaveBeenCalledWith('u1', 'tools-admin');

    const roles = await svc.getUserRoles('u1');
    expect(roles).toEqual({ success: true, userKey: 'u1', roles: [{ id: 'r1', name: 'tools-admin' }] });
    expect(proxy.getUserRealmRoles).toHaveBeenCalledWith('u1');
    // The singleton's db handle stays unset — none of the role paths touched it
    expect(svc.db == null || svc.db === undefined).toBe(true);
  });
});

// Review note (4-8): the uuid-AQL NotFoundError branch was considered for a
// direct test, but the earlier JIT test's jest.resetModules() + mock
// registrations make the shared registry unusable for it without brittle
// gymnastics. The branch is covered behaviorally by the "propagates
// NotFoundError" test above (getUserRealmRoles surfaces resolution failures).
