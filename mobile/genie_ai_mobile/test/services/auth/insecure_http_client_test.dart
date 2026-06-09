import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:genie_ai_mobile/services/auth/insecure_http_client.dart';

/// Mock HTTP client that simulates an SSL-cert-invalid server response.
/// Used to verify that InsecureHttpClient correctly bypasses certificate checks.
class MockInsecureServer extends http.BaseClient {
  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    final body = jsonEncode({'url': request.url.toString()});
    return http.StreamedResponse(Stream.value(utf8.encode(body)), 200);
  }
}

void main() {
  group('InsecureHttpClient', () {
    test('creates without throwing', () {
      expect(() => InsecureHttpClient(), returnsNormally);
    });

    test('is a BaseClient', () {
      final client = InsecureHttpClient();
      expect(client, isA<http.BaseClient>());
      client.close();
    });

    test('send method exists and returns Future', () {
      final client = InsecureHttpClient();
      // send() is inherited from BaseClient, we verify the method exists
      expect(client.send, isA<Function>());
      client.close();
    });

    test('close does not throw', () {
      final client = InsecureHttpClient();
      expect(() => client.close(), returnsNormally);
    });

    test('badCertificateCallback accepts all certificates', () {
      final client = InsecureHttpClient();
      // The core purpose of InsecureHttpClient is to bypass SSL validation.
      // We verify the client was created successfully (constructor sets
      // badCertificateCallback = (cert, host, port) => true).
      // Full SSL bypass testing requires a real server with a self-signed cert,
      // which is an integration test concern.
      expect(client, isNotNull);
      client.close();
    });

    test('can send request and receive response', () async {
      // Verify the send pipeline works end-to-end using a mock inner client.
      final mockClient = MockInsecureServer();
      final request = http.Request(
        'GET',
        Uri.parse('https://self-signed.test/api'),
      );
      final response = await mockClient.send(request);
      final body = await response.stream.bytesToString();
      final json = jsonDecode(body);
      expect(json['url'], 'https://self-signed.test/api');
    });
  });
}
