import 'dart:async';
import 'dart:io';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/services/connectivity_service.dart';

/// Fake provider returning a configurable result.
class FakeAsyncProvider extends ConnectivityProvider {
  final ConnectivityResult result;
  int callCount = 0;

  FakeAsyncProvider(this.result);

  @override
  Future<List<ConnectivityResult>> checkConnectivity() async {
    callCount++;
    return [result];
  }
}

/// Fake provider that never completes (for testing concurrency guard).
class HangingProvider extends ConnectivityProvider {
  final Completer<List<ConnectivityResult>> completer = Completer();

  @override
  Future<List<ConnectivityResult>> checkConnectivity() => completer.future;
}

Future<List<InternetAddress>> _fakeDnsSuccess(String host) async =>
    [InternetAddress('8.8.8.8')];

Future<List<InternetAddress>> _fakeDnsFailure(String host) async =>
    throw const SocketException('DNS failed');

Future<List<InternetAddress>> _fakeDnsTimeout(String host) async =>
    Future.delayed(const Duration(seconds: 10), () => <InternetAddress>[]);

void main() {
  late ConnectivityService service;

  setUp(() {
    ConnectivityService.resetForTesting();
    service = ConnectivityService();
    // Reset user override to default state without calling init (which needs platform plugin)
    service.setUserOfflineMode(false);
  });

  tearDown(() {
    service.dispose();
    ConnectivityService.resetForTesting();
  });

  group('ConnectivityService', () {
    group('initial state', () {
      test('isOnline defaults to true (hardware available, no override)', () {
        expect(service.isOnline, isTrue);
      });

      test('isUserOfflineOverride defaults to false', () {
        expect(service.isUserOfflineOverride, isFalse);
      });

      test('isOnlineStream is a broadcast stream', () {
        // Can subscribe multiple listeners without error
        final sub1 = service.isOnlineStream.listen((_) {});
        final sub2 = service.isOnlineStream.listen((_) {});
        sub1.cancel();
        sub2.cancel();
      });
    });

    group('isOnline getter', () {
      test('returns true when hardware available and no override', () {
        // Default state: _isNetworkHardwareAvailable=true, _userOfflineOverride=false
        expect(service.isOnline, isTrue);
      });

      test('returns false when user offline override is active', () {
        service.setUserOfflineMode(true);
        expect(service.isOnline, isFalse);
      });
    });

    group('setUserOfflineMode', () {
      test('sets override to true', () {
        service.setUserOfflineMode(true);
        expect(service.isUserOfflineOverride, isTrue);
        expect(service.isOnline, isFalse);
      });

      test('sets override to false', () {
        service.setUserOfflineMode(true);
        service.setUserOfflineMode(false);
        expect(service.isUserOfflineOverride, isFalse);
        expect(service.isOnline, isTrue);
      });

      test('does not emit when setting same value', () async {
        final events = <bool>[];
        final sub = service.isOnlineStream.listen(events.add);

        // Set false when already false (default)
        service.setUserOfflineMode(false);
        await Future<void>.delayed(Duration.zero);

        expect(events, isEmpty);
        await sub.cancel();
      });

      test('emits status change when override toggled on', () async {
        final completer = Completer<bool>();
        final sub = service.isOnlineStream.listen(completer.complete);

        service.setUserOfflineMode(true);

        final emitted = await completer.future;
        expect(emitted, isFalse);
        await sub.cancel();
      });

      test('emits status change when override toggled off', () async {
        service.setUserOfflineMode(true);

        final completer = Completer<bool>();
        final sub = service.isOnlineStream.listen(completer.complete);

        service.setUserOfflineMode(false);

        final emitted = await completer.future;
        expect(emitted, isTrue);
        await sub.cancel();
      });
    });

    group('toggleUserOfflineMode', () {
      test('toggles from false to true', () async {
        final result = await service.toggleUserOfflineMode();
        expect(result, isTrue);
        expect(service.isUserOfflineOverride, isTrue);
      });

      test('toggles from true to false', () async {
        await service.toggleUserOfflineMode();
        final result = await service.toggleUserOfflineMode();
        expect(result, isFalse);
        expect(service.isUserOfflineOverride, isFalse);
      });

      test('emits status on toggle', () async {
        final events = <bool>[];
        final sub = service.isOnlineStream.listen(events.add);

        await service.toggleUserOfflineMode();
        await Future<void>.delayed(Duration.zero);

        expect(events, isNotEmpty);
        expect(events.last, isFalse);
        await sub.cancel();
      });
    });

    group('stream behavior', () {
      test('multiple listeners receive same events', () async {
        final events1 = <bool>[];
        final events2 = <bool>[];
        final sub1 = service.isOnlineStream.listen(events1.add);
        final sub2 = service.isOnlineStream.listen(events2.add);

        service.setUserOfflineMode(true);
        await Future<void>.delayed(Duration.zero);

        expect(events1, equals(events2));
        await sub1.cancel();
        await sub2.cancel();
      });

      test(
        'new listener receives subsequent events after subscription',
        () async {
          // First toggle happens before subscription
          service.setUserOfflineMode(true);

          final events = <bool>[];
          final sub = service.isOnlineStream.listen(events.add);

          // Second toggle after subscription
          service.setUserOfflineMode(false);
          await Future<void>.delayed(Duration.zero);

          // Should only receive events after subscription
          expect(events, [true]);
          await sub.cancel();
        },
      );

      test('stream can be listened to and cancelled repeatedly', () async {
        for (int i = 0; i < 3; i++) {
          final events = <bool>[];
          final sub = service.isOnlineStream.listen(events.add);
          service.setUserOfflineMode(i.isEven);
          await Future<void>.delayed(Duration.zero);
          await sub.cancel();
          expect(events, isNotEmpty);
        }
      });
    });

    group('listener registration/unregistration', () {
      test('cancelled listener does not receive further events', () async {
        final events = <bool>[];
        final sub = service.isOnlineStream.listen(events.add);

        service.setUserOfflineMode(true);
        await Future<void>.delayed(Duration.zero);
        await sub.cancel();

        service.setUserOfflineMode(false);
        await Future<void>.delayed(Duration.zero);

        // Only the first event should be recorded
        expect(events.length, 1);
        expect(events.first, isFalse);
      });
    });

    group('concurrent recheck', () {
      test('overlapping calls are blocked by _isChecking guard', () async {
        final fakeProvider = FakeAsyncProvider(ConnectivityResult.none);
        final service = ConnectivityService.test(
          provider: fakeProvider,
          dnsLookup: _fakeDnsFailure,
        );
        service.setUserOfflineMode(false);

        // Start first call (will be suspended on provider)
        final future1 = service.recheckConnectivity();
        // Start second call while first is in-flight
        service.recheckConnectivity();

        // Complete the first call
        await future1;

        // Provider was only called once (second call hit the guard)
        expect(fakeProvider.callCount, 1);
        service.dispose();
      });

      test('guard resets after completion', () async {
        final fakeProvider = FakeAsyncProvider(ConnectivityResult.wifi);
        final service = ConnectivityService.test(
          provider: fakeProvider,
        );
        service.setUserOfflineMode(false);

        await service.recheckConnectivity();
        await service.recheckConnectivity();

        // Both calls succeeded (guard was reset between them)
        expect(fakeProvider.callCount, 2);
        service.dispose();
      });
    });

    group('DNS fallback', () {
      test('treats as online when DNS succeeds but hardware says none',
          () async {
        final fakeProvider = FakeAsyncProvider(ConnectivityResult.none);
        final service = ConnectivityService.test(
          provider: fakeProvider,
          dnsLookup: _fakeDnsSuccess,
        );
        service.setUserOfflineMode(false);

        // Initially hardware=true (default), we need to set it to false first
        // Force hardware to offline by simulating a none result without DNS
        // Use a separate call to establish offline state
        final service2 = ConnectivityService.test(
          provider: FakeAsyncProvider(ConnectivityResult.none),
          dnsLookup: _fakeDnsFailure,
        );
        service2.setUserOfflineMode(false);
        await service2.recheckConnectivity();
        expect(service2.isOnline, isFalse);
        service2.dispose();

        // Now test the DNS success path with fresh instance
        final service3 = ConnectivityService.test(
          provider: FakeAsyncProvider(ConnectivityResult.none),
          dnsLookup: _fakeDnsSuccess,
        );
        service3.setUserOfflineMode(false);
        // Force hardware state to false first
        service3.setUserOfflineMode(true);
        service3.setUserOfflineMode(false);

        await service3.recheckConnectivity();

        // DNS succeeded → hardware status changed to online
        expect(service3.isOnline, isTrue);
        service3.dispose();
      });

      test('treats as offline when DNS fails', () async {
        final fakeProvider = FakeAsyncProvider(ConnectivityResult.none);
        final service = ConnectivityService.test(
          provider: fakeProvider,
          dnsLookup: _fakeDnsFailure,
        );
        service.setUserOfflineMode(false);

        await service.recheckConnectivity();

        expect(service.isOnline, isFalse);
        service.dispose();
      });

      test('treats as offline when DNS times out', () async {
        final fakeProvider = FakeAsyncProvider(ConnectivityResult.none);
        final service = ConnectivityService.test(
          provider: fakeProvider,
          dnsLookup: _fakeDnsTimeout,
        );
        service.setUserOfflineMode(false);

        await service.recheckConnectivity();

        expect(service.isOnline, isFalse);
        service.dispose();
      }, timeout: const Timeout(Duration(seconds: 5)));
    });

    group('dispose lifecycle', () {
      test('monitorTimer is null before init', () {
        expect(service.monitorTimer, isNull);
      });

      test('dispose cancels timer and closes stream', () async {
        // Start monitoring manually (normally done by init)
        final fakeProvider = FakeAsyncProvider(ConnectivityResult.wifi);
        final service = ConnectivityService.test(
          provider: fakeProvider,
        );
        service.setUserOfflineMode(false);

        // Manually trigger monitoring via recheckConnectivity + timer start
        // Use _startMonitoring indirectly by simulating what init does
        await service.recheckConnectivity();

        // Dispose should not throw
        expect(() => service.dispose(), returnsNormally);
      });

      test('double dispose does not throw', () {
        expect(() => service.dispose(), returnsNormally);
        expect(() => service.dispose(), returnsNormally);
      });

      test('stream emits done after dispose', () async {
        final doneCompleter = Completer<void>();
        service.isOnlineStream.listen(null, onDone: doneCompleter.complete);

        service.dispose();

        await doneCompleter.future;
      });
    });

    group('resetForTesting', () {
      test('creates fresh instance with default state', () {
        ConnectivityService.resetForTesting();
        final fresh = ConnectivityService();
        expect(fresh.isOnline, isTrue);
        expect(fresh.isUserOfflineOverride, isFalse);
        expect(fresh.monitorTimer, isNull);
        fresh.dispose();
      });

      test('reset isolates instances', () async {
        ConnectivityService.resetForTesting();
        final service1 = ConnectivityService();
        service1.setUserOfflineMode(true);
        expect(service1.isUserOfflineOverride, isTrue);

        ConnectivityService.resetForTesting();
        final service2 = ConnectivityService();
        expect(service2.isUserOfflineOverride, isFalse);

        service1.dispose();
        service2.dispose();
      });
    });
  });
}
