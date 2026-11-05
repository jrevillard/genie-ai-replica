import 'dart:async';
import 'dart:io';

import 'package:connectivity_plus/connectivity_plus.dart';

import 'package:genie_ai_mobile/services/connectivity_service.dart';

/// Fake provider returning a configurable result, with the connectivity
/// stream the service listens to under the test's control.
class FakeConnectivityProvider extends ConnectivityProvider {
  FakeConnectivityProvider(this.result);

  final ConnectivityResult result;
  final StreamController<List<ConnectivityResult>> controller =
      StreamController<List<ConnectivityResult>>.broadcast();
  int callCount = 0;

  @override
  Future<List<ConnectivityResult>> checkConnectivity() async {
    callCount++;
    return [result];
  }

  @override
  Stream<List<ConnectivityResult>> get onConnectivityChanged =>
      controller.stream;
}

Future<List<InternetAddress>> dnsSuccess(String host) async => [
  InternetAddress('8.8.8.8'),
];

Future<List<InternetAddress>> dnsFailure(String host) async =>
    throw const SocketException('DNS failed');

Future<List<InternetAddress>> dnsTimeout(String host) async =>
    Future.delayed(const Duration(seconds: 10), () => <InternetAddress>[]);
