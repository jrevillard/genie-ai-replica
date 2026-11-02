/**
 * DEC-32b pins — Keletso-style login wrapper: renders the brand card
 * (shield hero, eyebrow/title/message), Sign-in triggers the OIDC redirect
 * with returnUrl, register link carries state+PKCE, error re-arms on
 * client-side failure. S-1 invariant: NO credential inputs, ever.
 */
import { mount } from '@vue/test-utils';
import LoginScreen from '../LoginScreen.vue';

jest.mock('@/services/keycloakAuthService', () => ({
  login: jest.fn().mockResolvedValue(undefined),
  getUserManager: jest.fn(() => ({
    createSigninRequest: jest.fn().mockResolvedValue({
      url: 'https://kc.example/auth/realms/agrivisory/protocol/openid-connect/auth?state=xyz&code_challenge=abc'
    })
  }))
}));

const keycloakAuthService = require('@/services/keycloakAuthService');

const CONFIG = {
  app: {
    title: 'Agrivisory-Lesotho',
    icon: { type: 'file', value: '/config/agrivisory-logo.webp' },
  },
};

function mountScreen(props = {}) {
  return mount(LoginScreen, {
    global: {
      mocks: {
        $config: CONFIG,
        $t: (k) => k,
        $i18n: { locale: 'en', availableLocales: ['en', 'st'] },
      },
    },
    props,
  });
}

const flush = async (wrapper) => {
  await Promise.resolve();
  await Promise.resolve();
  await wrapper.vm.$nextTick();
};

describe('LoginScreen wrapper (DEC-32b, Keletso style)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renders the brand card — shield hero, title, no credential inputs (S-1)', async () => {
    const wrapper = mountScreen();
    await flush(wrapper);

    expect(wrapper.find('.hero-logo').attributes('src')).toBe('/config/agrivisory-logo.webp');
    // $t mock returns the key → tOr must fall back to the English default
    expect(wrapper.find('.login-title').text()).toBe('Sign in to Agrivisory');
    expect(wrapper.find('button.action-primary').exists()).toBe(true);
    expect(wrapper.findAll('input[type=email], input[type=password], input[type=text]').length).toBe(0);
  });

  it('Sign-in click performs the OIDC redirect with returnUrl; never double-fires', async () => {
    const wrapper = mountScreen({ returnUrl: '/dashboard' });
    await flush(wrapper);

    const btn = wrapper.find('button.action-primary');
    await btn.trigger('click');
    await btn.trigger('click');

    expect(keycloakAuthService.login).toHaveBeenCalledTimes(1);
    expect(keycloakAuthService.login).toHaveBeenCalledWith({ returnUrl: '/dashboard' });
  });

  it('register link carries state + PKCE (a bare /registrations URL dead-ends /callback)', async () => {
    const wrapper = mountScreen();
    await flush(wrapper);

    const href = wrapper.find('a.action-secondary').attributes('href');
    expect(href).toContain('/protocol/openid-connect/registrations?');
    expect(href).toContain('state=xyz');
    expect(href).toContain('code_challenge=abc');
  });

  it('shows an error and re-arms the button when the redirect fails client-side', async () => {
    keycloakAuthService.login.mockRejectedValueOnce(new Error('boom'));
    const wrapper = mountScreen();
    await flush(wrapper);

    await wrapper.find('button.action-primary').trigger('click');
    await flush(wrapper);

    expect(wrapper.find('.login-error').exists()).toBe(true);
    expect(wrapper.find('button.action-primary').attributes('disabled')).toBeUndefined();
  });
});
