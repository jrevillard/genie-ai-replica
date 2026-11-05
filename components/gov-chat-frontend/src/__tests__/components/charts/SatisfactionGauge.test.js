// Tests for the satisfaction gauge period labels.
//
// The backend emits stable period keys ('current', 'week1'...'week4') instead
// of localized text; the component translates them through the i18n bundle.
import { shallowMount } from '@vue/test-utils';
import SatisfactionGauge from '@/components/charts/SatisfactionGauge.vue';

const translations = {
  'analytics.timePeriods.current': 'Current',
  'analytics.timePeriods.week1': 'Last Week',
  'analytics.timePeriods.week2': '2 Weeks Ago',
  'analytics.timePeriods.week3': '3 Weeks Ago',
  'analytics.timePeriods.week4': '4 Weeks Ago'
};

const translate = (key) => (key in translations ? translations[key] : key);

const mountGauge = (historicalData) =>
  shallowMount(SatisfactionGauge, {
    propsData: { externalData: true, historicalData },
    global: {
      mocks: {
        $t: translate,
        $i18n: { locale: 'en', t: translate }
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
