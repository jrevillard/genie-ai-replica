import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:openapi/api.dart';

/// Stub for the CurrentUserApi the settings screen talks to. The reset
/// tests share it: [resetBody]/[resetStatus] shape the reset outcome,
/// [resetGate] holds the reset in flight (loading-state assertions), and
/// [resetCalls] lets a test observe that the reset actually ran instead
/// of only what it left behind.
class MockCurrentUserApi implements CurrentUserApi {
  MockCurrentUserApi({
    this.resetBody = const {},
    this.resetStatus = 200,
    this.resetGate,
  });

  final Map<String, dynamic> resetBody;
  final int resetStatus;

  /// When set, the reset call only completes once the test resolves it —
  /// used to hold the reset in flight while asserting on the loading state.
  final Completer<void>? resetGate;

  /// How many times the reset endpoint was called.
  int resetCalls = 0;

  @override
  Future<http.Response> apiMeGetWithHttpInfo({String? data}) async {
    return http.Response(
      jsonEncode({
        'id': 'user-1',
        'name': 'Test User',
        'email': 'test@example.test',
      }),
      200,
    );
  }

  @override
  Future<http.Response> apiMeResetDataPostWithHttpInfo() async {
    resetCalls++;
    final gate = resetGate;
    if (gate != null) await gate.future;
    return http.Response(jsonEncode(resetBody), resetStatus);
  }

  @override
  Future<http.Response> apiMePutWithHttpInfo({
    String? data,
    List<http.MultipartFile>? files,
  }) async {
    return http.Response(jsonEncode({'ok': true}), 200);
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => null;
}
