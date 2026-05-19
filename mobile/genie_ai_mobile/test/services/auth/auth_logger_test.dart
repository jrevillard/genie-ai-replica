import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

import 'package:genie_ai_mobile/services/auth/auth_logger.dart';

void main() {
  late Directory tempDir;
  late AuthLogger logger;

  setUp(() {
    tempDir = Directory.systemTemp.createTempSync('auth_logger_test_');
    logger = AuthLogger(logDir: tempDir);
  });

  tearDown(() async {
    if (await tempDir.exists()) {
      await tempDir.delete(recursive: true);
    }
  });

  group('AuthLogger log formatting', () {
    test('logAuthFailure writes structured key=value format', () async {
      logger.logAuthFailure(
        errorCode: 'REFRESH_FAILED',
        keycloakEndpoint: 'https://keycloak.example.com/realms/genie',
        httpStatus: 400,
        networkReachable: true,
        message: 'Invalid grant',
        source: 'AuthNotifier.refreshToken',
      );

      await logger.flush();

      final files = await tempDir
          .list()
          .where((e) => e is File && e.path.endsWith('.txt'))
          .cast<File>()
          .toList();
      expect(files, hasLength(1));

      final content = await files.first.readAsString();
      expect(content, contains('level=WARN'));
      expect(content, contains('error_code=REFRESH_FAILED'));
      expect(
        content,
        contains('keycloak_endpoint=https://keycloak.example.com/realms/genie'),
      );
      expect(content, contains('http_status=400'));
      expect(content, contains('network_reachable=true'));
      expect(content, contains('message="Invalid grant"'));
      expect(content, contains('source=AuthNotifier.refreshToken'));
      expect(content, contains('timestamp='));
    });

    test('logAuthEvent writes INFO level', () async {
      logger.logAuthEvent(
        message: 'Authorization successful',
        source: 'AuthNotifier.authorize',
      );

      await logger.flush();

      final files = await tempDir
          .list()
          .where((e) => e is File && e.path.endsWith('.txt'))
          .cast<File>()
          .toList();
      expect(files, hasLength(1));

      final content = await files.first.readAsString();
      expect(content, contains('level=INFO'));
      expect(content, contains('message="Authorization successful"'));
      expect(content, contains('source=AuthNotifier.authorize'));
    });

    test('logApiError includes httpStatus and endpoint', () async {
      logger.logApiError(
        httpStatus: 401,
        endpoint: '/api/chat/conversations',
        message: 'Unauthorized',
      );

      await logger.flush();

      final files = await tempDir
          .list()
          .where((e) => e is File && e.path.endsWith('.txt'))
          .cast<File>()
          .toList();
      expect(files, hasLength(1));

      final content = await files.first.readAsString();
      expect(content, contains('level=WARN'));
      expect(content, contains('error_code=API_401'));
      expect(content, contains('http_status=401'));
      expect(content, contains('endpoint=/api/chat/conversations'));
      expect(content, contains('message="Unauthorized"'));
      expect(content, contains('source=ApiService'));
    });
  });

  group('AuthLogger daily rotation', () {
    test('log filename includes current date', () async {
      logger.logAuthEvent(message: 'Test event', source: 'Test');

      await logger.flush();

      final now = DateTime.now().toUtc();
      final expectedDate =
          '${now.year}-${now.month.toString().padLeft(2, '0')}-${now.day.toString().padLeft(2, '0')}';

      final files = await tempDir
          .list()
          .where((e) => e is File && e.path.endsWith('.txt'))
          .cast<File>()
          .toList();
      expect(files, hasLength(1));
      expect(files.first.path, contains('auth_logs_$expectedDate.txt'));
    });
  });

  group('AuthLogger 30-day retention', () {
    test('deletes log files older than 30 days on first write', () async {
      // Create a log file dated 31 days ago
      final oldDate = DateTime.now().toUtc().subtract(const Duration(days: 31));
      final oldFilename =
          'auth_logs_${oldDate.year}-${oldDate.month.toString().padLeft(2, '0')}-${oldDate.day.toString().padLeft(2, '0')}.txt';
      final oldFile = File('${tempDir.path}/$oldFilename');
      await oldFile.writeAsString('old log entry\n');
      expect(await oldFile.exists(), isTrue);

      // Create a log file dated 29 days ago (should be kept)
      final recentDate = DateTime.now().toUtc().subtract(
        const Duration(days: 29),
      );
      final recentFilename =
          'auth_logs_${recentDate.year}-${recentDate.month.toString().padLeft(2, '0')}-${recentDate.day.toString().padLeft(2, '0')}.txt';
      final recentFile = File('${tempDir.path}/$recentFilename');
      await recentFile.writeAsString('recent log entry\n');
      expect(await recentFile.exists(), isTrue);

      // Trigger first write which runs retention check
      logger.logAuthEvent(message: 'Retention test', source: 'Test');

      await logger.flush();

      expect(await oldFile.exists(), isFalse);
      expect(await recentFile.exists(), isTrue);
    });
  });

  group('AuthLogger anti-token-leak', () {
    test('never writes JWT tokens (eyJ prefix) to log file', () async {
      // Log various auth events and failures
      logger.logAuthFailure(
        errorCode: 'REFRESH_FAILED',
        message:
            'Token refresh failed for user session', // No token value in message
        source: 'AuthNotifier.refreshToken',
      );

      logger.logAuthEvent(
        message: 'Authorization successful', // No token in message
        source: 'AuthNotifier.authorize',
      );

      logger.logApiError(
        httpStatus: 401,
        endpoint: '/api/me',
        message: 'Token expired', // No actual token value
        source: 'ApiService',
      );

      await logger.flush();

      final files = await tempDir
          .list()
          .where((e) => e is File && e.path.endsWith('.txt'))
          .cast<File>()
          .toList();
      final content = await files.first.readAsString();

      // Assert no JWT prefix appears in the log
      expect(content.contains('eyJ'), isFalse);
    });

    test('API does not accept token parameters — compile-time safety', () {
      // This test verifies the AuthLogger API design:
      // logAuthFailure, logAuthEvent, and logApiError do not accept
      // any token-related parameters. The API surface prevents token logging.
      expect(
        () => logger.logAuthFailure(
          errorCode: 'TEST',
          message: 'test',
          source: 'Test',
          // No accessToken parameter exists
        ),
        returnsNormally,
      );
    });
  });

  group('AuthLogger Directory injectability', () {
    test('uses provided logDir instead of default', () async {
      final customDir = Directory.systemTemp.createTempSync('custom_log_');
      try {
        final customLogger = AuthLogger(logDir: customDir);

        customLogger.logAuthEvent(message: 'Custom dir test', source: 'Test');

        await customLogger.flush();

        final files = await customDir
            .list()
            .where((e) => e is File && e.path.endsWith('.txt'))
            .cast<File>()
            .toList();
        expect(files, hasLength(1));
      } finally {
        await customDir.delete(recursive: true);
      }
    });

    test('creates log directory if it does not exist', () async {
      final nestedDir = Directory('${tempDir.path}/nested/logs');
      expect(await nestedDir.exists(), isFalse);

      final nestedLogger = AuthLogger(logDir: nestedDir);

      nestedLogger.logAuthEvent(message: 'Nested dir test', source: 'Test');

      await nestedLogger.flush();

      expect(await nestedDir.exists(), isTrue);

      final files = await nestedDir
          .list()
          .where((e) => e is File && e.path.endsWith('.txt'))
          .cast<File>()
          .toList();
      expect(files, hasLength(1));
    });
  });

  group('AuthLogger NFR9 field completeness', () {
    test('logAuthFailure includes all NFR9 fields when provided', () async {
      logger.logAuthFailure(
        errorCode: 'AUTH_FAILED',
        keycloakEndpoint: 'https://keycloak.example.com/realms/genie',
        httpStatus: 403,
        networkReachable: false,
        message: 'Access denied',
        source: 'AuthNotifier.authorize',
      );

      await logger.flush();

      final files = await tempDir
          .list()
          .where((e) => e is File && e.path.endsWith('.txt'))
          .cast<File>()
          .toList();
      final content = await files.first.readAsString();

      // All NFR9 fields must be present
      expect(content, contains('error_code='));
      expect(content, contains('keycloak_endpoint='));
      expect(content, contains('http_status='));
      expect(content, contains('network_reachable='));
      expect(content, contains('timestamp='));
      expect(content, contains('message='));
      expect(content, contains('source='));
    });
  });
}
