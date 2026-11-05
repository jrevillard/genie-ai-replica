// lib/services/connectivity_service.dart
import 'dart:async';
import 'dart:io'; // ADDED: For InternetAddress.lookup fallback
import 'package:flutter/widgets.dart';
import 'package:connectivity_plus/connectivity_plus.dart';

/// Abstract connectivity provider for dependency injection.
/// Allows unit tests to substitute a fake for the platform-backed [Connectivity].
abstract class ConnectivityProvider {
  Future<List<ConnectivityResult>> checkConnectivity();
  Stream<List<ConnectivityResult>> get onConnectivityChanged;
}

/// Production provider wrapping the real [Connectivity] plugin.
class RealConnectivityProvider implements ConnectivityProvider {
  final Connectivity _connectivity = Connectivity();

  @override
  Future<List<ConnectivityResult>> checkConnectivity() =>
      _connectivity.checkConnectivity();

  @override
  Stream<List<ConnectivityResult>> get onConnectivityChanged =>
      _connectivity.onConnectivityChanged;
}

/// Default DNS lookup function used when none is injected.
Future<List<InternetAddress>> _defaultDnsLookup(String host) =>
    InternetAddress.lookup(host);

class ConnectivityService with WidgetsBindingObserver {
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
  }) : _provider = provider ?? RealConnectivityProvider(),
       _dnsLookupFn = dnsLookup ?? _defaultDnsLookup;

  /// Public test constructor — creates a fresh (non-singleton) instance with
  /// injectable dependencies for deterministic unit tests.
  /// Production code should use the factory [ConnectivityService()] instead.
  @visibleForTesting
  factory ConnectivityService.test({
    ConnectivityProvider? provider,
    Future<List<InternetAddress>> Function(String)? dnsLookup,
  }) => ConnectivityService._internal(provider: provider, dnsLookup: dnsLookup);

  /// Reset the singleton for test isolation.
  @visibleForTesting
  static void resetForTesting() {
    _instance = null;
  }

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

  /// Watchdog cadence, from the fastest to the slowest. The watchdog uses
  /// the fastest rung while the device is reachable and climbs the ladder
  /// while it is not: a device that stays offline then pays a DNS lookup
  /// every 15, 30 and 60 seconds instead of every 5.
  static const List<Duration> _pollLadder = [
    Duration(seconds: 5),
    Duration(seconds: 15),
    Duration(seconds: 30),
    Duration(seconds: 60),
  ];

  /// Index of the rung the watchdog currently waits on.
  int _pollRung = 0;

  /// Whether the service registered itself as a lifecycle observer.
  bool _observesLifecycle = false;

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
    // 0. Watch the app lifecycle: the watchdog has no work to do while the
    // app sits in the background.
    WidgetsBinding.instance.addObserver(this);
    _observesLifecycle = true;

    // 1. Get initial hardware state
    await recheckConnectivity();

    // 2. Listen for Stream changes (Immediate reaction)
    _provider.onConnectivityChanged.listen((List<ConnectivityResult> results) {
      debugPrint('[Connectivity] Stream Event: $results');
      // Use first result or default to none
      final result = results.isNotEmpty
          ? results.first
          : ConnectivityResult.none;
      _updateHardwareStatus(result);
      // The stream is the authoritative signal that connectivity changed:
      // drop the backoff so the watchdog is quick again.
      _pollRung = 0;
      _scheduleWatchdog();
    });

    // 3. Start the watchdog (Reliability backup)
    // Catches any missed event or stuck state, on a cadence that slows
    // down while the device stays unreachable.
    _scheduleWatchdog();

    debugPrint(
      '[Connectivity] Service Initialized. Online: $isOnline (Hardware: $_isNetworkHardwareAvailable, Override: $_userOfflineOverride)',
    );
  }

  /// Schedules the next watchdog check on the current rung of the ladder.
  void _scheduleWatchdog() {
    _monitorTimer?.cancel();
    final Duration interval = _pollLadder[_pollRung];
    debugPrint(
      '[Connectivity] Watchdog scheduled in ${interval.inSeconds}s...',
    );
    _monitorTimer = Timer(interval, () async {
      // Use recheckConnectivity() because it includes the DNS fallback.
      // The previous simple check was forcing the app offline when the plugin
      // falsely reported "none" (common on Android).
      await recheckConnectivity();
      _advancePollRung();
      _scheduleWatchdog();
    });
  }

  /// Moves the watchdog one rung up the ladder while the device stays
  /// unreachable, and back to the fast cadence as soon as it is reachable.
  void _advancePollRung() {
    if (_isNetworkHardwareAvailable) {
      _pollRung = 0;
    } else if (_pollRung < _pollLadder.length - 1) {
      _pollRung++;
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      debugPrint('[Connectivity] App resumed. Restarting the watchdog.');
      _pollRung = 0;
      _scheduleWatchdog();
      unawaited(recheckConnectivity());
    } else if (state == AppLifecycleState.paused ||
        state == AppLifecycleState.hidden ||
        state == AppLifecycleState.detached) {
      debugPrint('[Connectivity] App backgrounded. Pausing the watchdog.');
      _monitorTimer?.cancel();
      _monitorTimer = null;
    }
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
      final lookup = await _dnsLookupFn(
        'google.com',
      ).timeout(const Duration(seconds: 2));
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
    _monitorTimer = null;
    if (_observesLifecycle) {
      WidgetsBinding.instance.removeObserver(this);
      _observesLifecycle = false;
    }
    if (!_statusController.isClosed) {
      _statusController.close();
    }
  }
}
