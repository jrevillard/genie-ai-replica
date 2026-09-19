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

    test('leaves blank input untouched', () {
      expect(decorateChatResponse(''), '');
      expect(decorateChatResponse('   '), '   ');
      expect(decorateChatResponse(null), '');
    });
  });
}
