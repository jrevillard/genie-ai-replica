/**
 * useChartTheme - Shared composable for chart theme detection
 *
 * Provides CSS variable reference strings for chart libraries that support
 * them natively (ApexCharts, D3 SVG). No runtime color resolution needed.
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';

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
 * @returns {{ theme: import('vue').Ref<string>, isDarkMode: import('vue').ComputedRef<boolean>, getCssVarStrings: Function }}
 */
export function useChartTheme(options = {}) {
  const { onThemeChange, listenToSystem = false } = options;

  const theme = ref(detectThemeMode());
  const isDarkMode = computed(() => theme.value === 'dark');
  let themeObserver = null;
  let systemMediaQuery = null;
  let systemChangeHandler = null;

  /**
   * Return CSS variable reference strings for chart config.
   * ApexCharts and D3 SVG elements consume these directly.
   */
  function getCssVarStrings() {
    return {
      isDarkMode: isDarkMode.value,
      textColor: 'var(--fg)',
      backgroundColor: 'var(--surface)',
      borderColor: 'var(--border)',
      gridColor: 'var(--border-light)',
      accentColor: 'var(--accent)',
      mutedColor: 'var(--muted)',
      chartColors: ['#5470c6', '#91cc75', '#fac858', '#ee6666', '#73c0de', '#3ba272', '#fc8452', '#9a60b4']
    };
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

  return { theme, isDarkMode, getCssVarStrings };
}

export default useChartTheme;
