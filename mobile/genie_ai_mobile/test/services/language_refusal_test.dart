import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/services/language_refusal.dart';

void main() {
  group('languageRefusalCode', () {
    test('reads the code the backend refused the request with', () {
      // The backend refuses a language the deployment cannot answer in with
      // a body that names the refused side. The client shows its own text,
      // so it reads the code and nothing else.
      expect(
        languageRefusalCode(
          '{"error": "UNSUPPORTED_LANGUAGE", "message": "Unsupported target language"}',
        ),
        unsupportedLanguageCode,
      );
    });

    test('reads the code of any other refusal', () {
      expect(
        languageRefusalCode('{"error": "MISSING_PARAMETERS"}'),
        'MISSING_PARAMETERS',
      );
    });

    test('reports no code for a body that carries none', () {
      // A failure the backend does not name is the generic one: the client
      // has nothing to explain beyond "the request failed".
      expect(languageRefusalCode(null), isNull);
      expect(languageRefusalCode(''), isNull);
      expect(languageRefusalCode('not json'), isNull);
      expect(languageRefusalCode('[]'), isNull);
      expect(languageRefusalCode('{"message": "no code here"}'), isNull);
    });
  });

  group('LanguageRefusal', () {
    test('carries the code it was refused with', () {
      const LanguageRefusal refusal = LanguageRefusal(unsupportedLanguageCode);
      expect(refusal.code, unsupportedLanguageCode);
      expect(refusal.toString(), contains(unsupportedLanguageCode));
    });
  });
}
