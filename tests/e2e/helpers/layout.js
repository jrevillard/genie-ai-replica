const { expect } = require('@playwright/test');

// The layout handles the sidebar and grid specs share: the two panels,
// their edge handles (strip + chevron button), and the welcome grid with
// its tiles. A handle rename lands here once; the specs that import
// these never re-type the attribute selector.
const SIDEBAR_LEFT = '[data-testid="side-bar"]';
const SIDEBAR_RIGHT = '[data-testid="sidebar"]';
const SIDEBAR_HANDLE_LEFT = '[data-testid="sidebar-handle-left"]';
const SIDEBAR_HANDLE_RIGHT = '[data-testid="sidebar-handle-right"]';
const SIDEBAR_HANDLE_BUTTON_LEFT = '[data-testid="sidebar-handle-button-left"]';
const SIDEBAR_HANDLE_BUTTON_RIGHT = '[data-testid="sidebar-handle-button-right"]';
const QUICK_HELP_GRID = '[data-testid="quick-help-grid"]';
const QUICK_HELP_ITEM = '[data-testid="quick-help-item"]';
const QUICK_HELP_GRID_ITEM = `${QUICK_HELP_GRID} ${QUICK_HELP_ITEM}`;

// Sidebar (panel) widths animate over a 0.3 s transition and the layout
// reflows around them. A geometry read must see the transition's end,
// not a mid-flight frame, so a wait on the sidebars polls until every
// selector's measured width holds steady across two consecutive samples
// — bounded by a hard timeout, never by a fixed duration. Pass a single
// selector or an array of them; panels animating in the same window
// settle in the same wait.
async function waitForWidthSettled(page, selectors, timeout = 15000) {
  const sels = Array.isArray(selectors) ? selectors : [selectors];
  let prev = [];
  await expect
    .poll(async () => {
      const widths = await page.evaluate((list) =>
        list.map((s) => {
          const matches = document.querySelectorAll(s);
          // A width read must name ONE element: a missing panel and an
          // ambiguous selector are both defects, not a width to wait on.
          if (matches.length !== 1) {
            throw new Error(
              `waitForWidthSettled: "${s}" matches ${matches.length} elements — the panel to measure is not identified`
            );
          }
          const rect = matches[0].getBoundingClientRect();
          return Math.round(rect.width);
        }), sels
      );
      const settled =
        widths.length > 0 && widths.every((w, i) => w !== null && prev[i] === w);
      prev = widths;
      return settled;
    }, { timeout })
    .toBe(true);
}

module.exports = {
  waitForWidthSettled,
  SIDEBAR_LEFT,
  SIDEBAR_RIGHT,
  SIDEBAR_HANDLE_LEFT,
  SIDEBAR_HANDLE_RIGHT,
  SIDEBAR_HANDLE_BUTTON_LEFT,
  SIDEBAR_HANDLE_BUTTON_RIGHT,
  QUICK_HELP_GRID,
  QUICK_HELP_ITEM,
  QUICK_HELP_GRID_ITEM
};
