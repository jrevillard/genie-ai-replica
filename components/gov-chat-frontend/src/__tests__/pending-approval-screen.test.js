// F14/DEC-24b: the pending screen's "Back to Login" button must LOG OUT (store
// action: genie_post_logout flag + id_token_hint signoutRedirect), not call
// login() — a session-holding Pending user calling login() gets silently
// re-authenticated → dashboard → 403 ACCOUNT_PENDING → bounced right back
// (the redirect loop that read as a dead button).
import { mount } from '@vue/test-utils';

jest.mock('../services/keycloakAuthService', () => ({
  login: jest.fn().mockResolvedValue(undefined),
  logout: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('vue-router', () => ({}));

const PendingApprovalScreen = require('../components/PendingApprovalScreen.vue').default;

describe('PendingApprovalScreen (F14: back-to-login = logout)', () => {
  it('goToLogin dispatches the store LOGOUT action (not login)', async () => {
    const dispatch = jest.fn().mockResolvedValue(undefined);
    const wrapper = mount(PendingApprovalScreen, {
      global: { mocks: { $store: { dispatch }, $t: (k, f) => f ?? k } }
    });
    await wrapper.vm.goToLogin();
    expect(dispatch).toHaveBeenCalledWith('logout');
  });

  it('falls back to a login redirect when the store logout throws', async () => {
    const { login } = require('../services/keycloakAuthService');
    const dispatch = jest.fn().mockRejectedValue(new Error('session gone'));
    const wrapper = mount(PendingApprovalScreen, {
      global: { mocks: { $store: { dispatch }, $t: (k, f) => f ?? k } }
    });
    await wrapper.vm.goToLogin();
    expect(dispatch).toHaveBeenCalledWith('logout');
    expect(login).toHaveBeenCalled();
  });
});
