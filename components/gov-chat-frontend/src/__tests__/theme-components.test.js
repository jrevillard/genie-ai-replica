// The global theme layer must not paint the bot bubble.
//
// The bot answer renders inside the elevated answer card, and the card is
// that bubble's surface: the component flattens the bubble inside the
// card (transparent, no chrome) so the answer reads as one panel. A
// global rule that paints the bubble stacks a second surface inside the
// card, and the inner one reads as a second colour in the middle of the
// answer.
//
// The stacking is invisible in a unit test — it is a cascade outcome —
// so the guard is static: the global layer must carry no rule that
// targets the bot bubble and gives it a background. A rule that merely
// outranks the scoped one (a `:root body` prefix) is what brought the
// stacking back, and the guard is what keeps it out.

const fs = require('fs');
const path = require('path');

const CSS_PATH = path.join(__dirname, '..', 'theme-components.css');

const cssWithoutComments = fs.readFileSync(CSS_PATH, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

describe('global theme layer', () => {
  it('does not paint the bot bubble — the answer card owns that surface', () => {
    const offenders = cssWithoutComments
      .split('}')
      .map((rule) => rule.trim())
      .filter((rule) => rule.includes('.chat-message.bot') && rule.includes('.message-bubble'))
      .filter((rule) => /background(-color)?\s*:/.test(rule));

    expect(offenders).toEqual([]);
  });
});
