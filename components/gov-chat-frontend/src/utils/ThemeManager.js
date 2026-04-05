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
        this.applyDialogTheme = this.applyDialogTheme.bind(this);
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
        
        // Check for explicit dark mode indicators - more robust checks
        const hasDarkClass =
            htmlElement.classList.contains('dark-theme') ||
            htmlElement.classList.contains('dark-mode') ||
            bodyElement.classList.contains('dark-theme') ||
            bodyElement.classList.contains('dark-mode');
    
        const hasDarkDataTheme =
            htmlElement.getAttribute('data-theme') === 'dark' ||
            bodyElement.getAttribute('data-theme') === 'dark';
            
        // Check system preference
        const prefersDarkMode =
            window.matchMedia('(prefers-color-scheme: dark)').matches;
            
        // Check for light mode indicators
        const hasLightClass =
            htmlElement.classList.contains('light-theme') ||
            htmlElement.classList.contains('light-mode') ||
            bodyElement.classList.contains('light-theme') ||
            bodyElement.classList.contains('light-mode');
            
        const hasLightDataTheme =
            htmlElement.getAttribute('data-theme') === 'light' ||
            bodyElement.getAttribute('data-theme') === 'light';
            
        // Set initial theme with explicit priority:
        // 1. Explicit light/dark classes or data attributes
        // 2. System preference
        // 3. Default to light mode
        if (hasDarkClass || hasDarkDataTheme) {
            this.setTheme('dark');
        } else if (hasLightClass || hasLightDataTheme) {
            this.setTheme('light');
        } else if (prefersDarkMode) {
            this.setTheme('dark');
        } else {
            // Always default to light mode if no clear indication
            this.setTheme('light');
        }
        
        // Force apply theme to ensure it's properly set in the DOM
        this.forceApplyTheme();
        
        console.log(`[ThemeManager] Initial theme detected: ${this.currentTheme}`);
    }

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
        window.dispatchEvent(new CustomEvent('themeChange', {
            detail: {
                theme: this.currentTheme,
                isDarkMode: this.isDarkMode,
                userPreference: this.userPreference
            }
        }));
    }

    /**
     * Set up listener for system theme changes
     */
    setupSystemThemeListener() {
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

        const handleThemeChange = (e) => {
            if (!document.documentElement.hasAttribute('data-theme') &&
                !document.documentElement.classList.contains('dark-theme') &&
                !document.documentElement.classList.contains('dark-mode')) {
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
        window.dispatchEvent(new CustomEvent('themeChange', {
            detail: {
                theme: this.currentTheme,
                isDarkMode: this.isDarkMode,
                userPreference: this.userPreference
            }
        }));

        console.log(`[ThemeManager] Theme set to: ${this.currentTheme} (user preference: ${this.userPreference})`);
    }

    /**
     * Toggle between light and dark themes
     */
    toggleTheme() {
        this.setTheme(this.currentTheme === 'light' ? 'dark' : 'light');
    }

    _getCssVar(property, fallback = '') {
        const prop = property.startsWith('--') ? property : `--${property}`;
        return getComputedStyle(document.documentElement).getPropertyValue(prop).trim() || fallback;
    }

    /**
     * Get current theme information
     * @returns {Object} Theme configuration
     */
    getThemeInfo() {
        return {
            isDarkMode: this.isDarkMode,
            textColor: this._getCssVar('--text-primary', this.isDarkMode ? '#f0f0f0' : '#333333'),
            backgroundColor: 'transparent',
            tooltipBackground: this.isDarkMode ? 'rgba(30, 30, 30, 0.85)' : 'rgba(255, 255, 255, 0.85)',
            tooltipTextColor: this._getCssVar('--text-primary', this.isDarkMode ? '#f0f0f0' : '#333333'),
            theme: this.currentTheme,

            // Additional useful colors
            borderColor: this._getCssVar('--border-color', this.isDarkMode ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.2)'),
            gridColor: this._getCssVar('--border-light', this.isDarkMode ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.1)'),
            accentColor: this._getCssVar('--accent-color', '#4E97D1'),

            // Standard chart colors that work in both themes
            chartColors: [
                '#5470c6', '#91cc75', '#fac858', '#ee6666',
                '#73c0de', '#3ba272', '#fc8452', '#9a60b4'
            ]
        };
    }

    /**
     * Get dialog-specific theme styles
     * @returns {Object} Dialog styling configuration
     */
    getDialogTheme() {
        const isDarkMode = this.isDarkMode;

        return {
            modal: {
                titleColor: this._getCssVar('--text-primary', isDarkMode ? '#f0f0f0' : '#333333'),
                textColor: this._getCssVar('--text-secondary', isDarkMode ? 'rgba(255, 255, 255, 0.8)' : '#666666'),
                background: this._getCssVar('--bg-dialog', isDarkMode ? '#2a2a2a' : '#ffffff'),
                borderColor: this._getCssVar('--border-color', isDarkMode ? '#3a3a3a' : '#dcdfe4'),
                boxShadow: isDarkMode
                    ? '0 4px 12px rgba(0, 0, 0, 0.4)'
                    : '0 4px 12px rgba(0, 0, 0, 0.15)'
            },
            overlay: {
                background: isDarkMode
                    ? 'rgba(0, 0, 0, 0.7)'
                    : 'rgba(0, 0, 0, 0.5)'
            },
            buttons: {
                primary: {
                    background: this._getCssVar('--accent-color', '#4E97D1'),
                    textColor: '#ffffff',
                    hoverBackground: this._getCssVar('--accent-hover', '#3a7da0')
                },
                secondary: {
                    background: this._getCssVar('--bg-button-secondary', isDarkMode ? '#3a3a3a' : '#cccccc'),
                    textColor: this._getCssVar('--text-button-secondary', isDarkMode ? '#e0e0e0' : '#333333'),
                    hoverBackground: this._getCssVar('--bg-button-secondary-hover', isDarkMode ? '#4a4a4a' : '#bbbbbb')
                }
            },
            input: {
                background: this._getCssVar('--bg-input', isDarkMode ? '#333333' : '#ffffff'),
                textColor: this._getCssVar('--text-primary', isDarkMode ? '#f0f0f0' : '#333333'),
                borderColor: this._getCssVar('--border-input', isDarkMode ? '#3a3a3a' : '#ddd'),
                placeholderColor: this._getCssVar('--text-tertiary', isDarkMode ? '#8c8c8c' : '#767676')
            },
            tabs: {
                background: this._getCssVar('--bg-tertiary', isDarkMode ? '#252525' : '#f0f2f5'),
                activeBackground: this._getCssVar('--bg-dialog', isDarkMode ? '#2a2a2a' : '#ffffff'),
                textColor: this._getCssVar('--text-primary', isDarkMode ? '#f0f0f0' : '#333333'),
                activeTextColor: this._getCssVar('--text-primary', isDarkMode ? '#ffffff' : '#000000'),
                borderColor: this._getCssVar('--border-color', isDarkMode ? '#3a3a3a' : '#cccccc')
            }
        };
    }

    /**
     * Convenience method to apply dialog theme to an element
     * @param {HTMLElement} element - Element to apply theme to
     * @param {string} [themeType='modal'] - Type of theme to apply
     */
    applyDialogTheme(element, themeType = 'modal') {
        if (!element) return;

        const theme = this.getDialogTheme();
        const themeStyles = theme[themeType] || theme.modal;

        Object.entries(themeStyles).forEach(([key, value]) => {
            if (typeof value === 'object') return; // Skip nested objects
            element.style.setProperty(`--dialog-${key}`, value);
        });
    }
}

// Ensure singleton export
export const themeManager = new ThemeManager();
// Export methods to ensure they can be imported correctly
export const getDialogTheme = themeManager.getDialogTheme;
export const applyDialogTheme = themeManager.applyDialogTheme;
// Export convenience methods
export const getThemeInfo = () => themeManager.getThemeInfo();
export const setTheme = (theme) => themeManager.setTheme(theme);
export const toggleTheme = () => themeManager.toggleTheme();
export default themeManager;