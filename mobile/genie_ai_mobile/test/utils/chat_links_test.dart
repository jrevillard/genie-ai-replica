import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/utils/chat_links.dart';

void main() {
  const backend = 'https://mewa.example.org:443';

  group('resolveChatLink', () {
    test('resolves site-relative paths against the backend origin', () {
      expect(
        resolveChatLink(
          '/api/weather/drought-report/drought_sapahar_20260919.pdf',
          backend,
        ).toString(),
        'https://mewa.example.org/api/weather/drought-report/drought_sapahar_20260919.pdf',
      );
    });

    test('ignores a base path on the backend URL', () {
      expect(
        resolveChatLink('/api/x', 'https://host/api').toString(),
        'https://host/api/x',
      );
    });

    test('leaves absolute URLs untouched', () {
      expect(
        resolveChatLink('https://bamis.gov.bd/bulletin', backend).toString(),
        'https://bamis.gov.bd/bulletin',
      );
      expect(
        resolveChatLink('mailto:help@example.org', backend).toString(),
        'mailto:help@example.org',
      );
    });

    test('returns null for blank input or a base without scheme', () {
      expect(resolveChatLink(null, backend), isNull);
      expect(resolveChatLink('   ', backend), isNull);
      expect(resolveChatLink('/api/x', 'localhost'), isNull);
    });
  });

  group('droughtReportFilename', () {
    test('recognises the report path and extracts the file name', () {
      final uri = resolveChatLink(
        '/api/weather/drought-report/drought_sapahar_20260919.pdf',
        backend,
      )!;
      expect(droughtReportFilename(uri), 'drought_sapahar_20260919.pdf');
    });

    test('is null for other links', () {
      expect(
        droughtReportFilename(Uri.parse('https://host/api/weather/geocode')),
        isNull,
      );
      expect(
        droughtReportFilename(
          Uri.parse('https://host/api/weather/drought-report/x/y.pdf'),
        ),
        isNull,
      );
    });
  });
}
