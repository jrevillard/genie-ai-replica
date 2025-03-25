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

        // Initialize by checking if dark mode is active
        this.detectInitialTheme();

        // Set up system theme change listener
        this.setupSystemThemeListener();

        // Make this instance the singleton
        ThemeManager.instance = this;
    }

    /**
     * Detect the initial theme from DOM or system preference
     */
    detectInitialTheme() {
        const htmlElement = document.documentElement;

        // Check for explicit dark mode indicators
        const hasDarkClass =
            htmlElement.classList.contains('dark-theme') ||
            htmlElement.classList.contains('dark-mode');

        const hasDarkDataTheme =
            htmlElement.getAttribute('data-theme') === 'dark';

        // Check system preference
        const prefersDarkMode =
            window.matchMedia('(prefers-color-scheme: dark)').matches;

        // Set initial theme
        if (hasDarkClass || hasDarkDataTheme || prefersDarkMode) {
            this.setTheme('dark');
        } else {
            this.setTheme('light');
        }

        console.log(`[ThemeManager] Initial theme detected: ${this.currentTheme}`);
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

    /**
     * Get current theme information
     * @returns {Object} Theme configuration
     */
    getThemeInfo() {
        return {
            isDarkMode: this.isDarkMode,
            textColor: this.isDarkMode ? '#FFFFFF' : '#333333',
            backgroundColor: 'transparent',
            tooltipBackground: this.isDarkMode ? 'rgba(30, 30, 30, 0.85)' : 'rgba(255, 255, 255, 0.85)',
            tooltipTextColor: this.isDarkMode ? '#FFFFFF' : '#333333',
            theme: this.currentTheme,

            // Additional useful colors
            borderColor: this.isDarkMode ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.2)',
            gridColor: this.isDarkMode ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.1)',
            accentColor: '#4E97D1',

            // Standard chart colors that work in both themes
            chartColors: [
                '#5470c6', '#91cc75', '#fac858', '#ee6666',
                '#73c0de', '#3ba272', '#fc8452', '#9a60b4'
            ]
        };
    }
}

// Export singleton instance
export const themeManager = new ThemeManager();

// Export convenience methods
export const getThemeInfo = () => themeManager.getThemeInfo();
export const setTheme = (theme) => themeManager.setTheme(theme);
export const toggleTheme = () => themeManager.toggleTheme();

// Legacy exported functions for backward compatibility
export function applyThemeToAxes(svg, theme) {
    if (!svg || !theme) return;

    // Apply theme to all axis domains and tick lines
    svg.selectAll('.domain, .tick line')
        .attr('stroke', theme.borderColor);

    // Apply theme to all axis text
    svg.selectAll('.tick text')
        .style('fill', theme.textColor)
        .style('font-weight', theme.isDarkMode ? 'normal' : 'bold');
}

export function createThemedTooltip(containerId = 'chart-tooltip') {
    const theme = themeManager.getThemeInfo();

    // Remove any existing tooltip with this ID
    d3.select(`#${containerId}`).remove();

    // Create new tooltip
    const tooltip = d3.select('body')
        .append('div')
        .attr('id', containerId)
        .attr('class', 'd3-tooltip')
        .style('position', 'absolute')
        .style('background', theme.tooltipBackground)
        .style('color', theme.tooltipTextColor)
        .style('padding', '8px')
        .style('border-radius', '4px')
        .style('font-size', '12px')
        .style('pointer-events', 'none')
        .style('opacity', 0)
        .style('z-index', 1000)
        .style('box-shadow', '0 3px 14px rgba(0,0,0,0.4)');

    return tooltip;
}