'use strict';

describe('oidcConfig', () => {
  let oidcConfig;

  beforeEach(() => {
    // Reset env vars
    delete process.env.VUE_APP_KEYCLOAK_URL;
    delete process.env.VUE_APP_KEYCLOAK_CLIENT_ID;
    // Reset window config
    window.APP_CONFIG = {};
    jest.resetModules();
  });

  it('should return defaults when no config is available', () => {
    oidcConfig = require('@/config/oidcConfig').default;

    expect(oidcConfig.authority).toBe('http://localhost/auth/realms/genie');
    expect(oidcConfig.client_id).toBe('genie-app');
    expect(oidcConfig.response_type).toBe('code');
    expect(oidcConfig.scope).toBe('openid profile email');
    expect(oidcConfig.automaticSilentRenew).toBe(true);
    expect(oidcConfig.storeAuthStateInCookie).toBe(false);
    expect(oidcConfig.redirect_uri).toMatch(/\/callback$/);
    expect(oidcConfig.post_logout_redirect_uri).toBeDefined();
  });

  it('should read client_id from window.APP_CONFIG.keycloak', () => {
    window.APP_CONFIG = {
      keycloak: {
        url: 'https://auth.example.com',
        realm: 'myrealm',
        client_id: 'my-client'
      }
    };

    oidcConfig = require('@/config/oidcConfig').default;

    expect(oidcConfig.authority).toBe('https://auth.example.com/realms/myrealm');
    expect(oidcConfig.client_id).toBe('my-client');
  });

  it('should also accept legacy clientId from APP_CONFIG', () => {
    window.APP_CONFIG = {
      keycloak: {
        url: 'https://auth.example.com',
        realm: 'myrealm',
        clientId: 'my-client'
      }
    };

    oidcConfig = require('@/config/oidcConfig').default;

    expect(oidcConfig.authority).toBe('https://auth.example.com/realms/myrealm');
    expect(oidcConfig.client_id).toBe('my-client');
  });

  it('should fall back to env vars when APP_CONFIG is empty', () => {
    process.env.VUE_APP_KEYCLOAK_URL = 'https://env.example.com';
    process.env.VUE_APP_KEYCLOAK_CLIENT_ID = 'env-client';

    oidcConfig = require('@/config/oidcConfig').default;

    // realm falls back to 'genie' default when not in APP_CONFIG
    expect(oidcConfig.authority).toBe('https://env.example.com/realms/genie');
    expect(oidcConfig.client_id).toBe('env-client');
  });

  it('should prefer APP_CONFIG over env vars', () => {
    process.env.VUE_APP_KEYCLOAK_URL = 'https://env.example.com';
    window.APP_CONFIG = {
      keycloak: {
        url: 'https://app.example.com',
        realm: 'apprealm',
        client_id: 'app-client'
      }
    };

    oidcConfig = require('@/config/oidcConfig').default;

    expect(oidcConfig.authority).toBe('https://app.example.com/realms/apprealm');
  });

  it('should allow partial APP_CONFIG override with env var fallback', () => {
    window.APP_CONFIG = {
      keycloak: {
        url: 'https://app.example.com'
      }
    };
    process.env.VUE_APP_KEYCLOAK_CLIENT_ID = 'env-client';

    oidcConfig = require('@/config/oidcConfig').default;

    // realm falls back to 'genie' default when not in APP_CONFIG
    expect(oidcConfig.authority).toBe('https://app.example.com/realms/genie');
    expect(oidcConfig.client_id).toBe('env-client');
  });

  it('should include PKCE-compatible settings', () => {
    oidcConfig = require('@/config/oidcConfig').default;

    expect(oidcConfig.response_type).toBe('code');
    expect(oidcConfig.scope).toContain('openid');
  });

  it('should strip trailing slash from keycloak URL', () => {
    window.APP_CONFIG = {
      keycloak: {
        url: 'https://auth.example.com/',
        realm: 'myrealm',
        client_id: 'my-client'
      }
    };

    oidcConfig = require('@/config/oidcConfig').default;

    expect(oidcConfig.authority).toBe('https://auth.example.com/realms/myrealm');
    expect(oidcConfig.authority).not.toContain('//realms');
  });
});
