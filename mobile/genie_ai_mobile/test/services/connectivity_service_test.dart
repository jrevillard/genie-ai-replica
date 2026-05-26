import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/services/connectivity_service.dart';

void main() {
  late ConnectivityService service;

  setUp(() {
    service = ConnectivityService();
    // Reset user override to default state without calling init (which needs platform plugin)
    service.setUserOfflineMode(false);
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
  });
}
