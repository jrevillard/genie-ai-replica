import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/utils/config_resolver.dart';

/// The shared config reader: the container guard, the guarded descent
/// and the JS-truthiness every config gate reads. Its own file - the
/// resolver serves the welcome message and the Quick Help buttons, not
/// one component.
void main() {
  /// The ONE guarded descent to a config section: every key on the path
  /// is container-checked, a non-map anywhere degrades to the empty map.
  group('configSectionOf', () {
    test('descends the path to the named section', () {
      final config = {
        'features': {
          'chat': {
            'welcomeMessage': {'en': 'Hello'},
          },
        },
      };

      expect(configSectionOf(config, ['features', 'chat']), {
        'welcomeMessage': {'en': 'Hello'},
      });
    });

    test('a non-map node anywhere on the path degrades to the empty map', () {
      expect(
        configSectionOf({'features': 'oops'}, ['features', 'chat']),
        isEmpty,
      );
      expect(configSectionOf({}, ['features', 'chat']), isEmpty);
    });
  });

  /// The scalar half of the web's `value || ''`: a numeric or boolean
  /// SCALAR that JS reads as falsy resolves to no text — a numeric typo
  /// in a title degrades the same way on both platforms.
  group('resolveConfigText scalars', () {
    test('a plain string is itself', () {
      expect(resolveConfigText('Ask about IDs', 'en'), 'Ask about IDs');
    });

    test('a list stringifies the way JavaScript does', () {
      expect(resolveConfigText(['Apply for ID'], 'en'), 'Apply for ID');
      expect(resolveConfigText(['a', 'b'], 'en'), 'a,b');
    });

    test('0 and false resolve to no text; a truthy number keeps its form', () {
      expect(resolveConfigText(0, 'en'), '');
      expect(resolveConfigText(false, 'en'), '');
      expect(resolveConfigText(42, 'en'), '42');
    });
  });

  /// The ONE JS-truthiness read a config gate does — the shared falsy
  /// set (null, false, 0, '') every config gate on both platforms
  /// agrees on, so a numeric-typed typo degrades the same way on each.
  group('configTruthy', () {
    test('a string, a map or a list reads as true', () {
      expect(configTruthy('Hello'), isTrue);
      expect(configTruthy({'en': 'Hello'}), isTrue);
      expect(configTruthy([]), isTrue);
    });

    test('null, false, 0 and the empty string read as false', () {
      expect(configTruthy(null), isFalse);
      expect(configTruthy(false), isFalse);
      expect(configTruthy(0), isFalse);
      expect(configTruthy(0.0), isFalse);
      expect(configTruthy(''), isFalse);
    });
  });

  /// The ONE container guard, and the map branch the card label's
  /// resolution depends on.
  group('configMapOf', () {
    test('a map is handed back as-is', () {
      final map = {'en': 'Hello'};

      expect(configMapOf(map), same(map));
    });

    test('anything else degrades to the empty map', () {
      expect(configMapOf(null), isEmpty);
      expect(configMapOf('nope'), isEmpty);
      expect(configMapOf(['a']), isEmpty);
      expect(configMapOf(7), isEmpty);
    });
  });

  group('resolveConfigText locale maps', () {
    test('the active locale wins', () {
      expect(
        resolveConfigText({'en': 'Hello', 'fr': 'Bonjour'}, 'fr'),
        'Bonjour',
      );
    });

    test('an absent locale falls back to English', () {
      expect(resolveConfigText({'en': 'Hello'}, 'fr'), 'Hello');
    });

    test('neither present falls back to the first value', () {
      expect(resolveConfigText({'es': 'Hola'}, 'fr'), 'Hola');
    });

    test('an empty map resolves to no text', () {
      expect(resolveConfigText({}, 'en'), '');
    });
  });
}
