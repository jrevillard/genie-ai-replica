import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/services/translation_status.dart';

void main() {
  group('isTranslationFailed', () {
    test('reports a failure when the answer could not be translated', () {
      // The answer the caller reads is the English one: the client has to say
      // so instead of showing English as if it were the requested language.
      expect(isTranslationFailed({'translation_status': 'failed'}), isTrue);
      expect(isTranslationFailed({'translation_status': 'refused'}), isTrue);
    });

    test('reports no failure when the answer was translated', () {
      expect(isTranslationFailed({'translation_status': 'ok'}), isFalse);
    });

    test('reports no failure when no translation was asked for', () {
      // No status at all: the answer was written in the language the caller
      // reads, and there is nothing to report.
      expect(isTranslationFailed(null), isFalse);
      expect(isTranslationFailed(<String, dynamic>{}), isFalse);
    });
  });
}
