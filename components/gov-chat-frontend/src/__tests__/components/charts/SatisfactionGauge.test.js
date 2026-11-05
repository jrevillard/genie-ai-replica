// Tests for the satisfaction gauge period labels.
//
// The backend emits stable period keys ('current', 'week1'...'week4') instead
// of localized text; the component translates them through the shipped i18n
// catalogue (realI18n), so a key missing from the catalogue fails here.
import { shallowMount } from '@vue/test-utils';
import SatisfactionGauge from '@/components/charts/SatisfactionGauge.vue';

const { createRealEnI18n, realI18nMock } = require('../../helpers/realI18n');

const i18n = createRealEnI18n();
const $t = (...args) => i18n.global.t(...args);

const mountGauge = (historicalData) =>
  shallowMount(SatisfactionGauge, {
    propsData: { externalData: true, historicalData },
    global: {
      mocks: {
        $t,
        $i18n: realI18nMock(i18n)
      },
      stubs: { apexchart: true }
    }
  });

describe('SatisfactionGauge period labels', () => {
  it('translates a period key into its display text', () => {
    const wrapper = mountGauge([
      { label: 'current', value: 80 },
      { label: 'week2', value: 70 }
    ]);

    const labels = wrapper.findAll('.trend-item .label').map((node) => node.text());
    expect(labels).toEqual(['Current', '2 Weeks Ago']);
  });

  it('renders a value that is not a period key unchanged', () => {
    const wrapper = mountGauge([{ label: 'Previous Month', value: 70 }]);

    const labels = wrapper.findAll('.trend-item .label').map((node) => node.text());
    expect(labels).toEqual(['Previous Month']);
  });

  it('falls back to the period keys when no historical data is provided', () => {
    const wrapper = mountGauge([]);

    const labels = wrapper.findAll('.trend-item .label').map((node) => node.text());
    expect(labels).toEqual(['Current', 'Last Week', '2 Weeks Ago', '3 Weeks Ago', '4 Weeks Ago']);
  });
});
