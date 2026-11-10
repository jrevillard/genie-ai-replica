// Tests for the satisfaction gauge: period labels and the T1 value bands.
//
// The backend emits stable period keys ('current', 'week1'...'week4') instead
// of localized text; the component translates them through the shipped i18n
// catalogue (realI18n), so a key missing from the catalogue fails here.
//
// The chart-theme composable and the satisfaction-scale util are mocked: the
// band tests pin the component's PICK of the shared scale (which scale index
// feeds which gauge band) and its empty-scale degradation, not the scale's own
// math — that math is pinned in utils/chartColors.test.js.
import { shallowMount } from '@vue/test-utils';
import SatisfactionGauge from '@/components/charts/SatisfactionGauge.vue';

const { createRealEnI18n, realI18nMock } = require('../../helpers/realI18n');

const mockStatusColors = {
  success: 'rgb(34, 197, 94)',
  warning: 'rgb(245, 158, 11)',
  danger: 'rgb(239, 68, 68)',
  info: 'rgb(31, 111, 235)'
};

const mockResolvedTheme = {
  isDarkMode: false,
  textColor: 'rgb(17, 19, 24)',
  backgroundColor: 'rgb(255, 255, 255)',
  borderColor: 'rgb(51, 51, 51)',
  gridColor: 'rgb(85, 85, 85)',
  accentColor: 'rgb(31, 111, 235)',
  mutedColor: 'rgb(136, 136, 136)',
  brandColor: 'rgb(31, 111, 235)',
  statusColors: { ...mockStatusColors },
  chartColors: [
    'rgb(31, 111, 235)',
    'rgb(34, 197, 94)',
    'rgb(245, 158, 11)',
    'rgb(239, 68, 68)',
    'rgb(142, 68, 173)',
    'rgb(22, 160, 133)',
    'rgb(192, 57, 43)',
    'rgb(44, 62, 80)'
  ]
};

jest.mock('@/composables/useChartTheme', () => ({
  useChartTheme: () => ({
    theme: 'system',
    isDarkMode: false,
    getResolvedTheme: () => mockResolvedTheme,
    getCssVarStrings: () => mockResolvedTheme
  })
}));

jest.mock('../../../utils/chartColors', () => ({
  buildSatisfactionBands: jest.fn(() => [])
}));

const { buildSatisfactionBands } = require('../../../utils/chartColors');

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

describe('SatisfactionGauge value bands (admin-ux T1 review F2/F4)', () => {
  afterEach(() => {
    mockResolvedTheme.statusColors = { ...mockStatusColors };
    buildSatisfactionBands.mockReset();
    buildSatisfactionBands.mockReturnValue([]);
  });

  it('builds the bands through the shared builder from its resolved status colors', async () => {
    // The band PICK contract ([0,2,3,4] of the scale, with token fallbacks)
    // lives in the builder and is pinned in utils/chartColors.test.js; the
    // component pins its half: delegate with the resolved theme's statusColors.
    const bands = ['rgb(201, 8, 28)', 'rgb(220, 60, 50)', 'rgb(245, 158, 11)', 'rgb(34, 197, 94)'];
    buildSatisfactionBands.mockReturnValue(bands);
    const wrapper = mountGauge([]);
    // initChart runs inside the mounted hook's own $nextTick
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.getGaugeBandColors()).toEqual(bands);
    expect(buildSatisfactionBands).toHaveBeenCalledWith(mockResolvedTheme.statusColors);
    // value 0 (< 60) → the poor band at both gradient ends
    expect(wrapper.vm.chartOptions.fill.gradient.colorStops.map((stop) => stop.color)).toEqual([bands[0], bands[0]]);
    expect(wrapper.vm.chartOptions.fill.gradient.gradientToColors[0]).toBe(bands[0]);
  });

  it('hands ApexCharts the resolved accent gradient when no bands could be built', async () => {
    // An empty band array must not reach the gradient config as undefined
    // indexes (review F4) — initChart falls back to the resolved accent.
    buildSatisfactionBands.mockReturnValue([]);
    const wrapper = mountGauge([]);
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.getGaugeBandColors()).toEqual([]);
    expect(wrapper.vm.chartOptions.fill.gradient.colorStops.map((stop) => stop.color)).toEqual([
      'rgb(31, 111, 235)',
      'rgb(31, 111, 235)'
    ]);
  });
});
