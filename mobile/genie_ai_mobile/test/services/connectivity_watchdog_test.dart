import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';

import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:genie_ai_mobile/services/connectivity_service.dart';

import '../helpers/connectivity_fakes.dart';

/// Fake provider whose checks after the first one never complete, so a poll
/// can be held in flight — while the service is disposed, or while another
/// check holds the concurrency guard.
class GatedProvider extends ConnectivityProvider {
  final Completer<List<ConnectivityResult>> gate =
      Completer<List<ConnectivityResult>>();
  int callCount = 0;

  @override
  Future<List<ConnectivityResult>> checkConnectivity() {
    callCount++;
    if (callCount == 1) return Future.value([ConnectivityResult.none]);
    return gate.future;
  }

  @override
  Stream<List<ConnectivityResult>> get onConnectivityChanged =>
      const Stream.empty();
}

/// Fake provider whose answer the test can flip mid-flight.
class SwitchableProvider extends ConnectivityProvider {
  SwitchableProvider(this.result);

  ConnectivityResult result;
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

/// Fake provider whose platform channel fails from the second check on.
class ThrowingProvider extends ConnectivityProvider {
  int callCount = 0;

  @override
  Future<List<ConnectivityResult>> checkConnectivity() async {
    callCount++;
    if (callCount == 1) return [ConnectivityResult.none];
    throw StateError('connectivity plugin failure');
  }

  @override
  Stream<List<ConnectivityResult>> get onConnectivityChanged =>
      const Stream.empty();
}

/// Starts the watchdog against a fake provider answering [result] forever,
/// and registers the teardowns every test needs.
Future<(ConnectivityService, FakeConnectivityProvider)> startWatchdog(
  WidgetTester tester,
  ConnectivityResult result,
) async {
  final provider = FakeConnectivityProvider(result);
  final service = ConnectivityService.test(
    provider: provider,
    dnsLookup: dnsFailure,
  );
  addTearDown(provider.controller.close);
  await service.init();
  return (service, provider);
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
      final (service, provider) = await startWatchdog(
        tester,
        ConnectivityResult.wifi,
      );
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
    final (service, provider) = await startWatchdog(
      tester,
      ConnectivityResult.none,
    );
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
    final (service, provider) = await startWatchdog(
      tester,
      ConnectivityResult.wifi,
    );
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
    final (service, provider) = await startWatchdog(
      tester,
      ConnectivityResult.none,
    );
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
        dnsLookup: dnsFailure,
      );

      await service.init();

      // The second poll never completes: it is held in flight.
      await tester.pump(const Duration(seconds: 5));
      await tester.pump();
      expect(provider.callCount, 2);

      service.dispose();
      // A different answer than the first sample: the late poll changes the
      // status and would hit the closed controller if the emit had no guard.
      provider.gate.complete([ConnectivityResult.wifi]);
      await tester.pump();
      await tester.pump(const Duration(seconds: 30));
      await tester.pump();

      // The poll that completed after the disposal must not arm a new timer.
      expect(service.monitorTimer, isNull);
    },
  );

  testWidgets('a connectivity event while backgrounded restarts nothing', (
    tester,
  ) async {
    final (service, provider) = await startWatchdog(
      tester,
      ConnectivityResult.wifi,
    );
    expect(provider.callCount, 1);

    service.didChangeAppLifecycleState(AppLifecycleState.paused);

    // The OS still delivers connectivity events in the background.
    provider.controller.add([ConnectivityResult.none]);
    await tester.pump();
    expect(service.isOnline, isFalse);

    await tester.pump(const Duration(seconds: 60));
    await tester.pump();
    expect(provider.callCount, 1);

    service.dispose();
  });

  testWidgets('a connectivity event after disposal reaches nothing', (
    tester,
  ) async {
    final (service, provider) = await startWatchdog(
      tester,
      ConnectivityResult.wifi,
    );

    service.dispose();
    // A status change after the disposal would hit the closed status
    // controller if the connectivity subscription were still live.
    provider.controller.add([ConnectivityResult.none]);
    await tester.pump();
    await tester.pump(const Duration(seconds: 30));
    await tester.pump();

    expect(service.monitorTimer, isNull);
  });

  testWidgets('a "none" event does not restore the fast cadence', (
    tester,
  ) async {
    final (service, provider) = await startWatchdog(
      tester,
      ConnectivityResult.none,
    );
    await tester.pump(const Duration(seconds: 5));
    await tester.pump();
    expect(provider.callCount, 2);

    // The OS reports the network going away while already unreachable: no
    // recovery happened, so the ladder keeps climbing instead of restarting.
    provider.controller.add([ConnectivityResult.none]);
    await tester.pump();

    await tester.pump(const Duration(seconds: 5));
    await tester.pump();
    expect(provider.callCount, 2);

    await tester.pump(const Duration(seconds: 10));
    await tester.pump();
    expect(provider.callCount, 3);

    service.dispose();
  });

  testWidgets('a watchdog tick the concurrency guard skipped climbs nothing', (
    tester,
  ) async {
    final provider = GatedProvider();
    final service = ConnectivityService.test(
      provider: provider,
      dnsLookup: dnsFailure,
    );

    await service.init();
    expect(service.isOnline, isFalse);

    // A check held in flight blocks the watchdog's own tick: the tick has no
    // fresh sample, so it must not climb the ladder on the previous one.
    unawaited(service.recheckConnectivity());
    await tester.pump();

    await tester.pump(const Duration(seconds: 5));
    await tester.pump();

    provider.gate.complete([ConnectivityResult.none]);
    await tester.pump();

    // The next tick runs on the fast rung: it polls 5s after the skipped one.
    await tester.pump(const Duration(seconds: 5));
    await tester.pump();
    expect(provider.callCount, 3);

    service.dispose();
  });

  testWidgets(
    'resume re-arms the watchdog on the cadence the fresh sample implies',
    (tester) async {
      final provider = SwitchableProvider(ConnectivityResult.none);
      final service = ConnectivityService.test(
        provider: provider,
        dnsLookup: dnsFailure,
      );
      addTearDown(provider.controller.close);

      await service.init();
      // Climb to the slowest rung.
      await tester.pump(const Duration(seconds: 5));
      await tester.pump();
      await tester.pump(const Duration(seconds: 15));
      await tester.pump();
      await tester.pump(const Duration(seconds: 30));
      await tester.pump();
      final int callsBeforePause = provider.callCount;

      service.didChangeAppLifecycleState(AppLifecycleState.paused);

      // The network comes back while the app is in the background.
      provider.result = ConnectivityResult.wifi;

      service.didChangeAppLifecycleState(AppLifecycleState.resumed);
      await tester.pump();
      await tester.pump(const Duration(seconds: 5));
      await tester.pump();

      // The resume recheck is one call; the next watchdog poll must follow
      // within 5s on the dropped-back rung, not on the stale 60s one.
      expect(provider.callCount, greaterThan(callsBeforePause + 1));

      service.dispose();
    },
  );

  testWidgets('repeated no-op events do not postpone the watchdog poll', (
    tester,
  ) async {
    final (service, provider) = await startWatchdog(
      tester,
      ConnectivityResult.none,
    );

    await tester.pump(const Duration(seconds: 5));
    await tester.pump();
    expect(provider.callCount, 2);

    // An event storm that carries no news (the device was already
    // unreachable) must not restart the countdown every time.
    for (var i = 0; i < 3; i++) {
      await tester.pump(const Duration(seconds: 4));
      provider.controller.add([ConnectivityResult.none]);
      await tester.pump();
    }
    await tester.pump(const Duration(seconds: 3));
    await tester.pump();
    expect(provider.callCount, greaterThanOrEqualTo(3));

    service.dispose();
  });

  testWidgets('a failed check carries no evidence: the ladder does not climb', (
    tester,
  ) async {
    final provider = ThrowingProvider();
    final service = ConnectivityService.test(
      provider: provider,
      dnsLookup: dnsFailure,
    );

    await service.init();
    await tester.pump(const Duration(seconds: 5));
    await tester.pump();
    await tester.pump(const Duration(seconds: 5));
    await tester.pump();

    // Every check fails, so the watchdog never gains evidence of an
    // unreachable device and stays on the fast rung.
    expect(provider.callCount, 3);

    service.dispose();
  });

  testWidgets('a status change after disposal does not throw', (tester) async {
    final provider = SwitchableProvider(ConnectivityResult.none);
    final service = ConnectivityService.test(
      provider: provider,
      dnsLookup: dnsFailure,
    );

    await service.init();
    service.dispose();

    // The override toggle is a UI entry point that can survive the service:
    // the emit onto the closed controller must be swallowed, not thrown.
    expect(() => service.setUserOfflineMode(true), returnsNormally);
  });
}
