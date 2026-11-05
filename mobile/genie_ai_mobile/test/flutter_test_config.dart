import 'dart:async';

import 'package:shared_preferences/shared_preferences.dart';

/// The preferences store is a platform plugin. Without an in-memory
/// implementation every read in a test raises MissingPluginException, and
/// the asynchronous error surfaces after the test that triggered it has
/// already completed — the failure is then attributed to an unrelated test.
/// Installing the mock store here covers every test file; the files that
/// need specific values call `SharedPreferences.setMockInitialValues` with
/// their own values.
Future<void> testExecutable(FutureOr<void> Function() testMain) async {
  SharedPreferences.setMockInitialValues({});
  await testMain();
}
