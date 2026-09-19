import 'dart:convert';
import 'dart:io';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:http/http.dart' as http;

import 'package:genie_ai_mobile/firebase_options.dart';
import 'package:genie_ai_mobile/services/notification_service.dart';

/// FCM background handler — must be a top-level function so the background
/// isolate can resolve it after the main isolate is gone.
@pragma('vm:entry-point')
Future<void> firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);
}

/// FCM push notifications (Android-focused for now). Ported from the
/// Climate-PolisenseAI branch and adapted to the Keycloak-era app:
/// - Firebase is initialized explicitly from [DefaultFirebaseOptions] instead
///   of the google-services Gradle plugin, because per-flavor applicationIds
///   (.dev/.staging/.e2e) have no matching client entry in google-services.json.
/// - The backend derives the user from the Keycloak bearer token, so the
///   register payload carries no userId; requests go through the
///   authenticated (AuthInterceptor) client.
class PushNotificationService {
  static final FlutterLocalNotificationsPlugin _localNotifications =
      FlutterLocalNotificationsPlugin();

  static bool _initialized = false;
  static String? _registeredToken;
  static String? _registeredDistrict;
  static bool _registrationInFlight = false;

  static bool get _isSupportedPlatform =>
      !kIsWeb && (Platform.isAndroid || Platform.isIOS);

  /// Initialize Firebase, permissions, channels and message handlers.
  /// Safe to call on unsupported platforms (no-op). Never throws.
  static Future<void> init() async {
    if (!_isSupportedPlatform || _initialized) return;
    try {
      await Firebase.initializeApp(
        options: DefaultFirebaseOptions.currentPlatform,
      );
      FirebaseMessaging.onBackgroundMessage(firebaseMessagingBackgroundHandler);

      final settings = await FirebaseMessaging.instance.requestPermission(
        alert: true,
        badge: true,
        sound: true,
      );
      debugPrint(
        '[NOTIF] Push permission: ${settings.authorizationStatus.name}',
      );

      const AndroidInitializationSettings androidInit =
          AndroidInitializationSettings('@mipmap/ic_launcher');
      const InitializationSettings initSettings = InitializationSettings(
        android: androidInit,
      );
      await _localNotifications.initialize(settings: initSettings);

      // Create the weather_alerts channel explicitly. The backend sends
      // channelId: 'weather_alerts'; without this, Android routes background
      // pushes to a default-importance fallback channel with no heads-up banner.
      const AndroidNotificationChannel weatherChannel =
          AndroidNotificationChannel(
            'weather_alerts',
            'Weather Alerts',
            description: 'Severe weather and climate early warnings',
            importance: Importance.max,
          );
      await _localNotifications
          .resolvePlatformSpecificImplementation<
            AndroidFlutterLocalNotificationsPlugin
          >()
          ?.createNotificationChannel(weatherChannel);

      FirebaseMessaging.onMessage.listen((RemoteMessage message) {
        debugPrint(
          '[NOTIF] Foreground message: ${message.notification?.title}',
        );
        final title = message.notification?.title;
        final body = message.notification?.body ?? '';
        NotificationService.show(
          title == null || title.isEmpty ? body : '$title — $body',
          type: NotificationType.info,
        );
        _showLocalNotification(message);
      });

      FirebaseMessaging.onMessageOpenedApp.listen((RemoteMessage message) {
        debugPrint('[NOTIF] App opened via notification: ${message.data}');
      });

      _initialized = true;
    } catch (e) {
      debugPrint('[NOTIF] Push init failed (continuing without push): $e');
    }
  }

  static Future<void> _showLocalNotification(RemoteMessage message) async {
    const AndroidNotificationDetails androidDetails =
        AndroidNotificationDetails(
          'weather_alerts',
          'Weather Alerts',
          importance: Importance.max,
          priority: Priority.high,
        );
    const NotificationDetails details = NotificationDetails(
      android: androidDetails,
    );
    await _localNotifications.show(
      id: message.hashCode,
      title: message.notification?.title,
      body: message.notification?.body,
      notificationDetails: details,
      payload: message.data.toString(),
    );
  }

  /// Register this device's FCM token with the backend. Idempotent: called on
  /// every rebuild while authenticated, but posts only when the token or the
  /// district changed. The user identity comes from the bearer token injected
  /// by [client]; [district] targets district broadcasts (same district the
  /// alert banner shows).
  static Future<void> registerDevice({
    required http.Client client,
    required String backendUrl,
    required String district,
  }) async {
    if (!_isSupportedPlatform || !_initialized || _registrationInFlight) return;

    _registrationInFlight = true;
    try {
      final token = await FirebaseMessaging.instance.getToken();
      if (token == null || token.isEmpty) {
        debugPrint('[NOTIF] No FCM token available; registration skipped');
        return;
      }
      if (token == _registeredToken && district == _registeredDistrict) return;

      final payload = {
        'fcmToken': token,
        'platform': Platform.isAndroid ? 'android' : 'ios',
        // The backend targets by DISTRICT only; crops / alertTypes are stored
        // for a future opt-out UI. They still have to name what the warning
        // engine actually emits, so leaving a stale list here (potato_ews,
        // general) would silently mismatch once opt-out ships. Crops are left
        // empty: the region's crop set lives on the server (REGION_CROPS) and
        // a hard-coded list here would exclude the others.
        'preferences': {
          'districts': [district],
          'crops': const <String>[],
          'alertTypes': const [
            'weather_warning',
            'crop_ews',
            'drought_alert',
            'flood_ews',
            'bmd_warning',
            'special_bulletin',
          ],
        },
      };

      final response = await client.post(
        Uri.parse('$backendUrl/api/notifications/register'),
        headers: const {'Content-Type': 'application/json'},
        body: jsonEncode(payload),
      );
      if (response.statusCode >= 200 && response.statusCode < 300) {
        _registeredToken = token;
        _registeredDistrict = district;
        debugPrint('[NOTIF] Device token registered for $district');
      } else {
        debugPrint(
          '[NOTIF] Device token registration failed: '
          '${response.statusCode} ${response.body}',
        );
      }
    } catch (e) {
      debugPrint('[NOTIF] Device token registration error: $e');
    } finally {
      _registrationInFlight = false;
    }
  }

  /// Deactivate this device's token on logout so alerts stop for the signed-out
  /// account. Must run while the bearer token is still valid. Never throws.
  static Future<void> unregisterDevice({
    required http.Client client,
    required String backendUrl,
  }) async {
    if (!_isSupportedPlatform || !_initialized) return;
    try {
      final token =
          _registeredToken ?? await FirebaseMessaging.instance.getToken();
      if (token == null || token.isEmpty) return;
      await client
          .post(
            Uri.parse('$backendUrl/api/notifications/unregister'),
            headers: const {'Content-Type': 'application/json'},
            body: jsonEncode({'fcmToken': token}),
          )
          .timeout(const Duration(seconds: 5));
      _registeredToken = null;
      _registeredDistrict = null;
      debugPrint('[NOTIF] Device token unregistered');
    } catch (e) {
      debugPrint('[NOTIF] Device token unregister error: $e');
    }
  }
}
