/**
 * ThemeManager.js - Singleton to handle theme management across the application
 */

class ThemeManager {
  constructor() {
    // Enforce singleton pattern
    if (ThemeManager.instance) {
      return ThemeManager.instance;
    }

    // Initialize with default theme (light)
    this.currentTheme = 'light';
    this.isDarkMode = false;
    this.userPreference = 'light';

    // Bind methods to ensure correct context
    this.getDialogTheme = this.getDialogTheme.bind(this);
    this.detectInitialTheme = this.detectInitialTheme.bind(this);
    this.forceApplyTheme = this.forceApplyTheme.bind(this);

    // Detect and apply theme immediately
    this.detectInitialTheme();

    // Set up system theme change listener
    this.setupSystemThemeListener();

    // Make this instance the singleton
    ThemeManager.instance = this;

    // Reapply theme after a small delay to ensure it propagates
    setTimeout(() => this.forceApplyTheme(), 50);
  }

  detectInitialTheme() {
    const htmlElement = document.documentElement;
    const bodyElement = document.body;

    // 1. Check localStorage for saved user preference (highest priority)
    try {
      const savedTheme = localStorage.getItem('theme');
      if (savedTheme && ['light', 'dark', 'system'].includes(savedTheme)) {
        this.setTheme(savedTheme);
        console.log(`[ThemeManager] Theme from localStorage: ${savedTheme}`);
        return;
      }
    } catch {
      // localStorage not available
    }

    // 2. Check for explicit dark mode indicators on DOM
    const hasDarkClass =
      htmlElement.classList.contains('dark-theme') ||
      htmlElement.classList.contains('dark-mode') ||
      bodyElement.classList.contains('dark-theme') ||
      bodyElement.classList.contains('dark-mode');

    const hasDarkDataTheme =
      htmlElement.getAttribute('data-theme') === 'dark' || bodyElement.getAttribute('data-theme') === 'dark';

    // 3. Check for light mode indicators on DOM
    const hasLightClass =
      htmlElement.classList.contains('light-theme') ||
      htmlElement.classList.contains('light-mode') ||
      bodyElement.classList.contains('light-theme') ||
      bodyElement.classList.contains('light-mode');

    const hasLightDataTheme =
      htmlElement.getAttribute('data-theme') === 'light' || bodyElement.getAttribute('data-theme') === 'light';

    // 4. Fall back to system preference
    const prefersDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;

    if (hasDarkClass || hasDarkDataTheme) {
      this.setTheme('dark');
    } else if (hasLightClass || hasLightDataTheme) {
      this.setTheme('light');
    } else if (prefersDarkMode) {
      this.setTheme('dark');
    } else {
      this.setTheme('light');
    }

    console.log(`[ThemeManager] Initial theme detected: ${this.currentTheme}`);
  }

  /**
   * Force apply the current theme to the DOM
   */
  forceApplyTheme() {
    // Force apply the theme to the DOM
    document.documentElement.setAttribute('data-theme', this.currentTheme);
    document.body.setAttribute('data-theme', this.currentTheme);

    // Add/remove dark mode classes for compatibility
    if (this.isDarkMode) {
      document.documentElement.classList.add('dark-mode');
      document.body.classList.add('dark-mode');
    } else {
      document.documentElement.classList.remove('dark-mode');
      document.body.classList.remove('dark-mode');
    }

    // Dispatch theme change event
    window.dispatchEvent(
      new CustomEvent('themeChange', {
        detail: {
          theme: this.currentTheme,
          isDarkMode: this.isDarkMode,
          userPreference: this.userPreference
        }
      })
    );
  }

  /**
   * Set up listener for system theme changes
   */
  setupSystemThemeListener() {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const handleThemeChange = (e) => {
      if (
        !document.documentElement.hasAttribute('data-theme') &&
        !document.documentElement.classList.contains('dark-theme') &&
        !document.documentElement.classList.contains('dark-mode')
      ) {
        // Only update if no explicit theme is set on the DOM
        this.setTheme(e.matches ? 'dark' : 'light');
        console.log(`[ThemeManager] System theme changed to: ${this.currentTheme}`);
      }
    };

    // Add listener with compatibility for older browsers
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handleThemeChange);
    } else {
      mediaQuery.addListener(handleThemeChange);
    }
  }

  // Add this method to the ThemeManager class in ThemeManager.js

  /**
   * Set the theme with support for 'system' option
   * @param {string} theme - 'light', 'dark', or 'system'
   */
  setTheme(theme) {
    // Store the user's preference
    this.userPreference = theme;

    if (theme === 'system') {
      // For system preference, check the media query
      const prefersDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
      this.currentTheme = prefersDarkMode ? 'dark' : 'light';
      this.isDarkMode = prefersDarkMode;
    } else if (theme === 'light' || theme === 'dark') {
      // For explicit light/dark choices
      this.currentTheme = theme;
      this.isDarkMode = theme === 'dark';
    } else {
      console.error(`[ThemeManager] Invalid theme: ${theme}. Must be 'light', 'dark', or 'system'.`);
      return;
    }

    // Apply the theme to the DOM
    document.documentElement.setAttribute('data-theme', this.currentTheme);
    document.body.setAttribute('data-theme', this.currentTheme);

    // Add/remove dark mode classes for compatibility
    if (this.isDarkMode) {
      document.documentElement.classList.add('dark-mode');
      document.body.classList.add('dark-mode');
    } else {
      document.documentElement.classList.remove('dark-mode');
      document.body.classList.remove('dark-mode');
    }

    // Dispatch theme change event
    window.dispatchEvent(
      new CustomEvent('themeChange', {
        detail: {
          theme: this.currentTheme,
          isDarkMode: this.isDarkMode,
          userPreference: this.userPreference
        }
      })
    );

    console.log(`[ThemeManager] Theme set to: ${this.currentTheme} (user preference: ${this.userPreference})`);
  }

  /**
   * Read a CSS custom property value from the document root
   * @param {string} property - CSS variable name (with or without --)
   * @param {string} fallback - Fallback value if the variable is not set
   * @returns {string} The computed CSS variable value
   */
  _getCssVar(property, fallback = '') {
    const prop = property.startsWith('--') ? property : `--${property}`;
    return getComputedStyle(document.documentElement).getPropertyValue(prop).trim() || fallback;
  }

  /**
   * Get dialog-specific theme styles, reading colors from CSS variables
   * @returns {Object} Dialog styling configuration
   */
  getDialogTheme() {
    return {
      modal: {
        titleColor: this._getCssVar('--fg', this.isDarkMode ? '#f0f0f0' : '#333333'),
        textColor: this._getCssVar('--muted', this.isDarkMode ? '#b3b3b3' : '#666666'),
        background: this._getCssVar('--surface', this.isDarkMode ? '#2a2a2a' : '#ffffff'),
        borderColor: this._getCssVar('--border', this.isDarkMode ? '#3a3a3a' : '#dcdfe4'),
        boxShadow: this.isDarkMode ? '0 4px 12px rgba(0, 0, 0, 0.4)' : '0 4px 12px rgba(0, 0, 0, 0.15)'
      },
      overlay: {
        background: this.isDarkMode ? 'rgba(0, 0, 0, 0.7)' : 'rgba(0, 0, 0, 0.5)'
      },
      buttons: {
        primary: {
          background: this._getCssVar('--accent', '#4E97D1'),
          textColor: '#ffffff',
          hoverBackground: this._getCssVar('--accent-hover', '#3a7da0')
        },
        secondary: {
          background: this._getCssVar('--btn-secondary-bg', this.isDarkMode ? '#3a3a3a' : '#cccccc'),
          textColor: this._getCssVar('--btn-secondary-fg', this.isDarkMode ? '#e0e0e0' : '#333333'),
          hoverBackground: this._getCssVar('--btn-secondary-hover', this.isDarkMode ? '#4a4a4a' : '#bbbbbb')
        }
      },
      input: {
        background: this._getCssVar('--surface', this.isDarkMode ? '#333333' : '#ffffff'),
        textColor: this._getCssVar('--fg', this.isDarkMode ? '#f0f0f0' : '#333333'),
        borderColor: this._getCssVar('--border', this.isDarkMode ? '#3a3a3a' : '#ddd'),
        placeholderColor: this._getCssVar('--muted-soft', this.isDarkMode ? '#8c8c8c' : '#767676')
      },
      tabs: {
        background: this._getCssVar('--bg', this.isDarkMode ? '#252525' : '#f0f2f5'),
        activeBackground: this._getCssVar('--surface', this.isDarkMode ? '#2a2a2a' : '#ffffff'),
        textColor: this._getCssVar('--fg', this.isDarkMode ? '#f0f0f0' : '#333333'),
        activeTextColor: this._getCssVar('--fg', this.isDarkMode ? '#f0f0f0' : '#000000'),
        borderColor: this._getCssVar('--border', this.isDarkMode ? '#3a3a3a' : '#cccccc')
      }
    };
  }
}

// Ensure singleton export
export const themeManager = new ThemeManager();
export const getDialogTheme = themeManager.getDialogTheme;
export const setTheme = (theme) => themeManager.setTheme(theme);
export default themeManager;
