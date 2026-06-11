import 'dart:async';
import 'dart:io';

import 'package:flutter_appauth_platform_interface/flutter_appauth_platform_interface.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_appauth/flutter_appauth.dart';
import 'package:http/http.dart' as http;
import 'package:genie_ai_mobile/services/auth/network_error_classifier.dart';

void main() {
  late NetworkErrorClassifier classifier;

  setUp(() {
    classifier = NetworkErrorClassifier();
  });

  group('NetworkErrorClassifier', () {
    group('isNetworkError', () {
      test('returns true for SocketException', () {
        final error = const SocketException('Host unreachable');
        expect(classifier.isNetworkError(error), isTrue);
      });

      test('returns true for ClientException', () {
        final error = http.ClientException('Connection refused');
        expect(classifier.isNetworkError(error), isTrue);
      });

      test('returns true for TimeoutException', () {
        final error = TimeoutException(
          'Request timed out',
          Duration(seconds: 30),
        );
        expect(classifier.isNetworkError(error), isTrue);
      });

      test('returns true for TlsException', () {
        final error = const TlsException('TLS handshake failed');
        expect(classifier.isNetworkError(error), isTrue);
      });

      test(
        'returns true for FlutterAppAuthPlatformException with network code',
        () {
          final error = FlutterAppAuthPlatformException(
            code: 'network_error',
            message: 'No internet connection',
            platformErrorDetails: FlutterAppAuthPlatformErrorDetails(),
          );
          expect(classifier.isNetworkError(error), isTrue);
        },
      );

      test(
        'returns true for FlutterAppAuthPlatformException with connection code',
        () {
          final error = FlutterAppAuthPlatformException(
            code: 'connection_refused',
            message: 'Connection refused',
            platformErrorDetails: FlutterAppAuthPlatformErrorDetails(),
          );
          expect(classifier.isNetworkError(error), isTrue);
        },
      );

      test(
        'returns true for FlutterAppAuthPlatformException with timeout code',
        () {
          final error = FlutterAppAuthPlatformException(
            code: 'authorization_timeout',
            message: 'Browser not responding',
            platformErrorDetails: FlutterAppAuthPlatformErrorDetails(),
          );
          expect(classifier.isNetworkError(error), isTrue);
        },
      );

      test(
        'returns true for FlutterAppAuthPlatformException with unreachable code',
        () {
          final error = FlutterAppAuthPlatformException(
            code: 'server_unreachable',
            message: 'Server unreachable',
            platformErrorDetails: FlutterAppAuthPlatformErrorDetails(),
          );
          expect(classifier.isNetworkError(error), isTrue);
        },
      );

      test(
        'returns true for FlutterAppAuthPlatformException with no_browser code',
        () {
          final error = FlutterAppAuthPlatformException(
            code: 'no_browser_available',
            message: 'No browser available',
            platformErrorDetails: FlutterAppAuthPlatformErrorDetails(),
          );
          expect(classifier.isNetworkError(error), isTrue);
        },
      );

      test('returns false for generic Exception', () {
        expect(classifier.isNetworkError(Exception('Generic error')), isFalse);
      });

      test('returns false for ArgumentError', () {
        expect(
          classifier.isNetworkError(ArgumentError('Invalid param')),
          isFalse,
        );
      });

      test(
        'returns false for FlutterAppAuthPlatformException with invalid_grant',
        () {
          final error = FlutterAppAuthPlatformException(
            code: 'invalid_grant',
            message: 'Invalid credentials',
            platformErrorDetails: FlutterAppAuthPlatformErrorDetails(),
          );
          expect(classifier.isNetworkError(error), isFalse);
        },
      );

      test(
        'returns false for FlutterAppAuthPlatformException with invalid_client',
        () {
          final error = FlutterAppAuthPlatformException(
            code: 'invalid_client',
            message: 'Invalid client',
            platformErrorDetails: FlutterAppAuthPlatformErrorDetails(),
          );
          expect(classifier.isNetworkError(error), isFalse);
        },
      );

      test('returns false for String (non-exception)', () {
        expect(classifier.isNetworkError('just a string'), isFalse);
      });
    });
  });
}
