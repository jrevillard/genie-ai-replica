const { expect } = require('@playwright/test');

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
          const el = document.querySelector(s);
          if (!el) return null;
          const rect = el.getBoundingClientRect();
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

module.exports = { waitForWidthSettled };
