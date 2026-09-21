import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/utils/chat_response_emojis.dart';

/// Same cases as the web `chatResponseEmojis.test.js`: both clients must
/// render an identical decorated reply.
void main() {
  group('decorateChatResponse', () {
    test('decorates each supported crop once', () {
      expect(
        decorateChatResponse('Eggplant, mango and Rice Aman are supported.'),
        '🍆 Eggplant, 🥭 mango and 🌾 Rice Aman are supported.',
      );
    });

    test('decorates each weather topic once', () {
      expect(
        decorateChatResponse(
          '- Rain and wind are expected.\n- Cloudy conditions continue.',
        ),
        '- 🌧️ Rain and 💨 wind are expected.\n- ☁️ Cloudy conditions continue.',
      );
    });

    test('does not duplicate existing emojis', () {
      expect(
        decorateChatResponse('🌧️ Rain is expected.'),
        '🌧️ Rain is expected.',
      );
    });

    test('moves misplaced emojis and decorates every topic in a paragraph', () {
      const response =
          'The next week will bring heavy rainfall. Temperatures will range from 25.2°C to 32.9°C. '
          'Humidity will be high. Wind speeds will be moderate. These conditions are not ideal for planting eggplant. 🍆,';
      expect(
        decorateChatResponse(response),
        'The next week will bring heavy 🌧️ rainfall. 🌡️ Temperatures will range from 25.2°C to 32.9°C. '
        '💧 Humidity will be high. 💨 Wind speeds will be moderate. These conditions are not ideal for planting 🍆 eggplant.',
      );
    });

    test('never decorates a markdown link destination', () {
      const response =
          'সাপাহার অঞ্চলের খরা পরিস্থিতি স্থিতিশীল।\n\n'
          '[পুরো খরা প্রতিবেদন দেখুন](/api/weather/drought-report/drought_sapahar_20260921.pdf)';
      expect(decorateChatResponse(response), response);
    });

    test('still decorates the prose around a link, leaving the URL alone', () {
      expect(
        decorateChatResponse(
          'Drought is easing. [View full drought report](/api/weather/drought-report/x.pdf)',
        ),
        '🏜️ Drought is easing. [View full drought report](/api/weather/drought-report/x.pdf)',
      );
    });

    test('leaves blank input untouched', () {
      expect(decorateChatResponse(''), '');
      expect(decorateChatResponse('   '), '   ');
      expect(decorateChatResponse(null), '');
    });
  });
}
