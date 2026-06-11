import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/services/notification_service.dart';

void main() {
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
  });
}
