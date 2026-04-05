import { ref, onMounted, onBeforeUnmount } from 'vue'

/**
 * Detect current theme mode from DOM.
 */
function detectThemeMode() {
  const dataTheme = document.documentElement.getAttribute('data-theme')
  if (dataTheme === 'dark') return 'dark'
  if (dataTheme === 'light') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/**
 * Read a CSS custom property value from the document root.
 * @param {string} property - CSS variable name (with or without --)
 * @param {string} fallback - Fallback value
 * @returns {string}
 */
function getCssVar(property, fallback = '') {
  const prop = property.startsWith('--') ? property : `--${property}`
  return getComputedStyle(document.documentElement).getPropertyValue(prop).trim() || fallback
}

/**
 * Shared composable for chart theme management.
 * Provides reactive theme state and CSS-variable-based theme info.
 *
 * @param {Object} options
 * @param {Function} [options.onThemeChange] - Callback when theme changes
 * @param {boolean} [options.listenToSystem=false] - Also listen to system theme changes
 */
export function useChartTheme(options = {}) {
  const { onThemeChange, listenToSystem = false } = options
  const theme = ref(detectThemeMode())

  function getTheme() {
    const isDark = theme.value === 'dark'
    return {
      isDarkMode: isDark,
      textColor: getCssVar('--text-primary', isDark ? '#f0f0f0' : '#333333'),
      backgroundColor: 'transparent',
      tooltipBackground: isDark ? 'rgba(30, 30, 30, 0.85)' : 'rgba(255, 255, 255, 0.85)',
      tooltipTextColor: getCssVar('--text-primary', isDark ? '#f0f0f0' : '#333333'),
      borderColor: getCssVar('--border-color', isDark ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.2)'),
      gridColor: getCssVar('--border-light', isDark ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.1)'),
      accentColor: getCssVar('--accent-color', '#4E97D1'),
      chartColors: ['#5470c6', '#91cc75', '#fac858', '#ee6666', '#73c0de', '#3ba272', '#fc8452', '#9a60b4'],
    }
  }

  function handleThemeChange() {
    theme.value = detectThemeMode()
    if (onThemeChange) onThemeChange(theme.value)
  }

  let observer = null

  onMounted(() => {
    // Listen for ThemeManager's CustomEvent
    window.addEventListener('themeChange', handleThemeChange)

    // Also observe data-theme attribute as a fallback
    observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.attributeName === 'data-theme' || mutation.attributeName === 'class') {
          handleThemeChange()
          break
        }
      }
    })
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'class'],
    })

    if (listenToSystem) {
      const mql = window.matchMedia('(prefers-color-scheme: dark)')
      mql.addEventListener('change', handleThemeChange)
    }
  })

  onBeforeUnmount(() => {
    window.removeEventListener('themeChange', handleThemeChange)
    if (observer) observer.disconnect()
  })

  return { theme, getTheme }
}
