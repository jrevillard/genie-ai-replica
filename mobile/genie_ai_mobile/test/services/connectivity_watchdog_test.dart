import 'dart:async';
import 'dart:io';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/services/connectivity_service.dart';

/// Fake provider returning a fixed result, with the connectivity stream the
/// service listens to under the test's control.
class WatchdogProvider extends ConnectivityProvider {
  WatchdogProvider(this.result);

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

Future<List<InternetAddress>> _dnsFailure(String host) async =>
    throw const SocketException('DNS failed');

/// Fake provider whose checks after the first one never complete, so a poll
/// can be held in flight while the service is disposed.
class GatedProvider extends ConnectivityProvider {
  final Completer<List<ConnectivityResult>> gate =
      Completer<List<ConnectivityResult>>();
  int callCount = 0;

  @override
  Future<List<ConnectivityResult>> checkConnectivity() {
    callCount++;
    if (callCount == 1) return Future.value([ConnectivityResult.wifi]);
    return gate.future;
  }

  @override
  Stream<List<ConnectivityResult>> get onConnectivityChanged =>
      const Stream.empty();
}

/// The watchdog is the reliability backup of the connectivity stream: it
/// polls the device so a missed event cannot leave the app stuck. These
/// tests pin the two properties that keep it cheap: it slows down while the
/// device stays unreachable, and it stops while the app is in the background.
void main() {
  tearDown(() {
    ConnectivityService.resetForTesting();
  });

  testWidgets(
    'the watchdog polls every 5 seconds while the device is reachable',
    (tester) async {
      final provider = WatchdogProvider(ConnectivityResult.wifi);
      final service = ConnectivityService.test(
        provider: provider,
        dnsLookup: _dnsFailure,
      );
      addTearDown(provider.controller.close);

      await service.init();
      expect(provider.callCount, 1);

      await tester.pump(const Duration(seconds: 5));
      await tester.pump();
      expect(provider.callCount, 2);

      await tester.pump(const Duration(seconds: 5));
      await tester.pump();
      expect(provider.callCount, 3);

      service.dispose();
    },
  );

  testWidgets('the watchdog slows down while the device stays unreachable', (
    tester,
  ) async {
    final provider = WatchdogProvider(ConnectivityResult.none);
    final service = ConnectivityService.test(
      provider: provider,
      dnsLookup: _dnsFailure,
    );
    addTearDown(provider.controller.close);

    await service.init();
    expect(provider.callCount, 1);
    expect(service.isOnline, isFalse);

    await tester.pump(const Duration(seconds: 5));
    await tester.pump();
    expect(provider.callCount, 2);

    // The next poll waits 15s, not 5s.
    await tester.pump(const Duration(seconds: 5));
    await tester.pump();
    expect(provider.callCount, 2);

    await tester.pump(const Duration(seconds: 10));
    await tester.pump();
    expect(provider.callCount, 3);

    // Then 30s, then 60s, and it stays there.
    await tester.pump(const Duration(seconds: 30));
    await tester.pump();
    expect(provider.callCount, 4);

    await tester.pump(const Duration(seconds: 60));
    await tester.pump();
    expect(provider.callCount, 5);

    await tester.pump(const Duration(seconds: 60));
    await tester.pump();
    expect(provider.callCount, 6);

    service.dispose();
  });

  testWidgets('the watchdog stops while the app is in the background', (
    tester,
  ) async {
    final provider = WatchdogProvider(ConnectivityResult.wifi);
    final service = ConnectivityService.test(
      provider: provider,
      dnsLookup: _dnsFailure,
    );
    addTearDown(provider.controller.close);

    await service.init();
    expect(provider.callCount, 1);

    service.didChangeAppLifecycleState(AppLifecycleState.paused);
    expect(service.monitorTimer, isNull);

    await tester.pump(const Duration(seconds: 60));
    await tester.pump();
    expect(provider.callCount, 1);

    service.didChangeAppLifecycleState(AppLifecycleState.resumed);
    await tester.pump();
    expect(provider.callCount, 2);
    expect(service.monitorTimer, isNotNull);

    service.dispose();
  });

  testWidgets('a connectivity event restores the fast watchdog cadence', (
    tester,
  ) async {
    final provider = WatchdogProvider(ConnectivityResult.none);
    final service = ConnectivityService.test(
      provider: provider,
      dnsLookup: _dnsFailure,
    );
    addTearDown(provider.controller.close);

    await service.init();
    await tester.pump(const Duration(seconds: 5));
    await tester.pump();
    expect(provider.callCount, 2);

    provider.controller.add([ConnectivityResult.wifi]);
    await tester.pump();
    expect(service.isOnline, isTrue);

    // The next poll comes 5s after the event, not 15s.
    await tester.pump(const Duration(seconds: 5));
    await tester.pump();
    expect(provider.callCount, 3);

    service.dispose();
  });

  testWidgets(
    'a poll in flight when the service is disposed schedules nothing',
    (tester) async {
      final provider = GatedProvider();
      final service = ConnectivityService.test(
        provider: provider,
        dnsLookup: _dnsFailure,
      );

      await service.init();

      // The second poll never completes: it is held in flight.
      await tester.pump(const Duration(seconds: 5));
      await tester.pump();
      expect(provider.callCount, 2);

      service.dispose();
      provider.gate.complete([ConnectivityResult.wifi]);
      await tester.pump();
      await tester.pump(const Duration(seconds: 30));
      await tester.pump();

      // The poll that completed after the disposal must not arm a new timer.
      expect(service.monitorTimer, isNull);
    },
  );
}
