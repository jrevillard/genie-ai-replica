import { mount } from '@vue/test-utils';
import DashboardView from '@/views/DashboardView.vue';

jest.mock('@/components/ChatBotComponent.vue', () => ({
  name: 'ChatBotComponent',
  template: '<div class="chatbot-container" />'
}));

describe('DashboardView', () => {
  it('carries the scoping class the visual layer hangs off', () => {
    const wrapper = mount(DashboardView, {
      global: {
        stubs: { 'chat-bot-component': true }
      }
    });

    expect(wrapper.find('.dashboard-content').classes()).toContain('genie-living-intelligence');
  });
});
