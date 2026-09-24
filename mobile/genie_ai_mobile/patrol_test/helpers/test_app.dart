import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:genie_ai_mobile/config/e2e_config.dart';
import 'package:genie_ai_mobile/main.dart';
import 'package:genie_ai_mobile/services/auth/auth_providers.dart';
import 'package:genie_ai_mobile/services/auth/connectivity_checker.dart';
import 'package:genie_ai_mobile/services/auth/insecure_http_client.dart';
import 'package:genie_ai_mobile/services/keycloak/keycloak_service.dart';

class FakeConnectivityChecker implements ConnectivityChecker {
  final StreamController<bool> _controller = StreamController<bool>.broadcast();

  bool _isOnline = true;

  @override
  bool get isOnline => _isOnline;

  @override
  Stream<bool> get onConnectivityChanged => _controller.stream;

  void setOnline(bool online) {
    _isOnline = online;
    _controller.add(online);
  }
}

/// Default overrides for TestApp. Tests that need to control connectivity
/// should create their own [FakeConnectivityChecker] instance and override
/// [connectivityCheckerProvider] with it.
final testProviderOverrides = [
  connectivityCheckerProvider.overrideWithValue(FakeConnectivityChecker()),
  keycloakServiceProvider.overrideWithValue(
    KeycloakService(
      keycloakConfig: e2eConfig,
      httpClient: InsecureHttpClient(),
    ),
  ),
];

/// TestApp wrapper — accepts an external [container] so tests can
/// inject tokens into the same ProviderScope instance that the widget tree uses.
class TestApp extends StatelessWidget {
  const TestApp({super.key, this.container});

  /// External ProviderContainer shared with the widget tree.
  /// Tests must create this container with [testProviderOverrides] and pass it here.
  final ProviderContainer? container;

  @override
  Widget build(BuildContext context) {
    if (container != null) {
      return UncontrolledProviderScope(
        container: container!,
        child: const MyApp(),
      );
    }
    return ProviderScope(
      overrides: testProviderOverrides,
      child: const MyApp(),
    );
  }
}
