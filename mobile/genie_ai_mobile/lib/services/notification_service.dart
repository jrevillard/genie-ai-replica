import 'dart:async';

import 'package:flutter/foundation.dart';

enum NotificationType { success, error, info, warning }

class NotificationEvent {
  final String message;
  final NotificationType type;
  final int duration;
  NotificationEvent(this.message, this.type, this.duration);
}

class NotificationService {
  static StreamController<NotificationEvent> _controller =
      StreamController.broadcast();
  static Stream<NotificationEvent> get events => _controller.stream;

  /// Reset the stream controller for test isolation.
  /// Closes the existing controller and creates a fresh one.
  @visibleForTesting
  static void resetForTesting() {
    _controller.close();
    _controller = StreamController.broadcast();
  }

  static void show(
    String msg, {
    NotificationType type = NotificationType.success,
    int dur = 3000,
  }) {
    _controller.add(NotificationEvent(msg, type, dur));
  }

  static void success(String msg) => show(msg, type: NotificationType.success);
  static void error(String msg) => show(msg, type: NotificationType.error);
  static void info(String msg) => show(msg);
  static void warning(String msg) => show(msg, type: NotificationType.warning);
}
