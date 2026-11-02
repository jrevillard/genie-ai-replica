/**
 * L.1 / DEC-31 pin — the navbar carries ONE config-driven brand logo:
 * the ITU+FAO+Genie trio is gone (no hardcoded img srcs), the logo img
 * renders the config value with the app title as alt text.
 */
import { mount } from '@vue/test-utils';
import NavBarComponent from '../NavBarComponent.vue';

jest.mock('@/components/LanguageSelector.vue', () => ({ name: 'LanguageSelector', render: () => null }));
jest.mock('@/services/httpService', () => ({ get: jest.fn(), post: jest.fn() }), { virtual: true });

const CONFIG = {
  app: {
    title: 'Agrivisory-Lesotho',
    icon: { type: 'file', value: '/config/agrivisory-logo.webp' },
  },
};

function mountNavBar() {
  return mount(NavBarComponent, {
    global: {
      mocks: {
        $store: { getters: { currentUser: { roles: ['user'] }, isAuthenticated: true } },
        $t: (k, d) => d || k,
        $i18n: { locale: 'en' },
      },
    },
    props: { config: CONFIG },
  });
}

describe('NavBar brand logo (L.1, DEC-31)', () => {
  it('renders exactly one logo — the config-driven brand mark with title alt', () => {
    const wrapper = mountNavBar();

    const imgs = wrapper.findAll('.nav-left img');
    expect(imgs.length).toBe(1);

    const logo = imgs[0];
    expect(logo.attributes('src')).toBe('/config/agrivisory-logo.webp');
    expect(logo.attributes('alt')).toBe('Agrivisory-Lesotho');
  });

  it('carries no ITU/FAO/Genie marks anywhere in the rendered navbar', () => {
    const html = mountNavBar().html();
    expect(html).not.toMatch(/itu-logo|fao-icon|fao-logo|genie-ai-icon/i);
  });

  it('ships the configured icon file — a code+json commit that misses the binary fails here (review #3)', () => {
    const fs = require('fs');
    const path = require('path');
    const active = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../public/config/genie-ai-config.json'), 'utf8'));
    const iconPath = active.app.icon.value.replace(/^\//, '');
    expect(fs.existsSync(path.join(__dirname, '../../../public/', iconPath))).toBe(true);
  });
});
