'use strict';

const { decorateChatResponse } = require('../../utils/chatResponseEmojis');

describe('decorateChatResponse', () => {
  it('decorates each supported crop once', () => {
    expect(decorateChatResponse('Eggplant, mango and Rice Aman are supported.')).toBe(
      '🍆 Eggplant, 🥭 mango and 🌾 Rice Aman are supported.'
    );
  });

  it('decorates each weather topic once', () => {
    expect(decorateChatResponse('- Rain and wind are expected.\n- Cloudy conditions continue.')).toBe(
      '- 🌧️ Rain and 💨 wind are expected.\n- ☁️ Cloudy conditions continue.'
    );
  });

  it('does not duplicate existing emojis', () => {
    expect(decorateChatResponse('🌧️ Rain is expected.')).toBe('🌧️ Rain is expected.');
  });

  it('moves misplaced emojis and decorates every topic in a single paragraph', () => {
    const response =
      'The next week will bring heavy rainfall. Temperatures will range from 25.2°C to 32.9°C. ' +
      'Humidity will be high. Wind speeds will be moderate. These conditions are not ideal for planting eggplant. 🍆,';

    expect(decorateChatResponse(response)).toBe(
      'The next week will bring heavy 🌧️ rainfall. 🌡️ Temperatures will range from 25.2°C to 32.9°C. ' +
        '💧 Humidity will be high. 💨 Wind speeds will be moderate. These conditions are not ideal for planting 🍆 eggplant.'
    );
  });
});
