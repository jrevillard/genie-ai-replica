// The crawl's link-dense/text-light block pruning (issue #989): the sweep drops
// a page's navigation chrome, but must NOT drop a section's link list — the
// "See also" / "Related" clusters that carry the page's cross-links.
//
// The sweep is the ONLY thing between a crawled page and its concept graph:
// a pruned block takes its links with it, so an over-eager sweep silently
// strips the inter-concept links (the 7.4%-density symptom of #989).

const cheerio = require('cheerio');
const { pruneLinkDenseBlocks } = require('../../../workers/content-pruning');

/** A link-dense, text-light block — the shape the sweep targets. */
const linkList = (links, cls = 'navbox') =>
  `<div class="${cls}"><ul>${links.map((l) => `<li><a href="${l}">${l}</a></li>`).join('')}</ul></div>`;

const LINKS = ['/wiki/Alpha', '/wiki/Beta', '/wiki/Gamma', '/wiki/Delta', '/wiki/Epsilon', '/wiki/Zeta', '/wiki/Eta'];

describe('pruneLinkDenseBlocks (issue #989)', () => {
  test('removes a link-dense, text-light block (navigation chrome)', () => {
    const $ = cheerio.load(`<body><div id="content">${linkList(LINKS)}</div></body>`);
    pruneLinkDenseBlocks($);
    expect($('#content').text()).not.toContain('Alpha');
    expect($('a').length).toBe(0);
  });

  test('keeps a link-dense block that CARRIES a heading (a section link list)', () => {
    const $ = cheerio.load(
      `<body><div id="content"><div class="section"><h2>See also</h2>${linkList(LINKS, 'seealso')}</div></div></body>`
    );
    pruneLinkDenseBlocks($);
    expect($('a').length).toBe(LINKS.length);
    expect($('#content').text()).toContain('Alpha');
  });

  test('keeps a link-dense block that FOLLOWS a heading (heading then the list)', () => {
    const $ = cheerio.load(`<body><div id="content"><h2>Related</h2>${linkList(LINKS, 'related')}</div></body>`);
    pruneLinkDenseBlocks($);
    expect($('a').length).toBe(LINKS.length);
  });

  test('keeps a link-dense block that follows a heading WRAPPER (div holding the heading)', () => {
    // MediaWiki shape: <div class="mw-heading"><h2>See also</h2></div> then the list.
    const $ = cheerio.load(
      `<body><div id="content"><div class="mw-heading"><h2>See also</h2></div>${linkList(
        LINKS,
        'mw-seealso'
      )}</div></body>`
    );
    pruneLinkDenseBlocks($);
    expect($('a').length).toBe(LINKS.length);
  });

  test('leaves a text-rich block alone even when it is link-dense', () => {
    const long = 'This paragraph carries enough prose that the block is not text-light at all. '.repeat(4);
    const list = `<ul>${LINKS.map((l) => `<li><a href="${l}">${l}</a></li>`).join('')}</ul>`;
    const $ = cheerio.load(`<body><div id="content"><div class="prose">${long}${list}</div></div></body>`);
    pruneLinkDenseBlocks($);
    expect($('a').length).toBe(LINKS.length);
  });

  test('leaves a small link list alone (below the link-count threshold)', () => {
    const few = ['/wiki/Alpha', '/wiki/Beta'];
    const $ = cheerio.load(`<body><div id="content">${linkList(few, 'small')}</div></body>`);
    pruneLinkDenseBlocks($);
    expect($('a').length).toBe(few.length);
  });
});
