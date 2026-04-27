import 'dart:async';
import 'dart:io';

import 'package:path_provider/path_provider.dart';
import 'package:talker/talker.dart';

class AuthLogger {
  final Directory? logDir;
  final Talker _talker;
  bool _retentionChecked = false;
  Future<void> _writeChain = Future.value();

  AuthLogger({this.logDir})
      : _talker = Talker(
          settings: TalkerSettings(
            useHistory: true,
            useConsoleLogs: true,
          ),
        );

  Future<Directory> _getLogDir() async {
    if (logDir != null) return logDir!;
    return getApplicationDocumentsDirectory();
  }

  String _logFileName() {
    final now = DateTime.now().toUtc();
    final date = '${now.year}-${_twoDigits(now.month)}-${_twoDigits(now.day)}';
    return 'auth_logs_$date.txt';
  }

  String _twoDigits(int n) => n.toString().padLeft(2, '0');

  Future<void> _ensureRetentionChecked() async {
    if (_retentionChecked) return;
    _retentionChecked = true;
    await _cleanOldLogs();
  }

  Future<void> _cleanOldLogs() async {
    try {
      final dir = await _getLogDir();
      if (!await dir.exists()) return;
      final cutoff = DateTime.now().toUtc().subtract(const Duration(days: 30));
      await for (final entity in dir.list()) {
        if (entity is File && _isAuthLogFile(entity)) {
          final date = _parseDateFromFilename(entity.uri.pathSegments.last);
          if (date != null && date.isBefore(cutoff)) {
            await entity.delete();
          }
        }
      }
    } catch (_) {
      // Retention cleanup must never crash the app
    }
  }

  bool _isAuthLogFile(File file) {
    return file.uri.pathSegments.last.startsWith('auth_logs_') &&
        file.uri.pathSegments.last.endsWith('.txt');
  }

  DateTime? _parseDateFromFilename(String filename) {
    final match = RegExp(r'auth_logs_(\d{4})-(\d{2})-(\d{2})\.txt$')
        .firstMatch(filename);
    if (match == null) return null;
    try {
      return DateTime.utc(
        int.parse(match.group(1)!),
        int.parse(match.group(2)!),
        int.parse(match.group(3)!),
      );
    } catch (_) {
      return null;
    }
  }

  Future<void> _writeToFile(String line) {
    _writeChain = _writeChain.then((_) async {
      try {
        await _ensureRetentionChecked();
        final dir = await _getLogDir();
        await dir.create(recursive: true);
        final file = File('${dir.path}/${_logFileName()}');
        await file.writeAsString('$line\n', mode: FileMode.append);
      } catch (_) {
        // File logging must never crash the app
      }
    });
    return _writeChain;
  }

  /// Wait for all pending log writes (including retention cleanup) to complete.
  Future<void> flush() => _writeChain;

  void _logStructured({
    required String level,
    String? errorCode,
    String? keycloakEndpoint,
    int? httpStatus,
    bool? networkReachable,
    required String message,
    required String source,
    String? endpoint,
  }) {
    final timestamp = DateTime.now().toUtc().toIso8601String();
    final parts = <String>[
      'timestamp=$timestamp',
      'level=$level',
      if (errorCode != null) 'error_code=$errorCode',
      if (keycloakEndpoint != null) 'keycloak_endpoint=$keycloakEndpoint',
      if (httpStatus != null) 'http_status=$httpStatus',
      if (networkReachable != null) 'network_reachable=$networkReachable',
      if (endpoint != null) 'endpoint=$endpoint',
      'message="$message"',
      'source=$source',
    ];
    final line = parts.join(' ');

    unawaited(_writeToFile(line));

    final consoleParts = <String>[
      '[$source]',
      message,
      if (errorCode != null) 'err=$errorCode',
      if (httpStatus != null) 'status=$httpStatus',
    ];
    final consoleMsg = consoleParts.join(' ');

    switch (level) {
      case 'WARN':
        _talker.warning(consoleMsg);
      case 'ERROR':
        _talker.error(consoleMsg);
      default:
        _talker.info(consoleMsg);
    }
  }

  /// Log an authentication failure with structured NFR9 fields.
  /// Tokens and PII must NEVER be passed — the API does not accept them.
  void logAuthFailure({
    required String errorCode,
    String? keycloakEndpoint,
    int? httpStatus,
    bool? networkReachable,
    required String message,
    required String source,
  }) {
    _logStructured(
      level: 'WARN',
      errorCode: errorCode,
      keycloakEndpoint: keycloakEndpoint,
      httpStatus: httpStatus,
      networkReachable: networkReachable,
      message: message,
      source: source,
    );
  }

  /// Log a non-failure auth event (login success, logout, token refresh success).
  void logAuthEvent({
    required String message,
    required String source,
  }) {
    _logStructured(
      level: 'INFO',
      message: message,
      source: source,
    );
  }

  /// Log an API-layer error (401, network errors).
  void logApiError({
    required int httpStatus,
    required String endpoint,
    required String message,
    String source = 'ApiService',
    bool? networkReachable,
  }) {
    _logStructured(
      level: 'WARN',
      errorCode: 'API_$httpStatus',
      httpStatus: httpStatus,
      endpoint: endpoint,
      networkReachable: networkReachable,
      message: message,
      source: source,
    );
  }
}
