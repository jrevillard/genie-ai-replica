// lib/services/connectivity_service.dart
import 'dart:async';
import 'dart:io'; // ADDED: For InternetAddress.lookup fallback
import 'package:flutter/foundation.dart';
import 'package:connectivity_plus/connectivity_plus.dart';

/// Abstract connectivity provider for dependency injection.
/// Allows unit tests to substitute a fake for the platform-backed [Connectivity].
abstract class ConnectivityProvider {
  Future<List<ConnectivityResult>> checkConnectivity();
}

/// Production provider wrapping the real [Connectivity] plugin.
class RealConnectivityProvider implements ConnectivityProvider {
  final Connectivity _connectivity = Connectivity();

  @override
  Future<List<ConnectivityResult>> checkConnectivity() =>
      _connectivity.checkConnectivity();
}

/// Default DNS lookup function used when none is injected.
Future<List<InternetAddress>> _defaultDnsLookup(String host) =>
    InternetAddress.lookup(host);

class ConnectivityService {
  static ConnectivityService? _instance;
  factory ConnectivityService() =>
      _instance ??= ConnectivityService._internal();

  /// Create an instance with optional test dependencies.
  /// Production code should use the factory [ConnectivityService()] instead.
  /// Tests pass a fake [provider] and/or [dnsLookup] for deterministic behavior.
  /// Accessible from test files via package imports (Dart library privacy).
  ConnectivityService._internal({
    ConnectivityProvider? provider,
    Future<List<InternetAddress>> Function(String)? dnsLookup,
  })  : _provider = provider ?? RealConnectivityProvider(),
        _dnsLookupFn = dnsLookup ?? _defaultDnsLookup;

  /// Public test constructor — creates a fresh (non-singleton) instance with
  /// injectable dependencies for deterministic unit tests.
  /// Production code should use the factory [ConnectivityService()] instead.
  @visibleForTesting
  factory ConnectivityService.test({
    ConnectivityProvider? provider,
    Future<List<InternetAddress>> Function(String)? dnsLookup,
  }) =>
      ConnectivityService._internal(provider: provider, dnsLookup: dnsLookup);

  /// Reset the singleton for test isolation.
  @visibleForTesting
  static void resetForTesting() {
    _instance = null;
  }

  final Connectivity _connectivity = Connectivity();
  final ConnectivityProvider _provider;
  final Future<List<InternetAddress>> Function(String) _dnsLookupFn;

  // Internal state
  bool _isNetworkHardwareAvailable = true;
  bool _userOfflineOverride = false;

  // Concurrency guard to prevent overlapping checks
  bool _isChecking = false;

  // Stream controller to broadcast final "Online" status
  final StreamController<bool> _statusController =
      StreamController<bool>.broadcast();

  // Polling timer for reliability
  Timer? _monitorTimer;

  /// Exposes the monitor timer for test assertions.
  @visibleForTesting
  Timer? get monitorTimer => _monitorTimer;

  /// Exposes the final "Online" status.
  Stream<bool> get isOnlineStream => _statusController.stream;

  /// Synchronous getter for current state
  bool get isOnline => _isNetworkHardwareAvailable && !_userOfflineOverride;

  /// Getter for the specific override flag (for UI toggles)
  bool get isUserOfflineOverride => _userOfflineOverride;

  /// Initialize listeners. Should be called at app startup.
  Future<void> init() async {
    debugPrint('[Connectivity] Init called. Starting service...');
    // 1. Get initial hardware state
    await recheckConnectivity();

    // 2. Listen for Stream changes (Immediate reaction)
    _connectivity.onConnectivityChanged.listen((
      List<ConnectivityResult> results,
    ) {
      debugPrint('[Connectivity] Stream Event: $results');
      // Use first result or default to none
      final result = results.isNotEmpty
          ? results.first
          : ConnectivityResult.none;
      _updateHardwareStatus(result);
    });

    // 3. Start Periodic Polling (Reliability backup)
    // Checks every 5 seconds to catch any missed events or stuck states
    _startMonitoring();

    debugPrint(
      '[Connectivity] Service Initialized. Online: $isOnline (Hardware: $_isNetworkHardwareAvailable, Override: $_userOfflineOverride)',
    );
  }

  void _startMonitoring() {
    debugPrint('[Connectivity] Starting watchdog timer (5s interval)...');
    _monitorTimer?.cancel();
    _monitorTimer = Timer.periodic(const Duration(seconds: 5), (_) async {
      // FIX: Use recheckConnectivity() because it includes the DNS fallback.
      // The previous simple check was forcing the app offline when the plugin
      // falsely reported "none" (common on Android).
      await recheckConnectivity();
    });
  }

  /// Forces a fresh check of the hardware status.
  /// Uses DNS fallback if hardware reports offline but internet might be available.
  Future<void> recheckConnectivity() async {
    // Prevent overlapping checks (e.g. Watchdog + Manual Toggle firing at once)
    if (_isChecking) {
      // debugPrint('[Connectivity] Check already in progress. Skipping.');
      return;
    }
    _isChecking = true;

    try {
      List<ConnectivityResult> results = await _provider.checkConnectivity();
      // Use first result or default to none
      ConnectivityResult result = results.isNotEmpty
          ? results.first
          : ConnectivityResult.none;
      // debugPrint('[Connectivity] Raw hardware check result: $result');

      // FALLBACK CHECK:
      // If plugin says "None", but we are actually connected (e.g. WiFi handling is slow),
      // try a real network request (DNS lookup).
      if (result == ConnectivityResult.none) {
        // debugPrint('[Connectivity] Hardware says NONE. Attempting DNS lookup fallback...');
        result = await _applyDnsFallback(result);
      }

      _updateHardwareStatus(result);
    } catch (e) {
      debugPrint('[Connectivity] Recheck failed: $e');
    } finally {
      _isChecking = false;
    }
  }

  /// Attempts DNS lookup as a fallback when hardware reports offline.
  /// Returns the original result if DNS fails, or [ConnectivityResult.mobile]
  /// if DNS succeeds (indicating real internet despite hardware reporting none).
  Future<ConnectivityResult> _applyDnsFallback(
    ConnectivityResult result,
  ) async {
    try {
      final stopwatch = Stopwatch()..start();
      final lookup = await _dnsLookupFn('google.com').timeout(
        const Duration(seconds: 2),
      );
      stopwatch.stop();

      if (lookup.isNotEmpty && lookup[0].rawAddress.isNotEmpty) {
        debugPrint(
          '[Connectivity] Hardware said NONE, but DNS lookup succeeded '
          '(${stopwatch.elapsedMilliseconds}ms). Forcing Online.',
        );
        return ConnectivityResult.mobile;
      }
    } catch (e) {
      // Lookup failed, so we really are offline.
    }
    return result;
  }

  void _updateHardwareStatus(ConnectivityResult result) {
    // FIX: Check single enum value
    final bool hasConnection = result != ConnectivityResult.none;

    // Only emit if state effectively changes
    if (_isNetworkHardwareAvailable != hasConnection) {
      debugPrint(
        '[Connectivity] Hardware Status Changed: $result (Available: $hasConnection)',
      );
      _isNetworkHardwareAvailable = hasConnection;
      _emitStatus();
    } else {
      // debugPrint('[Connectivity] Status unchanged. Ignoring update.');
    }
  }

  /// Toggle the user's manual offline override.
  /// Returns the new state of the override (true = forced offline).
  Future<bool> toggleUserOfflineMode() async {
    debugPrint(
      '[Connectivity] User toggling offline mode. Current Override: $_userOfflineOverride',
    );
    _userOfflineOverride = !_userOfflineOverride;

    // If going ONLINE, force a check immediately to ensure we are actually connected
    if (!_userOfflineOverride) {
      debugPrint('[Connectivity] User wants ONLINE. Forcing hardware check...');
      await recheckConnectivity();
    }

    // FIX: Always emit status here. Even if hardware didn't change (e.g. WiFi was already on),
    // the User Override flag DID change, so the final "Online" status has changed.
    _emitStatus();

    debugPrint(
      '[Connectivity] User Override Toggled Final State: $_userOfflineOverride',
    );
    return _userOfflineOverride;
  }

  /// Sets the override explicitly.
  void setUserOfflineMode(bool isOffline) {
    debugPrint('[Connectivity] Setting user offline mode explicit: $isOffline');
    if (_userOfflineOverride != isOffline) {
      _userOfflineOverride = isOffline;
      _emitStatus();
    }
  }

  void _emitStatus() {
    final bool status = isOnline;
    debugPrint(
      '[Connectivity] Emitting final status: $status (Hardware: $_isNetworkHardwareAvailable, UserOverride: $_userOfflineOverride)',
    );
    _statusController.add(status);
  }

  void dispose() {
    debugPrint('[Connectivity] Disposing service.');
    _monitorTimer?.cancel();
    if (!_statusController.isClosed) {
      _statusController.close();
    }
  }
}
