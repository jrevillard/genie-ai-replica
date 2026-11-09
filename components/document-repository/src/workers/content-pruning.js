/**
 * workers/content-pruning.js
 * The crawler-side content pruning: drop link-heavy, text-light blocks (the
 * navigation chrome of a page) from the parsed DOM.
 *
 * A block that belongs to a SECTION is EXEMPT from the sweep: it carries a
 * heading, it follows a heading, or it follows a heading wrapper (the
 * `<div class="mw-heading"><h2>See also</h2></div>` shape a wiki emits).
 * Those blocks hold the page's cross-links ("See also", "Related", the
 * columns list) — pruning one drops the concepts' inter-link material.
 */

const HEADINGS = 'h1, h2, h3, h4, h5, h6';
// Block-level children disqualify a wrapper from being a heading wrapper.
const BLOCK_LEVEL = 'ul,ol,li,dl,table,div,p,section,nav,aside,blockquote,pre,figure,form';

/** A div that holds a heading and nothing but inline content around it — the
 * heading wrapper a wiki puts between a heading and its section body. */
function isHeadingWrapper($, el) {
  if (!$(el).find(HEADINGS).length) return false;
  return $(el).find(BLOCK_LEVEL).length === 0;
}

/** A block is heading-adjacent when it carries a heading itself, when the
 * element right before it is a heading, or when that element is a heading
 * wrapper. */
function isHeadingAdjacent($, el) {
  if ($(el).find(HEADINGS).length > 0) return true;
  const prev = $(el).prev();
  if (!prev.length) return false;
  const prevEl = prev.get(0);
  if (/^h[1-6]$/.test(prevEl.tagName)) return true;
  return isHeadingWrapper($, prevEl);
}

/**
 * Remove link-heavy, text-light blocks from the DOM.
 * @param {*} $ cheerio instance (mutated in place)
 */
function pruneLinkDenseBlocks($) {
  $('div').each((i, el) => {
    const linkCount = $(el).find('a').length;
    const textLength = $(el).text().trim().length;
    if (linkCount <= 5 || textLength / linkCount >= 15) return;
    if (isHeadingAdjacent($, el)) return;
    $(el).remove();
  });
}

module.exports = { pruneLinkDenseBlocks, isHeadingAdjacent, isHeadingWrapper, HEADINGS };
