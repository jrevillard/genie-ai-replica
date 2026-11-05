// Tests for the satisfaction heatmap period labels.
//
// The backend emits stable period keys ('current', 'week1'...'week4') instead
// of localized text; the component translates them through the i18n bundle.
import { shallowMount } from '@vue/test-utils';
import SatisfactionHeatmap from '@/components/charts/SatisfactionHeatmap.vue';

const translations = {
  'analytics.timePeriods.current': 'Current',
  'analytics.timePeriods.week1': 'Last Week',
  'analytics.timePeriods.week2': '2 Weeks Ago',
  'analytics.timePeriods.week3': '3 Weeks Ago',
  'analytics.timePeriods.week4': '4 Weeks Ago'
};

const translate = (key) => (key in translations ? translations[key] : key);

// The theme composable listens to the system color scheme; jsdom has no matchMedia.
beforeAll(() => {
  window.matchMedia =
    window.matchMedia ||
    ((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false
    }));
});

const mountHeatmap = (data) =>
  shallowMount(SatisfactionHeatmap, {
    propsData: { externalData: true, data },
    global: {
      mocks: {
        $t: translate,
        $i18n: { locale: 'en', t: translate }
      },
      stubs: { apexchart: true }
    }
  });

describe('SatisfactionHeatmap period labels', () => {
  it('translates the period keys of every cell', () => {
    const wrapper = mountHeatmap([
      {
        name: 'Category One',
        data: [
          { x: 'current', y: 80 },
          { x: 'week2', y: 70 }
        ]
      }
    ]);

    const xs = wrapper.vm.chartSeries[0].data.map((point) => point.x);
    expect(xs).toEqual(['Current', '2 Weeks Ago']);
  });

  it('keeps the cell values and the category name untouched', () => {
    const wrapper = mountHeatmap([
      {
        name: 'Category One',
        data: [{ x: 'current', y: 80 }]
      }
    ]);

    expect(wrapper.vm.chartSeries[0].name).toBe('Category One');
    expect(wrapper.vm.chartSeries[0].data[0].y).toBe(80);
  });

  it('renders a value that is not a period key unchanged', () => {
    const wrapper = mountHeatmap([{ name: 'Category One', data: [{ x: 'Last Week', y: 80 }] }]);

    const xs = wrapper.vm.chartSeries[0].data.map((point) => point.x);
    expect(xs).toEqual(['Last Week']);
  });
});
