import 'dart:io';

import 'package:http/http.dart' as http;
import 'package:http/io_client.dart';

class InsecureHttpClient extends http.BaseClient {
  final http.Client _inner;

  InsecureHttpClient() : _inner = _createInner();

  static http.Client _createInner() {
    final securityContext = SecurityContext(withTrustedRoots: false);
    final httpClient = HttpClient(context: securityContext);
    httpClient.badCertificateCallback = (cert, host, port) => true;
    return IOClient(httpClient);
  }

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) =>
      _inner.send(request);

  @override
  void close() => _inner.close();
}
