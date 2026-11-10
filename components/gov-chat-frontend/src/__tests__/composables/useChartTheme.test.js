/**
 * useChartTheme.test.js — the bridge returns RESOLVED colors.
 *
 * T1 contract: chart libraries cannot resolve var() (canvas fillStyle; SVG
 * presentation attributes), so the bridge must never ship 'var(--x)' strings
 * or the hardcoded stock palette. The resolution machinery itself is
 * chartColors.js (unit-tested separately + browser-verified live); here we
 * pin the bridge's SHAPE: the payload is concrete, the ramp comes from the
 * brand-ramp builder, and the legacy getCssVarStrings alias matches.
 */
'use strict';

jest.mock('../../utils/chartColors', () => ({
  resolveChartTokens: jest.fn(() => ({
    '--fg': 'rgb(20, 20, 20)',
    '--surface': 'rgb(250, 250, 250)',
    '--border': 'rgb(200, 200, 200)',
    '--border-light': 'rgb(230, 230, 230)',
    '--accent': 'rgb(0, 90, 200)',
    '--accent-muted': 'rgb(150, 180, 220)',
    '--muted': 'rgb(110, 110, 110)',
    '--brand': 'rgb(0, 80, 190)',
    '--success': 'rgb(20, 160, 90)',
    '--warning': 'rgb(230, 170, 20)',
    '--danger': 'rgb(220, 60, 50)',
    '--info': 'rgb(40, 130, 220)'
  })),
  buildBrandRamp: jest.fn(({ accent, statuses }) => [
    accent,
    `mix-info-${statuses.info}`,
    `mix-success-${statuses.success}`,
    `mix-warning-${statuses.warning}`,
    `mix-danger-${statuses.danger}`,
    'rot-140',
    'rot-neg140',
    'deep-tone'
  ])
}));

const { useChartTheme } = require('../../composables/useChartTheme');

describe('useChartTheme — resolved theme payload', () => {
  beforeEach(() => {
    document.documentElement.setAttribute('data-theme', 'light');
  });

  it('getResolvedTheme returns concrete colors (never var() strings)', () => {
    const { getResolvedTheme } = useChartTheme();
    const theme = getResolvedTheme();
    expect(theme.textColor).toBe('rgb(20, 20, 20)');
    expect(theme.accentColor).toBe('rgb(0, 90, 200)');
    expect(theme.backgroundColor).toBe('rgb(250, 250, 250)');
    expect(theme.gridColor).toBe('rgb(230, 230, 230)');
    Object.values(theme.statusColors).forEach((c) => expect(c).not.toMatch(/^var\(/));
  });

  it('the chartColors ramp comes from the brand-ramp builder with the status tokens', () => {
    const { getResolvedTheme } = useChartTheme();
    const theme = getResolvedTheme();
    expect(theme.chartColors[0]).toBe('rgb(0, 90, 200)');
    expect(theme.chartColors[1]).toBe('mix-info-rgb(40, 130, 220)');
    expect(theme.chartColors[4]).toBe('mix-danger-rgb(220, 60, 50)');
    expect(theme.chartColors).toHaveLength(8);
  });

  it('the legacy getCssVarStrings alias returns the same resolved shape', () => {
    const { getCssVarStrings, getResolvedTheme } = useChartTheme();
    expect(getCssVarStrings()).toEqual(getResolvedTheme());
  });

  it('isDarkMode follows the resolved data-theme attribute', () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    const { getResolvedTheme } = useChartTheme();
    expect(getResolvedTheme().isDarkMode).toBe(true);
    document.documentElement.setAttribute('data-theme', 'light');
    const { getResolvedTheme: light } = useChartTheme();
    expect(light().isDarkMode).toBe(false);
  });
});
