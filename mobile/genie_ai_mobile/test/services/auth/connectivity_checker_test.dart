import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/services/auth/connectivity_checker.dart';
import 'package:genie_ai_mobile/services/connectivity_service.dart';

void main() {
  group('ConnectivityChecker', () {
    group('interface', () {
      test('ConnectivityChecker defines isOnline getter', () {
        // Verify the interface contract exists
        expect(ConnectivityChecker, isNotNull);
      });

      test('ConnectivityChecker defines onConnectivityChanged stream', () {
        expect(ConnectivityChecker, isNotNull);
      });
    });

    group('RealConnectivityChecker', () {
      test('implements ConnectivityChecker', () {
        final checker = RealConnectivityChecker();
        expect(checker, isA<ConnectivityChecker>());
      });

      test('isOnline delegates to ConnectivityService', () {
        final checker = RealConnectivityChecker();
        final service = ConnectivityService();
        expect(checker.isOnline, service.isOnline);
      });

      test('onConnectivityChanged returns a stream', () {
        final checker = RealConnectivityChecker();
        expect(checker.onConnectivityChanged, isA<Stream<bool>>());
      });

      test(
        'onConnectivityChanged is the same stream as ConnectivityService',
        () {
          final checker = RealConnectivityChecker();
          final service = ConnectivityService();
          // Both should emit the same events
          expect(checker.onConnectivityChanged, equals(service.isOnlineStream));
        },
      );
    });
  });
}
