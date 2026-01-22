// lib/services/connectivity_service.dart
import 'dart:async';
import 'dart:io'; // ADDED: For InternetAddress.lookup fallback
import 'package:flutter/foundation.dart';
import 'package:connectivity_plus/connectivity_plus.dart';

class ConnectivityService {
  static final ConnectivityService _instance = ConnectivityService._internal();
  factory ConnectivityService() => _instance;
  ConnectivityService._internal();

  final Connectivity _connectivity = Connectivity();

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
    _connectivity.onConnectivityChanged.listen((ConnectivityResult result) {
      debugPrint('[Connectivity] Stream Event: $result');
      _updateHardwareStatus(result);
    });

    // 3. Start Periodic Polling (Reliability backup)
    // Checks every 5 seconds to catch any missed events or stuck states
    _startMonitoring();

    debugPrint(
        '[Connectivity] Service Initialized. Online: $isOnline (Hardware: $_isNetworkHardwareAvailable, Override: $_userOfflineOverride)');
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
      ConnectivityResult result = await _connectivity.checkConnectivity();
      // debugPrint('[Connectivity] Raw hardware check result: $result');

      // FALLBACK CHECK:
      // If plugin says "None", but we are actually connected (e.g. WiFi handling is slow),
      // try a real network request (DNS lookup).
      if (result == ConnectivityResult.none) {
        // debugPrint('[Connectivity] Hardware says NONE. Attempting DNS lookup fallback...');
        try {
          final stopwatch = Stopwatch()..start();
          final lookup = await InternetAddress.lookup('google.com')
              .timeout(const Duration(seconds: 2));
          stopwatch.stop();

          if (lookup.isNotEmpty && lookup[0].rawAddress.isNotEmpty) {
            debugPrint(
                '[Connectivity] Hardware said NONE, but DNS lookup succeeded (${stopwatch.elapsedMilliseconds}ms). Forcing Online.');
            // Treat as mobile (doesn't matter which, as long as not none)
            result = ConnectivityResult.mobile;
          }
        } catch (e) {
          // Lookup failed, so we really are offline.
        }
      }

      _updateHardwareStatus(result);
    } catch (e) {
      debugPrint('[Connectivity] Recheck failed: $e');
    } finally {
      _isChecking = false;
    }
  }

  void _updateHardwareStatus(ConnectivityResult result) {
    // FIX: Check single enum value
    final bool hasConnection = result != ConnectivityResult.none;

    // Only emit if state effectively changes
    if (_isNetworkHardwareAvailable != hasConnection) {
      debugPrint(
          '[Connectivity] Hardware Status Changed: $result (Available: $hasConnection)');
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
        '[Connectivity] User toggling offline mode. Current Override: $_userOfflineOverride');
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
        '[Connectivity] User Override Toggled Final State: $_userOfflineOverride');
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
        '[Connectivity] Emitting final status: $status (Hardware: $_isNetworkHardwareAvailable, UserOverride: $_userOfflineOverride)');
    _statusController.add(status);
  }

  void dispose() {
    debugPrint('[Connectivity] Disposing service.');
    _monitorTimer?.cancel();
    _statusController.close();
  }
}
