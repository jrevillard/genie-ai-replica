import 'dart:async';

import '../connectivity_service.dart';

abstract class ConnectivityChecker {
  bool get isOnline;
  Stream<bool> get onConnectivityChanged;
}

class RealConnectivityChecker implements ConnectivityChecker {
  final ConnectivityService _service = ConnectivityService();

  @override
  bool get isOnline => _service.isOnline;

  @override
  Stream<bool> get onConnectivityChanged => _service.isOnlineStream;
}
