/**
 * useChartTheme - Shared composable for chart theme detection
 *
 * Replaces the duplicate getTheme()/setupThemeChangeListener() logic
 * that was copied into every chart component.
 */
import { ref, onMounted, onBeforeUnmount } from 'vue'

/**
 * Detect the current theme mode from DOM/localStorage/system preference.
 * @returns {'light'|'dark'} Resolved theme mode
 */
function detectThemeMode() {
  let themeMode = document.documentElement.getAttribute('data-theme') || localStorage.getItem('theme') || 'light'

  if (!['light', 'dark', 'system'].includes(themeMode)) {
    themeMode = 'light'
  }

  if (themeMode === 'system') {
    themeMode = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }

  return themeMode
}

/**
 * Read a CSS custom property from the document root.
 * @param {string} property - CSS variable name (with or without --)
 * @param {string} fallback
 * @returns {string}
 */
function getCssVar(property, fallback = '') {
  const prop = property.startsWith('--') ? property : `--${property}`
  return getComputedStyle(document.documentElement).getPropertyValue(prop).trim() || fallback
}

/**
 * Shared composable for chart theme management.
 *
 * @param {Object} [options]
 * @param {Function} [options.onThemeChange] - Callback when theme changes (for re-rendering)
 * @param {boolean} [options.listenToSystem] - Also listen to OS preference changes
 * @returns {{ theme: import('vue').Ref<string>, isDarkMode: import('vue').ComputedRef<boolean>, getTheme: Function }}
 */
export function useChartTheme(options = {}) {
  const { onThemeChange, listenToSystem = false } = options

  const theme = ref(detectThemeMode())
  let themeObserver = null
  let systemMediaQuery = null
  let systemChangeHandler = null

  function getTheme() {
    theme.value = detectThemeMode()
    const isDark = theme.value === 'dark'

    return {
      isDarkMode: isDark,
      theme: theme.value,
      textColor: getCssVar('--text-primary', isDark ? '#f0f0f0' : '#333333'),
      backgroundColor: getCssVar('--bg-card', isDark ? '#414141' : '#ffffff'),
      borderColor: getCssVar('--border-color', isDark ? '#555555' : '#e5e7eb'),
      gridColor: getCssVar('--border-light', isDark ? 'rgba(255,255,255,0.15)' : '#e0e0e0'),
      accentColor: getCssVar('--accent-color', '#4e97d1'),
      chartColors: ['#5470c6', '#91cc75', '#fac858', '#ee6666', '#73c0de', '#3ba272', '#fc8452', '#9a60b4'],
    }
  }

  function handleThemeMutation() {
    theme.value = detectThemeMode()
    if (onThemeChange) onThemeChange(theme.value)
  }

  onMounted(() => {
    // Watch for data-theme and class attribute changes on <html>
    themeObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.attributeName === 'class' || mutation.attributeName === 'data-theme') {
          handleThemeMutation()
          break
        }
      }
    })

    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme'],
    })

    // Optionally listen to OS-level system preference changes
    if (listenToSystem) {
      systemMediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
      systemChangeHandler = () => handleThemeMutation()

      if (systemMediaQuery.addEventListener) {
        systemMediaQuery.addEventListener('change', systemChangeHandler)
      } else {
        systemMediaQuery.addListener(systemChangeHandler)
      }
    }
  })

  onBeforeUnmount(() => {
    if (themeObserver) {
      themeObserver.disconnect()
      themeObserver = null
    }
    if (systemMediaQuery && systemChangeHandler) {
      if (systemMediaQuery.removeEventListener) {
        systemMediaQuery.removeEventListener('change', systemChangeHandler)
      } else {
        systemMediaQuery.removeListener(systemChangeHandler)
      }
      systemMediaQuery = null
      systemChangeHandler = null
    }
  })

  return { theme, getTheme }
}

export default useChartTheme
