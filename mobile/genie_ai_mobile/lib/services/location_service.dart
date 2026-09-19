import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:geolocator/geolocator.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

/// A device position; kept minimal so tests can inject one without geolocator.
typedef DevicePosition = ({double lat, double lon});

/// Supplies the device position (null when unavailable / refused).
typedef PositionProvider = Future<DevicePosition?> Function();

/// District the app treats as "my area" (parity with the web
/// `config/defaultLocation.js` + `CropAlertBanner.resolveDistrict`):
/// the district nearest to the device location, cached for a day, else the
/// deployment default served by `GET /api/weather/default-location`
/// (DEFAULT_LOCATION in the server .env; Dhaka when unset).
///
/// Notifies listeners whenever the resolved district changes so the alert
/// banner re-polls and the push registration is refreshed.
class LocationService extends ChangeNotifier {
  LocationService._();
  static final LocationService _instance = LocationService._();
  factory LocationService() => _instance;

  /// Placeholder that config prompts use for "the user's district".
  static const String placeholder = '{{location}}';
  static const String builtInDefault = 'Dhaka';
  static const String cacheKey = 'mewa_alert_district';
  static const Duration cacheTtl = Duration(hours: 24);

  String _defaultDistrict = builtInDefault;
  String? _resolvedDistrict;
  bool _initialized = false;
  bool _defaultLoaded = false;
  Future<void>? _inFlight;

  /// District used for alerts and `{{location}}` prompts.
  String get district => _resolvedDistrict ?? _defaultDistrict;
  String get defaultDistrict => _defaultDistrict;
  bool get isInitialized => _initialized;

  /// True once [district] names a real place: the device district or the
  /// deployment default fetched from the server. False while it is still the
  /// built-in placeholder, so callers (the alert banner) can hold off rather
  /// than show another district's warnings before the location is known.
  bool get hasResolvedDistrict => _resolvedDistrict != null || _defaultLoaded;

  /// Replace every `{{location}}` in [text] with the resolved district.
  /// Non-string / null input is returned unchanged.
  String? fillPlaceholder(String? text) {
    if (text == null || !text.contains(placeholder)) return text;
    return text.split(placeholder).join(district);
  }

  /// Make sure a prompt can be filled with a real place before it is sent:
  /// starts [init] if needed and waits for it (bounded by [cap]); if the
  /// deployment default could not be fetched earlier (offline, gateway down)
  /// it is retried. Without this a chip tapped right after login was filled
  /// with the built-in Dhaka fallback instead of the deployment default.
  Future<void> ensureReady({
    required http.Client client,
    required String backendUrl,
    Duration cap = const Duration(seconds: 6),
  }) async {
    if (!_initialized) {
      await Future.any([
        init(client: client, backendUrl: backendUrl),
        Future<void>.delayed(cap),
      ]);
    }
    if (!_defaultLoaded) {
      final before = district;
      await _loadDefault(client, backendUrl);
      if (district != before) notifyListeners();
    }
  }

  /// Resolve the deployment default and the device district. Idempotent:
  /// concurrent callers share the same future; later calls are no-ops.
  /// Never throws — every failure keeps the current fallback.
  Future<void> init({
    required http.Client client,
    required String backendUrl,
    PositionProvider? positionProvider,
  }) {
    if (_initialized) return Future.value();
    return _inFlight ??=
        _init(
          client: client,
          backendUrl: backendUrl,
          positionProvider: positionProvider ?? _devicePosition,
        ).whenComplete(() {
          _initialized = true;
          _inFlight = null;
          // Always wake listeners once resolution has settled, even when the
          // district string is unchanged: the banner defers its first poll
          // until hasResolvedDistrict and needs this signal to start.
          notifyListeners();
        });
  }

  Future<void> _init({
    required http.Client client,
    required String backendUrl,
    required PositionProvider positionProvider,
  }) async {
    await _loadDefault(client, backendUrl);
    if (!await _loadCached()) {
      await _resolveFromDevice(client, backendUrl, positionProvider);
    }
  }

  Future<void> _loadDefault(http.Client client, String backendUrl) async {
    try {
      final resp = await client
          .get(Uri.parse('$backendUrl/api/weather/default-location'))
          .timeout(const Duration(seconds: 8));
      if (resp.statusCode == 200) {
        final name =
            (jsonDecode(utf8.decode(resp.bodyBytes)) as Map)['location']
                ?.toString();
        if (name != null && name.trim().isNotEmpty) {
          _defaultDistrict = name.trim();
          _defaultLoaded = true;
        }
      }
    } catch (e) {
      debugPrint('[LOCATION] default-location unavailable: $e');
    }
  }

  Future<bool> _loadCached() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(cacheKey);
      if (raw == null) return false;
      final cached = jsonDecode(raw) as Map;
      final at = DateTime.fromMillisecondsSinceEpoch(
        (cached['at'] as num?)?.toInt() ?? 0,
      );
      final name = cached['district']?.toString();
      if (name != null &&
          name.isNotEmpty &&
          DateTime.now().difference(at) < cacheTtl) {
        _resolvedDistrict = name;
        return true;
      }
    } catch (_) {
      // corrupt cache entry: fall through to a fresh resolution
    }
    return false;
  }

  Future<void> _resolveFromDevice(
    http.Client client,
    String backendUrl,
    PositionProvider positionProvider,
  ) async {
    try {
      final pos = await positionProvider();
      if (pos == null) return;
      final uri = Uri.parse(
        '$backendUrl/api/weather/nearest-district',
      ).replace(queryParameters: {'lat': '${pos.lat}', 'lon': '${pos.lon}'});
      final resp = await client.get(uri).timeout(const Duration(seconds: 8));
      if (resp.statusCode != 200) return;
      final name = (jsonDecode(utf8.decode(resp.bodyBytes)) as Map)['district']
          ?.toString();
      if (name == null || name.isEmpty) return; // outside Bangladesh
      _resolvedDistrict = name;
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(
        cacheKey,
        jsonEncode({
          'district': name,
          'at': DateTime.now().millisecondsSinceEpoch,
        }),
      );
    } catch (e) {
      debugPrint('[LOCATION] district resolution skipped: $e');
    }
  }

  static Future<DevicePosition?> _devicePosition() async {
    if (kIsWeb) return null;
    if (!await Geolocator.isLocationServiceEnabled()) return null;
    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
    if (permission == LocationPermission.denied ||
        permission == LocationPermission.deniedForever) {
      return null;
    }
    Position? pos;
    try {
      pos = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.low,
          timeLimit: Duration(seconds: 8),
        ),
      );
    } on TimeoutException {
      // No fresh fix (indoors, emulator): a district-level answer only needs
      // the last known position.
      pos = await Geolocator.getLastKnownPosition();
    }
    if (pos == null) return null;
    return (lat: pos.latitude, lon: pos.longitude);
  }

  /// Mark the service resolved with [defaultDistrict] without any network or
  /// device access, and wake listeners (tests only).
  @visibleForTesting
  void markReadyForTesting({String defaultDistrict = builtInDefault}) {
    _defaultDistrict = defaultDistrict;
    _defaultLoaded = true;
    _initialized = true;
    notifyListeners();
  }

  /// Reset to the pristine state (tests only).
  @visibleForTesting
  void resetForTesting() {
    _defaultDistrict = builtInDefault;
    _resolvedDistrict = null;
    _initialized = false;
    _defaultLoaded = false;
    _inFlight = null;
  }
}
