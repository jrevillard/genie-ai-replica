import { mount } from '@vue/test-utils';
import DashboardView from '@/views/DashboardView.vue';

// The mock defines the class the layer hangs off, so a `stubs` entry that
// points at the same name wins the mount and silences the assertion. The
// stub is purely redundant — drop it.
jest.mock('@/components/ChatBotComponent.vue', () => ({
  name: 'ChatBotComponent',
  template: '<div class="chatbot-container" />'
}));

describe('DashboardView', () => {
  it('carries the scoping class the visual layer hangs off', () => {
    const wrapper = mount(DashboardView);

    expect(wrapper.find('.dashboard-content').classes()).toContain('genie-living-intelligence');
  });
});
