import { mount } from '@vue/test-utils';
import MarketPriceChart from '@/components/charts/MarketPriceChart.vue';

jest.mock('@/services/agriApiService.js', () => ({
  getMarketPrices: jest.fn().mockResolvedValue({ data: { series: [] }, meta: {} })
}));

describe('MarketPriceChart', () => {
  /** Mount with stubs so the template does not try to render ApexCharts. */
  const mountOpts = {
    propsData: {
      category: 'test-category',
      timeSeries: [],
      unit: 'USD/kg',
      resolvedCssVars: {
        mutedColor: '#888',
        textColor: '#333'
      }
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
});
