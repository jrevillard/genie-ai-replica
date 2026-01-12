// lib/services/connectivity_service.dart
import 'dart:async';
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

  // Stream controller to broadcast final "Online" status
  final StreamController<bool> _statusController = StreamController<bool>.broadcast();

  /// Exposes the final "Online" status.
  Stream<bool> get isOnlineStream => _statusController.stream;

  /// Synchronous getter for current state
  bool get isOnline => _isNetworkHardwareAvailable && !_userOfflineOverride;

  /// Initialize listeners. Should be called at app startup.
  Future<void> init() async {
    // 1. Get initial hardware state
    try {
      final ConnectivityResult result = await _connectivity.checkConnectivity();
      _updateHardwareStatus(result);
    } catch (e) {
      debugPrint('[Connectivity] Init Check Failed: $e');
      _isNetworkHardwareAvailable = true; // Default to optimistic
    }

    // 2. Listen for changes
    _connectivity.onConnectivityChanged.listen((ConnectivityResult result) {
      _updateHardwareStatus(result);
    });

    _emitStatus();
    debugPrint('[Connectivity] Service Initialized. Online: $isOnline');
  }

  void _updateHardwareStatus(ConnectivityResult result) {
    final hasConnection = result != ConnectivityResult.none;
    
    if (_isNetworkHardwareAvailable != hasConnection) {
      _isNetworkHardwareAvailable = hasConnection;
      debugPrint('[Connectivity] Hardware Status Changed: $_isNetworkHardwareAvailable');
      _emitStatus();
    }
  }

  /// Toggle the user's manual offline override.
  /// Returns the new state of the override (true = forced offline).
  bool toggleUserOfflineMode() {
    _userOfflineOverride = !_userOfflineOverride;
    debugPrint('[Connectivity] User Override Toggled: $_userOfflineOverride');
    _emitStatus();
    return _userOfflineOverride;
  }

  void _emitStatus() {
    _statusController.add(isOnline);
  }
}