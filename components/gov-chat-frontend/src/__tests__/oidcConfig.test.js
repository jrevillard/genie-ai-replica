'use strict';

describe('oidcConfig', () => {
  let oidcConfig;

  beforeEach(() => {
    // Reset env vars
    delete process.env.VUE_APP_KEYCLOAK_URL;
    delete process.env.VUE_APP_KEYCLOAK_REALM;
    delete process.env.VUE_APP_KEYCLOAK_CLIENT_ID;
    // Reset window config
    window.APP_CONFIG = {};
    jest.resetModules();
  });

  it('should return defaults when no config is available', () => {
    oidcConfig = require('@/config/oidcConfig').default;

    expect(oidcConfig.authority).toBe('http://localhost:8080/realms/genie');
    expect(oidcConfig.clientId).toBe('genie-app');
    expect(oidcConfig.responseType).toBe('code');
    expect(oidcConfig.scope).toBe('openid profile email');
    expect(oidcConfig.automaticSilentRenew).toBe(true);
    expect(oidcConfig.storeAuthStateInCookie).toBe(false);
    expect(oidcConfig.redirectUri).toMatch(/\/callback$/);
    expect(oidcConfig.postLogoutRedirectUri).toBeDefined();
  });

  it('should read from window.APP_CONFIG.keycloak when available', () => {
    window.APP_CONFIG = {
      keycloak: {
        url: 'https://auth.example.com',
        realm: 'myrealm',
        clientId: 'my-client'
      }
    };

    oidcConfig = require('@/config/oidcConfig').default;

    expect(oidcConfig.authority).toBe('https://auth.example.com/realms/myrealm');
    expect(oidcConfig.clientId).toBe('my-client');
  });

  it('should fall back to env vars when APP_CONFIG is empty', () => {
    process.env.VUE_APP_KEYCLOAK_URL = 'https://env.example.com';
    process.env.VUE_APP_KEYCLOAK_REALM = 'envrealm';
    process.env.VUE_APP_KEYCLOAK_CLIENT_ID = 'env-client';

    oidcConfig = require('@/config/oidcConfig').default;

    expect(oidcConfig.authority).toBe('https://env.example.com/realms/envrealm');
    expect(oidcConfig.clientId).toBe('env-client');
  });

  it('should prefer APP_CONFIG over env vars', () => {
    process.env.VUE_APP_KEYCLOAK_URL = 'https://env.example.com';
    window.APP_CONFIG = {
      keycloak: {
        url: 'https://app.example.com',
        realm: 'apprealm',
        clientId: 'app-client'
      }
    };

    oidcConfig = require('@/config/oidcConfig').default;

    expect(oidcConfig.authority).toBe('https://app.example.com/realms/apprealm');
  });

  it('should allow partial APP_CONFIG override with env var fallback', () => {
    window.APP_CONFIG = {
      keycloak: {
        url: 'https://app.example.com'
        // realm and clientId not specified → fall back to env vars
      }
    };
    process.env.VUE_APP_KEYCLOAK_REALM = 'envrealm';
    process.env.VUE_APP_KEYCLOAK_CLIENT_ID = 'env-client';

    oidcConfig = require('@/config/oidcConfig').default;

    expect(oidcConfig.authority).toBe('https://app.example.com/realms/envrealm');
    expect(oidcConfig.clientId).toBe('env-client');
  });

  it('should include PKCE-compatible settings', () => {
    oidcConfig = require('@/config/oidcConfig').default;

    // Authorization Code flow with PKCE is default in oidc-client-ts
    expect(oidcConfig.responseType).toBe('code');
    expect(oidcConfig.scope).toContain('openid');
  });

  it('should strip trailing slash from keycloak URL', () => {
    window.APP_CONFIG = {
      keycloak: {
        url: 'https://auth.example.com/',
        realm: 'myrealm',
        clientId: 'my-client'
      }
    };

    oidcConfig = require('@/config/oidcConfig').default;

    expect(oidcConfig.authority).toBe('https://auth.example.com/realms/myrealm');
    expect(oidcConfig.authority).not.toContain('//realms');
  });
});
