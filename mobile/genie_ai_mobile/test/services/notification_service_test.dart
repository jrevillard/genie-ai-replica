import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/services/notification_service.dart';

void main() {
  tearDown(() {
    NotificationService.resetForTesting();
  });

  group('NotificationService', () {
    group('show', () {
      test('dispatches event via stream', () async {
        final completer = Completer<NotificationEvent>();
        final sub = NotificationService.events.listen(completer.complete);

        NotificationService.show('Test message');

        final event = await completer.future;
        expect(event.message, 'Test message');
        expect(event.type, NotificationType.success);
        expect(event.duration, 3000);
        await sub.cancel();
      });

      test('dispatches with custom type and duration', () async {
        final completer = Completer<NotificationEvent>();
        final sub = NotificationService.events.listen(completer.complete);

        NotificationService.show(
          'Error occurred',
          type: NotificationType.error,
          dur: 5000,
        );

        final event = await completer.future;
        expect(event.message, 'Error occurred');
        expect(event.type, NotificationType.error);
        expect(event.duration, 5000);
        await sub.cancel();
      });

      test('dispatches with warning type', () async {
        final completer = Completer<NotificationEvent>();
        final sub = NotificationService.events.listen(completer.complete);

        NotificationService.show('Warning!', type: NotificationType.warning);

        final event = await completer.future;
        expect(event.type, NotificationType.warning);
        await sub.cancel();
      });

      test('dispatches with info type', () async {
        final completer = Completer<NotificationEvent>();
        final sub = NotificationService.events.listen(completer.complete);

        NotificationService.show('Info', type: NotificationType.info);

        final event = await completer.future;
        expect(event.type, NotificationType.info);
        await sub.cancel();
      });
    });

    group('convenience methods', () {
      test('success dispatches with success type', () async {
        final completer = Completer<NotificationEvent>();
        final sub = NotificationService.events.listen(completer.complete);

        NotificationService.success('Success!');

        final event = await completer.future;
        expect(event.message, 'Success!');
        expect(event.type, NotificationType.success);
        await sub.cancel();
      });

      test('error dispatches with error type', () async {
        final completer = Completer<NotificationEvent>();
        final sub = NotificationService.events.listen(completer.complete);

        NotificationService.error('Something failed');

        final event = await completer.future;
        expect(event.message, 'Something failed');
        expect(event.type, NotificationType.error);
        await sub.cancel();
      });

      test('info dispatches with success type (default)', () async {
        final completer = Completer<NotificationEvent>();
        final sub = NotificationService.events.listen(completer.complete);

        NotificationService.info('Information');

        final event = await completer.future;
        expect(event.message, 'Information');
        expect(event.type, NotificationType.success);
        await sub.cancel();
      });

      test('warning dispatches with warning type', () async {
        final completer = Completer<NotificationEvent>();
        final sub = NotificationService.events.listen(completer.complete);

        NotificationService.warning('Caution');

        final event = await completer.future;
        expect(event.message, 'Caution');
        expect(event.type, NotificationType.warning);
        await sub.cancel();
      });
    });

    group('subscription management', () {
      test('multiple subscribers receive events', () async {
        final events1 = <NotificationEvent>[];
        final events2 = <NotificationEvent>[];
        final sub1 = NotificationService.events.listen(events1.add);
        final sub2 = NotificationService.events.listen(events2.add);

        NotificationService.success('Test');
        await Future<void>.delayed(Duration.zero);

        expect(events1.length, 1);
        expect(events2.length, 1);
        expect(events1.first.message, 'Test');
        expect(events2.first.message, 'Test');
        await sub1.cancel();
        await sub2.cancel();
      });

      test('cancelled subscriber does not receive events', () async {
        final events = <NotificationEvent>[];
        final sub = NotificationService.events.listen(events.add);

        NotificationService.success('First');
        await Future<void>.delayed(Duration.zero);
        await sub.cancel();

        NotificationService.success('Second');
        await Future<void>.delayed(Duration.zero);

        expect(events.length, 1);
        expect(events.first.message, 'First');
      });
    });

    group('event payload', () {
      test('NotificationEvent has correct fields', () {
        final event = NotificationEvent('msg', NotificationType.error, 5000);
        expect(event.message, 'msg');
        expect(event.type, NotificationType.error);
        expect(event.duration, 5000);
      });

      test('NotificationType has all expected values', () {
        expect(NotificationType.values.length, 4);
        expect(NotificationType.values, contains(NotificationType.success));
        expect(NotificationType.values, contains(NotificationType.error));
        expect(NotificationType.values, contains(NotificationType.info));
        expect(NotificationType.values, contains(NotificationType.warning));
      });
    });

    group('notification filtering by type', () {
      test('can filter events by type', () async {
        final errorEvents = <NotificationEvent>[];
        final sub = NotificationService.events
            .where((e) => e.type == NotificationType.error)
            .listen(errorEvents.add);

        NotificationService.success('OK');
        NotificationService.error('Fail');
        NotificationService.success('OK2');
        await Future<void>.delayed(Duration.zero);

        expect(errorEvents.length, 1);
        expect(errorEvents.first.message, 'Fail');
        await sub.cancel();
      });
    });

    group('stream lifecycle', () {
      test('controller is a broadcast stream', () {
        final sub1 = NotificationService.events.listen((_) {});
        final sub2 = NotificationService.events.listen((_) {});
        // No error from multiple simultaneous listeners
        sub1.cancel();
        sub2.cancel();
      });

      test('multiple sequential events delivered in order', () async {
        final events = <NotificationEvent>[];
        final sub = NotificationService.events.listen(events.add);

        NotificationService.success('first');
        NotificationService.warning('second');
        NotificationService.error('third');
        await Future<void>.delayed(Duration.zero);

        expect(events.length, 3);
        expect(events[0].message, 'first');
        expect(events[0].type, NotificationType.success);
        expect(events[1].message, 'second');
        expect(events[1].type, NotificationType.warning);
        expect(events[2].message, 'third');
        expect(events[2].type, NotificationType.error);
        await sub.cancel();
      });
    });

    group('rapid-fire stress', () {
      test('all 100 events received in order', () async {
        final events = <NotificationEvent>[];
        final sub = NotificationService.events.listen(events.add);

        for (int i = 0; i < 100; i++) {
          NotificationService.info('event-$i');
        }
        await Future<void>.delayed(Duration.zero);

        expect(events.length, 100);
        for (int i = 0; i < 100; i++) {
          expect(events[i].message, 'event-$i');
        }
        await sub.cancel();
      });
    });

    group('resetForTesting', () {
      test('new controller works after reset', () async {
        NotificationService.success('before');
        await Future<void>.delayed(Duration.zero);

        NotificationService.resetForTesting();

        final events = <NotificationEvent>[];
        final sub = NotificationService.events.listen(events.add);

        NotificationService.success('after');
        await Future<void>.delayed(Duration.zero);

        expect(events.length, 1);
        expect(events.first.message, 'after');
        await sub.cancel();
      });

      test('old subscription does not receive events after reset', () async {
        final events = <NotificationEvent>[];
        final sub = NotificationService.events.listen(events.add);

        NotificationService.success('before');
        await Future<void>.delayed(Duration.zero);
        expect(events.length, 1);

        NotificationService.resetForTesting();

        NotificationService.success('after');
        await Future<void>.delayed(Duration.zero);

        // Old subscription should not receive the new event
        expect(events.length, 1);
        await sub.cancel();
      });
    });
  });
}
