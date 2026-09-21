const { decorateChatResponse } = require('../../../services/translation/chat-response-emojis');

describe('decorateChatResponse (backend twin)', () => {
  test('decorates weather topics once each, like the client', () => {
    expect(decorateChatResponse('Heavy rain. Temperatures high, humidity high, wind moderate.')).toBe(
      'Heavy 🌧️ rain. 🌡️ Temperatures high, 💧 humidity high, 💨 wind moderate.'
    );
  });

  test('does not duplicate an emoji that is already there', () => {
    expect(decorateChatResponse('🌧️ Rain is expected.')).toBe('🌧️ Rain is expected.');
  });

  test('never touches a markdown link destination', () => {
    const s = 'Drought is easing. [View full drought report](/api/weather/drought-report/x.pdf)';
    expect(decorateChatResponse(s)).toBe(
      '🏜️ Drought is easing. [View full drought report](/api/weather/drought-report/x.pdf)'
    );
  });

  test('passes through non-strings and blanks', () => {
    expect(decorateChatResponse('')).toBe('');
    expect(decorateChatResponse(null)).toBe(null);
  });
});
