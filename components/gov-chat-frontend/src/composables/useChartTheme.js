/**
 * useChartTheme - Shared composable for chart theme detection and RESOLVED colors.
 *
 * Chart libraries cannot resolve CSS var() references: ECharts paints to canvas
 * (fillStyle parses CSS colors, not references) and ApexCharts applies config
 * colors as SVG presentation attributes (var() is invalid there — css-variables-1).
 * The old "CSS variable reference strings" contract therefore never worked: the
 * strings silently fell back wherever they reached SVG attributes or canvas, and
 * the hardcoded stock palette ignored --brand and every deployment flavour.
 *
 * The bridge now returns RESOLVED colors: each token is read through a hidden
 * probe element (utils/chartColors.js — works for any token definition, including
 * theme-variables.css's relative-OKLch chains), and the categorical ramp is
 * derived from --brand + the status tokens by expressions the browser evaluates.
 * Call getResolvedTheme() (or the getCssVarStrings() alias) at render time; the
 * theme MutationObserver below fires onThemeChange so callers re-render.
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { buildBrandRamp, resolveChartTokens } from '../utils/chartColors';

/**
 * Detect the current theme mode from DOM/localStorage/system preference.
 * @returns {'light'|'dark'} Resolved theme mode
 */
function detectThemeMode() {
  let themeMode = document.documentElement.getAttribute('data-theme') || localStorage.getItem('theme') || 'light';

  if (!['light', 'dark', 'system'].includes(themeMode)) {
    themeMode = 'light';
  }

  if (themeMode === 'system') {
    themeMode = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  return themeMode;
}

/**
 * Shared composable for chart theme management.
 *
 * @param {Object} [options]
 * @param {Function} [options.onThemeChange] - Callback when theme changes (for re-rendering)
 * @param {boolean} [options.listenToSystem] - Also listen to OS preference changes
 * @returns {{ theme: import('vue').Ref<string>, isDarkMode: import('vue').ComputedRef<boolean>, getResolvedTheme: Function, getCssVarStrings: Function }}
 */
export function useChartTheme(options = {}) {
  const { onThemeChange, listenToSystem = false } = options;

  const theme = ref(detectThemeMode());
  const isDarkMode = computed(() => theme.value === 'dark');
  let themeObserver = null;
  let systemMediaQuery = null;
  let systemChangeHandler = null;

  /**
   * Return the RESOLVED chart theme: concrete color strings read from the live
   * tokens, plus the brand-derived categorical ramp. Safe for canvas fillStyle,
   * SVG presentation attributes, D3 attr() — every channel charts use.
   */
  function getResolvedTheme() {
    const tokens = resolveChartTokens();
    const accentColor = tokens['--accent'];
    const statuses = {
      success: tokens['--success'],
      warning: tokens['--warning'],
      danger: tokens['--danger'],
      info: tokens['--info']
    };
    return {
      isDarkMode: isDarkMode.value,
      textColor: tokens['--fg'],
      backgroundColor: tokens['--surface'],
      borderColor: tokens['--border'],
      gridColor: tokens['--border-light'],
      accentColor,
      mutedColor: tokens['--muted'],
      brandColor: tokens['--brand'],
      statusColors: statuses,
      chartColors: buildBrandRamp({ accent: accentColor, brand: tokens['--brand'], statuses, fg: tokens['--fg'] })
    };
  }

  /**
   * Backward-compatible alias — now returns RESOLVED colors (the historic
   * 'var(--x)' string contract never resolved outside stylesheets; every
   * consumer was migrated to concrete values in T1).
   */
  function getCssVarStrings() {
    return getResolvedTheme();
  }

  function handleThemeMutation() {
    theme.value = detectThemeMode();
    if (onThemeChange) onThemeChange(theme.value);
  }

  onMounted(() => {
    themeObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.attributeName === 'class' || mutation.attributeName === 'data-theme') {
          handleThemeMutation();
          break;
        }
      }
    });

    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme']
    });

    if (listenToSystem) {
      systemMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      systemChangeHandler = () => handleThemeMutation();

      if (systemMediaQuery.addEventListener) {
        systemMediaQuery.addEventListener('change', systemChangeHandler);
      } else {
        systemMediaQuery.addListener(systemChangeHandler);
      }
    }
  });

  onBeforeUnmount(() => {
    if (themeObserver) {
      themeObserver.disconnect();
      themeObserver = null;
    }
    if (systemMediaQuery && systemChangeHandler) {
      if (systemMediaQuery.removeEventListener) {
        systemMediaQuery.removeEventListener('change', systemChangeHandler);
      } else {
        systemMediaQuery.removeListener(systemChangeHandler);
      }
      systemMediaQuery = null;
      systemChangeHandler = null;
    }
  });

  return { theme, isDarkMode, getResolvedTheme, getCssVarStrings };
}

export default useChartTheme;
