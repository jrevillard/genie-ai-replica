'use strict';

// Mock DOM APIs before importing ThemeManager
const mockLocalStorage = (() => {
  let store = {};
  return {
    getItem: jest.fn((key) => store[key] ?? null),
    setItem: jest.fn((key, val) => {
      store[key] = val;
    }),
    removeItem: jest.fn((key) => {
      delete store[key];
    }),
    clear: jest.fn(() => {
      store = {};
    }),
    _getStore: () => store
  };
})();

Object.defineProperty(window, 'localStorage', { value: mockLocalStorage });

const mockMatchMedia = jest.fn((_query) => ({
  matches: false,
  addEventListener: jest.fn(),
  removeEventListener: jest.fn(),
  addListener: jest.fn(),
  removeListener: jest.fn()
}));

Object.defineProperty(window, 'matchMedia', { value: mockMatchMedia, writable: true, configurable: true });

const mockDispatchEvent = jest.fn();
Object.defineProperty(window, 'dispatchEvent', { value: mockDispatchEvent });

// Mock document.documentElement and document.body with classList and attributes
const createMockElement = () => {
  const classes = new Set();
  const attrs = {};
  return {
    classList: {
      add: jest.fn((cls) => classes.add(cls)),
      remove: jest.fn((cls) => classes.delete(cls)),
      contains: jest.fn((cls) => classes.has(cls))
    },
    setAttribute: jest.fn((attr, val) => {
      attrs[attr] = val;
    }),
    getAttribute: jest.fn((attr) => attrs[attr] ?? null),
    hasAttribute: jest.fn((attr) => attr in attrs),
    _classes: classes,
    _attrs: attrs
  };
};

let mockDocElement = createMockElement();
let mockBody = createMockElement();

Object.defineProperty(document, 'documentElement', { value: mockDocElement, configurable: true });
Object.defineProperty(document, 'body', { value: mockBody, configurable: true });

// Mock getComputedStyle for _getCssVar
Object.defineProperty(window, 'getComputedStyle', {
  value: jest.fn(() => ({
    getPropertyValue: jest.fn((_prop) => '')
  }))
});

// Mock CustomEvent
global.CustomEvent = class CustomEvent {
  constructor(type, options = {}) {
    this.type = type;
    this.detail = options.detail;
  }
};

jest.useFakeTimers();

describe('ThemeManager', () => {
  let ThemeManagerModule;

  beforeEach(() => {
    jest.clearAllMocks();
    mockLocalStorage.clear();

    // Reset window.matchMedia to default mock (returns light mode)
    Object.defineProperty(window, 'matchMedia', { value: mockMatchMedia, writable: true, configurable: true });

    // Reset singleton
    jest.resetModules();

    // Create fresh mock elements for each test
    mockDocElement = createMockElement();
    mockBody = createMockElement();
    Object.defineProperty(document, 'documentElement', { value: mockDocElement, configurable: true });
    Object.defineProperty(document, 'body', { value: mockBody, configurable: true });

    // Re-import to get fresh singleton
    ThemeManagerModule = require('@/utils/ThemeManager');
  });

  describe('initialization', () => {
    it('creates a singleton instance', () => {
      const instance1 = ThemeManagerModule.default;
      const instance2 = ThemeManagerModule.themeManager;

      expect(instance1).toBe(instance2);
    });

    it('defaults to light theme when no preference saved', () => {
      const tm = ThemeManagerModule.default;

      expect(tm.currentTheme).toBe('light');
      expect(tm.isDarkMode).toBe(false);
    });

    it('restores theme from localStorage', () => {
      mockLocalStorage.getItem.mockReturnValueOnce('dark');

      jest.resetModules();
      const mod = require('@/utils/ThemeManager');
      const tm = mod.default;

      expect(tm.currentTheme).toBe('dark');
      expect(tm.isDarkMode).toBe(true);
    });

    it('detects system dark mode preference via setTheme system', () => {
      // Verify that system theme resolves correctly using matchMedia
      const tm = ThemeManagerModule.default;

      // Default matchMedia returns false (light mode)
      tm.setTheme('system');
      expect(tm.currentTheme).toBe('light');
      expect(tm.isDarkMode).toBe(false);
    });
  });

  describe('setTheme', () => {
    it('sets light theme', () => {
      const tm = ThemeManagerModule.default;

      tm.setTheme('light');

      expect(tm.currentTheme).toBe('light');
      expect(tm.isDarkMode).toBe(false);
      expect(tm.userPreference).toBe('light');
    });

    it('sets dark theme', () => {
      const tm = ThemeManagerModule.default;

      tm.setTheme('dark');

      expect(tm.currentTheme).toBe('dark');
      expect(tm.isDarkMode).toBe(true);
      expect(tm.userPreference).toBe('dark');
    });

    it('sets system theme and resolves to light when system prefers light', () => {
      const tm = ThemeManagerModule.default;

      tm.setTheme('system');

      expect(tm.userPreference).toBe('system');
      expect(tm.currentTheme).toBe('light');
      expect(tm.isDarkMode).toBe(false);
    });

    it('sets system theme and resolves to dark when system prefers dark', () => {
      // matchMedia returns dark preference
      window.matchMedia = jest.fn((query) => ({
        matches: query.includes('dark'),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        addListener: jest.fn(),
        removeListener: jest.fn()
      }));

      jest.resetModules();
      const mod = require('@/utils/ThemeManager');
      const tm = mod.default;

      tm.setTheme('system');

      expect(tm.userPreference).toBe('system');
      expect(tm.currentTheme).toBe('dark');
      expect(tm.isDarkMode).toBe(true);
    });

    it('ignores invalid theme values', () => {
      const tm = ThemeManagerModule.default;
      const originalTheme = tm.currentTheme;

      tm.setTheme('invalid');

      expect(tm.currentTheme).toBe(originalTheme);
    });

    it('applies data-theme attribute to document', () => {
      const tm = ThemeManagerModule.default;

      tm.setTheme('dark');

      expect(document.documentElement.setAttribute).toHaveBeenCalledWith('data-theme', 'dark');
      expect(document.body.setAttribute).toHaveBeenCalledWith('data-theme', 'dark');
    });

    it('adds dark-mode class when dark', () => {
      const tm = ThemeManagerModule.default;

      tm.setTheme('dark');

      expect(document.documentElement.classList.add).toHaveBeenCalledWith('dark-mode');
      expect(document.body.classList.add).toHaveBeenCalledWith('dark-mode');
    });

    it('removes dark-mode class when light', () => {
      const tm = ThemeManagerModule.default;

      tm.setTheme('light');

      expect(document.documentElement.classList.remove).toHaveBeenCalledWith('dark-mode');
      expect(document.body.classList.remove).toHaveBeenCalledWith('dark-mode');
    });

    it('dispatches themeChange event', () => {
      const tm = ThemeManagerModule.default;

      tm.setTheme('dark');

      expect(window.dispatchEvent).toHaveBeenCalled();
    });
  });

  describe('forceApplyTheme', () => {
    it('applies current theme to DOM and dispatches event', () => {
      const tm = ThemeManagerModule.default;

      tm.setTheme('dark');
      window.dispatchEvent.mockClear();

      tm.forceApplyTheme();

      expect(document.documentElement.setAttribute).toHaveBeenCalledWith('data-theme', 'dark');
      expect(window.dispatchEvent).toHaveBeenCalledTimes(1);
    });
  });

  describe('getDialogTheme', () => {
    it('returns dialog theme configuration', () => {
      const tm = ThemeManagerModule.default;

      tm.setTheme('light');
      const dialogTheme = tm.getDialogTheme();

      expect(dialogTheme).toHaveProperty('modal');
      expect(dialogTheme).toHaveProperty('overlay');
      expect(dialogTheme).toHaveProperty('buttons');
      expect(dialogTheme).toHaveProperty('input');
      expect(dialogTheme).toHaveProperty('tabs');
    });

    it('returns dark mode defaults when isDarkMode is true', () => {
      const tm = ThemeManagerModule.default;

      tm.setTheme('dark');
      const dialogTheme = tm.getDialogTheme();

      expect(dialogTheme.overlay.background).toBe('rgba(0, 0, 0, 0.7)');
    });

    it('returns light mode defaults when isDarkMode is false', () => {
      const tm = ThemeManagerModule.default;

      tm.setTheme('light');
      const dialogTheme = tm.getDialogTheme();

      expect(dialogTheme.overlay.background).toBe('rgba(0, 0, 0, 0.5)');
    });
  });

  describe('detectInitialTheme priority', () => {
    it('prefers localStorage over DOM classes', () => {
      mockLocalStorage.getItem.mockReturnValueOnce('light');

      const darkEl = createMockElement();
      darkEl.classList.add('dark-mode');
      Object.defineProperty(document, 'documentElement', { value: darkEl, configurable: true });

      jest.resetModules();
      const tm = require('@/utils/ThemeManager').default;

      expect(tm.currentTheme).toBe('light');
    });

    it('defaults to light when no indicators present', () => {
      const tm = ThemeManagerModule.default;

      expect(tm.currentTheme).toBe('light');
      expect(tm.isDarkMode).toBe(false);
    });

    it('detects dark theme from DOM dark-mode class', () => {
      const darkEl = createMockElement();
      darkEl.classList.add('dark-mode');
      const bodyEl = createMockElement();

      Object.defineProperty(document, 'documentElement', { value: darkEl, configurable: true });
      Object.defineProperty(document, 'body', { value: bodyEl, configurable: true });

      jest.resetModules();
      const tm = require('@/utils/ThemeManager').default;

      expect(tm.currentTheme).toBe('dark');
      expect(tm.isDarkMode).toBe(true);
    });

    it('detects dark theme from data-theme attribute', () => {
      const darkEl = createMockElement();
      darkEl.setAttribute('data-theme', 'dark');
      const bodyEl = createMockElement();

      Object.defineProperty(document, 'documentElement', { value: darkEl, configurable: true });
      Object.defineProperty(document, 'body', { value: bodyEl, configurable: true });

      jest.resetModules();
      const tm = require('@/utils/ThemeManager').default;

      expect(tm.currentTheme).toBe('dark');
      expect(tm.isDarkMode).toBe(true);
    });

    it('detects light theme from DOM light-mode class', () => {
      const lightEl = createMockElement();
      lightEl.classList.add('light-mode');
      const bodyEl = createMockElement();

      Object.defineProperty(document, 'documentElement', { value: lightEl, configurable: true });
      Object.defineProperty(document, 'body', { value: bodyEl, configurable: true });

      jest.resetModules();
      const tm = require('@/utils/ThemeManager').default;

      expect(tm.currentTheme).toBe('light');
      expect(tm.isDarkMode).toBe(false);
    });

    it('falls back to system preference when no localStorage or DOM indicators', () => {
      window.matchMedia = jest.fn((query) => ({
        matches: query.includes('dark'),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        addListener: jest.fn(),
        removeListener: jest.fn()
      }));

      const el = createMockElement();
      Object.defineProperty(document, 'documentElement', { value: el, configurable: true });
      Object.defineProperty(document, 'body', { value: createMockElement(), configurable: true });

      jest.resetModules();
      const tm = require('@/utils/ThemeManager').default;

      expect(tm.currentTheme).toBe('dark');
      expect(tm.isDarkMode).toBe(true);
    });
  });

  describe('setupSystemThemeListener', () => {
    it('registers a change listener on matchMedia', () => {
      let addedListener = null;
      window.matchMedia = jest.fn(() => ({
        matches: false,
        addEventListener: jest.fn((event, handler) => {
          if (event === 'change') addedListener = handler;
        }),
        removeEventListener: jest.fn(),
        addListener: jest.fn(),
        removeListener: jest.fn()
      }));

      jest.resetModules();
      require('@/utils/ThemeManager');

      expect(addedListener).not.toBeNull();
    });

    it('does not override explicit data-theme when system changes', () => {
      let changeHandler = null;
      const el = createMockElement();
      window.matchMedia = jest.fn(() => ({
        matches: false,
        addEventListener: jest.fn((event, handler) => {
          if (event === 'change') changeHandler = handler;
        }),
        removeEventListener: jest.fn(),
        addListener: jest.fn(),
        removeListener: jest.fn()
      }));
      Object.defineProperty(document, 'documentElement', { value: el, configurable: true });
      Object.defineProperty(document, 'body', { value: createMockElement(), configurable: true });

      jest.resetModules();
      const tm = require('@/utils/ThemeManager').default;

      el.hasAttribute.mockReturnValue(true);

      const themeBefore = tm.currentTheme;
      changeHandler({ matches: true });

      expect(tm.currentTheme).toBe(themeBefore);
    });

    it('updates theme when system preference changes and no explicit theme is set', () => {
      let changeHandler = null;
      const el = createMockElement();
      const bodyEl = createMockElement();

      window.matchMedia = jest.fn(() => ({
        matches: false,
        addEventListener: jest.fn((event, handler) => {
          if (event === 'change') changeHandler = handler;
        }),
        removeEventListener: jest.fn(),
        addListener: jest.fn(),
        removeListener: jest.fn()
      }));

      Object.defineProperty(document, 'documentElement', { value: el, configurable: true });
      Object.defineProperty(document, 'body', { value: bodyEl, configurable: true });

      jest.resetModules();
      const tm = require('@/utils/ThemeManager').default;

      expect(tm.currentTheme).toBe('light');

      el.hasAttribute.mockReturnValue(false);
      el.classList.contains.mockReturnValue(false);

      changeHandler({ matches: true });

      expect(tm.currentTheme).toBe('dark');
      expect(tm.isDarkMode).toBe(true);
    });

    it('updates to light when system preference changes to light and no explicit theme is set', () => {
      let changeHandler = null;
      const el = createMockElement();
      const bodyEl = createMockElement();

      // Start with dark system preference
      window.matchMedia = jest.fn(() => ({
        matches: true,
        addEventListener: jest.fn((event, handler) => {
          if (event === 'change') changeHandler = handler;
        }),
        removeEventListener: jest.fn(),
        addListener: jest.fn(),
        removeListener: jest.fn()
      }));

      Object.defineProperty(document, 'documentElement', { value: el, configurable: true });
      Object.defineProperty(document, 'body', { value: bodyEl, configurable: true });

      jest.resetModules();
      const tm = require('@/utils/ThemeManager').default;

      expect(tm.currentTheme).toBe('dark');

      el.hasAttribute.mockReturnValue(false);
      el.classList.contains.mockReturnValue(false);

      changeHandler({ matches: false });

      expect(tm.currentTheme).toBe('light');
      expect(tm.isDarkMode).toBe(false);
    });
  });
});
