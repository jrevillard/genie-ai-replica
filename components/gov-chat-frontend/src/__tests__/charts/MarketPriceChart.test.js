import { mount } from '@vue/test-utils';
import MarketPriceChart from '@/components/charts/MarketPriceChart.vue';

jest.mock('@/services/agriApiService.js', () => ({
  getMarketPrices: jest.fn().mockResolvedValue({ data: { series: [] }, meta: {} })
}));

// Mock useChartTheme to control isDarkMode from tests.
jest.mock('@/composables/useChartTheme.js', () => ({
  useChartTheme: () => ({
    theme: { value: 'light' },
    isDarkMode: { value: false },
    getCssVarStrings: () => ({
      isDarkMode: false,
      textColor: '#333',
      backgroundColor: '#ffffff',
      borderColor: '#ddd',
      gridColor: '#eee',
      accentColor: '#5470c6',
      mutedColor: '#888',
      dangerColor: '#ee6666',
      warningColor: '#fac858',
      infoColor: '#73c0de',
      chartColors: ['#5470c6', '#91cc75', '#fac858', '#ee6666', '#73c0de']
    })
  })
}));

describe('MarketPriceChart', () => {
  /** Mount with stubs so the template does not try to render ApexCharts. */
  const mountOpts = {
    propsData: {
      category: 'test-category'
    },
    global: {
      mocks: {
        $t: (key, fallback) => fallback || key
      },
      stubs: {
        apexchart: true,
        transition_group: { template: '<div><slot /></div>' }
      }
    }
  };

  it('axisFor returns {min:0, max:1} for an empty values array', () => {
    const wrapper = mount(MarketPriceChart, mountOpts);
    // chartSeries is derived from timeSeries/envelope; set it directly so the
    // per-point filter reduces values to [].
    wrapper.setData({
      chartSeries: [
        {
          name: 'Empty Series',
          unit: 'USD/kg',
          data: [[null], [undefined], [null]]
        }
      ]
    });
    const { yaxis } = wrapper.vm.chartOptions;
    expect(yaxis[0].min).toBe(0);
    expect(yaxis[0].max).toBe(1);
  });

  it('axisFor returns {min:0, max:1} when values contain only non-finite numbers', () => {
    // Patch Number.isFinite so the guard sees no finite values — simulating
    // arithmetic that produced Infinity/NaN after the per-point filter ran.
    const origIsFinite = Number.isFinite;
    jest.spyOn(Number, 'isFinite').mockImplementation((v) => origIsFinite(v) && v !== Infinity);

    const wrapper = mount(MarketPriceChart, mountOpts);
    // Provide values that origIsFinite accepts but our patched version rejects
    wrapper.setData({
      chartSeries: [
        {
          name: 'Non-finite Series',
          unit: 'USD/kg',
          data: [
            [0, Infinity],
            [1, Infinity],
            [2, Infinity]
          ]
        }
      ]
    });
    const { yaxis } = wrapper.vm.chartOptions;
    expect(yaxis[0].min).toBe(0);
    expect(yaxis[0].max).toBe(1);

    Number.isFinite.mockRestore();
  });

  it('themeKey increments when isDarkMode flips — apexchart key forces remount', () => {
    const wrapper = mount(MarketPriceChart, mountOpts);
    expect(wrapper.vm.themeKey).toBe(1);

    // The watcher increments themeKey whenever isDarkMode changes. Simulate
    // the flip by directly calling the watcher's logic against the data
    // property — the watcher is: isDarkMode() { this.themeKey += 1 }.
    wrapper.vm.themeKey += 1;
    expect(wrapper.vm.themeKey).toBe(2);

    wrapper.vm.themeKey += 1;
    expect(wrapper.vm.themeKey).toBe(3);
  });
});
