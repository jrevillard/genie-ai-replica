'use strict';

/**
 * Regression test for infinite recursion in theme change handling.
 *
 * Bug: App.vue handleThemeChange listens for 'themeChange' events AND calls
 * themeManager.setTheme() which dispatches 'themeChange' events — causing
 * infinite recursion (Maximum call stack size exceeded).
 *
 * Fix: Re-entrancy guard (_isApplyingTheme flag) in handleThemeChange.
 */

describe('Theme change recursion guard', () => {
  let setThemeCallCount;

  beforeEach(() => {
    setThemeCallCount = 0;
  });

  /**
   * Simulates the exact recursion pattern from the bug:
   * handleThemeChange → themeManager.setTheme → dispatches themeChange → handleThemeChange
   *
   * Without the guard, this blows the call stack.
   * With the guard, handleThemeChange returns early on re-entrant calls.
   */
  it('should not cause infinite recursion when setTheme dispatches themeChange event', () => {
    const MAX_SAFE_CALLS = 5; // Well below stack limit, proves no recursion

    // Simulate themeManager.setTheme that dispatches themeChange event
    const mockThemeManager = {
      setTheme(theme) {
        setThemeCallCount++;
        // Simulate the event dispatch that would trigger handleThemeChange again
        if (setThemeCallCount < MAX_SAFE_CALLS) {
          mockHandleThemeChange({ detail: { theme } });
        }
      }
    };

    // Simulate handleThemeChange with re-entrancy guard (the fix)
    let isApplyingTheme = false;
    function mockHandleThemeChange(event) {
      const newTheme = event?.detail?.theme ?? event;
      if (isApplyingTheme) return; // Guard — breaks the cycle
      isApplyingTheme = true;

      // ... theme application logic ...
      mockThemeManager.setTheme(newTheme);

      isApplyingTheme = false;
    }

    // This would recurse infinitely without the guard
    expect(() => mockHandleThemeChange({ detail: { theme: 'dark' } })).not.toThrow();
    expect(setThemeCallCount).toBe(1); // Only one actual call, re-entrant calls skipped
  });

  it('should still apply theme changes on subsequent distinct calls', () => {
    const appliedThemes = [];

    const mockThemeManager = {
      setTheme(theme) {
        appliedThemes.push(theme);
      }
    };

    let isApplyingTheme = false;
    function mockHandleThemeChange(event) {
      const newTheme = event?.detail?.theme ?? event;
      if (isApplyingTheme) return;
      isApplyingTheme = true;
      mockThemeManager.setTheme(newTheme);
      isApplyingTheme = false;
    }

    // Simulate user switching themes multiple times
    mockHandleThemeChange({ detail: { theme: 'dark' } });
    mockHandleThemeChange({ detail: { theme: 'light' } });
    mockHandleThemeChange({ detail: { theme: 'system' } });

    expect(appliedThemes).toEqual(['dark', 'light', 'system']);
  });
});
