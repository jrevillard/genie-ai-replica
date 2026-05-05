import 'dart:io';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:genie_ai_mobile/services/auth/auth_providers.dart';

const _packageId = 'com.example.genie_ai_mobile.e2e';

/// Force-stop the app via adb. Kills the app process entirely,
/// simulating the OS reclaiming memory or the user swiping it away.
/// After this, the app must be relaunched via openApp().
Future<void> forceStopApp() async {
  await Process.run('adb', ['shell', 'am', 'force-stop', _packageId]);
}

/// Clear secure storage by directly calling FlutterSecureStorage.
/// This works from within the test process (no adb needed).
Future<void> clearSecureStorage() async {
  try {
    const storage = FlutterSecureStorage();
    await storage.deleteAll();
  } catch (_) {}
}

/// Clear secure storage via the ProviderContainer's token storage.
/// Use this when a container with tokenStorageProvider override is available.
Future<void> clearSecureStorageFromContainer(ProviderContainer container) async {
  try {
    await container.read(tokenStorageProvider).deleteAll();
  } catch (_) {}
}
