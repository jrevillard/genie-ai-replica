import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

enum NotificationType { success, error, info, warning }

class NotificationEvent {
  final String message;
  final String? title;
  final NotificationType type;
  final int duration;
  final Map<String, dynamic>? data;

  NotificationEvent(this.message, {this.title, this.type = NotificationType.success, this.duration = 3000, this.data});
}

class NotificationService {
  static final StreamController<NotificationEvent> _controller = StreamController.broadcast();
  static Stream<NotificationEvent> get events => _controller.stream;

  // Firebase & Local Notification Instances
  static final FirebaseMessaging _messaging = FirebaseMessaging.instance;
  static final FlutterLocalNotificationsPlugin _localNotifications = FlutterLocalNotificationsPlugin();

  /// Initialize all notification services
  static Future<void> init() async {
    // 1. Request Permissions (iOS/Android 13+)
    NotificationSettings settings = await _messaging.requestPermission(
      alert: true,
      badge: true,
      sound: true,
    );

    if (settings.authorizationStatus == AuthorizationStatus.authorized) {
      debugPrint('[NOTIF] User granted permission');
    }

    // 2. Initialize Local Notifications (for Foreground Banners)
    const AndroidInitializationSettings androidInit = AndroidInitializationSettings('@mipmap/ic_launcher');
    const InitializationSettings initSettings = InitializationSettings(android: androidInit);
    await _localNotifications.initialize(initSettings);

    // 3. Handle Foreground Messages
    FirebaseMessaging.onMessage.listen((RemoteMessage message) {
      debugPrint('[NOTIF] Foreground message received: ${message.notification?.title}');
      
      // Trigger in-app popup/event
      _controller.add(NotificationEvent(
        message.notification?.body ?? '',
        title: message.notification?.title,
        type: NotificationType.info,
        data: message.data,
      ));

      // Also show a local notification banner if desired even when app is open
      _showLocalNotification(message);
    });

    // 4. Handle Background/Terminated Click (App opened via notification)
    FirebaseMessaging.onMessageOpenedApp.listen((RemoteMessage message) {
      debugPrint('[NOTIF] App opened via notification: ${message.data}');
      // TODO: Navigate to specific screen based on message.data
    });
  }

  /// Manually show a local notification banner
  static Future<void> _showLocalNotification(RemoteMessage message) async {
    const AndroidNotificationDetails androidDetails = AndroidNotificationDetails(
      'high_importance_channel', 
      'High Importance Notifications',
      importance: Importance.max,
      priority: Priority.high,
    );
    const NotificationDetails details = NotificationDetails(android: androidDetails);

    await _localNotifications.show(
      message.hashCode,
      message.notification?.title,
      message.notification?.body,
      details,
      payload: message.data.toString(),
    );
  }

  /// Get FCM Token for Backend Registration
  static Future<String?> getDeviceToken() async {
    try {
      return await _messaging.getToken();
    } catch (e) {
      debugPrint('[NOTIF] Error getting token: $e');
      return null;
    }
  }

  // Legacy In-App UI helpers
  static void show(String msg, {NotificationType type = NotificationType.success, int dur = 3000}) {
    _controller.add(NotificationEvent(msg, type: type, duration: dur));
  }

  static void success(String msg) => show(msg, type: NotificationType.success);
  static void error(String msg) => show(msg, type: NotificationType.error);
  static void info(String msg) => show(msg, type: NotificationType.info);
  static void warning(String msg) => show(msg, type: NotificationType.warning);
}
